import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CreateExpenseInput {
  concept: string;
  categoryId?: string | null;
  supplier?: string | null;
  amountUsd?: number | null;
  /** Alternativa a amountUsd: monto = pctRate% de pctBase (ej. fee 8,6% de $150). */
  pctRate?: number | null;
  pctBase?: number | null;
  currency?: string | null;
  method?: string | null;
  account?: string | null;
  status?: 'PENDING' | 'REVIEW' | 'PARTIAL' | 'PAID';
  receiptUrl?: string | null;
  note?: string | null;
  expenseDate?: string | null;
  whiteLabelId?: string | null;
  actorId?: string | null;
}

/**
 * CONTABILIDAD — Fase 2. Egresos, categorías y gastos recurrentes. Todo el
 * dinero que sale (incluye el pago de un corte de comisiones como UN egreso que
 * referencia su corte). Soporta monto fijo o por % y pagos parciales.
 */
@Injectable()
export class ExpenseService {
  constructor(private prisma: PrismaService) {}

  // ── Categorías ──────────────────────────────────────────────────────────
  listCategories() {
    return this.prisma.expenseCategory.findMany({
      orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createCategory(name: string, color?: string | null) {
    const slug = name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    return this.prisma.expenseCategory.upsert({
      where: { slug },
      update: { name, ...(color ? { color } : {}) },
      create: { name, slug, color: color ?? null },
    });
  }

  setCategoryActive(id: string, active: boolean) {
    return this.prisma.expenseCategory.update({ where: { id }, data: { active } });
  }

  // ── Egresos ─────────────────────────────────────────────────────────────
  async list(opts: { onlyClubify?: boolean; categoryId?: string; status?: string; limit?: number }) {
    const rows = await this.prisma.expense.findMany({
      where: {
        ...(opts.onlyClubify ? { whiteLabelId: null } : {}),
        ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
        ...(opts.status ? { status: opts.status as any } : {}),
      },
      orderBy: { expenseDate: 'desc' },
      take: Math.min(opts.limit ?? 300, 1000),
    });
    return rows.map((r) => ({
      ...r,
      amountUsd: Number(r.amountUsd),
      amountPaidUsd: Number(r.amountPaidUsd),
      outstandingUsd: round2(Number(r.amountUsd) - Number(r.amountPaidUsd)),
      pctRate: r.pctRate == null ? null : Number(r.pctRate),
      pctBase: r.pctBase == null ? null : Number(r.pctBase),
    }));
  }

  async create(input: CreateExpenseInput) {
    // Monto: fijo, o calculado por porcentaje sobre una base.
    let amount = input.amountUsd ?? null;
    if ((amount == null || amount === 0) && input.pctRate != null && input.pctBase != null) {
      amount = round2((Number(input.pctRate) / 100) * Number(input.pctBase));
    }
    const amountUsd = Number(amount ?? 0);
    return this.prisma.expense.create({
      data: {
        concept: input.concept.trim(),
        categoryId: input.categoryId ?? null,
        supplier: input.supplier ?? null,
        amountUsd,
        currency: input.currency ?? 'USD',
        method: input.method ?? null,
        account: input.account ?? null,
        status: input.status ?? 'PENDING',
        amountPaidUsd: input.status === 'PAID' ? amountUsd : 0,
        receiptUrl: input.receiptUrl ?? null,
        note: input.note ?? null,
        pctRate: input.pctRate ?? null,
        pctBase: input.pctBase ?? null,
        expenseDate: input.expenseDate ? new Date(input.expenseDate) : new Date(),
        whiteLabelId: input.whiteLabelId ?? null,
        actorId: input.actorId ?? null,
      },
    });
  }

  /** Registra un pago (total o PARCIAL). Suma a amountPaidUsd y ajusta estado. */
  async registerPayment(
    id: string,
    input: { amountPaidUsd: number; method?: string | null; account?: string | null; receiptUrl?: string | null },
  ) {
    const e = await this.prisma.expense.findUnique({
      where: { id },
      select: { amountUsd: true, amountPaidUsd: true },
    });
    if (!e) return { ok: false as const };
    const total = Number(e.amountUsd);
    const paid = round2(Number(e.amountPaidUsd) + Number(input.amountPaidUsd));
    const status = paid >= total - 0.01 ? 'PAID' : 'PARTIAL';
    await this.prisma.expense.update({
      where: { id },
      data: {
        amountPaidUsd: paid,
        status,
        ...(input.method ? { method: input.method } : {}),
        ...(input.account ? { account: input.account } : {}),
        ...(input.receiptUrl ? { receiptUrl: input.receiptUrl } : {}),
      },
    });
    return { ok: true as const, status, paid, outstanding: round2(total - paid) };
  }

  setStatus(id: string, status: 'PENDING' | 'REVIEW' | 'PARTIAL' | 'PAID') {
    return this.prisma.expense.update({ where: { id }, data: { status } });
  }

  async summary(opts: { from?: Date; to?: Date; onlyClubify?: boolean }) {
    const rows = await this.prisma.expense.findMany({
      where: {
        ...(opts.onlyClubify ? { whiteLabelId: null } : {}),
        ...(opts.from || opts.to
          ? { expenseDate: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
          : {}),
      },
      select: { amountUsd: true, amountPaidUsd: true, status: true, categoryId: true },
    });
    let total = 0,
      paid = 0;
    const byCategory: Record<string, number> = {};
    for (const r of rows) {
      total += Number(r.amountUsd);
      paid += Number(r.amountPaidUsd);
      const k = r.categoryId ?? 'sin-categoria';
      byCategory[k] = round2((byCategory[k] ?? 0) + Number(r.amountUsd));
    }
    return {
      count: rows.length,
      totalUsd: round2(total),
      paidUsd: round2(paid),
      outstandingUsd: round2(total - paid),
      pending: rows.filter((r) => r.status === 'PENDING' || r.status === 'REVIEW').length,
      byCategory,
    };
  }

  // ── Gastos recurrentes ──────────────────────────────────────────────────
  listRecurring(opts: { onlyClubify?: boolean }) {
    return this.prisma.recurringExpense.findMany({
      where: { ...(opts.onlyClubify ? { whiteLabelId: null } : {}) },
      orderBy: [{ active: 'desc' }, { concept: 'asc' }],
    });
  }

  createRecurring(input: {
    concept: string;
    categoryId?: string | null;
    supplier?: string | null;
    amountUsd: number;
    periodicity: string;
    method?: string | null;
    account?: string | null;
    whiteLabelId?: string | null;
    note?: string | null;
  }) {
    return this.prisma.recurringExpense.create({
      data: {
        concept: input.concept.trim(),
        categoryId: input.categoryId ?? null,
        supplier: input.supplier ?? null,
        amountUsd: Number(input.amountUsd),
        periodicity: input.periodicity,
        method: input.method ?? null,
        account: input.account ?? null,
        whiteLabelId: input.whiteLabelId ?? null,
        note: input.note ?? null,
      },
    });
  }

  setRecurringActive(id: string, active: boolean) {
    return this.prisma.recurringExpense.update({ where: { id }, data: { active } });
  }
}
