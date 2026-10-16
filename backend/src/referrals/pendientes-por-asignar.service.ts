import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  brandWhiteLabelWhere,
  resolveBrandScope,
} from '../common/white-label/brand-scope.util';
import { AuditService } from '../audit/audit.service';
import { ReferralsService } from './referrals.service';
import {
  CODIGO_VENTA_DIRECTA,
  DATOS_CODIGO_VENTA_DIRECTA,
  codigoVentaDirectaEsSeguro,
  esAtribucionQueCobra,
  esCodigoVentaDirecta,
  esPendientePorAsignar,
  haCobrado,
  primerCobro,
} from './pendiente-por-asignar';

type CobroResumen = {
  fecha: string;
  montoUsd: number;
  pasarela: string;
};

export type NegocioPorAsignar = {
  tenantId: string;
  brandName: string;
  status: string;
  planPeriodicity: string | null;
  /** Primer cobro PAGADO del libro. Null = solo se sabe que tiene suscripción real. */
  primerCobro: CobroResumen | null;
  cobros: number;
  totalUsd: number;
  /** Si pertenece a un grupo empresarial SIN afiliado: se asigna en el grupo. */
  businessGroup: { id: string; name: string } | null;
};

export type NegocioVentaDirecta = Omit<NegocioPorAsignar, 'businessGroup'> & {
  /** Cuándo se marcó como venta directa. */
  marcadoEl: string;
};

/**
 * «Pendientes por asignar vendedor» y «Venta directa». Ver la regla y el
 * porqué del diseño en `pendiente-por-asignar.ts`.
 *
 * Solo negocios de la PLATAFORMA (Clubify): en una marca blanca la venta y sus
 * comisiones son de la marca, y el controlador ya corta con `SoloPlataformaGuard`.
 *
 * No calcula comisiones: asignar va por `ReferralsService.setTenantAssignment`,
 * el mismo camino que usa la ficha del negocio y «Pagos por aprobar», para que
 * la comisión salga con la lógica de siempre (y el mismo rastro de auditoría).
 */
@Injectable()
export class PendientesPorAsignarService {
  private readonly logger = new Logger(PendientesPorAsignarService.name);
  private ventaDirectaId: string | null = null;

  constructor(
    private prisma: PrismaService,
    private referrals: ReferralsService,
    private audit: AuditService,
  ) {}

  /** WHERE de los negocios de la plataforma (Clubify + legacy sin marca). */
  private async wherePlataforma(): Promise<Record<string, any>> {
    const scope = await resolveBrandScope(this.prisma, null);
    return brandWhiteLabelWhere(scope);
  }

  /**
   * El código de venta directa; si no existe, lo crea.
   *
   * Se crea solo (sin script) porque es UNA fila, no un cambio de esquema, y es
   * idempotente: `code` es único, así que si dos peticiones llegan a la vez la
   * segunda choca con P2002 y relee la que ganó.
   */
  async asegurarCodigoVentaDirecta(): Promise<string> {
    if (this.ventaDirectaId) return this.ventaDirectaId;
    const leer = () =>
      this.prisma.referralCode.findUnique({
        where: { code: CODIGO_VENTA_DIRECTA },
        select: {
          id: true,
          role: true,
          commissionPercent: true,
          fixedCommissionUsd: true,
          parentCodeId: true,
          parentEmbajadorCodeId: true,
        },
      });
    let codigo = await leer();
    if (!codigo) {
      const scope = await resolveBrandScope(this.prisma, null);
      try {
        await this.prisma.referralCode.create({
          data: {
            ...DATOS_CODIGO_VENTA_DIRECTA,
            whiteLabelId: scope.clubifyId,
          },
        });
        this.logger.log('Creado el código de venta directa (VENTA_DIRECTA)');
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e;
      }
      codigo = await leer();
    }
    if (!codigo) throw new Error('No se pudo crear el código de venta directa');
    if (!codigoVentaDirectaEsSeguro(codigo)) {
      // Alguien lo editó (le puso %, lo colgó de un embajador…): asignarlo
      // pagaría comisión a quien no vendió. No se arregla solo a escondidas.
      throw new ConflictException(
        'El código VENTA_DIRECTA fue modificado (tiene comisión o depende de alguien). ' +
          'Debe quedar como vendedor al 0 % y sin padre antes de usarlo.',
      );
    }
    this.ventaDirectaId = codigo.id;
    return codigo.id;
  }

