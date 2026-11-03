import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { enRango } from './where-periodo';
import { alcanceDeMarca, combinar } from './alcance-de-marca';
import { mesContable, mesContableActual, nombreDelPeriodo } from '../common/periodo-contable';
import {
  GastoOperativo,
  MES_INICIAL,
  PREFIJO_HISTORIAL,
  cambiarDesde,
  esMes,
  leerHistorial,
  mesSiguiente,
  mesesEntre,
  montoDelMes,
  totalDelMes,
} from './gastos-operativos';
import {
  ES_UN_DIA,
  fechaDentroDelPeriodo,
  instanteDelDia,
} from './fecha-del-movimiento';

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
  /**
   * El día del egreso, "YYYY-MM-DD". OBLIGATORIO: hasta el 2026-09-24 era
   * opcional y caía a `new Date()`, así que un egreso creado desde mayo se
   * guardaba en septiembre sin decir nada.
   */
  expenseDate: string;
  /** El período que la persona está gestionando, para contrastar la fecha. */
  periodo?: string | null;
  /** Guardar aunque la fecha caiga fuera de ese período (elección consciente). */
  confirmarOtroPeriodo?: boolean;
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
  async list(opts: { onlyClubify?: boolean; categoryId?: string; status?: string; limit?: number; from?: Date; to?: Date }) {
    const rows = await this.prisma.expense.findMany({
      where: combinar(
        await alcanceDeMarca(this.prisma, opts.onlyClubify),
        opts.categoryId ? { categoryId: opts.categoryId } : null,
        opts.status ? { status: opts.status as any } : null,
        enRango('expenseDate', { from: opts.from, to: opts.to }),
      ),
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
    // La FECHA primero: sin ella no hay egreso.
    //
    // Esta comprobación vive en el servicio y no solo en el formulario a
    // propósito: es la que no se puede saltar. El aviso de «esa fecha es de
    // otro período» sí necesita saber dónde estaba la persona, y eso solo lo
    // sabe quien llama — por eso `periodo` viaja en la petición.
    const dia = (input.expenseDate ?? '').trim();
    if (!ES_UN_DIA.test(dia)) {
      throw new BadRequestException(
        'Falta la fecha del egreso: ponla en formato AAAA-MM-DD.',
      );
    }
    const fecha = instanteDelDia(dia);
    if (!fecha) {
      throw new BadRequestException(`El día ${dia} no existe en el calendario.`);
    }
    if (
      input.periodo &&
      !input.confirmarOtroPeriodo &&
      !fechaDentroDelPeriodo(dia, input.periodo)
    ) {
      throw new BadRequestException(
        `La fecha ${dia} no pertenece a ${nombreDelPeriodo(input.periodo)}. ` +
          'Corrígela, o confirma que quieres registrarla en ese otro período.',
      );
    }

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
        expenseDate: fecha,
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
      where: combinar(
        await alcanceDeMarca(this.prisma, opts.onlyClubify),
        enRango('expenseDate', { from: opts.from, to: opts.to }),
      ),
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
  async listRecurring(opts: { onlyClubify?: boolean }) {
    return this.prisma.recurringExpense.findMany({
      where: await alcanceDeMarca(this.prisma, opts.onlyClubify),
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

  // ── Gastos operativos en la cascada (ver `gastos-operativos.ts`) ─────────

  /** Los gastos recurrentes del alcance, cada uno con su historial de montos. */
  async gastosOperativos(onlyClubify: boolean): Promise<
    Array<GastoOperativo & { concept: string; categoryId: string | null; supplier: string | null }>
  > {
    const [recs, hist] = await Promise.all([
      this.prisma.recurringExpense.findMany({
        where: await alcanceDeMarca(this.prisma, onlyClubify),
        orderBy: [{ active: 'desc' }, { concept: 'asc' }],
      }),
      this.prisma.setting.findMany({ where: { key: { startsWith: PREFIJO_HISTORIAL } } }),
    ]);
    const porId = new Map(hist.map((h) => [h.key.slice(PREFIJO_HISTORIAL.length), h.value]));
    return recs.map((r) => ({
      id: r.id,
      concept: r.concept,
      categoryId: r.categoryId,
      supplier: r.supplier,
      amountUsd: Number(r.amountUsd),
      periodicity: r.periodicity,
      active: r.active,
      historial: leerHistorial(porId.get(r.id)),
    }));
  }

  /**
   * Total de gastos operativos de un rango. Cuenta meses ENTEROS: el mes de
   * `from` hasta el de `to`. Sin `from`, desde mayo de 2026; sin `to`, hasta el
   * mes en curso (los meses futuros no son un gasto todavía).
   */
  async gastosOperativosDelRango(opts: { onlyClubify: boolean; from?: Date; to?: Date }) {
    const desde = opts.from ? mesContable(opts.from) : MES_INICIAL;
    // `to` es exclusivo (inicio del período siguiente): el último mes es el del
    // instante anterior.
    const hasta = opts.to ? mesContable(new Date(opts.to.getTime() - 1)) : mesContableActual();
    const gastos = await this.gastosOperativos(opts.onlyClubify);
    const porMes: Record<string, number> = {};
    let total = 0;
    for (const m of mesesEntre(desde < MES_INICIAL ? MES_INICIAL : desde, hasta)) {
      porMes[m] = totalDelMes(gastos, m);
      total += porMes[m];
    }
    return { totalUsd: Math.round(total * 100) / 100, porMes };
  }

  /** La grilla de la pestaña: cada gasto por mes, de mayo de 2026 a `hasta`. */
  async grillaGastosOperativos(onlyClubify: boolean, hasta?: string) {
    const actual = mesContableActual();
    // Por defecto, seis meses por delante del actual: lo que se planea de verdad.
    let fin = hasta && esMes(hasta) ? hasta : actual;
    if (!hasta) for (let i = 0; i < 6; i++) fin = mesSiguiente(fin);
    const meses = mesesEntre(MES_INICIAL, fin);
    const gastos = await this.gastosOperativos(onlyClubify);
    return {
      mesActual: actual,
      meses,
      gastos: gastos.map((g) => ({
        id: g.id,
        concept: g.concept,
        categoryId: g.categoryId,
        supplier: g.supplier,
        periodicity: g.periodicity,
        active: g.active,
        montos: Object.fromEntries(meses.map((m) => [m, montoDelMes(g, m)])),
      })),
      totales: Object.fromEntries(meses.map((m) => [m, totalDelMes(gastos, m)])),
    };
  }

  /** Cambia lo que cuesta un gasto desde `mes` en adelante. */
  async cambiarMontoDesde(id: string, mes: string, montoUsd: number) {
    const g = (await this.gastosOperativos(false)).find((x) => x.id === id);
    if (!g) throw new BadRequestException('Ese gasto operativo no existe.');
    let historial;
    try {
      historial = cambiarDesde(g, mes, Number(montoUsd), mesContableActual());
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const key = `${PREFIJO_HISTORIAL}${id}`;
    const value = JSON.stringify(historial);
    await this.prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    return { ok: true as const, historial };
  }
}
