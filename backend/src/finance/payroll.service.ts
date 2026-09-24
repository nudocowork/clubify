import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { enRangoConRespaldo, type Rango } from './where-periodo';
import { alcanceDeMarca, combinar } from './alcance-de-marca';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Cuántas veces cobra un colaborador en un mes. La «nómina próxima» sumaba el
 * monto de cada uno tal cual, y una quincena contaba como el mes entero.
 */
export function vecesAlMes(periodicidad: string | null | undefined): number {
  return String(periodicidad ?? '').toUpperCase() === 'QUINCENAL' ? 2 : 1;
}

/** Estado de un corte según lo abonado, tras cambiar su total. */
export function estadoDelCorte(totalUsd: number, pagadoUsd: number): 'PENDING' | 'PARTIAL' | 'PAID' {
  if (pagadoUsd <= 0) return 'PENDING';
  return pagadoUsd >= totalUsd - 0.01 ? 'PAID' : 'PARTIAL';
}

export interface EmployeePatch {
  name?: string;
  role?: string | null;
  payType?: string | null;
  amountUsd?: number;
  periodicity?: string;
  active?: boolean;
  note?: string | null;
}

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
      where: await alcanceDeMarca(this.prisma, onlyClubify),
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

  /**
   * Editar un colaborador. Sara (2026-09-17): «no se pueden estandarizar los
   * pagos… se debe poder editar el monto». Hasta hoy solo se podía crear, y los
   * tres colaboradores se dieron de alta con el monto en PESOS en un campo que
   * es de dólares: no había forma de corregirlo.
   *
   * Solo cambia el colaborador: los cortes ya generados guardan su propio monto
   * (son la foto de lo que se le pagó ese período).
   */
  updateEmployee(id: string, patch: EmployeePatch) {
    const data: Record<string, unknown> = {};
    if (patch.name !== undefined && patch.name.trim()) data.name = patch.name.trim();
    if (patch.role !== undefined) data.role = patch.role?.trim() || null;
    if (patch.payType !== undefined) data.payType = patch.payType?.trim() || null;
    if (patch.amountUsd !== undefined && Number.isFinite(Number(patch.amountUsd))) {
      data.amountUsd = round2(Number(patch.amountUsd));
    }
    if (patch.periodicity !== undefined && patch.periodicity.trim()) data.periodicity = patch.periodicity.trim();
    if (patch.active !== undefined) data.active = patch.active;
    if (patch.note !== undefined) data.note = patch.note?.trim() || null;
    return this.prisma.payrollEmployee.update({ where: { id }, data });
  }

  /**
   * Eliminar a un colaborador «de por vida» (Sara). Se borra la ficha; lo que ya
   * se le pagó NO: cada corte guarda nombre, cargo y montos en sus propias filas
   * (`PayrollItem.employeeId` no es una relación), así que el histórico y los
   * cierres siguen cuadrando.
   */
  async deleteEmployee(id: string) {
    const r = await this.prisma.payrollEmployee.deleteMany({ where: { id } });
    return { ok: r.count === 1 };
  }

  // ── Cortes de nómina ──────────────────────────────────────────────────────
  /**
   * Genera un corte de nómina.
   *
   * Un segundo corte del MISMO período, cuando el primero todavía no tiene
   * pagos, casi nunca es lo que se quiere: es que faltó un colaborador. Le pasó
   * a Sara con la quincena del 1-15 de septiembre — agregó al que faltaba y
   * volvió a generar, y acabó con dos cortes de las mismas fechas en vez de uno
   * completo.
   *
   * La pantalla ya lo avisa, pero el aviso se puede ignorar y la pantalla no es
   * la última palabra: aquí se rechaza. Con el corte ya PAGADO (o con abonos)
   * sí se deja generar otro, porque entonces la única salida es un corte nuevo
   * con la misma fecha y solo los que faltan — que es justo lo que pidió el
   * encargo.
   */
  async generateRun(input: {
    periodLabel: string;
    periodStart?: string | null;
    periodEnd?: string | null;
    items: RunItemInput[];
    whiteLabelId?: string | null;
    actorId?: string | null;
  }) {
    if (input.periodEnd) {
      const fin = new Date(input.periodEnd);
      if (!Number.isNaN(fin.getTime())) {
        // Por el DÍA en que termina, no por el instante: el panel lo manda al
        // mediodía, pero un corte viejo pudo guardarse a otra hora.
        const dia = fin.toISOString().slice(0, 10);
        const gemelo = await this.prisma.payrollRun.findFirst({
          where: {
            whiteLabelId: input.whiteLabelId ?? null,
            periodEnd: {
              gte: new Date(`${dia}T00:00:00.000Z`),
              lte: new Date(`${dia}T23:59:59.999Z`),
            },
            amountPaidUsd: { lte: 0 },
          },
          select: { id: true, periodLabel: true },
        });
        if (gemelo) {
          throw new BadRequestException(
            `Ya hay un corte sin pagos que termina ese día: «${gemelo.periodLabel}». ` +
              'Si falta un colaborador, agrégalo a ese corte desde su detalle en vez de generar otro igual.',
          );
        }
      }
    }
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

  async listRuns(onlyClubify: boolean, rango: Rango = {}) {
    const rows = await this.prisma.payrollRun.findMany({
      where: combinar(
        await alcanceDeMarca(this.prisma, onlyClubify),
        enRangoConRespaldo('periodEnd', rango),
      ),
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

  /**
   * Agregar a alguien a un corte que todavía no se ha pagado.
   *
   * Sara (2026-09-17) generó el corte del 1 al 15, vio que le faltaba un
   * colaborador, lo dio de alta y volvió a generar: quedaron DOS cortes con la
   * misma fecha. Lo que pedía: «si el período sigue como pendiente, poder
   * agregar el colaborador a ese corte; si ya está pagado, crear un corte nuevo
   * con la misma fecha de corte pero con ese solo colaborador».
   *
   * Con abonos NO se toca: ese corte ya es dinero que salió, y cambiarle el
   * total descuadraría el mes contra el banco. En ese caso el panel ofrece el
   * corte aparte.
   */
  async addRunItem(runId: string, input: RunItemInput) {
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.findUnique({
        where: { id: runId },
        select: { amountPaidUsd: true },
      });
      if (!run) return { ok: false as const, motivo: 'no-existe' as const };
      if (Number(run.amountPaidUsd) > 0) {
        return { ok: false as const, motivo: 'ya-pagado' as const };
      }
      // Ya está en el corte: agregarlo otra vez le sumaría su sueldo dos veces
      // y el corte saldría inflado sin que se vea de dónde. El panel filtra a
      // los que faltan, pero por NOMBRE, y a un colaborador se le puede
      // corregir el nombre («Nicolas» → «Nicolás Rojas»): entonces vuelve a
      // aparecer como faltante. Por id Y por nombre, que es como lo guarda la
      // línea.
      const yaEsta = await tx.payrollItem.findFirst({
        where: {
          runId,
          OR: [
            ...(input.employeeId ? [{ employeeId: input.employeeId }] : []),
            { employeeName: input.employeeName },
          ],
        },
        select: { id: true },
      });
      if (yaEsta) return { ok: false as const, motivo: 'ya-esta' as const };
      const base = Number(input.baseUsd) || 0;
      const bonus = Number(input.bonusUsd ?? 0) || 0;
      const ded = Number(input.deductionUsd ?? 0) || 0;
      await tx.payrollItem.create({
        data: {
          runId,
          employeeId: input.employeeId ?? null,
          employeeName: input.employeeName,
          role: input.role ?? null,
          baseUsd: base,
          bonusUsd: bonus,
          deductionUsd: ded,
          totalUsd: round2(base + bonus - ded),
        },
      });
      return { ok: true as const, ...(await this.recalcularCorte(tx, runId)) };
    });
  }

  /**
   * Cambiar el monto de un colaborador DENTRO de un corte: el mes en que cobró
   * 100.000 y el siguiente 300.000 (Sara). Recalcula el total del corte y su
   * estado contra lo que ya se abonó, en una transacción para que el total nunca
   * quede descuadrado con sus líneas.
   */
  async updateRunItem(
    runId: string,
    itemId: string,
    input: { baseUsd?: number; bonusUsd?: number; deductionUsd?: number },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.payrollItem.findFirst({ where: { id: itemId, runId } });
      if (!item) return { ok: false as const };
      const num = (v: unknown, previo: unknown) =>
        v === undefined || v === null || !Number.isFinite(Number(v)) ? Number(previo) : Number(v);
      const base = num(input.baseUsd, item.baseUsd);
      const bonus = num(input.bonusUsd, item.bonusUsd);
      const ded = num(input.deductionUsd, item.deductionUsd);
      await tx.payrollItem.update({
        where: { id: itemId },
        data: { baseUsd: base, bonusUsd: bonus, deductionUsd: ded, totalUsd: round2(base + bonus - ded) },
      });
      return { ok: true as const, ...(await this.recalcularCorte(tx, runId)) };
    });
  }

  /** Quitar a alguien de un corte (no le tocaba cobrar ese período). */
  async deleteRunItem(runId: string, itemId: string) {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.payrollItem.deleteMany({ where: { id: itemId, runId } });
      if (r.count === 0) return { ok: false as const };
      return { ok: true as const, ...(await this.recalcularCorte(tx, runId)) };
    });
  }

  /**
   * Borrar un corte entero. Solo si no tiene NINGÚN abono: uno con pagos ya es
   * dinero que salió, y borrarlo descuadraría el mes contra el banco.
   */
  async deleteRun(id: string) {
    const r = await this.prisma.payrollRun.deleteMany({
      where: { id, amountPaidUsd: { lte: 0 } },
    });
    return { ok: r.count === 1 };
  }

  private async recalcularCorte(tx: any, runId: string) {
    const items: Array<{ totalUsd: unknown }> = await tx.payrollItem.findMany({
      where: { runId },
      select: { totalUsd: true },
    });
    const run = await tx.payrollRun.findUnique({
      where: { id: runId },
      select: { amountPaidUsd: true, paidAt: true },
    });
    const total = round2(items.reduce((a, it) => a + Number(it.totalUsd), 0));
    const pagado = Number(run?.amountPaidUsd ?? 0);
    // Un corte no puede quedar por debajo de lo que ya se le abonó: quedaba con
    // saldo negativo y ese negativo le restaba «pendiente» a los demás cortes del
    // mes. Lanzar deshace la transacción entera (revisión de Fable, 2026-09-17).
    if (total < pagado - 0.01) {
      throw new BadRequestException(
        `A este pago ya se le abonaron $${pagado.toFixed(2)}: el total no puede quedar por debajo.`,
      );
    }
    const status = estadoDelCorte(total, pagado);
    await tx.payrollRun.update({
      where: { id: runId },
      data: {
        totalUsd: total,
        status,
        // Con fecha si pasa a pagado ahora; sin ella si deja de estarlo.
        ...(status !== 'PAID' ? { paidAt: null } : run?.paidAt ? {} : { paidAt: new Date() }),
      },
    });
    return { totalUsd: total, status };
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

  async summary(onlyClubify: boolean, rango: Rango = {}) {
    const where = await alcanceDeMarca(this.prisma, onlyClubify);
    const [employees, runs] = await Promise.all([
      // Los colaboradores NO se acotan por período: son las personas que hay
      // hoy, y "nómina próxima" mira hacia adelante, no al mes que se ve.
      this.prisma.payrollEmployee.findMany({
        where: combinar(where, { active: true }),
        select: { amountUsd: true, periodicity: true },
      }),
      this.prisma.payrollRun.findMany({
        where: combinar(where, enRangoConRespaldo('periodEnd', rango)),
        select: { totalUsd: true, amountPaidUsd: true, status: true },
      }),
    ]);
    // Al MES: una quincena es la mitad de lo que cobra en el mes.
    const proxima = round2(
      employees.reduce((a, e) => a + Number(e.amountUsd) * vecesAlMes(e.periodicity), 0),
    );
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