  /**
   * Lee todo lo necesario en tres consultas (negocios, libro y atribuciones) y
   * decide en memoria con la regla pura. Son unos cientos de negocios.
   */
  private async leerTodo() {
    const plataforma = await this.wherePlataforma();
    return TenantContext.runWithoutTenant(async () => {
      // El `await` va DENTRO: fuera del bloque la consulta volvería a llevar el
      // filtro por negocio del middleware.
      const tenants = await this.prisma.tenant.findMany({
        where: plataforma,
        select: {
          id: true,
          brandName: true,
          status: true,
          planPeriodicity: true,
          hotmartSubscriberCode: true,
          businessGroup: {
            select: {
              id: true,
              name: true,
              referralCodeId: true,
              referralCode: { select: { isActive: true } },
            },
          },
        },
      });
      const ids = tenants.map((t) => t.id);
      if (!ids.length) return { tenants, cobros: [], usos: [] };
      const [cobros, usos] = await Promise.all([
        this.prisma.incomeRecord.findMany({
          where: {
            tenantId: { in: ids },
            status: 'PAGADO',
            grossUsd: { gt: 0 },
            // Lo que pagó una MARCA BLANCA (rebranding, créditos) no es la
            // venta de un negocio a un cliente.
            payerWhiteLabelId: null,
          },
          select: { tenantId: true, saleDate: true, grossUsd: true, gateway: true },
        }),
        this.prisma.referralUse.findMany({
          where: { tenantId: { in: ids } },
          select: {
            tenantId: true,
            createdAt: true,
            referralCode: { select: { code: true, role: true, isActive: true } },
          },
        }),
      ]);
      return { tenants, cobros, usos };
    });
  }

  async listar(): Promise<{
    pendientes: NegocioPorAsignar[];
    ventasDirectas: NegocioVentaDirecta[];
  }> {
    const { tenants, cobros, usos } = await this.leerTodo();

    const cobrosPorNegocio = new Map<string, Array<{ saleDate: Date; grossUsd: number; gateway: string }>>();
    for (const c of cobros) {
      if (!c.tenantId) continue;
      const lista = cobrosPorNegocio.get(c.tenantId) ?? [];
      lista.push({ saleDate: c.saleDate, grossUsd: Number(c.grossUsd), gateway: c.gateway });
      cobrosPorNegocio.set(c.tenantId, lista);
    }
    const atribuidos = new Set<string>();
    const ventaDirectaDesde = new Map<string, Date>();
    for (const u of usos) {
      if (!u.tenantId) continue;
      if (esCodigoVentaDirecta(u.referralCode.code)) {
        ventaDirectaDesde.set(u.tenantId, u.createdAt);
      } else if (esAtribucionQueCobra(u.referralCode)) {
        atribuidos.add(u.tenantId);
      }
    }

    const pendientes: NegocioPorAsignar[] = [];
    const ventasDirectas: NegocioVentaDirecta[] = [];
    for (const t of tenants) {
      const suyos = cobrosPorNegocio.get(t.id) ?? [];
      const primero = primerCobro(suyos);
      const base = {
        tenantId: t.id,
        brandName: t.brandName,
        status: t.status,
        planPeriodicity: t.planPeriodicity ?? null,
        primerCobro: primero
          ? {
              fecha: primero.saleDate.toISOString(),
              montoUsd: Math.round(primero.grossUsd * 100) / 100,
              pasarela: primero.gateway,
            }
          : null,
        cobros: suyos.length,
        totalUsd: Math.round(suyos.reduce((s, c) => s + c.grossUsd, 0) * 100) / 100,
      };
      const marcado = ventaDirectaDesde.get(t.id);
      if (marcado) {
        ventasDirectas.push({ ...base, marcadoEl: marcado.toISOString() });
        continue;
      }
      if (
        esPendientePorAsignar({
          haCobrado: haCobrado({
            cobrosPagados: suyos.length,
            status: t.status,
            hotmartSubscriberCode: t.hotmartSubscriberCode,
          }),
          ventaDirecta: false,
          atribuidoDirecto: atribuidos.has(t.id),
          grupo: t.businessGroup,
        })
      ) {
        pendientes.push({
          ...base,
          businessGroup: t.businessGroup
            ? { id: t.businessGroup.id, name: t.businessGroup.name }
            : null,
        });
      }
    }
    // Lo más reciente arriba: es lo que todavía está a tiempo de generar la
    // comisión del ciclo en curso al asignarlo.
    const fechaDe = (n: { primerCobro: CobroResumen | null }) =>
      n.primerCobro ? Date.parse(n.primerCobro.fecha) : 0;
    pendientes.sort((a, b) => fechaDe(b) - fechaDe(a));
    ventasDirectas.sort((a, b) => Date.parse(b.marcadoEl) - Date.parse(a.marcadoEl));
    return { pendientes, ventasDirectas };
  }

  /** Para el contador del menú. Los de grupo cuentan: también falta decidirlos. */
  async contar(): Promise<{ total: number }> {
    const { pendientes } = await this.listar();
    return { total: pendientes.length };
  }

