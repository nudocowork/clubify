import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CommissionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { brandWhiteLabelWhere, resolveBrandScope } from '../common/white-label/brand-scope.util';
import { alcanceDeMarca, combinar } from '../finance/alcance-de-marca';
import { ReferralsService } from '../referrals/referrals.service';
import { CutoffService } from '../referrals/cutoff.service';
import { recalcBatchTotal } from '../referrals/payout-batch.util';
import { rangoBogota } from '../referrals/rango-de-fechas';
import { addDaysYmd, bogotaNoonUtc, bogotaYmd } from '../referrals/cutoff-calendar';
import { nombreDePlan } from '../referrals/plan-label';
import { revisarComprobante } from '../referrals/comprobante-de-pago';
import {
  ACCIONES_QUE_FIJAN_REVISION,
  ETIQUETA_DE_ESTADO,
  estadoDeComision,
  idsEnRevision,
  motivoParaNoPermitir,
  type Accion,
  type Estado,
} from './estados';
import {
  ETIQUETA_DE_EQUIPO,
  ETIQUETA_DE_ROL,
  equipoDeColaborador,
  etiquetaDeColaborador,
  type Equipo,
  type MarcasDeEquipo,
} from './equipos';
import {
  claveDeVenta,
  consolidar,
  estadoDeLiquidacion,
  ETIQUETA_DE_LIQUIDACION,
  porMes,
  sumaDeIndividuales,
  totalesDe,
  type FilaParaTotales,
  type Totales,
} from './totales';
import { fotoDeComision, revisarMotivo } from './auditoria';
import {
  calcularComisionManual,
  claveValida,
  esManual,
  ETIQUETA_DE_TIPO,
  periodKeyManual,
  TIPOS_MANUALES,
  yaCobraEstaVenta,
  type EstadoInicial,
  type TipoManual,
} from './comision-manual';
import {
  describirOperacion,
  estadoDelCliente,
  ETIQUETA_DE_TIPO_DE_VENTA,
  tipoDeVenta,
  type TipoDeVenta,
} from './descripcion';
import {
  beneficiariosDeParticipaciones,
  esParticipacion,
  ingresoDeParticipacion,
  negocioDeParticipacion,
} from './participaciones';

/** Filtros del reporte. Todas las fechas son días de Bogotá (YYYY-MM-DD). */
export type Filtros = {
  desde?: string;
  hasta?: string;
  colaborador?: string;
  equipo?: Equipo;
  negocio?: string;
  periodicidad?: string;
  tipoVenta?: TipoDeVenta;
  estado?: Estado;
};

/**
 * Tope de filas por consulta. El reporte agrega en memoria (los estados, el
 * equipo y el tipo de venta son DERIVADOS y no existen como columna), así que
 * se trae el período entero de una vez. Un mes de Clubify son unos cientos de
 * comisiones; el tope está muy por encima y, si se alcanza, se avisa en
 * pantalla en vez de cortar los totales en silencio.
 */
const TOPE_FILAS = 20_000;

const round2 = (n: number) => Math.round(n * 100) / 100;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Fila del reporte tal como la pinta el panel. */
export type FilaReporte = {
  id: string;
  fecha: string;
  colaborador: { codeId: string | null; nombre: string; rol: string | null; rolEtiqueta: string; equipo: Equipo };
  negocio: { id: string | null; nombre: string | null; esGrupo: boolean };
  cliente: string | null;
  plan: string | null;
  periodicidad: string | null;
  ventaUsd: number | null;
  porcentaje: number | null;
  esFijo: boolean;
  montoUsd: number;
  pagadoUsd: number;
  estado: Estado | null;
  estadoEtiqueta: string;
  status: string;
  paymentStatus: string;
  tipoVenta: TipoDeVenta | null;
  tipoVentaEtiqueta: string | null;
  proximaRenovacion: string | null;
  estadoCliente: string;
  esManual: boolean;
  tipoManual: string | null;
  esDeEquipo: boolean;
  esParticipacion: boolean;
  corte: { id: string; code: string; status: string; paymentDate: string | null } | null;
  notas: string | null;
};

type Contexto = {
  filas: FilaReporte[];
  paraTotales: FilaParaTotales[];
  colaboradores: Map<string, { nombre: string; rol: string | null; equipo: Equipo; equipoDeVenta: string | null }>;
  avisos: string[];
};

@Injectable()
export class ReporteComisionesService {
  private readonly logger = new Logger(ReporteComisionesService.name);

  constructor(
    private prisma: PrismaService,
    private referrals: ReferralsService,
    private cutoff: CutoffService,
  ) {}

  // ── Utilidades ─────────────────────────────────────────────────────────

  /**
   * Las consultas del reporte cruzan negocios: un SUPER_ADMIN dentro de
   * Clubify tiene el middleware de tenant activo con los negocios de la marca,
   * y eso dejaría fuera las filas sin negocio (comisión de equipo, manuales,
   * grupos). El alcance de marca se pone a mano en cada `where`.
   *
   * El `await` va DENTRO: una PrismaPromise es perezosa y, esperada fuera, el
   * bypass no surte efecto (ver la memoria del middleware, 2026-09-11).
   */
  private sinTenant<T>(fn: () => Promise<T>): Promise<T> {
    return TenantContext.runWithoutTenant(async () => {
      const r = await fn();
      return r;
    });
  }

