import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  limitesDelMes,
  limitesDelPeriodo,
  mesAtras,
  mesContable,
  mesContableActual,
  mesesDelPeriodo,
  periodoAnterior,
} from '../common/periodo-contable';
import { IncomeRecordService } from './income-record.service';
import { ExpenseService } from './expense.service';
import { enRango, enRangoConRespaldo } from './where-periodo';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * CONTABILIDAD — Fase 6 (Reportes/Dashboard) y motor del snapshot de la Fase 5
 * (Cierres). Cascada de utilidad, DERIVADA en lectura (no persiste nada):
 *
 *   Bruto − (Fee pasarela + Impuestos) = Neto
 *   Neto − Egresos − Nómina − Comisiones = UTILIDAD
 *
 * `onlyClubify` filtra por whiteLabelId null (misma convención que el resto del
 * módulo). Las comisiones no se acotan por marca (v1): son el costo de afiliados
 * de la plataforma; se puede refinar después.
 */
export interface FinancialSummary {
  grossUsd: number;
  gatewayFeeUsd: number;
  taxUsd: number;
  netUsd: number; // neto esperado (bruto − fee − impuesto)
  netReceivedUsd: number; // neto realmente conciliado
  egresosUsd: number;
  nominaUsd: number;
  comisionesUsd: number;
  utilidadUsd: number;
  ingresosCount: number;
}

@Injectable()
export class FinanceReportService {
  constructor(
    private prisma: PrismaService,
    private income: IncomeRecordService,
    private expense: ExpenseService,
  ) {}

  async summary(
    onlyClubify: boolean,
    from?: Date,
    to?: Date,
  ): Promise<FinancialSummary> {
    const wl = onlyClubify ? { whiteLabelId: null } : {};
    const rango = { from, to };
    const [inc, exp, runs, comms] = await Promise.all([
      this.income.summary({ from, to, onlyClubify }),
      this.expense.summary({ from, to, onlyClubify }),
      this.prisma.payrollRun.findMany({
        where: { ...wl, ...enRangoConRespaldo('periodEnd', rango) },
        select: { totalUsd: true },
      }),
      this.prisma.commission.findMany({
        where: {
          status: { not: 'REJECTED' },
          ...enRangoConRespaldo('businessDate', rango),
        },
        select: { amount: true },
      }),
    ]);
    const nominaUsd = round2(
      runs.reduce((a, r) => a + Number(r.totalUsd), 0),
    );
    const comisionesUsd = round2(
      comms.reduce((a, c) => a + Number(c.amount), 0),
    );
    const utilidadUsd = round2(
      inc.netExpectedUsd - exp.totalUsd - nominaUsd - comisionesUsd,
    );
    return {
      grossUsd: inc.grossUsd,
      gatewayFeeUsd: inc.gatewayFeeUsd,
      taxUsd: inc.taxUsd,
      netUsd: inc.netExpectedUsd,
      netReceivedUsd: inc.netReceivedUsd,
      egresosUsd: exp.totalUsd,
      nominaUsd,
      comisionesUsd,
      utilidadUsd,
      ingresosCount: inc.count,
    };
  }

  /** Bordes de un mes YYYY-MM, en hora de Bogotá (ver `periodo-contable.ts`). */
  monthBounds(period: string): { from: Date; to: Date } | null {
    return limitesDelMes(period);
  }

  /** Serie mensual de la utilidad (últimos N meses, incluido el actual). */
  async monthlySeries(
    onlyClubify: boolean,
    months: number,
  ): Promise<
    Array<{
      period: string;
      grossUsd: number;
      egresosUsd: number;
      nominaUsd: number;
      comisionesUsd: number;
      utilidadUsd: number;
    }>
  > {
    const actual = mesContableActual();
    const out = [];
    for (let i = months - 1; i >= 0; i--) {
      const period = mesAtras(actual, i);
      const b = this.monthBounds(period)!;
      const s = await this.summary(onlyClubify, b.from, b.to);
      out.push({
        period,
        grossUsd: s.grossUsd,
        egresosUsd: s.egresosUsd,
        nominaUsd: s.nominaUsd,
        comisionesUsd: s.comisionesUsd,
        utilidadUsd: s.utilidadUsd,
      });
    }
    return out;
  }


  // ── Fase 2 — Panorama del período (métricas + gráficas) ────────────────────

  /**
   * Todo lo que necesita la primera pantalla de un período contable:
   * la cascada del período, la del período ANTERIOR para comparar sin mezclar,
   * la evolución mes a mes y de dónde viene el dinero.
   */
  async panorama(onlyClubify: boolean, period: string) {
    const meses = mesesDelPeriodo(period);
    const anterior = periodoAnterior(period);
    const rango = limitesDelPeriodo(period) ?? {};
    const rangoAnterior = anterior ? (limitesDelPeriodo(anterior) ?? {}) : null;

    const [resumen, resumenAnterior, serie, porPasarela] = await Promise.all([
      this.summary(onlyClubify, rango.from, rango.to),
      rangoAnterior
        ? this.summary(onlyClubify, rangoAnterior.from, rangoAnterior.to)
        : Promise.resolve(null),
      this.serieDeMeses(onlyClubify, meses),
      this.ingresosPorPasarela(onlyClubify, rango),
    ]);

    return {
      period,
      resumen,
      anterior: anterior ? { period: anterior, resumen: resumenAnterior } : null,
      serie,
      porPasarela,
    };
  }

