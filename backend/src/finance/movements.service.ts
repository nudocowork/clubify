import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { enRango, enRangoConRespaldo } from './where-periodo';
import { CATEGORIAS_DE_INGRESO } from './categorias-de-ingreso';
import { alcanceDeMarca, combinar } from './alcance-de-marca';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Nombre legible de la categoría de un ingreso, con respaldo para las
 *  filas antiguas que aún no la tienen. */
const ETIQUETA_CATEGORIA: Record<string, string> = CATEGORIAS_DE_INGRESO;

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
  source: 'income' | 'expense' | 'payroll' | 'commission';
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
    const wl = await alcanceDeMarca(this.prisma, opts.onlyClubify);
    const rango = { from: opts.from, to: opts.to };
    const dateFilter = (field: string) => enRango(field, rango);
    const dateFilterConRespaldo = (field: string) =>
      enRangoConRespaldo(field, rango);

    const [incomes, expenses, cats, runs, comisiones] = await Promise.all([
      this.prisma.incomeRecord.findMany({
        where: combinar(wl, dateFilter('saleDate')),
        select: {
          saleDate: true, brandName: true, gateway: true, externalTxId: true,
          grossUsd: true, netExpectedUsd: true, netReceivedUsd: true, reconStatus: true,
          status: true, category: true,
        },
      }),
      this.prisma.expense.findMany({
        where: combinar(wl, dateFilter('expenseDate')),
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
        where: combinar(wl, dateFilterConRespaldo('periodEnd')),
        select: {
          createdAt: true, periodEnd: true, periodLabel: true, totalUsd: true,
          status: true, receiptUrl: true, reference: true,
          _count: { select: { items: true } },
        },
      }),
      // Las comisiones NO se acotan por marca (misma decisión que la cascada:
      // hoy son el costo de afiliados de la plataforma entera). Solo entran las
      // PAGADAS y por su fecha de PAGO: una comisión aprobada pero sin pagar no
      // es dinero que salió, y meterla aquí descuadraría el saldo corrido.
      this.prisma.commission.findMany({
        where: combinar(
          { paymentStatus: 'PAID', status: { not: 'REJECTED' } },
          enRango('paidAt', rango),
        ),
        select: {
          id: true, paidAt: true, amountPaid: true, payoutBatchId: true,
          recipientCode: { select: { ownerName: true, code: true } },
          referralUse: { select: { tenant: { select: { brandName: true } } } },
        },
      }),
    ]);
    const catName = new Map(cats.map((c) => [c.id, c.name]));

    type Raw = Omit<Movement, 'balanceUsd'>;
    const raw: Raw[] = [];

    for (const i of incomes) {
      // Un cobro devuelto se sigue viendo —el histórico no se borra— pero no
      // suma al saldo: el dinero salió otra vez.
      const devuelto = i.status !== 'PAGADO';
      const credit = devuelto
        ? 0
        : i.netReceivedUsd != null
          ? Number(i.netReceivedUsd)
          : Number(i.netExpectedUsd);
      raw.push({
        date: i.saleDate.toISOString(),
        kind: 'INGRESO',
        category: ETIQUETA_CATEGORIA[i.category ?? ''] ?? 'Venta',
        concept: `Cobro ${i.gateway}`,
        party: i.brandName,
        grossUsd: Number(i.grossUsd),
        debitUsd: 0,
        creditUsd: round2(credit),
        net: round2(credit),
        status: devuelto ? i.status : i.reconStatus,
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

    for (const c of comisiones) {
      const amt = Number(c.amountPaid);
      if (!(amt > 0) || !c.paidAt) continue;
      raw.push({
        date: c.paidAt.toISOString(),
        kind: 'EGRESO',
        category: 'Comisión',
        concept: `Comisión a ${c.recipientCode?.ownerName ?? 'sin beneficiario'}` +
          (c.referralUse?.tenant?.brandName ? ` · ${c.referralUse.tenant.brandName}` : ''),
        party: c.recipientCode?.code ?? null,
        grossUsd: null,
        debitUsd: round2(amt),
        creditUsd: 0,
        net: round2(-amt),
        status: 'PAID',
        reference: c.payoutBatchId ?? c.id.slice(0, 8),
        hasReceipt: false,
        source: 'commission',
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