  /** Las tablas del reporte pueden no estar migradas: leer sin romper la página. */
  private async leerSeguro<T>(fn: () => Promise<T>, vacio: T, avisos?: string[]): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (/does not exist|no existe|P2021/i.test(msg) && avisos) {
        const aviso =
          'Faltan las tablas del reporte (notas, historial y comisiones manuales): hay que correr scripts/apply-reporte-comisiones-migration.cjs.';
        if (!avisos.includes(aviso)) avisos.push(aviso);
      } else {
        this.logger.warn(`lectura opcional falló: ${msg}`);
      }
      return vacio;
    }
  }

  /** WHERE de ReferralCode de la plataforma (Clubify + legacy sin marca). */
  private async marcaDeCodigos(): Promise<Record<string, any>> {
    const scope = await resolveBrandScope(this.prisma, null);
    return brandWhiteLabelWhere(scope);
  }

  private revisarFiltros(f: Filtros) {
    if (f.desde && !YMD.test(f.desde)) throw new BadRequestException('Fecha «desde» inválida (usa AAAA-MM-DD).');
    if (f.hasta && !YMD.test(f.hasta)) throw new BadRequestException('Fecha «hasta» inválida (usa AAAA-MM-DD).');
  }

  /** Lo que se filtra en la base: marca, fecha y colaborador. El resto, en memoria. */
  private async whereBase(f: Filtros): Promise<Prisma.CommissionWhereInput> {
    const marca = await this.marcaDeCodigos();
    const partes: Prisma.CommissionWhereInput[] = [
      {
        OR: [
          { recipientCode: marca },
          { recipientCodeId: null, referralUse: { referralCode: marca } },
        ],
      },
      // ADJUSTMENT no es una comisión (nunca se creó ninguno).
      { status: { not: CommissionStatus.ADJUSTMENT } },
    ];
    const rango = rangoBogota(f.desde, f.hasta);
    if (rango) {
      // La fecha de la comisión es la del cobro congelada; las legacy sin ella
      // caen a su creación. Mismo criterio que el control de Contabilidad.
      partes.push({ OR: [{ businessDate: rango }, { businessDate: null, createdAt: rango }] });
    }
    if (f.colaborador) {
      partes.push({
        OR: [
          { recipientCodeId: f.colaborador },
          { recipientCodeId: null, referralUse: { referralCodeId: f.colaborador } },
        ],
      });
    }
    return { AND: partes };
  }

  /** Marcas de equipo: socio de plataforma, comisión de equipo, participaciones, equipos de venta. */
  private async marcasDeEquipo(): Promise<MarcasDeEquipo & { equipoDeVentaPorCodigo: Map<string, string> }> {
    const ajustes = await this.prisma.setting.findMany({
      where: { key: { in: ['referrals.socioCodeId', 'comisiones.equipo.codeId'] } },
      select: { key: true, value: true },
    });
    const valor = (k: string) => ajustes.find((a) => a.key === k)?.value?.trim() || null;
    const socio = valor('referrals.socioCodeId');
    const equipo = valor('comisiones.equipo.codeId');
    const participaciones = await beneficiariosDeParticipaciones(this.prisma);

    // Miembros activos de un equipo de ventas → su código de afiliado.
    const equipoDeVentaPorCodigo = new Map<string, string>();
    const miembros = await this.leerSeguro(
      () =>
        this.sinTenant(() =>
          this.prisma.salesTeamMember.findMany({
            where: { isActive: true },
            select: { userId: true, team: { select: { name: true } } },
          }),
        ),
      [] as Array<{ userId: string; team: { name: string } }>,
    );
    if (miembros.length) {
      const codigos = await this.prisma.referralCode.findMany({
        where: { ownerUserId: { in: [...new Set(miembros.map((m) => m.userId))] } },
        select: { id: true, ownerUserId: true },
      });
      const equipoDeUsuario = new Map(miembros.map((m) => [m.userId, m.team.name]));
      for (const c of codigos) {
        const nombre = c.ownerUserId ? equipoDeUsuario.get(c.ownerUserId) : undefined;
        if (nombre) equipoDeVentaPorCodigo.set(c.id, nombre);
      }
    }
    return {
      socioCodeIds: new Set(socio ? [socio] : []),
      comisionDeEquipoCodeIds: new Set(equipo ? [equipo] : []),
      participacionesGlobales: participaciones,
      miembrosDeEquiposDeVenta: new Set(equipoDeVentaPorCodigo.keys()),
      equipoDeVentaPorCodigo,
    };
  }

  // ── Carga del período ─────────────────────────────────────────────────

  /**
   * Trae las comisiones del período y todo lo que hace falta para pintarlas,
   * con un número FIJO de consultas (no una por fila): comisiones, datos de
   * las manuales, negocios sin referido, dueños, primer y último cobro de cada
   * negocio, bitácora de revisión y marcas de equipo.
   */
  private async cargar(f: Filtros): Promise<Contexto> {
    this.revisarFiltros(f);
    const avisos: string[] = [];
    const where = await this.whereBase(f);

    const comisiones = await this.sinTenant(() =>
      this.prisma.commission.findMany({
        where,
        // `include` (no `select`) a propósito: trae TODAS las columnas, también
        // las del motor de participaciones si ya existen (ver participaciones.ts),
        // sin que este archivo tenga que nombrarlas.
        include: {
          recipientCode: { select: { id: true, ownerName: true, role: true } },
          referralUse: {
            select: {
              tenantId: true,
              referralCode: { select: { id: true, ownerName: true, role: true } },
            },
          },
          businessGroup: { select: { id: true, name: true } },
          payoutBatch: { select: { id: true, code: true, status: true, paymentDate: true } },
        },
        orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }],
        take: TOPE_FILAS + 1,
      }),
    );
    if (comisiones.length > TOPE_FILAS) {
      comisiones.length = TOPE_FILAS;
      avisos.push(
        `El período tiene más de ${TOPE_FILAS.toLocaleString('es-CO')} comisiones: se muestran las más recientes. Acota las fechas para ver totales exactos.`,
      );
    }

    const idsManuales = comisiones.filter((c) => esManual(c.periodKey)).map((c) => c.id);
    const idsRetenidas = comisiones.filter((c) => c.status === 'RETAINED').map((c) => c.id);

    const [manuales, bitacora, marcas] = await Promise.all([
      idsManuales.length
        ? this.leerSeguro(
            () => this.prisma.commissionManual.findMany({ where: { commissionId: { in: idsManuales } } }),
            [],
            avisos,
          )
        : Promise.resolve([]),
      idsRetenidas.length
        ? this.leerSeguro(
            () =>
              this.prisma.commissionAuditLog.findMany({
                where: { commissionId: { in: idsRetenidas }, accion: { in: [...ACCIONES_QUE_FIJAN_REVISION] } },
                select: { commissionId: true, accion: true, createdAt: true },
              }),
            [],
            avisos,
          )
        : Promise.resolve([]),
      this.marcasDeEquipo(),
    ]);
    const manualPorComision = new Map(manuales.map((m) => [m.commissionId, m]));
    const enRevision = new Set(idsEnRevision(bitacora));

    // Negocio de cada comisión: el del referido; si no tiene, el de la
    // participación o el que se eligió al crearla a mano.
    const negocioDe = (c: (typeof comisiones)[number]): string | null =>
      c.referralUse?.tenantId ?? negocioDeParticipacion(c) ?? manualPorComision.get(c.id)?.ownerTenantId ?? null;
    const tenantIds = [...new Set(comisiones.map(negocioDe).filter((x): x is string => !!x))];

    const [tenants, duenos, primeros, ultimos] = tenantIds.length
      ? await this.sinTenant(() =>
          Promise.all([
            this.prisma.tenant.findMany({
              where: { id: { in: tenantIds } },
              select: {
                id: true,
                brandName: true,
                planPeriodicity: true,
                status: true,
                failedPaymentCount: true,
                currentPeriodEnd: true,
                purchasedAt: true,
              },
            }),
            this.prisma.user.findMany({
              where: { tenantId: { in: tenantIds }, role: 'TENANT_OWNER' },
              select: { tenantId: true, fullName: true },
              orderBy: { createdAt: 'asc' },
            }),
            this.prisma.incomeRecord.groupBy({
              by: ['tenantId'],
              where: { tenantId: { in: tenantIds }, status: 'PAGADO' },
              _min: { saleDate: true },
            }),
            this.prisma.incomeRecord.findMany({
              where: { tenantId: { in: tenantIds } },
              orderBy: { saleDate: 'desc' },
              distinct: ['tenantId'],
              select: { tenantId: true, status: true },
            }),
          ]),
        )
      : [[], [], [], []];
    const tenantPorId = new Map(tenants.map((t) => [t.id, t]));
    const duenoPorTenant = new Map<string, string>();
    for (const d of duenos) if (d.tenantId && !duenoPorTenant.has(d.tenantId)) duenoPorTenant.set(d.tenantId, d.fullName);
    const primerCobro = new Map(primeros.map((p) => [p.tenantId, p._min.saleDate]));
    const ultimoEstado = new Map(ultimos.map((u) => [u.tenantId, u.status]));

    const colaboradores: Contexto['colaboradores'] = new Map();
    const filas: FilaReporte[] = [];
    const paraTotales: FilaParaTotales[] = [];

    for (const c of comisiones) {
      // Destinatario: el de la fila; las legacy sin él, el código del referido.
      const code = c.recipientCode ?? c.referralUse?.referralCode ?? null;
      const codeId = code?.id ?? null;
      const rol = code?.role ?? null;
      const equipo = codeId
        ? equipoDeColaborador({ codeId, role: rol }, marcas)
        : // Una participación sin código resoluble es igual de socio.
          esParticipacion(c)
          ? 'SOCIOS'
          : 'ADMINISTRACION';
      if (codeId && !colaboradores.has(codeId)) {
        colaboradores.set(codeId, {
          nombre: code?.ownerName ?? '—',
          rol,
          equipo,
          equipoDeVenta: marcas.equipoDeVentaPorCodigo.get(codeId) ?? null,
        });
      }

      const manual = manualPorComision.get(c.id) ?? null;
      const tenantId = negocioDe(c);
      const t = tenantId ? tenantPorId.get(tenantId) : undefined;
      const fecha = c.businessDate ?? c.createdAt;
      const enRev = enRevision.has(c.id);
      const datosEstado = {
        status: c.status,
        paymentStatus: c.paymentStatus,
        amount: Number(c.amount),
        amountPaid: Number(c.amountPaid),
        payoutBatchId: c.payoutBatchId,
      };
      const estado = estadoDeComision(datosEstado, { enRevision: enRev });
      const tipoManual = (manual?.tipo as TipoManual | undefined) ?? null;
      const tv: TipoDeVenta | null = manual
        ? tipoManual === 'VENTA'
          ? 'NUEVA'
          : tipoManual === 'RENOVACION'
            ? 'RENOVACION'
            : null
        : tenantId
          ? tipoDeVenta(fecha, primerCobro.get(tenantId) ?? t?.purchasedAt ?? null)
          : null;
      const base = c.baseAmountUsd != null ? Number(c.baseAmountUsd) : manual ? Number(manual.baseUsd) : null;
      const pct =
        c.appliedPercent != null ? Number(c.appliedPercent) : manual?.porcentaje != null ? Number(manual.porcentaje) : null;
      const esDeEquipo = !!c.periodKey?.startsWith('EQUIPO-');
      const periodicidad = t?.planPeriodicity ?? null;

      const fila: FilaReporte = {
        id: c.id,
        fecha: new Date(fecha).toISOString(),
        colaborador: {
          codeId,
          nombre: code?.ownerName ?? '(sin destinatario)',
          rol,
          rolEtiqueta: (rol && ETIQUETA_DE_ROL[rol]) || 'Colaborador',
          equipo,
        },
        negocio: c.businessGroup
          ? { id: c.businessGroup.id, nombre: c.businessGroup.name, esGrupo: true }
          : { id: tenantId, nombre: t?.brandName ?? null, esGrupo: false },
        cliente: tenantId ? (duenoPorTenant.get(tenantId) ?? null) : null,
        plan: nombreDePlan(periodicidad),
        periodicidad,
        ventaUsd: base,
        porcentaje: pct,
        esFijo: pct == null || manual?.montoFijoUsd != null,
        montoUsd: Number(c.amount),
        pagadoUsd: Number(c.amountPaid),
        estado,
        estadoEtiqueta: estado ? ETIQUETA_DE_ESTADO[estado] : 'Ajuste',
        status: c.status,
        paymentStatus: c.paymentStatus,
        tipoVenta: tv,
        tipoVentaEtiqueta: tv ? ETIQUETA_DE_TIPO_DE_VENTA[tv] : null,
        proximaRenovacion: t?.currentPeriodEnd ? t.currentPeriodEnd.toISOString() : null,
        estadoCliente: t
          ? estadoDelCliente({
              status: t.status,
              failedPaymentCount: t.failedPaymentCount,
              ultimoIngresoEstado: ultimoEstado.get(t.id) ?? null,
            })
          : '—',
        esManual: !!manual || esManual(c.periodKey),
        tipoManual: tipoManual ? ETIQUETA_DE_TIPO[tipoManual] : null,
        esDeEquipo,
        esParticipacion: esParticipacion(c),
        corte: c.payoutBatch
          ? {
              id: c.payoutBatch.id,
              code: c.payoutBatch.code,
              status: c.payoutBatch.status,
              paymentDate: c.payoutBatch.paymentDate?.toISOString() ?? null,
            }
          : null,
        notas: c.notes,
      };

      // Filtros derivados (no existen como columna).
      if (f.equipo && equipo !== f.equipo) continue;
      if (f.negocio && tenantId !== f.negocio && c.businessGroup?.id !== f.negocio) continue;
      if (f.periodicidad && periodicidad !== f.periodicidad) continue;
      if (f.tipoVenta && tv !== f.tipoVenta) continue;
      if (f.estado && estado !== f.estado) continue;

      filas.push(fila);
      paraTotales.push({
        id: c.id,
        codeId,
        equipo,
        estado,
        amount: Number(c.amount),
        amountPaid: Number(c.amountPaid),
        ventaUsd: base ?? 0,
        ventaClave: claveDeVenta({
          id: c.id,
          tenantId,
          businessGroupId: c.businessGroupId,
          periodKey: c.periodKey,
          businessDate: c.businessDate,
          createdAt: c.createdAt,
          esManual: fila.esManual,
          ingresoId: ingresoDeParticipacion(c),
        }),
        esAjuste: fila.esManual,
      });
    }
    return { filas, paraTotales, colaboradores, avisos };
  }

  /** Ventas del período según Contabilidad (IncomeRecord PAGADO de la plataforma). */
  private async ventasDelPeriodo(f: Filtros): Promise<{ totalUsd: number; cantidad: number }> {
    const rango = rangoBogota(f.desde, f.hasta);
    const marca = await alcanceDeMarca(this.prisma, true);
    const agg = await this.sinTenant(() =>
      this.prisma.incomeRecord.aggregate({
        where: combinar(
          {
            status: 'PAGADO',
            // Lo que pagan las marcas blancas (créditos, rebranding) no es una
            // venta a un negocio: no lleva comisión. Mismo criterio que la
            // comisión de equipo (`comision-de-equipo.service.ts`).
            payerWhiteLabelId: null,
            ...(rango ? { saleDate: rango } : {}),
            ...(f.negocio ? { tenantId: f.negocio } : {}),
            ...(f.periodicidad ? { planPeriodicity: f.periodicidad } : {}),
            ...(f.tipoVenta ? { isFirstPayment: f.tipoVenta === 'NUEVA' } : {}),
          },
          marca,
        ),
        _sum: { grossUsd: true },
        _count: { _all: true },
      }),
    );
    return { totalUsd: round2(Number(agg._sum.grossUsd ?? 0)), cantidad: agg._count._all };
  }

  /** Cortes abiertos con dinero por pagar de cada colaborador (para «Registrar pago»). */
  private cortesAbiertosPorColaborador(filas: FilaReporte[]) {
    const out = new Map<string, Map<string, { batchId: string; code: string; pendienteUsd: number }>>();
    for (const f of filas) {
      if (!f.colaborador.codeId || !f.corte || f.corte.status !== 'OPEN') continue;
      if (f.status !== 'APPROVED' || f.paymentStatus === 'PAID') continue;
      const porCorte = out.get(f.colaborador.codeId) ?? new Map();
      const c = porCorte.get(f.corte.id) ?? { batchId: f.corte.id, code: f.corte.code, pendienteUsd: 0 };
      c.pendienteUsd = round2(c.pendienteUsd + f.montoUsd - f.pagadoUsd);
      porCorte.set(f.corte.id, c);
      out.set(f.colaborador.codeId, porCorte);
    }
    return out;
  }

  private serializarTotales(t: Totales) {
    return { ...t, liquidacion: estadoDeLiquidacion(t), liquidacionEtiqueta: ETIQUETA_DE_LIQUIDACION[estadoDeLiquidacion(t)] };
  }

  // ── Lectura ───────────────────────────────────────────────────────────

  /** Dashboard + equipos + cierre consolidado del período, en una respuesta. */
  async resumen(f: Filtros) {
    const [ctx, ventas] = await Promise.all([this.cargar(f), this.ventasDelPeriodo(f)]);
    const { general, porColaborador, porEquipo } = consolidar(ctx.paraTotales);
    const suma = sumaDeIndividuales(porColaborador);
    const cortes = this.cortesAbiertosPorColaborador(ctx.filas);

    const colaboradores = [...porColaborador.entries()].map(([codeId, t]) => {
      const info = ctx.colaboradores.get(codeId);
      const equipo = info?.equipo ?? 'ADMINISTRACION';
      return {
        codeId: codeId === '—' ? null : codeId,
        nombre: info?.nombre ?? '(sin destinatario)',
        rol: info?.rol ?? null,
        rolEtiqueta: (info?.rol && ETIQUETA_DE_ROL[info.rol]) || 'Colaborador',
        equipo,
        equipoEtiqueta: ETIQUETA_DE_EQUIPO[equipo],
        equipoDeVenta: info?.equipoDeVenta ?? null,
        etiqueta: etiquetaDeColaborador({
          nombre: info?.nombre ?? '(sin destinatario)',
          role: info?.rol ?? null,
          equipo,
          equipoDeVenta: info?.equipoDeVenta ?? null,
        }),
        totales: this.serializarTotales(t),
        cortesAbiertos: [...(cortes.get(codeId)?.values() ?? [])],
      };
    });
    colaboradores.sort((a, b) => b.totales.comisionesUsd + b.totales.ajustesUsd - (a.totales.comisionesUsd + a.totales.ajustesUsd));

    const comisionando = colaboradores.filter(
      (c) => c.codeId && c.totales.comisionesUsd + c.totales.ajustesUsd > 0,
    ).length;

    return {
      periodo: { desde: f.desde ?? null, hasta: f.hasta ?? null },
      ventas,
      general: this.serializarTotales(general),
      porEquipo: Object.fromEntries(
        Object.entries(porEquipo).map(([e, t]) => [
          e,
          {
            ...this.serializarTotales(t),
            etiqueta: ETIQUETA_DE_EQUIPO[e as Equipo],
            colaboradores: colaboradores.filter((c) => c.equipo === e).length,
          },
        ]),
      ),
      colaboradoresComisionando: comisionando,
      colaboradores,
      porMes: porMes(ctx.filas.map((x) => ({ fecha: x.fecha, amount: x.montoUsd, estado: x.estado }))),
      // La comprobación que pidió el dueño: el total general es la suma de los
      // individuales. Si un día no lo es, el panel lo dice en rojo.
      cuadre: {
        ok:
          Math.abs(suma.comisionesUsd - general.comisionesUsd) < 0.005 &&
          Math.abs(suma.pagadoUsd - general.pagadoUsd) < 0.005 &&
          Math.abs(suma.saldoUsd - general.saldoUsd) < 0.005,
        sumaDeIndividuales: suma,
      },
      avisos: ctx.avisos,
    };
  }

  /** Lista paginada (el detalle de cada tarjeta y la exportación). */
  async listar(f: Filtros, page = 1, pageSize = 50) {
    const ctx = await this.cargar(f);
    const tam = Math.min(Math.max(1, Math.floor(pageSize) || 50), 5000);
    const pag = Math.max(1, Math.floor(page) || 1);
    const total = ctx.filas.length;
    return {
      items: ctx.filas.slice((pag - 1) * tam, pag * tam),
      total,
      page: pag,
      pageSize: tam,
      totales: this.serializarTotales(totalesDe(ctx.paraTotales)),
      avisos: ctx.avisos,
    };
  }

  /** Panel de un colaborador: sus totales y todas sus filas del período. */
  async colaborador(codeId: string, f: Filtros) {
    const ctx = await this.cargar({ ...f, colaborador: codeId });
    const t = totalesDe(ctx.paraTotales);
    const info = ctx.colaboradores.get(codeId);
    if (!info) {
      const marca = await this.marcaDeCodigos();
      const code = await this.prisma.referralCode.findFirst({
        where: { AND: [{ id: codeId }, marca] },
        select: { id: true },
      });
      if (!code) throw new NotFoundException('Colaborador no encontrado.');
    }
    return {
      codeId,
      nombre: info?.nombre ?? null,
      totales: this.serializarTotales(t),
      filas: ctx.filas,
      avisos: ctx.avisos,
    };
  }

  /** Colaboradores de la plataforma (con o sin comisiones) para filtros y formularios. */
  async opciones() {
    const marca = await this.marcaDeCodigos();
    const [codigos, marcas] = await Promise.all([
      this.prisma.referralCode.findMany({
        where: marca,
        select: { id: true, ownerName: true, role: true, isActive: true, code: true, commissionPercent: true },
        orderBy: { ownerName: 'asc' },
      }),
      this.marcasDeEquipo(),
    ]);
    return {
      colaboradores: codigos.map((c) => {
        const equipo = equipoDeColaborador({ codeId: c.id, role: c.role }, marcas);
        const equipoDeVenta = marcas.equipoDeVentaPorCodigo.get(c.id) ?? null;
        return {
          codeId: c.id,
          nombre: c.ownerName,
          code: c.code,
          rol: c.role,
          activo: c.isActive,
          porcentaje: Number(c.commissionPercent),
          equipo,
          etiqueta: etiquetaDeColaborador({ nombre: c.ownerName, role: c.role, equipo, equipoDeVenta }),
        };
      }),
      equipos: Object.entries(ETIQUETA_DE_EQUIPO).map(([id, etiqueta]) => ({ id, etiqueta })),
      estados: Object.entries(ETIQUETA_DE_ESTADO).map(([id, etiqueta]) => ({ id, etiqueta })),
      tiposManuales: TIPOS_MANUALES.map((id) => ({ id, etiqueta: ETIQUETA_DE_TIPO[id] })),
    };
  }

  /** Buscador de negocios de la plataforma (formulario de nueva comisión y filtro). */
  async buscarNegocios(q: string) {
    const scope = await resolveBrandScope(this.prisma, null);
    const marca = brandWhiteLabelWhere(scope);
    const texto = (q ?? '').trim().slice(0, 80);
    return this.sinTenant(() =>
      this.prisma.tenant.findMany({
        where: {
          AND: [marca, ...(texto ? [{ brandName: { contains: texto, mode: 'insensitive' as const } }] : [])],
        },
        select: { id: true, brandName: true, planPeriodicity: true, status: true },
        orderBy: { brandName: 'asc' },
        take: 25,
      }),
    );
  }

  /** Cobros de un negocio, para elegir la «venta relacionada» de una comisión manual. */
  async ventasDelNegocio(tenantId: string) {
    const marca = await alcanceDeMarca(this.prisma, true);
    return this.sinTenant(() =>
      this.prisma.incomeRecord.findMany({
        where: combinar({ tenantId }, marca),
        orderBy: { saleDate: 'desc' },
        take: 30,
        select: {
          id: true,
          saleDate: true,
          grossUsd: true,
          gateway: true,
          planPeriodicity: true,
          isFirstPayment: true,
          status: true,
        },
      }),
    ).then((rows) => rows.map((r) => ({ ...r, grossUsd: Number(r.grossUsd) })));
  }

  /**
   * «Ver descripción»: la operación, quiénes participan de la misma venta, notas,
   * comprobantes, pagos manuales, devoluciones, ajustes e historial de cambios.
   */
  async descripcion(id: string) {
    const avisos: string[] = [];
    const c = await this.sinTenant(() =>
      this.prisma.commission.findUnique({
        where: { id },
        include: {
          recipientCode: { select: { id: true, ownerName: true, role: true, whiteLabelId: true } },
          referralUse: {
            select: { tenantId: true, referralCode: { select: { id: true, ownerName: true, role: true, whiteLabelId: true } } },
          },
          businessGroup: { select: { id: true, name: true } },
          payoutBatch: {
            select: { id: true, code: true, status: true, paymentDate: true, receivedProofUrl: true, reference: true },
          },
        },
      }),
    );
    if (!c) throw new NotFoundException('Comisión no encontrada.');
    await this.exigirDeLaPlataforma(c.recipientCode ?? c.referralUse?.referralCode ?? null);

    const manual = await this.leerSeguro(
      () => this.prisma.commissionManual.findUnique({ where: { commissionId: id } }),
      null,
      avisos,
    );
    const tenantId = c.referralUse?.tenantId ?? negocioDeParticipacion(c) ?? manual?.ownerTenantId ?? null;
    const fecha = c.businessDate ?? c.createdAt;
    const code = c.recipientCode ?? c.referralUse?.referralCode ?? null;
    const margen = (dias: number) => ({
      gte: new Date(fecha.getTime() - dias * 86_400_000),
      lte: new Date(fecha.getTime() + dias * 86_400_000),
    });

    const [tenant, dueno, hermanas, notas, bitacora, historialGeneral, pagosManuales, devoluciones, venta, pagosPersona, ajustes] =
      await this.sinTenant(() =>
        Promise.all([
          tenantId
            ? this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: {
                  id: true,
                  brandName: true,
                  planPeriodicity: true,
                  status: true,
                  failedPaymentCount: true,
                  currentPeriodEnd: true,
                  purchasedAt: true,
                },
              })
            : Promise.resolve(null),
          tenantId
            ? this.prisma.user.findFirst({
                where: { tenantId, role: 'TENANT_OWNER' },
                select: { fullName: true, email: true },
                orderBy: { createdAt: 'asc' },
              })
            : Promise.resolve(null),
          // Participantes de la MISMA venta: mismo negocio (o grupo) y mismo
          // periodKey, o la misma transacción.
          this.prisma.commission.findMany({
            where: {
              id: { not: id },
              OR: [
                ...(c.periodKey && tenantId ? [{ periodKey: c.periodKey, referralUse: { tenantId } }] : []),
                ...(c.periodKey && c.businessGroupId ? [{ periodKey: c.periodKey, businessGroupId: c.businessGroupId }] : []),
                ...(c.hotmartTransactionId ? [{ hotmartTransactionId: c.hotmartTransactionId }] : []),
                ...(c.externalTxId && !esManual(c.periodKey) ? [{ externalTxId: c.externalTxId }] : []),
              ],
            },
            include: {
              recipientCode: { select: { id: true, ownerName: true, role: true } },
              referralUse: { select: { referralCode: { select: { id: true, ownerName: true, role: true } } } },
            },
            take: 20,
          }),
          this.leerSeguro(
            () => this.prisma.commissionNote.findMany({ where: { commissionId: id }, orderBy: { createdAt: 'asc' } }),
            [],
            avisos,
          ),
          this.leerSeguro(
            () => this.prisma.commissionAuditLog.findMany({ where: { commissionId: id }, orderBy: { createdAt: 'desc' } }),
            [],
            avisos,
          ),
          // Lo que otras pantallas dejaron en la auditoría general (habilitar a
          // mano, por ejemplo).
          this.prisma.auditLog.findMany({
            where: { resource: `Commission:${id}` },
            orderBy: { createdAt: 'desc' },
            take: 30,
            select: { id: true, action: true, actorId: true, metadata: true, createdAt: true },
          }),
          tenantId
            ? this.prisma.manualPayment.findMany({
                where: { tenantId, paidAt: margen(45) },
                orderBy: { paidAt: 'desc' },
                take: 10,
              })
            : Promise.resolve([]),
          tenantId
            ? this.prisma.incomeRecord.findMany({
                where: { tenantId, status: { in: ['REEMBOLSADO', 'CANCELADO'] } },
                orderBy: { saleDate: 'desc' },
                take: 10,
                select: { id: true, saleDate: true, refundedAt: true, grossUsd: true, status: true, gateway: true, note: true },
              })
            : Promise.resolve([]),
          manual?.incomeRecordId
            ? this.prisma.incomeRecord.findUnique({ where: { id: manual.incomeRecordId } })
            : tenantId
              ? this.prisma.incomeRecord.findFirst({
                  where: {
                    tenantId,
                    OR: [
                      ...(c.hotmartTransactionId ? [{ externalTxId: c.hotmartTransactionId }] : []),
                      { saleDate: margen(3) },
                    ],
                  },
                  orderBy: { saleDate: 'desc' },
                })
              : Promise.resolve(null),
          c.payoutBatchId && code
            ? this.prisma.batchPersonPayment.findMany({
                where: { batchId: c.payoutBatchId, recipientCodeId: code.id },
              })
            : Promise.resolve([]),
          // Ajustes: las comisiones manuales del mismo colaborador en este negocio.
          tenantId && code
            ? this.leerSeguro(
                () =>
                  this.prisma.commissionManual.findMany({
                    where: { ownerTenantId: tenantId, commissionId: { not: id } },
                    take: 20,
                  }),
                [],
                avisos,
              )
            : Promise.resolve([]),
        ]),
      );

    // Nombres de quien escribió notas, historial y pagos: una consulta.
    const userIds = [
      ...new Set(
        [
          ...bitacora.map((b) => b.actorUserId),
          ...historialGeneral.map((h) => h.actorId),
          ...pagosManuales.map((p) => p.actorId),
          ...pagosPersona.map((p) => p.paidByUserId),
        ].filter((x): x is string => !!x),
      ),
    ];
    const usuarios = userIds.length
      ? await this.sinTenant(() =>
          this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, email: true } }),
        )
      : [];
    const nombre = (uid: string | null | undefined) => {
      const u = uid ? usuarios.find((x) => x.id === uid) : null;
      return u ? u.fullName || u.email : uid ? '—' : null;
    };

    const enRev = idsEnRevision(bitacora.map((b) => ({ commissionId: b.commissionId, accion: b.accion, createdAt: b.createdAt })));
    const estado = estadoDeComision(
      {
        status: c.status,
        paymentStatus: c.paymentStatus,
        amount: Number(c.amount),
        amountPaid: Number(c.amountPaid),
        payoutBatchId: c.payoutBatchId,
      },
      { enRevision: enRev.includes(id) },
    );
    const primer = tenantId
      ? await this.sinTenant(() =>
          this.prisma.incomeRecord.findFirst({
            where: { tenantId, status: 'PAGADO' },
            orderBy: { saleDate: 'asc' },
            select: { saleDate: true },
          }),
        )
      : null;
    const tipoManual = (manual?.tipo as TipoManual | undefined) ?? null;
    const tv: TipoDeVenta | null = manual
      ? tipoManual === 'VENTA'
        ? 'NUEVA'
        : tipoManual === 'RENOVACION'
          ? 'RENOVACION'
          : null
      : tipoDeVenta(fecha, primer?.saleDate ?? tenant?.purchasedAt ?? null);
    const base = c.baseAmountUsd != null ? Number(c.baseAmountUsd) : manual ? Number(manual.baseUsd) : null;
    const pct = c.appliedPercent != null ? Number(c.appliedPercent) : manual?.porcentaje != null ? Number(manual.porcentaje) : null;
    const negocioNombre = c.businessGroup?.name ?? tenant?.brandName ?? null;

    const comprobantes = [
      ...notas
        .filter((n) => n.adjuntoUrl && !n.anuladaEl)
        .map((n) => ({ origen: 'Nota', url: n.adjuntoUrl!, mime: n.adjuntoMime, fecha: n.createdAt })),
      ...pagosPersona
        .filter((p) => p.proofUrl)
        .map((p) => ({ origen: 'Pago del corte', url: p.proofUrl!, mime: p.proofMimeType, fecha: p.paidAt })),
      ...(c.payoutBatch?.receivedProofUrl
        ? [{ origen: 'Dinero recibido del corte', url: c.payoutBatch.receivedProofUrl, mime: null, fecha: null }]
        : []),
    ];

    return {
      id: c.id,
      descripcion: describirOperacion({
        rol: code?.role ?? null,
        colaborador: code?.ownerName ?? '(sin destinatario)',
        negocio: negocioNombre,
        plan: nombreDePlan(tenant?.planPeriodicity),
        tipoVenta: tv,
        baseUsd: base,
        porcentaje: pct,
        montoUsd: Number(c.amount),
        esManual: !!manual || esManual(c.periodKey),
        tipoManual: tipoManual ? ETIQUETA_DE_TIPO[tipoManual] : null,
        esDeEquipo: !!c.periodKey?.startsWith('EQUIPO-'),
      }),
      fecha: fecha.toISOString(),
      disponibleEl: c.availableAt?.toISOString() ?? null,
      pagadaEl: c.paidAt?.toISOString() ?? null,
      montoUsd: Number(c.amount),
      pagadoUsd: Number(c.amountPaid),
      baseUsd: base,
      porcentaje: pct,
      estado,
      estadoEtiqueta: estado ? ETIQUETA_DE_ESTADO[estado] : 'Ajuste',
      status: c.status,
      paymentStatus: c.paymentStatus,
      colaborador: code ? { codeId: code.id, nombre: code.ownerName, rol: code.role } : null,
      negocio: negocioNombre ? { id: c.businessGroup?.id ?? tenantId, nombre: negocioNombre, esGrupo: !!c.businessGroup } : null,
      cliente: dueno ? { nombre: dueno.fullName, correo: dueno.email } : null,
      estadoCliente: tenant
        ? estadoDelCliente({ status: tenant.status, failedPaymentCount: tenant.failedPaymentCount })
        : '—',
      proximaRenovacion: tenant?.currentPeriodEnd?.toISOString() ?? null,
      transaccion: c.hotmartTransactionId ?? c.externalTxId ?? null,
      corte: c.payoutBatch
        ? { code: c.payoutBatch.code, status: c.payoutBatch.status, paymentDate: c.payoutBatch.paymentDate, reference: c.payoutBatch.reference }
        : null,
      observaciones: c.notes,
      venta: venta
        ? {
            id: venta.id,
            fecha: venta.saleDate,
            valorUsd: Number(venta.grossUsd),
            pasarela: venta.gateway,
            estado: venta.status,
            esPrimerPago: venta.isFirstPayment,
          }
        : null,
      participantes: hermanas.map((h) => {
        const hc = h.recipientCode ?? h.referralUse?.referralCode ?? null;
        const he = estadoDeComision({
          status: h.status,
          paymentStatus: h.paymentStatus,
          amount: Number(h.amount),
          amountPaid: Number(h.amountPaid),
          payoutBatchId: h.payoutBatchId,
        });
        return {
          id: h.id,
          nombre: hc?.ownerName ?? '(sin destinatario)',
          rol: hc?.role ? (ETIQUETA_DE_ROL[hc.role] ?? hc.role) : null,
          montoUsd: Number(h.amount),
          porcentaje: h.appliedPercent != null ? Number(h.appliedPercent) : null,
          estadoEtiqueta: he ? ETIQUETA_DE_ESTADO[he] : 'Ajuste',
        };
      }),
      notas: notas.map((n) => ({
        id: n.id,
        texto: n.texto,
        adjuntoUrl: n.adjuntoUrl,
        adjuntoMime: n.adjuntoMime,
        autor: n.autorNombre,
        fecha: n.createdAt,
        anulada: n.anuladaEl ? { fecha: n.anuladaEl, motivo: n.motivoAnulacion } : null,
      })),
      comprobantes,
      pagosManuales: pagosManuales.map((p) => ({
        id: p.id,
        fecha: p.paidAt,
        metodo: p.method,
        valor: p.amount != null ? Number(p.amount) : null,
        moneda: p.currency,
        referencia: p.reference,
        nota: p.note,
        registradoPor: nombre(p.actorId),
      })),
      devoluciones: devoluciones.map((d) => ({
        id: d.id,
        fecha: d.refundedAt ?? d.saleDate,
        valorUsd: Number(d.grossUsd),
        estado: d.status,
        pasarela: d.gateway,
        nota: d.note,
      })),
      ajustes: [
        ...(manual
          ? [
              {
                id: manual.id,
                tipo: ETIQUETA_DE_TIPO[manual.tipo as TipoManual] ?? manual.tipo,
                baseUsd: Number(manual.baseUsd),
                porcentaje: manual.porcentaje != null ? Number(manual.porcentaje) : null,
                montoFijoUsd: manual.montoFijoUsd != null ? Number(manual.montoFijoUsd) : null,
                descripcion: manual.descripcion,
                esEsta: true,
              },
            ]
          : []),
        ...ajustes.map((a) => ({
          id: a.id,
          tipo: ETIQUETA_DE_TIPO[a.tipo as TipoManual] ?? a.tipo,
          baseUsd: Number(a.baseUsd),
          porcentaje: a.porcentaje != null ? Number(a.porcentaje) : null,
          montoFijoUsd: a.montoFijoUsd != null ? Number(a.montoFijoUsd) : null,
          descripcion: a.descripcion,
          esEsta: false,
        })),
      ],
      historial: [
        ...bitacora.map((b) => ({
          id: b.id,
          fecha: b.createdAt,
          accion: b.accion,
          motivo: b.motivo,
          antes: b.valorAnterior,
          despues: b.valorNuevo,
          usuario: b.actorEmail ?? nombre(b.actorUserId),
          origen: 'Reporte de comisiones',
        })),
        ...historialGeneral.map((h) => ({
          id: h.id,
          fecha: h.createdAt,
          accion: h.action,
          motivo: ((h.metadata as Record<string, unknown> | null)?.reason as string | undefined) ?? null,
          antes: null,
          despues: h.metadata,
          usuario: nombre(h.actorId),
          origen: 'Otras pantallas',
        })),
      ].sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()),
      avisos,
    };
  }

  /** Historial de liquidaciones: pagos por persona, pagos sueltos y cortes cerrados. */
  async liquidaciones(page = 1, pageSize = 50) {
    const marca = await this.marcaDeCodigos();
    const codigos = await this.prisma.referralCode.findMany({ where: marca, select: { id: true, ownerName: true } });
    const nombreDe = new Map(codigos.map((c) => [c.id, c.ownerName]));
    const [personas, sueltos, cortes] = await this.sinTenant(() =>
      Promise.all([
        this.prisma.batchPersonPayment.findMany({
          where: { recipientCodeId: { in: [...nombreDe.keys()] } },
          include: {
            batch: {
              select: { code: true, periodStart: true, periodEnd: true, status: true, closedByUserId: true, paymentDate: true },
            },
          },
          orderBy: { paidAt: 'desc' },
          take: 2000,
        }),
        // Pagos por afiliado del flujo anterior (`/admin/payouts`).
        this.prisma.commissionPayout.findMany({
          where: { status: 'PAID', recipientUser: { referralCodes: { some: marca } } },
          include: { recipientUser: { select: { fullName: true } } },
          orderBy: { paidAt: 'desc' },
          take: 2000,
        }),
        this.prisma.payoutBatch.findMany({
          where: { status: 'CLOSED' },
          orderBy: [{ paymentDate: 'desc' }, { cutoffDate: 'desc' }],
          take: 200,
          select: {
            id: true,
            code: true,
            paymentDate: true,
            periodStart: true,
            periodEnd: true,
            totalUsd: true,
            reference: true,
            notes: true,
            closedAt: true,
            closedByUserId: true,
            receivedProofUrl: true,
            kind: true,
          },
        }),
      ]),
    );
    const userIds = [
      ...new Set(
        [
          ...personas.map((p) => p.paidByUserId),
          ...personas.map((p) => p.batch.closedByUserId),
          ...sueltos.map((s) => s.paidByUserId),
          ...cortes.map((c) => c.closedByUserId),
        ].filter((x): x is string => !!x),
      ),
    ];
    const usuarios = userIds.length
      ? await this.sinTenant(() =>
          this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, email: true } }),
        )
      : [];
    const quien = (uid: string | null | undefined) => {
      if (!uid) return null;
      const u = usuarios.find((x) => x.id === uid);
      return u ? u.fullName || u.email : null;
    };
    const ymd = (d: Date | null | undefined) => (d ? bogotaYmd(d) : null);

    const pagos = [
      ...personas.map((p) => ({
        id: p.id,
        origen: 'Corte' as const,
        fechaPago: p.paidAt.toISOString(),
        beneficiario: nombreDe.get(p.recipientCodeId) ?? '—',
        beneficiarioCodeId: p.recipientCodeId,
        periodo:
          p.batch.periodStart && p.batch.periodEnd
            ? `${ymd(p.batch.periodStart)} a ${ymd(p.batch.periodEnd)}`
            : p.batch.code,
        corte: p.batch.code,
        valorUsd: Number(p.amountUsd),
        // El pago por persona no guarda el método (Binance/banco): «—».
        metodo: null as string | null,
        referencia: p.reference,
        comprobanteUrl: p.proofUrl,
        // Nadie «aprueba» un pago por persona: quien cierra el corte confirma
        // la transferencia completa. Se muestra eso, y «—» si sigue abierto.
        aprobo: p.batch.status === 'CLOSED' ? quien(p.batch.closedByUserId) : null,
        registro: quien(p.paidByUserId),
        notas: p.notes,
      })),
      ...sueltos.map((s) => {
        const snap = (s.methodSnapshot ?? {}) as Record<string, unknown>;
        const metodo = typeof snap.kind === 'string' ? snap.kind : typeof snap.method === 'string' ? snap.method : null;
        return {
          id: s.id,
          origen: 'Pago a afiliado' as const,
          fechaPago: (s.paidAt ?? s.createdAt).toISOString(),
          beneficiario: s.recipientUser?.fullName ?? '—',
          beneficiarioCodeId: null as string | null,
          periodo: null as string | null,
          corte: null as string | null,
          valorUsd: Number(s.netUsd ?? s.amount),
          metodo: metodo === 'BINANCE' ? 'Binance' : metodo === 'BANK' ? 'Banco' : metodo,
          referencia: null as string | null,
          comprobanteUrl: s.proofUrl,
          aprobo: null as string | null,
          registro: quien(s.paidByUserId),
          notas: s.notes,
        };
      }),
    ].sort((a, b) => b.fechaPago.localeCompare(a.fechaPago));

    const tam = Math.min(Math.max(1, Math.floor(pageSize) || 50), 500);
    const pag = Math.max(1, Math.floor(page) || 1);
    return {
      pagos: pagos.slice((pag - 1) * tam, pag * tam),
      totalPagos: pagos.length,
      page: pag,
      pageSize: tam,
      cortes: cortes.map((c) => ({
        id: c.id,
        code: c.code,
        fechaPago: c.paymentDate?.toISOString() ?? null,
        periodo: c.periodStart && c.periodEnd ? `${ymd(c.periodStart)} a ${ymd(c.periodEnd)}` : null,
        // El total del corte es global (todas las marcas): el desglose de la
        // plataforma está en los pagos por persona.
        totalUsd: Number(c.totalUsd),
        referencia: c.reference,
        comprobanteUrl: c.receivedProofUrl,
        cerradoPor: quien(c.closedByUserId),
        cerradoEl: c.closedAt?.toISOString() ?? null,
        tipo: c.kind === 'ADJUSTMENT' ? 'Ajuste contable' : 'Corte',
        notas: c.notes,
      })),
    };
  }

  // ── Escritura (toda deja rastro en la bitácora) ──────────────────────────

  private motivo(m: unknown): string {
    const r = revisarMotivo(m);
    if (!r.ok) throw new BadRequestException(r.error);
    return r.motivo;
  }

  /** Una comisión de marca blanca no se toca desde aquí, aunque llegue su id. */
  private async exigirDeLaPlataforma(code: { whiteLabelId?: string | null } | null) {
    if (!code) return;
    const scope = await resolveBrandScope(this.prisma, null);
    const wl = code.whiteLabelId ?? null;
    if (wl && scope.clubifyId && wl !== scope.clubifyId) {
      throw new NotFoundException('Comisión no encontrada.');
    }
  }

  /**
   * Escribe la bitácora y ESPERA. No es best-effort como `AuditService.log`: si
   * el rastro no se puede guardar, quien hizo el cambio tiene que enterarse.
   */
  private async registrar(
    db: Pick<PrismaService, 'commissionAuditLog'> | Prisma.TransactionClient,
    user: AuthUser,
    datos: {
      accion: string;
      motivo: string;
      commissionId?: string | null;
      recipientCodeId?: string | null;
      batchId?: string | null;
      antes?: unknown;
      despues?: unknown;
    },
  ) {
    try {
      await db.commissionAuditLog.create({
        data: {
          accion: datos.accion,
          motivo: datos.motivo,
          commissionId: datos.commissionId ?? null,
          recipientCodeId: datos.recipientCodeId ?? null,
          batchId: datos.batchId ?? null,
          valorAnterior: (datos.antes ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          valorNuevo: (datos.despues ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          actorUserId: user.id ?? null,
          actorEmail: user.email ?? null,
        },
      });
    } catch (e) {
      this.logger.error(`bitácora del reporte falló (${datos.accion} ${datos.commissionId ?? ''}): ${(e as Error).message}`);
      // Dentro de una transacción el error la deshace entera: no se aplicó nada.
      if (db !== this.prisma) throw e;
      throw new ServiceUnavailableException(
        'El cambio se aplicó, pero no se pudo guardar en el historial. Avisa al equipo técnico (¿falta la migración del reporte?).',
      );
    }
  }

  private async cargarParaCambiar(id: string) {
    const c = await this.sinTenant(() =>
      this.prisma.commission.findUnique({
        where: { id },
        include: {
          recipientCode: { select: { id: true, whiteLabelId: true } },
          referralUse: { select: { referralCode: { select: { id: true, whiteLabelId: true } } } },
          payoutBatch: { select: { id: true, status: true } },
        },
      }),
    );
    if (!c) throw new NotFoundException('Comisión no encontrada.');
    await this.exigirDeLaPlataforma(c.recipientCode ?? c.referralUse?.referralCode ?? null);
    return c;
  }

  /**
   * Aprobar / enviar a revisión / retener / reversar. NO reimplementa nada: usa
   * los mismos métodos que /admin/commissions (`enableCommission`,
   * `setCommissionStatus`) y les añade el motivo y la bitácora.
   */
  async aplicarAccion(user: AuthUser, id: string, body: { accion: Accion; motivo: string; cascada?: boolean }) {
    const motivo = this.motivo(body.motivo);
    const c = await this.cargarParaCambiar(id);
    const bitacora = await this.prisma.commissionAuditLog.findMany({
      where: { commissionId: id, accion: { in: [...ACCIONES_QUE_FIJAN_REVISION] } },
      select: { commissionId: true, accion: true, createdAt: true },
    });
    const enRevision = idsEnRevision(bitacora).includes(id);
    const estado = estadoDeComision(
      {
        status: c.status,
        paymentStatus: c.paymentStatus,
        amount: Number(c.amount),
        amountPaid: Number(c.amountPaid),
        payoutBatchId: c.payoutBatchId,
      },
      { enRevision },
    );
    if (!estado) throw new BadRequestException('Un asiento de ajuste no se cambia desde aquí.');
    const no = motivoParaNoPermitir(estado, body.accion, { amountPaid: Number(c.amountPaid) });
    if (no) throw new ConflictException(no);
    const antes = fotoDeComision(c);
    let extra: Record<string, unknown> = {};

    switch (body.accion) {
      case 'APROBAR':
        if (c.status === 'PENDING') await this.referrals.enableCommission(user, id, motivo);
        else await this.referrals.setCommissionStatus(id, CommissionStatus.APPROVED, { cascade: false });
        break;
      case 'ENVIAR_A_REVISION':
      case 'RETENER': {
        await this.referrals.setCommissionStatus(id, CommissionStatus.RETAINED, { cascade: false });
        // Retenida no se paga: si estaba en un corte ABIERTO se suelta y el corte
        // recalcula su total, como al pausar a una persona. Al aprobarla otra vez,
        // el repaso de cortes la vuelve a enganchar. Un corte cerrado no se toca.
        if (c.payoutBatch?.status === 'OPEN') {
          await this.prisma.commission.updateMany({
            where: { id, status: CommissionStatus.RETAINED, amountPaid: 0 },
            data: { payoutBatchId: null },
          });
          await recalcBatchTotal(this.prisma, c.payoutBatch.id);
          extra = { soltadaDelCorte: c.payoutBatch.id };
        }
        break;
      }
      case 'REVERSAR': {
        const r = await this.referrals.setCommissionStatus(id, CommissionStatus.REJECTED, {
          cascade: body.cascada === true,
        });
        extra = { hermanasReversadas: r.cascaded };
        break;
      }
      default:
        throw new BadRequestException('Acción desconocida.');
    }

    const despues = await this.prisma.commission.findUnique({ where: { id } });
    await this.registrar(this.prisma, user, {
      accion: body.accion,
      motivo,
      commissionId: id,
      recipientCodeId: c.recipientCodeId,
      batchId: c.payoutBatchId,
      antes,
      despues: despues ? { ...fotoDeComision(despues), ...extra } : extra,
    });
    return { ok: true, id };
  }

  /** Nota (con o sin comprobante) sobre una comisión. */
  async agregarNota(
    user: AuthUser,
    id: string,
    body: { texto: string; adjuntoUrl?: string; adjuntoMime?: string },
  ) {
    const texto = (body.texto ?? '').trim();
    if (texto.length < 3) throw new BadRequestException('Escribe la nota.');
    if (texto.length > 4000) throw new BadRequestException('La nota es muy larga (máximo 4000 caracteres).');
    const rev = revisarComprobante(body.adjuntoUrl, body.adjuntoMime, process.env.S3_PUBLIC_URL ?? null);
    if (!rev.ok) throw new BadRequestException(rev.motivo);
    const c = await this.cargarParaCambiar(id);
    const autor = await this.prisma.user.findUnique({ where: { id: user.id }, select: { fullName: true } }).catch(() => null);

    return this.prisma.$transaction(async (tx) => {
      const nota = await tx.commissionNote.create({
        data: {
          commissionId: id,
          texto,
          adjuntoUrl: rev.comprobante?.url ?? null,
          adjuntoMime: rev.comprobante?.mimeType ?? null,
          autorUserId: user.id ?? null,
          autorNombre: autor?.fullName ?? user.email ?? null,
        },
      });
      // Agregar no modifica nada que existiera: el motivo es la nota misma.
      await this.registrar(tx, user, {
        accion: 'NOTA_AGREGADA',
        motivo: texto.slice(0, 500),
        commissionId: id,
        recipientCodeId: c.recipientCodeId,
        antes: null,
        despues: { notaId: nota.id, texto, adjuntoUrl: nota.adjuntoUrl },
      });
      return nota;
    });
  }

  /** Anular (nunca borrar) una nota o comprobante. */
  async anularNota(user: AuthUser, notaId: string, body: { motivo: string }) {
    const motivo = this.motivo(body.motivo);
    const nota = await this.prisma.commissionNote.findUnique({ where: { id: notaId } });
    if (!nota) throw new NotFoundException('Nota no encontrada.');
    if (nota.anuladaEl) throw new ConflictException('Esa nota ya está anulada.');
    const c = await this.cargarParaCambiar(nota.commissionId);
    return this.prisma.$transaction(async (tx) => {
      // Condicional: dos anulaciones a la vez no dejan dos rastros.
      const r = await tx.commissionNote.updateMany({
        where: { id: notaId, anuladaEl: null },
        data: { anuladaEl: new Date(), anuladaPorUserId: user.id ?? null, motivoAnulacion: motivo },
      });
      if (r.count === 0) throw new ConflictException('Esa nota ya está anulada.');
      await this.registrar(tx, user, {
        accion: 'NOTA_ANULADA',
        motivo,
        commissionId: nota.commissionId,
        recipientCodeId: c.recipientCodeId,
        antes: { notaId, texto: nota.texto, adjuntoUrl: nota.adjuntoUrl },
        despues: { notaId, anulada: true },
      });
      return { ok: true };
    });
  }

  /**
   * Registrar el pago de UNA persona dentro de un corte abierto. Es el mismo
   * paso 2 de «Corte actual» (`CutoffService.markPersonPaid`), con su
   * comprobante y su aviso interno; aquí solo se añade motivo y bitácora.
   */
  async registrarPagoPersona(
    user: AuthUser,
    body: {
      batchId: string;
      recipientCodeId: string;
      motivo: string;
      reference?: string;
      proofUrl?: string;
      proofMimeType?: string;
      notes?: string;
      paymentDate?: string;
    },
  ) {
    const motivo = this.motivo(body.motivo);
    const marca = await this.marcaDeCodigos();
    const code = await this.prisma.referralCode.findFirst({
      where: { AND: [{ id: body.recipientCodeId }, marca] },
      select: { id: true },
    });
    if (!code) throw new NotFoundException('Colaborador no encontrado.');
    const antes = await this.prisma.commission.findMany({
      where: { payoutBatchId: body.batchId, recipientCodeId: body.recipientCodeId },
      select: { id: true, status: true, paymentStatus: true, amount: true, amountPaid: true },
    });
    const r = await this.cutoff.markPersonPaid(user, body.batchId, body.recipientCodeId, {
      reference: body.reference,
      proofUrl: body.proofUrl,
      proofMimeType: body.proofMimeType,
      notes: body.notes,
      paymentDate: body.paymentDate,
    });
    await this.registrar(this.prisma, user, {
      accion: 'PAGO_PERSONA',
      motivo,
      recipientCodeId: body.recipientCodeId,
      batchId: body.batchId,
      antes: antes.map((a) => ({ ...a, amount: Number(a.amount), amountPaid: Number(a.amountPaid) })),
      despues: { reference: body.reference ?? null, proofUrl: body.proofUrl ?? null, paymentDate: body.paymentDate ?? null },
    });
    return r;
  }

  /**
   * «+ Nueva comisión». Ver por qué no reusa `createCommission` en
   * `comision-manual.ts`. El monto lo recalcula el servidor y la clave de
   * idempotencia hace que un doble clic devuelva la misma comisión.
   */
  async crearManual(
    user: AuthUser,
    body: {
      clave: string;
      fecha: string;
      recipientCodeId: string;
      tenantId?: string | null;
      incomeRecordId?: string | null;
      tipo: TipoManual;
      baseUsd: number;
      porcentaje?: number | null;
      montoFijoUsd?: number | null;
      descripcion: string;
      estadoInicial: EstadoInicial;
      comprobanteUrl?: string | null;
      comprobanteMime?: string | null;
      motivo: string;
    },
  ) {
    if (user.role !== 'SUPER_ADMIN') throw new BadRequestException('Solo un administrador crea comisiones a mano.');
    const motivo = this.motivo(body.motivo);
    if (!claveValida(body.clave)) throw new BadRequestException('Falta la clave del formulario: vuelve a abrirlo.');
    if (!YMD.test(body.fecha ?? '')) throw new BadRequestException('Fecha inválida (usa AAAA-MM-DD).');
    if (!(TIPOS_MANUALES as readonly string[]).includes(body.tipo)) throw new BadRequestException('Tipo de comisión inválido.');
    if (body.estadoInicial !== 'GENERADA' && body.estadoInicial !== 'EN_REVISION') {
      throw new BadRequestException('El estado inicial tiene que ser «Generada» o «En revisión».');
    }
    const descripcion = (body.descripcion ?? '').trim();
    if (descripcion.length < 5) throw new BadRequestException('Describe la comisión (al menos 5 letras).');
    if (descripcion.length > 2000) throw new BadRequestException('La descripción es muy larga.');
    const calc = calcularComisionManual({
      baseUsd: body.baseUsd,
      porcentaje: body.porcentaje,
      montoFijoUsd: body.montoFijoUsd,
    });
    if (!calc.ok) throw new BadRequestException(calc.error);
    const rev = revisarComprobante(body.comprobanteUrl, body.comprobanteMime, process.env.S3_PUBLIC_URL ?? null);
    if (!rev.ok) throw new BadRequestException(rev.motivo);

    // Doble clic / reintento: la misma clave devuelve la misma comisión.
    const previa = await this.prisma.commissionManual.findUnique({ where: { claveIdempotencia: body.clave } });
    if (previa) return { ok: true, commissionId: previa.commissionId, duplicada: true };

    const marca = await this.marcaDeCodigos();
    const code = await this.prisma.referralCode.findFirst({
      where: { AND: [{ id: body.recipientCodeId }, marca] },
      select: { id: true, ownerName: true },
    });
    if (!code) throw new BadRequestException('El colaborador no existe o no es de la plataforma.');

    let negocio: { id: string; brandName: string } | null = null;
    if (body.tenantId) {
      const scope = await resolveBrandScope(this.prisma, null);
      negocio = await this.sinTenant(() =>
        this.prisma.tenant.findFirst({
          where: { AND: [{ id: body.tenantId! }, brandWhiteLabelWhere(scope)] },
          select: { id: true, brandName: true },
        }),
      );
      if (!negocio) throw new BadRequestException('El negocio no existe o no es de la plataforma.');
    }

    if (body.incomeRecordId) {
      if (!negocio) throw new BadRequestException('Para relacionar una venta, elige primero el negocio.');
      const venta = await this.sinTenant(() =>
        this.prisma.incomeRecord.findUnique({
          where: { id: body.incomeRecordId! },
          select: { id: true, tenantId: true, status: true, externalTxId: true, saleDate: true },
        }),
      );
      if (!venta || venta.tenantId !== negocio.id) throw new BadRequestException('La venta no es de ese negocio.');
      if (venta.status !== 'PAGADO') throw new BadRequestException('Esa venta no está pagada: no lleva comisión.');
      // No duplicar: si el colaborador ya cobra por esa venta, la manual sobra.
      const existentes = await this.sinTenant(() =>
        this.prisma.commission.findMany({
          where: {
            OR: [{ recipientCodeId: code.id }, { recipientCodeId: null, referralUse: { referralCodeId: code.id } }],
            referralUse: { tenantId: negocio!.id },
          },
          select: {
            status: true,
            hotmartTransactionId: true,
            externalTxId: true,
            businessDate: true,
            createdAt: true,
            periodKey: true,
          },
        }),
      );
      if (yaCobraEstaVenta(venta, existentes)) {
        throw new ConflictException(`${code.ownerName} ya tiene una comisión por esa venta: no se crea otra.`);
      }
    }

    const enRevision = body.estadoInicial === 'EN_REVISION';
    const periodKey = periodKeyManual(body.fecha, body.clave);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const comision = await tx.commission.create({
          data: {
            // Sin referido a propósito: ver comision-manual.ts.
            referralUseId: null,
            recipientCodeId: code.id,
            amount: calc.montoUsd,
            currency: 'USD',
            // «En revisión» = retenida hasta que alguien la apruebe aquí (ver
            // estados.ts). «Generada» sigue la regla de toda comisión: 15 días
            // de espera desde su fecha y la libera el cron.
            status: enRevision ? CommissionStatus.RETAINED : CommissionStatus.PENDING,
            paymentStatus: 'PENDING',
            amountPaid: 0,
            periodKey,
            businessDate: bogotaNoonUtc(body.fecha),
            availableAt: bogotaNoonUtc(addDaysYmd(body.fecha, 15)),
            baseAmountUsd: calc.baseUsd,
            appliedPercent: calc.porcentaje,
            externalTxId: `manual:${body.clave}`,
            notes: `Comisión manual (${ETIQUETA_DE_TIPO[body.tipo]})${negocio ? ` · ${negocio.brandName}` : ''} · ${descripcion}`.slice(0, 2000),
          },
        });
        await tx.commissionManual.create({
          data: {
            commissionId: comision.id,
            claveIdempotencia: body.clave,
            ownerTenantId: negocio?.id ?? null,
            incomeRecordId: body.incomeRecordId ?? null,
            tipo: body.tipo,
            baseUsd: calc.baseUsd,
            porcentaje: calc.porcentaje,
            montoFijoUsd: calc.porcentaje == null ? calc.montoUsd : null,
            descripcion,
            estadoInicial: body.estadoInicial,
            creadoPorUserId: user.id ?? null,
          },
        });
        if (rev.comprobante) {
          await tx.commissionNote.create({
            data: {
              commissionId: comision.id,
              texto: 'Comprobante adjuntado al crear la comisión.',
              adjuntoUrl: rev.comprobante.url,
              adjuntoMime: rev.comprobante.mimeType,
              autorUserId: user.id ?? null,
              autorNombre: user.email ?? null,
            },
          });
        }
        await this.registrar(tx, user, {
          accion: enRevision ? 'CREAR_EN_REVISION' : 'CREAR_MANUAL',
          motivo,
          commissionId: comision.id,
          recipientCodeId: code.id,
          antes: null,
          despues: {
            ...fotoDeComision(comision),
            tipo: body.tipo,
            baseUsd: calc.baseUsd,
            porcentaje: calc.porcentaje,
            negocio: negocio?.brandName ?? null,
            incomeRecordId: body.incomeRecordId ?? null,
          },
        });
        return { ok: true, commissionId: comision.id, montoUsd: calc.montoUsd, duplicada: false };
      });
    } catch (e) {
      // Carrera de dos envíos con la misma clave: el segundo choca con la
      // UNIQUE de la clave y se le devuelve la primera.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const ya = await this.prisma.commissionManual.findUnique({ where: { claveIdempotencia: body.clave } });
        if (ya) return { ok: true, commissionId: ya.commissionId, duplicada: true };
      }
      throw e;
    }
  }
}
