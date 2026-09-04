import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface Movement {
  date: string;
  kind: 'INGRESO' | 'EGRESO';
  category: string;
  concept: string;
  party: string | null;
  grossUsd: number | null;
  debitUsd: number; // sale dinero
  creditUsd: number; // entra dinero
  net: number; // +credit / -debit
  balanceUsd: number; // saldo corrido
  status: string;
  reference: string | null;
  hasReceipt: boolean;
  source: 'income' | 'expense' | 'payroll';
}

/**
 * CONTABILIDAD — Fase 4. Movimientos = libro de caja unificado (tipo Excel con
 * saldo corrido). DERIVADO en lectura de IncomeRecord + Expense + PayrollRun —
 * NO persiste una tabla nueva ni duplica registros. Un ingreso entra como
 * CRÉDITO (neto recibido, o esperado si aún no se concilió); un egreso o un
 * corte de nómina salen como DÉBITO. El saldo se acumula en orden cronológico.
 */
@Injectable()
export class MovementsService {
  constructor(private prisma: PrismaService) {}

  async list(opts: {
    from?: Date;
    to?: Date;
    onlyClubify?: boolean;
    kind?: 'INGRESO' | 'EGRESO';
    limit?: number;
  }): Promise<{ movements: Movement[]; summary: { ingresosUsd: number; egresosUsd: number; saldoUsd: number; count: number } }> {
    const wlNull = opts.onlyClubify ? { whiteLabelId: null } : {};
    const rango = { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) };
    const dateFilter = (field: string) =>
      opts.from || opts.to ? { [field]: rango } : {};
    const dateFilterConRespaldo = (field: string) =>
      opts.from || opts.to
        ? { OR: [{ [field]: rango }, { [field]: null, createdAt: rango }] }
        : {};

    const [incomes, expenses, cats, runs] = await Promise.all([
      this.prisma.incomeRecord.findMany({
        where: { ...wlNull, ...dateFilter('saleDate') },
        select: {
          saleDate: true, brandName: true, gateway: true, externalTxId: true,
          grossUsd: true, netExpectedUsd: true, netReceivedUsd: true, reconStatus: true,
        },
      }),
      this.prisma.expense.findMany({
        where: { ...wlNull, ...dateFilter('expenseDate') },
        select: {
          expenseDate: true, concept: true, supplier: true, categoryId: true,
          amountUsd: true, status: true, receiptUrl: true, id: true,
        },
      }),
      this.prisma.expenseCategory.findMany({ select: { id: true, name: true } }),
      this.prisma.payrollRun.findMany({
        // El corte cuenta en el mes de su período; si no lo trae (el panel
        // permitía guardarlo sin fechas), cae al día en que se creó. Mismo
        // respaldo que `finance-report.service`, para que el libro de caja y
        // el reporte no se contradigan.
        where: { ...wlNull, ...dateFilterConRespaldo('periodEnd') },
        select: {
          createdAt: true, periodEnd: true, periodLabel: true, totalUsd: true,
          status: true, receiptUrl: true, reference: true,
          _count: { select: { items: true } },
        },
      }),
    ]);
    const catName = new Map(cats.map((c) => [c.id, c.name]));

    type Raw = Omit<Movement, 'balanceUsd'>;
    const raw: Raw[] = [];

    for (const i of incomes) {
      const credit = i.netReceivedUsd != null ? Number(i.netReceivedUsd) : Number(i.netExpectedUsd);
      raw.push({
        date: i.saleDate.toISOString(),
        kind: 'INGRESO',
        category: 'Venta',
        concept: `Cobro ${i.gateway}`,
        party: i.brandName,
        grossUsd: Number(i.grossUsd),
        debitUsd: 0,
        creditUsd: round2(credit),
        net: round2(credit),
        status: i.reconStatus,
        reference: i.externalTxId,
        hasReceipt: false,
        source: 'income',
      });
    }
    for (const e of expenses) {
      const amt = Number(e.amountUsd);
      raw.push({
        date: e.expenseDate.toISOString(),
        kind: 'EGRESO',
        category: e.categoryId ? catName.get(e.categoryId) ?? 'Egreso' : 'Egreso',
        concept: e.concept,
        party: e.supplier,
        grossUsd: null,
        debitUsd: round2(amt),
        creditUsd: 0,
        net: round2(-amt),
        status: e.status,
        reference: e.id.slice(0, 8),
        hasReceipt: !!e.receiptUrl,
        source: 'expense',
      });
    }
    for (const r of runs) {
      const amt = Number(r.totalUsd);
      raw.push({
        // La misma fecha por la que se filtró arriba: si el movimiento se
        // listara por `createdAt` habiendo entrado al rango por `periodEnd`,
        // aparecería fuera del mes que se está viendo y el saldo corrido
        // quedaría descolocado.
        date: (r.periodEnd ?? r.createdAt).toISOString(),
        kind: 'EGRESO',
        category: 'Nómina',
        concept: `Nómina · ${r.periodLabel} (${r._count.items} colab.)`,
        party: null,
        grossUsd: null,
        debitUsd: round2(amt),
        creditUsd: 0,
        net: round2(-amt),
        status: r.status,
        reference: r.reference,
        hasReceipt: !!r.receiptUrl,
        source: 'payroll',
      });
    }

    // Orden cronológico ascendente para el saldo corrido.
    raw.sort((a, b) => a.date.localeCompare(b.date));
    let balance = 0;
    let ingresos = 0,
      egresos = 0;
    const withBalance: Movement[] = raw.map((m) => {
      balance = round2(balance + m.net);
      ingresos += m.creditUsd;
      egresos += m.debitUsd;
      return { ...m, balanceUsd: balance };
    });

    // Filtro por tipo (después de calcular el saldo, para que el saldo sea real).
    const filtered = opts.kind ? withBalance.filter((m) => m.kind === opts.kind) : withBalance;
    // Más recientes primero para mostrar; recorta al límite.
    const shown = filtered.slice().reverse().slice(0, Math.min(opts.limit ?? 500, 2000));

    return {
      movements: shown,
      summary: {
        ingresosUsd: round2(ingresos),
        egresosUsd: round2(egresos),
        saldoUsd: round2(ingresos - egresos),
        count: withBalance.length,
      },
    };
  }
}
