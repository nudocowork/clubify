import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { brandWhiteLabelWhere, resolveBrandScope } from '../common/white-label/brand-scope.util';
import { limitesDelMes, mesContableActual } from '../common/periodo-contable';
import { afiliadoQueVendio, nombreDelPlan, tipoDeIngreso, type TipoDeEvento } from './eventos';

export interface EventoDelMuro {
  id: string;
  tipo: TipoDeEvento;
  afiliado: string;
  negocio: string;
  plan: string;
  monto_usd: number;
  fecha: string;
  estado: 'confirmada';
}

export interface ServicioDelMes {
  id: string;
  /** «Descuento de Implementación», «Implementación Oferta 25 USD»… */
  concepto: string;
  monto_usd: number;
  fecha: string;
}

export interface MuroDelMes {
  ventas: number;
  renovaciones: number;
  monto_usd: number;
  eventos: EventoDelMuro[];
  /**
   * Lo cobrado este mes que no es un plan: implementaciones, descuentos de
   * implementación y demás servicios adicionales (Contabilidad, categoría
   * OTRO). Va aparte y no suma a ventas ni renovaciones (Javier, 2026-10-26).
   */
  servicios: { cantidad: number; monto_usd: number; items: ServicioDelMes[] };
}

/**
 * Sales Wall: las ventas y renovaciones del mes en curso (hora Bogotá) de
 * Clubify, con quién las vendió. Sale de Contabilidad (`IncomeRecord`), que
 * cuadra uno a uno con Hotmart: es lo que se cobró, no lo que se prometió.
 *
 * Solo la plataforma Clubify (el controlador lleva `SoloPlataformaGuard`): la
 * pantalla lleva el logo de Clubify y no debe mezclar ventas de otra marca.
 * Sin datos de pago ni personales: negocio, afiliado, plan y monto.
 */
@Injectable()
export class SalesWallService {
  constructor(private readonly prisma: PrismaService) {}

  async delMes(ahora: Date = new Date()): Promise<MuroDelMes> {
    const limites = limitesDelMes(mesContableActual(ahora))!;
    const scope = await resolveBrandScope(this.prisma, null);
    const filas = await this.prisma.incomeRecord.findMany({
      where: {
        saleDate: { gte: limites.from, lte: limites.to },
        status: 'PAGADO',
        category: { in: ['NUEVA', 'RENOVACION', 'UPGRADE'] },
        OR: [{ tenantId: { not: null } }, { businessGroupId: { not: null } }],
        AND: [brandWhiteLabelWhere(scope)],
      },
      orderBy: { saleDate: 'desc' },
      select: {
        id: true,
        tenantId: true,
        businessGroupId: true,
        brandName: true,
        category: true,
        planPeriodicity: true,
        grossUsd: true,
        saleDate: true,
      },
      take: 500,
    });

    const idsNegocio = [...new Set(filas.map((f) => f.tenantId).filter((x): x is string => !!x))];
    const idsGrupo = [...new Set(filas.map((f) => f.businessGroupId).filter((x): x is string => !!x))];
    const [negocios, grupos, usos] = await Promise.all([
      idsNegocio.length
        ? this.prisma.tenant.findMany({
            where: { id: { in: idsNegocio } },
            select: { id: true, brandName: true, name: true, planPeriodicity: true },
          })
        : [],
      idsGrupo.length
        ? this.prisma.businessGroup.findMany({ where: { id: { in: idsGrupo } }, select: { id: true, name: true } })
        : [],
      idsNegocio.length
        ? this.prisma.referralUse.findMany({
            where: { tenantId: { in: idsNegocio } },
            select: { tenantId: true, referralCode: { select: { role: true, ownerName: true } } },
          })
        : [],
    ]);
    const negocioPorId = new Map(negocios.map((t) => [t.id, t]));
    const grupoPorId = new Map(grupos.map((g) => [g.id, g]));
    const usosPorNegocio = new Map<string, Array<{ role: string; ownerName: string | null }>>();
    for (const u of usos) {
      if (!u.tenantId) continue;
      const l = usosPorNegocio.get(u.tenantId) ?? [];
      l.push({ role: String(u.referralCode.role), ownerName: u.referralCode.ownerName });
      usosPorNegocio.set(u.tenantId, l);
    }

    const eventos: EventoDelMuro[] = [];
    let ventas = 0;
    let renovaciones = 0;
    let monto = 0;
    for (const f of filas) {
      const tipo = tipoDeIngreso(f.category);
      if (!tipo) continue;
      const t = f.tenantId ? negocioPorId.get(f.tenantId) : undefined;
      const g = f.businessGroupId ? grupoPorId.get(f.businessGroupId) : undefined;
      const usd = Number(f.grossUsd ?? 0) || 0;
      eventos.push({
        id: `ing_${f.id}`,
        tipo,
        afiliado: f.tenantId ? afiliadoQueVendio(usosPorNegocio.get(f.tenantId) ?? []) : 'Venta directa',
        negocio: (t?.brandName || t?.name || g?.name || f.brandName || '—').trim(),
        plan: nombreDelPlan(f.planPeriodicity ?? t?.planPeriodicity, usd),
        monto_usd: Math.round(usd * 100) / 100,
        fecha: f.saleDate.toISOString(),
        estado: 'confirmada',
      });
      if (tipo === 'venta') ventas++;
      else renovaciones++;
      monto += usd;
    }
    return {
      ventas,
      renovaciones,
      monto_usd: Math.round(monto * 100) / 100,
      eventos,
      servicios: await this.serviciosDelMes(limites, scope),
    };
  }

  private async serviciosDelMes(
    limites: { from: Date; to: Date },
    scope: Awaited<ReturnType<typeof resolveBrandScope>>,
  ): Promise<MuroDelMes['servicios']> {
    const filas = await this.prisma.incomeRecord.findMany({
      where: {
        saleDate: { gte: limites.from, lte: limites.to },
        status: 'PAGADO',
        category: 'OTRO',
        AND: [brandWhiteLabelWhere(scope)],
      },
      orderBy: { saleDate: 'desc' },
      select: { id: true, externalTxId: true, productName: true, grossUsd: true, saleDate: true },
      take: 200,
    });
    // El nombre de la OFERTA de Hotmart dice qué fue; el `productName` de
    // Contabilidad a veces es solo «20 USD» o «Servicios adicionales».
    const txs = filas.map((f) => f.externalTxId).filter((x): x is string => !!x);
    const ofertas = txs.length
      ? await this.prisma.$queryRawUnsafe<Array<{ t: string; o: string | null }>>(
          `SELECT DISTINCT ON (payload->'data'->'purchase'->>'transaction')
                  payload->'data'->'purchase'->>'transaction' AS t,
                  payload->'data'->'purchase'->'offer'->>'name' AS o
             FROM "HotmartWebhookEvent"
            WHERE payload->'data'->'purchase'->>'transaction' = ANY($1)`,
          txs,
        )
      : [];
    const oferta = new Map(ofertas.map((x) => [x.t, x.o]));
    const items = filas.map((f) => ({
      id: `srv_${f.id}`,
      concepto: (oferta.get(f.externalTxId ?? '') || f.productName || 'Servicio adicional').trim(),
      monto_usd: Math.round((Number(f.grossUsd ?? 0) || 0) * 100) / 100,
      fecha: f.saleDate.toISOString(),
    }));
    return {
      cantidad: items.length,
      monto_usd: Math.round(items.reduce((a, i) => a + i.monto_usd, 0) * 100) / 100,
      items,
    };
  }
}
