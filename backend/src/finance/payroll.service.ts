import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface RunItemInput {
  employeeId?: string | null;
  employeeName: string;
  role?: string | null;
  baseUsd: number;
  bonusUsd?: number | null;
  deductionUsd?: number | null;
}

/**
 * CONTABILIDAD — Fase 3. Nómina: colaboradores + cortes de nómina (agrupan el
 * pago de varios en un período, con bonos/deducciones) + pagos PARCIALES. El
 * corte es el egreso ÚNICO (su detalle vive en los items), no N egresos.
 */
@Injectable()
export class PayrollService {
  constructor(private prisma: PrismaService) {}

  // ── Colaboradores ─────────────────────────────────────────────────────────
  async listEmployees(onlyClubify: boolean) {
    const rows = await this.prisma.payrollEmployee.findMany({
      where: { ...(onlyClubify ? { whiteLabelId: null } : {}) },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return rows.map((e) => ({ ...e, amountUsd: Number(e.amountUsd) }));
  }

  createEmployee(input: {
    name: string;
    role?: string | null;
    payType?: string | null;
    amountUsd: number;
    periodicity: string;
    whiteLabelId?: string | null;
    note?: string | null;
  }) {
    return this.prisma.payrollEmployee.create({
      data: {
        name: input.name.trim(),
        role: input.role ?? null,
        payType: input.payType ?? null,
        amountUsd: Number(input.amountUsd),
        periodicity: input.periodicity,
        whiteLabelId: input.whiteLabelId ?? null,
        note: input.note ?? null,
      },
    });
  }

  setEmployeeActive(id: string, active: boolean) {
    return this.prisma.payrollEmployee.update({ where: { id }, data: { active } });
  }

  // ── Cortes de nómina ──────────────────────────────────────────────────────
  async generateRun(input: {
    periodLabel: string;
    periodStart?: string | null;
    periodEnd?: string | null;
    items: RunItemInput[];
    whiteLabelId?: string | null;
    actorId?: string | null;
  }) {
    const items = input.items.map((it) => {
      const base = Number(it.baseUsd) || 0;
      const bonus = Number(it.bonusUsd ?? 0) || 0;
      const ded = Number(it.deductionUsd ?? 0) || 0;
      return {
        employeeId: it.employeeId ?? null,
        employeeName: it.employeeName,
        role: it.role ?? null,
        baseUsd: base,
        bonusUsd: bonus,
        deductionUsd: ded,
        totalUsd: round2(base + bonus - ded),
      };
    });
    const total = round2(items.reduce((a, it) => a + it.totalUsd, 0));
    return this.prisma.payrollRun.create({
      data: {
        periodLabel: input.periodLabel.trim(),
        periodStart: input.periodStart ? new Date(input.periodStart) : null,
        periodEnd: input.periodEnd ? new Date(input.periodEnd) : null,
        totalUsd: total,
        status: 'PENDING',
        whiteLabelId: input.whiteLabelId ?? null,
        actorId: input.actorId ?? null,
        items: { create: items },
      },
      include: { items: true },
    });
  }

  async listRuns(onlyClubify: boolean) {
    const rows = await this.prisma.payrollRun.findMany({
      where: { ...(onlyClubify ? { whiteLabelId: null } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { items: true } } },
    });
    return rows.map((r) => ({
      ...r,
      totalUsd: Number(r.totalUsd),
      amountPaidUsd: Number(r.amountPaidUsd),
      outstandingUsd: round2(Number(r.totalUsd) - Number(r.amountPaidUsd)),
      itemCount: r._count.items,
    }));
  }

  async runDetail(id: string) {
    const r = await this.prisma.payrollRun.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!r) return null;
    return {
      ...r,
      totalUsd: Number(r.totalUsd),
      amountPaidUsd: Number(r.amountPaidUsd),
      outstandingUsd: round2(Number(r.totalUsd) - Number(r.amountPaidUsd)),
      items: r.items.map((it) => ({
        ...it,
        baseUsd: Number(it.baseUsd),
        bonusUsd: Number(it.bonusUsd),
        deductionUsd: Number(it.deductionUsd),
        totalUsd: Number(it.totalUsd),
      })),
    };
  }

  /** Registra un pago del corte (total o PARCIAL). Al quedar totalmente pagado,
   *  marca PAID y sella paidAt. */
  async registerRunPayment(
    id: string,
    input: { amountPaidUsd: number; method?: string | null; account?: string | null; reference?: string | null; receiptUrl?: string | null },
  ) {
    const run = await this.prisma.payrollRun.findUnique({
      where: { id },
      select: { totalUsd: true, amountPaidUsd: true },
    });
    if (!run) return { ok: false as const };
    const total = Number(run.totalUsd);
    const paid = round2(Number(run.amountPaidUsd) + Number(input.amountPaidUsd));
    const status = paid >= total - 0.01 ? 'PAID' : 'PARTIAL';
    await this.prisma.payrollRun.update({
      where: { id },
      data: {
        amountPaidUsd: paid,
        status,
        ...(input.method ? { method: input.method } : {}),
        ...(input.account ? { account: input.account } : {}),
        ...(input.reference ? { reference: input.reference } : {}),
        ...(input.receiptUrl ? { receiptUrl: input.receiptUrl } : {}),
        ...(status === 'PAID' ? { paidAt: new Date() } : {}),
      },
    });
    return { ok: true as const, status, paid, outstanding: round2(total - paid) };
  }

  async summary(onlyClubify: boolean) {
    const where = onlyClubify ? { whiteLabelId: null } : {};
    const [employees, runs] = await Promise.all([
      this.prisma.payrollEmployee.findMany({ where: { ...where, active: true }, select: { amountUsd: true } }),
      this.prisma.payrollRun.findMany({ where, select: { totalUsd: true, amountPaidUsd: true, status: true } }),
    ]);
    const proxima = round2(employees.reduce((a, e) => a + Number(e.amountUsd), 0));
    let pendiente = 0,
      pagada = 0;
    for (const r of runs) {
      pendiente += Number(r.totalUsd) - Number(r.amountPaidUsd);
      pagada += Number(r.amountPaidUsd);
    }
    return {
      colaboradores: employees.length,
      nominaProximaUsd: proxima,
      pendienteUsd: round2(pendiente),
      pagadaUsd: round2(pagada),
    };
  }
}