  /**
   * La cascada de cada uno de esos meses.
   *
   * Cuatro consultas en total —una por tabla, sobre el rango entero— y el
   * reparto por mes se hace en memoria. La versión ingenua (un `summary()` por
   * mes) son cuatro consultas POR MES: para un año, 48 viajes a la base para
   * pintar una gráfica.
   */
  async serieDeMeses(onlyClubify: boolean, meses: string[]) {
    if (meses.length === 0) return [];
    const desde = limitesDelMes(meses[0])!.from;
    const hasta = limitesDelMes(meses[meses.length - 1])!.to;
    const rango = { from: desde, to: hasta };
    const wl = onlyClubify ? { whiteLabelId: null } : {};

    const [ingresos, egresos, cortes, comisiones] = await Promise.all([
      this.prisma.incomeRecord.findMany({
        where: { ...wl, ...enRango('saleDate', rango) },
        select: {
          saleDate: true, grossUsd: true, gatewayFeeUsd: true,
          taxUsd: true, netExpectedUsd: true,
        },
      }),
      this.prisma.expense.findMany({
        where: { ...wl, ...enRango('expenseDate', rango) },
        select: { expenseDate: true, amountUsd: true },
      }),
      this.prisma.payrollRun.findMany({
        where: { ...wl, ...enRangoConRespaldo('periodEnd', rango) },
        select: { periodEnd: true, createdAt: true, totalUsd: true },
      }),
      this.prisma.commission.findMany({
        where: {
          status: { not: 'REJECTED' },
          ...enRangoConRespaldo('businessDate', rango),
        },
        select: { businessDate: true, createdAt: true, amount: true },
      }),
    ]);

    const vacio = () => ({
      grossUsd: 0, gatewayFeeUsd: 0, taxUsd: 0, netUsd: 0,
      egresosUsd: 0, nominaUsd: 0, comisionesUsd: 0,
    });
    const cubos = new Map(meses.map((m) => [m, vacio()]));
    const cubo = (fecha: Date) => cubos.get(mesContable(fecha));

    for (const i of ingresos) {
      const c = cubo(i.saleDate);
      if (!c) continue;
      c.grossUsd += Number(i.grossUsd);
      c.gatewayFeeUsd += Number(i.gatewayFeeUsd);
      c.taxUsd += Number(i.taxUsd);
      c.netUsd += Number(i.netExpectedUsd);
    }
    for (const e of egresos) {
      const c = cubo(e.expenseDate);
      if (c) c.egresosUsd += Number(e.amountUsd);
    }
    for (const r of cortes) {
      const c = cubo(r.periodEnd ?? r.createdAt);
      if (c) c.nominaUsd += Number(r.totalUsd);
    }
    for (const k of comisiones) {
      const c = cubo(k.businessDate ?? k.createdAt);
      if (c) c.comisionesUsd += Number(k.amount);
    }

    return meses.map((period) => {
      const c = cubos.get(period)!;
      const utilidadUsd = round2(
        c.netUsd - c.egresosUsd - c.nominaUsd - c.comisionesUsd,
      );
      return {
        period,
        grossUsd: round2(c.grossUsd),
        gatewayFeeUsd: round2(c.gatewayFeeUsd),
        taxUsd: round2(c.taxUsd),
        netUsd: round2(c.netUsd),
        egresosUsd: round2(c.egresosUsd),
        nominaUsd: round2(c.nominaUsd),
        comisionesUsd: round2(c.comisionesUsd),
        utilidadUsd,
      };
    });
  }

  /** De dónde entró el dinero del período, por pasarela. */
  async ingresosPorPasarela(
    onlyClubify: boolean,
    rango: { from?: Date; to?: Date },
  ) {
    const filas = await this.prisma.incomeRecord.groupBy({
      by: ['gateway'],
      where: {
        ...(onlyClubify ? { whiteLabelId: null } : {}),
        ...enRango('saleDate', rango),
      },
      _sum: { grossUsd: true },
      _count: { _all: true },
    });
    return filas
      .map((f) => ({
        gateway: f.gateway as string,
        grossUsd: round2(Number(f._sum.grossUsd ?? 0)),
        count: f._count._all,
      }))
      .sort((a, b) => b.grossUsd - a.grossUsd);
  }

  // ── Fase 5 — Cierres contables ─────────────────────────────────────────────

  /** Meses cerrados (snapshots) de un scope, más recientes primero. */
  async listCloses(scope: string) {
    return this.prisma.financialClose.findMany({
      where: { scope },
      orderBy: { period: 'desc' },
    });
  }

  /** Cierra (o re-cierra) un mes: calcula la cascada y la CONGELA en un snapshot. */
  async closePeriod(
    userId: string | null,
    period: string,
    scope: string,
    note?: string,
  ) {
    const b = this.monthBounds(period);
    if (!b) throw new BadRequestException('Período inválido (formato YYYY-MM).');
    const s = await this.summary(scope !== 'all', b.from, b.to);
    const data = {
      grossUsd: s.grossUsd,
      feeTaxUsd: round2(s.gatewayFeeUsd + s.taxUsd),
      netUsd: s.netUsd,
      egresosUsd: s.egresosUsd,
      nominaUsd: s.nominaUsd,
      comisionesUsd: s.comisionesUsd,
      utilidadUsd: s.utilidadUsd,
      note: note ?? null,
      closedByUserId: userId,
    };
    return this.prisma.financialClose.upsert({
      where: { period_scope: { period, scope } },
      update: { ...data, closedAt: new Date() },
      create: { period, scope, ...data },
    });
  }

  /** Reabre un mes cerrado (borra el snapshot para poder recalcular). */
  async reopen(id: string) {
    await this.prisma.financialClose.delete({ where: { id } }).catch(() => null);
    return { ok: true as const };
  }
}