  /** Estado de un negocio para la ficha: si se puede marcar y si ya lo está. */
  async estadoDelNegocio(tenantId: string) {
    const t = await this.negocioDeLaPlataforma(tenantId).catch(() => null);
    if (!t) return { puedeVentaDirecta: false, ventaDirecta: false };
    const uso = await this.prisma.referralUse.findFirst({
      where: { tenantId, referralCode: { code: CODIGO_VENTA_DIRECTA } },
      select: { id: true },
    });
    return { puedeVentaDirecta: !t.businessGroupId, ventaDirecta: !!uso };
  }

  private async negocioDeLaPlataforma(tenantId: string) {
    const plataforma = await this.wherePlataforma();
    const t = await this.prisma.tenant.findFirst({
      where: { AND: [{ id: tenantId }, plataforma] },
      select: { id: true, brandName: true, businessGroupId: true },
    });
    if (!t) throw new NotFoundException('Negocio no encontrado en la plataforma');
    return t;
  }

  /**
   * Asigna un vendedor real. Sirve también para pasar de «Venta directa» a un
   * vendedor: `setTenantAssignment` borra las demás atribuciones del negocio
   * (la de venta directa nunca tiene comisiones, así que siempre se borra) y
   * genera la comisión del ciclo vigente si el negocio ya pagó.
   */
  async asignarVendedor(user: AuthUser, tenantId: string, codeId: string) {
    const t = await this.negocioDeLaPlataforma(tenantId);
    if (t.businessGroupId) {
      // La comisión de un grupo se genera una vez sobre su bruto: una
      // atribución por negocio pelearía con la del grupo.
      throw new BadRequestException(
        'Este negocio pertenece a un grupo empresarial: el vendedor se asigna en el grupo.',
      );
    }
    const code = await this.prisma.referralCode.findUnique({
      where: { id: codeId },
      select: { id: true, code: true, role: true, isActive: true, whiteLabelId: true },
    });
    if (!code) throw new NotFoundException('Código de afiliado no encontrado');
    if (esCodigoVentaDirecta(code.code)) {
      throw new BadRequestException('Para venta directa usa el botón «Venta directa».');
    }
    if (!esAtribucionQueCobra(code)) {
      throw new BadRequestException(
        'Elige un influencer, embajador o vendedor activo.',
      );
    }
    const scope = await resolveBrandScope(this.prisma, null);
    if (code.whiteLabelId && code.whiteLabelId !== scope.clubifyId) {
      throw new BadRequestException('Ese código es de otra marca, no de la plataforma.');
    }
    return this.referrals.setTenantAssignment(tenantId, code.id, user.id);
  }

  /**
   * Marca el negocio como vendido por la empresa, SIN comisión. Reversible con
   * `asignarVendedor`.
   */
  async marcarVentaDirecta(user: AuthUser, tenantId: string) {
    const t = await this.negocioDeLaPlataforma(tenantId);
    if (t.businessGroupId) {
      throw new BadRequestException(
        'Este negocio pertenece a un grupo empresarial: su comisión se decide en el grupo.',
      );
    }
    // `setTenantAssignment` NO borra una atribución que ya tiene comisiones
    // PAGADAS (historial contable). Si quedara viva junto a la venta directa,
    // el flujo de embajador/influencer de la pasarela la encontraría en el
    // próximo cobro y le pagaría al vendedor anterior. Mejor negarse y que se
    // decida a mano desde la ficha que prometer «sin comisión» y no cumplirlo.
    const conPagadas = await this.prisma.referralUse.findMany({
      where: {
        tenantId,
        referralCode: {
          role: { in: ['INFLUENCER', 'AMBASSADOR', 'VENDOR'] },
          code: { not: CODIGO_VENTA_DIRECTA },
        },
        commissions: { some: { status: 'PAID' } },
      },
      select: { referralCode: { select: { code: true, ownerName: true } } },
    });
    if (conPagadas.length) {
      const quienes = conPagadas
        .map((u) => `${u.referralCode.ownerName} (${u.referralCode.code})`)
        .join(', ');
      throw new ConflictException(
        `No se puede marcar como venta directa: ${quienes} ya cobró comisiones de este negocio ` +
          'y esa atribución se conserva por el historial. Reasígnalo desde la ficha del negocio.',
      );
    }
    const codeId = await this.asegurarCodigoVentaDirecta();
    const r = await this.referrals.setTenantAssignment(tenantId, codeId, user.id);
    // `setTenantAssignment` ya deja `commission.manual_attribution` con el
    // código; esta línea es para poder buscar las ventas directas por acción.
    await this.audit
      .log({
        actorId: user.id,
        tenantId,
        action: 'commission.venta_directa',
        resource: `tenant:${tenantId}`,
        metadata: { brandName: t.brandName },
      })
      .catch(() => null);
    return r;
  }
}
