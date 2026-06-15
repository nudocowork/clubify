import { ForbiddenException, Injectable } from '@nestjs/common';
import { CommissionStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { CommissionRecalcService } from '../referrals/commission-recalc.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

/**
 * MÓDULO CONTABLE (2026-06-15) — "el contador público dentro del sistema".
 *
 * Implementación PROYECTADA (read-only): los asientos de doble partida se
 * DERIVAN en tiempo de lectura desde la fuente de verdad (Commission + sus
 * pagos + el precio base del tenant). No persiste tablas nuevas ni toca el
 * flujo de pagos → cero riesgo de deploy, y refleja SIEMPRE el estado real
 * de las comisiones. (El cierre mensual inmutable con asientos
 * materializados —F5 de docs/17— queda como follow-up.)
 *
 * INVARIANTE: cada asiento está balanceado (Σ Debe == Σ Haber), por lo que
 * el balance de comprobación global siempre cuadra en 0. Es lo que permite
 * "auditar y verificar que todo esté bien" + exportar al contador.
 *
 * Alcance: negocios CON atribución de afiliado (los que generan comisión).
 * Los ingresos/socio se derivan por (tenant, período) de esas comisiones.
 */

type Account = {
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'INCOME' | 'EXPENSE';
};

// Plan de cuentas (docs/17 §2.3, + socio de plataforma).
const ACCOUNTS: Record<string, Account> = {
  '1000': { code: '1000', name: 'Caja / Banco', type: 'ASSET' },
  '1100': { code: '1100', name: 'Hotmart por liquidar', type: 'ASSET' },
  '2000': { code: '2000', name: 'Comisiones por pagar', type: 'LIABILITY' },
  '2100': { code: '2100', name: 'Socio por pagar', type: 'LIABILITY' },
  '4000': { code: '4000', name: 'Ingresos por suscripciones', type: 'INCOME' },
  '5000': { code: '5000', name: 'Gasto de comisiones', type: 'EXPENSE' },
  '5100': { code: '5100', name: 'Gasto socio plataforma', type: 'EXPENSE' },
};

type JournalLine = {
  account: string;
  accountName: string;
  debit: number;
  credit: number;
};

type JournalEntryView = {
  id: string;
  date: Date;
  memo: string;
  sourceType:
    | 'REVENUE'
    | 'SOCIO_ACCRUAL'
    | 'COMMISSION_ACCRUAL'
    | 'COMMISSION_PAYOUT';
  sourceId: string | null;
  tenantId: string | null;
  tenantName: string | null;
  lines: JournalLine[];
};

const round = (n: number) => Math.round(n * 100) / 100;

const monthOf = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

@Injectable()
export class AccountingService {
  constructor(
    private prisma: PrismaService,
    private recalc: CommissionRecalcService,
  ) {}

  /**
   * Genera el reporte contable del período: resumen, balance de
   * comprobación y libro de asientos (derivados). `periodKey` (YYYY-MM)
   * y `tenantId` filtran; sin filtros = todo el histórico.
   */
  async buildReport(
    user: AuthUser,
    opts: { periodKey?: string; tenantId?: string; limit?: number } = {},
  ) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();

    // Fuente de verdad: comisiones NO anuladas (las REJECTED nunca entran al
    // libro — se anulan = como si no existieran).
    const where: any = { status: { not: CommissionStatus.REJECTED } };
    if (opts.tenantId) where.referralUse = { tenantId: opts.tenantId };

    const commissions = await this.prisma.commission.findMany({
      where,
      include: {
        referralUse: {
          select: {
            tenantId: true,
            tenant: {
              select: {
                id: true,
                brandName: true,
                planPeriodicity: true,
                subscriptionPriceUsd: true,
              },
            },
          },
        },
        recipientCode: {
          select: { ownerName: true, code: true, role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Setting % socio (default 10) — sobre TODA venta.
    const socioRow = await this.prisma.setting.findUnique({
      where: { key: 'referrals.socioPercent' },
    });
    const socioPct = socioRow?.value ? Number(socioRow.value) : 10;

    // periodKey de cada comisión (legacy sin periodKey → mes de createdAt).
    const pk = (c: (typeof commissions)[number]) =>
      c.periodKey ?? monthOf(new Date(c.createdAt));

    const entries: JournalEntryView[] = [];

    // ── 1. INGRESO + SOCIO: uno por (tenant, período). Base = precio real
    //    del tenant (subscriptionPriceUsd) ?? canónico del bundle.
    const groups = new Map<
      string,
      {
        tenantId: string;
        tenantName: string;
        periodicity: string | null;
        subPrice: unknown;
        date: Date;
      }
    >();
    for (const c of commissions) {
      const t = c.referralUse?.tenant;
      const tid = c.referralUse?.tenantId;
      if (!t || !tid) continue;
      const period = pk(c);
      const key = `${tid}::${period}`;
      const date = new Date(c.createdAt);
      const existing = groups.get(key);
      if (!existing || date < existing.date) {
        groups.set(key, {
          tenantId: tid,
          tenantName: t.brandName,
          periodicity: t.planPeriodicity ?? null,
          subPrice: t.subscriptionPriceUsd ?? null,
          date,
        });
      }
    }

    for (const [key, g] of groups) {
      const period = key.split('::')[1];
      if (opts.periodKey && period !== opts.periodKey) continue;
      const base = await this.recalc.getCommissionBase(
        g.subPrice,
        g.periodicity,
      );
      if (base <= 0) continue;

      // Ingreso por suscripción: Dr 1100 / Cr 4000.
      entries.push({
        id: `rev:${key}`,
        date: g.date,
        memo: `Ingreso suscripción · ${g.tenantName} · ${period}`,
        sourceType: 'REVENUE',
        sourceId: g.tenantId,
        tenantId: g.tenantId,
        tenantName: g.tenantName,
        lines: [
          this.line('1100', base, 0),
          this.line('4000', 0, base),
        ],
      });

      // Devengo socio 10%: Dr 5100 / Cr 2100.
      const socio = round((base * socioPct) / 100);
      if (socio > 0) {
        entries.push({
          id: `socio:${key}`,
          date: g.date,
          memo: `Socio plataforma ${socioPct}% · ${g.tenantName} · ${period}`,
          sourceType: 'SOCIO_ACCRUAL',
          sourceId: g.tenantId,
          tenantId: g.tenantId,
          tenantName: g.tenantName,
          lines: [
            this.line('5100', socio, 0),
            this.line('2100', 0, socio),
          ],
        });
      }
    }

    // ── 2. DEVENGO + PAGO de cada comisión.
    for (const c of commissions) {
      const period = pk(c);
      if (opts.periodKey && period !== opts.periodKey) continue;
      const tid = c.referralUse?.tenantId ?? null;
      const tName = c.referralUse?.tenant?.brandName ?? null;
      const who = c.recipientCode?.ownerName ?? c.recipientCode?.code ?? '—';
      const amount = round(Number(c.amount));
      const paid = round(Number(c.amountPaid));

      // Devengo: Dr 5000 / Cr 2000.
      if (amount > 0) {
        entries.push({
          id: `accr:${c.id}`,
          date: new Date(c.createdAt),
          memo: `Devengo comisión · ${who}${tName ? ` · ${tName}` : ''} · ${period}`,
          sourceType: 'COMMISSION_ACCRUAL',
          sourceId: c.id,
          tenantId: tid,
          tenantName: tName,
          lines: [this.line('5000', amount, 0), this.line('2000', 0, amount)],
        });
      }

      // Pago (total o parcial): Dr 2000 / Cr 1000.
      if (paid > 0) {
        entries.push({
          id: `pay:${c.id}`,
          date: new Date(c.paidAt ?? c.createdAt),
          memo: `Pago comisión · ${who}${tName ? ` · ${tName}` : ''}`,
          sourceType: 'COMMISSION_PAYOUT',
          sourceId: c.id,
          tenantId: tid,
          tenantName: tName,
          lines: [this.line('2000', paid, 0), this.line('1000', 0, paid)],
        });
      }
    }

    // ── 3. BALANCE DE COMPROBACIÓN por cuenta.
    const acc = new Map<string, { debit: number; credit: number }>();
    for (const e of entries) {
      for (const l of e.lines) {
        const cur = acc.get(l.account) ?? { debit: 0, credit: 0 };
        cur.debit = round(cur.debit + l.debit);
        cur.credit = round(cur.credit + l.credit);
        acc.set(l.account, cur);
      }
    }
    const trialBalance = [...acc.entries()]
      .map(([code, v]) => {
        const a = ACCOUNTS[code];
        // Saldo según naturaleza: ASSET/EXPENSE = Debe − Haber;
        // LIABILITY/INCOME = Haber − Debe.
        const balance =
          a.type === 'ASSET' || a.type === 'EXPENSE'
            ? round(v.debit - v.credit)
            : round(v.credit - v.debit);
        return {
          account: code,
          name: a.name,
          type: a.type,
          debit: v.debit,
          credit: v.credit,
          balance,
        };
      })
      .sort((x, y) => x.account.localeCompare(y.account));

    const totalDebit = round(
      trialBalance.reduce((s, r) => s + r.debit, 0),
    );
    const totalCredit = round(
      trialBalance.reduce((s, r) => s + r.credit, 0),
    );
    const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

    // ── 4. RESUMEN (estado de resultados + saldos clave).
    const bal = (code: string) =>
      trialBalance.find((r) => r.account === code)?.balance ?? 0;
    const ingresos = bal('4000');
    const gastoComisiones = bal('5000');
    const gastoSocio = bal('5100');
    const comisionesPorPagar = bal('2000');
    const socioPorPagar = bal('2100');
    // Pagos del período = débitos a 2000 (lo que salió de "por pagar").
    const pagos = acc.get('2000')?.debit ?? 0;
    const resultado = round(ingresos - gastoComisiones - gastoSocio);

    // Períodos disponibles para el selector.
    const periodSet = new Set<string>();
    for (const c of commissions) periodSet.add(pk(c));
    const periods = [...periodSet].sort().reverse();

    // Libro: orden cronológico desc, capado para display.
    const ledger = entries
      .slice()
      .sort((a, b) => b.date.getTime() - a.date.getTime());
    const limit = opts.limit ?? 500;

    return {
      summary: {
        ingresos,
        gastoComisiones,
        gastoSocio,
        comisionesPorPagar,
        socioPorPagar,
        pagos,
        resultado,
        socioPercent: socioPct,
      },
      trialBalance,
      totals: { totalDebit, totalCredit, balanced },
      ledger: ledger.slice(0, limit),
      ledgerCount: ledger.length,
      truncated: ledger.length > limit,
      periods,
      chartOfAccounts: Object.values(ACCOUNTS),
      periodKey: opts.periodKey ?? null,
      tenantId: opts.tenantId ?? null,
    };
  }

  private line(account: string, debit: number, credit: number): JournalLine {
    return {
      account,
      accountName: ACCOUNTS[account]?.name ?? account,
      debit: round(debit),
      credit: round(credit),
    };
  }
}
