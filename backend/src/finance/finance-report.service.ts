import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  limitesDelMes,
  mesAtras,
  mesContableActual,
} from '../common/periodo-contable';
import { IncomeRecordService } from './income-record.service';
import { ExpenseService } from './expense.service';

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
    const rango = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    /**
     * Filtro de fecha con RESPALDO por `createdAt`.
     *
     * `PayrollRun.periodEnd` y `Commission.businessDate` son opcionales, y en
     * la práctica casi ningún corte de nómina los trae: el panel los crea
     * mandando solo `periodLabel` (texto libre). Filtrando solo por el campo
     * preferido, esas filas se caían del `where` y el mes las contaba como
     * CERO — la nómina desaparecía del reporte y la UTILIDAD salía inflada.
     * Se cae al `createdAt` para la fila que no tenga fecha propia, el mismo
     * respaldo que ya usan `referrals.service` y el módulo `accounting`.
     */
    const dateWhere = (campo: 'periodEnd' | 'businessDate') =>
      from || to
        ? {
            OR: [
              { [campo]: rango },
              { [campo]: null, createdAt: rango },
            ],
          }
        : {};
    const [inc, exp, runs, comms] = await Promise.all([
      this.income.summary({ from, to, onlyClubify }),
      this.expense.summary({ from, to, onlyClubify }),
      this.prisma.payrollRun.findMany({
        where: { ...wl, ...dateWhere('periodEnd') },
        select: { totalUsd: true },
      }),
      this.prisma.commission.findMany({
        where: { status: { not: 'REJECTED' }, ...dateWhere('businessDate') },
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
