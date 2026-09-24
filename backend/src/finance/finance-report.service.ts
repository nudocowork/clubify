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
import { SOLO_LO_COBRADO } from './categorias-de-ingreso';
import { alcanceDeMarca, combinar, marcaClubify } from './alcance-de-marca';
import { NO_ES_COMISION_DEL_SOCIO, parteDelSocio, porcentajeDelSocio } from './socio';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * CONTABILIDAD — Fase 6 (Reportes/Dashboard) y motor del snapshot de la Fase 5
 * (Cierres). Cascada de utilidad, DERIVADA en lectura (no persiste nada):
 *
 *   Bruto − (Fee pasarela + Impuestos) = Neto
 *   Neto − Egresos − Nómina − Comisiones PAGADAS = Utilidad antes del socio
 *   Utilidad antes del socio − Socio = UTILIDAD
 *
 * El socio se lleva su porcentaje de la UTILIDAD (Sara, 2026-09-17), no del
 * neto: todo lo que baja la utilidad —egresos, nómina, comisiones— le baja
 * también su parte. Ver `socio.ts`.
 *
 * Las comisiones entran por lo PAGADO (fecha de pago), no por lo generado:
 * una comisión aprobada y sin pagar es deuda, no un egreso ya realizado, y
 * restarla inventaba una pérdida. Lo generado y lo pendiente se informan en
 * sus propias líneas para que la deuda con los afiliados siga a la vista.
 *
 * `onlyClubify` resuelve Clubify como su marca MÁS los legacy en null (ver
 * `alcance-de-marca.ts`). Las comisiones no se acotan por marca (v1): son el costo de afiliados
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
  /** Comisiones que YA SE PAGARON en el período: el dinero que salió. */
  comisionesUsd: number;
  /** Comisiones generadas en el período pero todavía sin pagar (deuda). */
  comisionesPendientesUsd: number;
  /** Comisiones generadas en el período, pagadas o no. */
  comisionesGeneradasUsd: number;
  /** Parte del socio: `socioPorcentaje` % de la utilidad de Clubify antes de él. */
  socioUsd: number;
  socioPorcentaje: number;
  utilidadUsd: number;
  ingresosCount: number;
  /** Cobros devueltos en el período (no restan; se informan aparte). */
  refundedUsd: number;
  /** Apuntes anulados en el período: nunca fueron un cobro. */
  canceledUsd: number;
  /** Bruto por clase de ingreso: NUEVA, RENOVACION, UPGRADE, OTRO. */
  porCategoria: Record<string, { count: number; grossUsd: number }>;
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
    const wl = await alcanceDeMarca(this.prisma, onlyClubify);
    const rango = { from, to };
    const [inc, exp, runs, comms, pagadas, socioPorcentaje, ventasClubify, egresosClubify, nominaClubify] =
      await Promise.all([
      this.income.summary({ from, to, onlyClubify }),
      this.expense.summary({ from, to, onlyClubify }),
      this.prisma.payrollRun.findMany({
        where: combinar(wl, enRangoConRespaldo('periodEnd', rango)),
        select: { totalUsd: true },
      }),
      this.prisma.commission.findMany({
        where: {
          status: { not: 'REJECTED' },
          ...NO_ES_COMISION_DEL_SOCIO,
          ...enRangoConRespaldo('businessDate', rango),
        },
        select: { amount: true, amountPaid: true, paymentStatus: true },
      }),
      // Lo que REALMENTE se pagó de comisiones dentro del período, por su fecha
      // de pago. No es lo mismo que "las del período que ya están pagadas": una
      // comisión de agosto pagada en septiembre es dinero que salió en
      // SEPTIEMBRE, y así es como cuadra contra el banco.
      this.prisma.commission.findMany({
        where: {
          status: { not: 'REJECTED' },
          paymentStatus: 'PAID',
          ...NO_ES_COMISION_DEL_SOCIO,
          ...enRango('paidAt', rango),
        },
        select: { amountPaid: true },
      }),
      porcentajeDelSocio(this.prisma),
      // El socio es de Clubify: con «todas las marcas» su base sigue siendo el
      // neto de Clubify, no el de las marcas blancas.
      onlyClubify
        ? Promise.resolve(null)
        : this.income.summary({ from, to, onlyClubify: true }),
      // Mismo motivo: con «todas las marcas», los egresos y la nómina que
      // cuentan para el socio son los de Clubify.
      onlyClubify ? Promise.resolve(null) : this.expense.summary({ from, to, onlyClubify: true }),
      onlyClubify
        ? Promise.resolve(null)
        : this.prisma.payrollRun.findMany({
            where: combinar(
              await alcanceDeMarca(this.prisma, true),
              enRangoConRespaldo('periodEnd', rango),
            ),
            select: { totalUsd: true },
          }),
    ]);
    const nominaUsd = round2(
      runs.reduce((a, r) => a + Number(r.totalUsd), 0),
    );
    // Generada en el período (devengo) vs pagada en el período (caja). La
    // cascada de utilidad resta la PAGADA: una comisión pendiente todavía no
    // es un egreso realizado — restarla inventaba una pérdida que no existe.
    const comisionesGeneradasUsd = round2(
      comms.reduce((a, c) => a + Number(c.amount), 0),
    );
    const comisionesPendientesUsd = round2(
      comms.reduce(
        (a, c) => a + (Number(c.amount) - Number(c.amountPaid ?? 0)),
        0,
      ),
    );
    const comisionesUsd = round2(
      pagadas.reduce((a, c) => a + Number(c.amountPaid), 0),
    );
    // La parte del socio sale de la utilidad de CLUBIFY, aunque la pantalla esté
    // mostrando todas las marcas: las ventas, egresos y nómina de una marca
    // blanca no son suyos. Las comisiones no se acotan por marca (decisión v1).
    const nominaClubifyUsd = nominaClubify
      ? round2(nominaClubify.reduce((a, r) => a + Number(r.totalUsd), 0))
      : nominaUsd;
    const utilidadAntesDelSocio = round2(
      (ventasClubify ?? inc).netExpectedUsd -
        (egresosClubify ?? exp).totalUsd -
        nominaClubifyUsd -
        comisionesUsd,
    );
    const socioUsd = parteDelSocio(utilidadAntesDelSocio, socioPorcentaje);
    const utilidadUsd = round2(
      inc.netExpectedUsd - exp.totalUsd - nominaUsd - comisionesUsd - socioUsd,
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
      comisionesPendientesUsd,
      comisionesGeneradasUsd,
      socioUsd,
      socioPorcentaje,
      utilidadUsd,
      ingresosCount: inc.count,
      refundedUsd: inc.refundedUsd,
      canceledUsd: inc.canceledUsd,
      porCategoria: inc.porCategoria,
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
      socioUsd: number;
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
        socioUsd: s.socioUsd,
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
    const wl = await alcanceDeMarca(this.prisma, onlyClubify);

    const [ingresos, egresos, cortes, comisiones, socioPorcentaje, ventasClubify, idDeClubify] = await Promise.all([
      this.prisma.incomeRecord.findMany({
        where: combinar(wl, SOLO_LO_COBRADO, enRango('saleDate', rango)),
        select: {
          saleDate: true, grossUsd: true, gatewayFeeUsd: true,
          taxUsd: true, netExpectedUsd: true,
        },
      }),
      // `whiteLabelId` viene en el select porque el socio se calcula sobre la
      // utilidad de CLUBIFY y estas dos tablas, con «todas las marcas», traen
      // también las de las marcas blancas. Repartir en memoria evita dos
      // consultas más por una gráfica.
      this.prisma.expense.findMany({
        where: combinar(wl, enRango('expenseDate', rango)),
        select: { expenseDate: true, amountUsd: true, whiteLabelId: true },
      }),
      this.prisma.payrollRun.findMany({
        where: combinar(wl, enRangoConRespaldo('periodEnd', rango)),
        select: { periodEnd: true, createdAt: true, totalUsd: true, whiteLabelId: true },
      }),
      // Por fecha de PAGO y con lo PAGADO, igual que `summary()`. Antes esta
      // consulta repartía por fecha de NEGOCIO y sumaba lo generado: la barra
      // «Comisiones pagadas» de un mes no daba lo mismo que la línea con ese
      // nombre en la cascada del mismo mes. Un módulo que se contradice consigo
      // mismo no se puede cuadrar.
      this.prisma.commission.findMany({
        where: {
          status: { not: 'REJECTED' },
          paymentStatus: 'PAID',
          ...NO_ES_COMISION_DEL_SOCIO,
          ...enRango('paidAt', rango),
        },
        select: { paidAt: true, amountPaid: true },
      }),
      porcentajeDelSocio(this.prisma),
      // Base del socio con «todas las marcas»: solo las ventas de Clubify. Con
      // el alcance Clubify ya son las mismas filas de `ingresos`.
      onlyClubify
        ? Promise.resolve(null)
        : alcanceDeMarca(this.prisma, true).then((clubify) =>
            this.prisma.incomeRecord.findMany({
              where: combinar(clubify, SOLO_LO_COBRADO, enRango('saleDate', rango)),
              select: { saleDate: true, netExpectedUsd: true },
            }),
          ),
      marcaClubify(this.prisma),
    ]);

    // La misma regla que `alcanceDeMarca`: Clubify es su id MÁS los legacy en
    // null. Con el alcance Clubify todas las filas ya lo son.
    const esDeClubify = (id: string | null) =>
      onlyClubify || id === null || id === idDeClubify;

    const vacio = () => ({
      grossUsd: 0, gatewayFeeUsd: 0, taxUsd: 0, netUsd: 0,
      egresosUsd: 0, nominaUsd: 0, comisionesUsd: 0,
      netoClubifyUsd: 0, egresosClubifyUsd: 0, nominaClubifyUsd: 0,
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
      if (!ventasClubify) c.netoClubifyUsd += Number(i.netExpectedUsd);
    }
    for (const v of ventasClubify ?? []) {
      const c = cubo(v.saleDate);
      if (c) c.netoClubifyUsd += Number(v.netExpectedUsd);
    }
    for (const e of egresos) {
      const c = cubo(e.expenseDate);
      if (!c) continue;
      c.egresosUsd += Number(e.amountUsd);
      if (esDeClubify(e.whiteLabelId)) c.egresosClubifyUsd += Number(e.amountUsd);
    }
    for (const r of cortes) {
      const c = cubo(r.periodEnd ?? r.createdAt);
      if (!c) continue;
      c.nominaUsd += Number(r.totalUsd);
      if (esDeClubify(r.whiteLabelId)) c.nominaClubifyUsd += Number(r.totalUsd);
    }
    for (const k of comisiones) {
      if (!k.paidAt) continue;
      const c = cubo(k.paidAt);
      if (c) c.comisionesUsd += Number(k.amountPaid);
    }

    return meses.map((period) => {
      const c = cubos.get(period)!;
      // Igual que en `summary`, y con los MISMOS componentes: la utilidad de
      // Clubify. Antes restaba los egresos y la nómina de todas las marcas de
      // un neto que ya era solo el de Clubify, así que el primer egreso de una
      // marca blanca habría enseñado dos socios distintos para el mismo mes
      // (la gráfica y la cascada). Las comisiones no se acotan por marca
      // (decisión v1), igual que en `summary`.
      const socioUsd = parteDelSocio(
        round2(
          c.netoClubifyUsd - c.egresosClubifyUsd - c.nominaClubifyUsd - c.comisionesUsd,
        ),
        socioPorcentaje,
      );
      const utilidadUsd = round2(
        c.netUsd - c.egresosUsd - c.nominaUsd - c.comisionesUsd - socioUsd,
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
        socioUsd,
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
      where: combinar(
        await alcanceDeMarca(this.prisma, onlyClubify),
        SOLO_LO_COBRADO,
        enRango('saleDate', rango),
      ),
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


  // ── Fase 3 — Comisiones del período (la misma línea de la cascada) ────────

  /**
   * Las comisiones que cuenta ESTE período, abiertas por beneficiario.
   *
   * Usa EXACTAMENTE el mismo `where` que la cascada (`summary`), no uno
   * parecido: el total de esta pestaña tiene que dar igual que la línea
   * "− Comisiones afiliados" del Resumen. Dos consultas distintas para el mismo
   * número es cómo se llega a que un módulo se contradiga consigo mismo.
   *
   * Tampoco se acota por marca, igual que la cascada: hoy las comisiones son el
   * costo de afiliados de la plataforma entera (decisión v1 documentada arriba).
   */
  async comisionesDelPeriodo(period: string) {
    const rango = limitesDelPeriodo(period) ?? {};
    const filas = await this.prisma.commission.findMany({
      where: {
        status: { not: 'REJECTED' },
        ...NO_ES_COMISION_DEL_SOCIO,
        ...enRangoConRespaldo('businessDate', rango),
      },
      select: {
        amount: true,
        amountPaid: true,
        paymentStatus: true,
        businessDate: true,
        createdAt: true,
        recipientCode: { select: { code: true, ownerName: true, role: true } },
      },
    });

    type Beneficiario = {
      code: string;
      nombre: string;
      rol: string;
      totalUsd: number;
      pagadoUsd: number;
      pendienteUsd: number;
      count: number;
    };
    const porBeneficiario = new Map<string, Beneficiario>();
    let totalUsd = 0;
    let pagadoUsd = 0;

    for (const f of filas) {
      const monto = Number(f.amount);
      const pagado = Number(f.amountPaid);
      totalUsd += monto;
      pagadoUsd += pagado;
      // Sin código de beneficiario (filas legacy) se agrupan aparte en vez de
      // desaparecer: si no cuadran con el total, hay que poder verlas.
      const code = f.recipientCode?.code ?? '—';
      const b = porBeneficiario.get(code) ?? {
        code,
        nombre: f.recipientCode?.ownerName ?? 'Sin beneficiario asignado',
        rol: f.recipientCode?.role ?? '—',
        totalUsd: 0,
        pagadoUsd: 0,
        pendienteUsd: 0,
        count: 0,
      };
      b.totalUsd = round2(b.totalUsd + monto);
      b.pagadoUsd = round2(b.pagadoUsd + pagado);
      b.pendienteUsd = round2(b.totalUsd - b.pagadoUsd);
      b.count += 1;
      porBeneficiario.set(code, b);
    }

    return {
      period,
      totalUsd: round2(totalUsd),
      pagadoUsd: round2(pagadoUsd),
      pendienteUsd: round2(totalUsd - pagadoUsd),
      count: filas.length,
      porBeneficiario: [...porBeneficiario.values()].sort(
        (a, b) => b.totalUsd - a.totalUsd,
      ),
    };
  }

  /**
   * Las comisiones del período REPARTIDAS POR CORTE, tal como las paga el módulo
   * de Comisiones.
   *
   * POR QUÉ (Sara, 2026-09-17): «los pagos de comisiones se generan cada 15
   * días… la información de las comisiones la debes traer del apartado de
   * comisiones. Para este corte estas son las comisiones que se van a pagar y no
   * coinciden con lo que hay en contabilidad».
   *
   * No coincidían porque cada módulo agrupa por algo distinto: Contabilidad por
   * la fecha de la comisión y el módulo por el CORTE al que entra, que es cuando
   * queda disponible para pago (15 días después). Ejemplo real de septiembre:
   * las 3 comisiones de Nicolas Rojas ($160) son de negocios de agosto, pero
   * entran al corte del 15-09 — Contabilidad las dejaba fuera y el corte sí las
   * paga. Ahora el corte manda: los mismos números, la misma gente.
   *
   * Lo generado en el mes que TODAVÍA no entra a ningún corte se informa aparte
   * («aún sin corte»), para que el total del mes siga a la vista sin mezclarse
   * con lo que se va a transferir.
   */
  async cortesDeComisiones(period: string) {
    const rango = limitesDelPeriodo(period) ?? {};
    const soloComisiones = {
      status: { not: 'REJECTED' as const },
      ...NO_ES_COMISION_DEL_SOCIO,
    };
    const [cortes, sueltas] = await Promise.all([
      this.prisma.payoutBatch.findMany({
        where: enRango('cutoffDate', rango),
        orderBy: { cutoffDate: 'desc' },
        include: {
          commissions: {
            where: soloComisiones,
            select: {
              amount: true,
              amountPaid: true,
              recipientCodeId: true,
              recipientCode: { select: { code: true, ownerName: true, role: true } },
            },
          },
        },
      }),
      // Del período y sin corte todavía: se generaron, pero se pagan cuando
      // queden disponibles (y entren a un corte).
      this.prisma.commission.findMany({
        where: {
          ...soloComisiones,
          payoutBatchId: null,
          ...enRangoConRespaldo('businessDate', rango),
        },
        select: { amount: true, availableAt: true },
      }),
    ]);

    type Persona = {
      code: string;
      codeId: string | null;
      nombre: string;
      rol: string;
      count: number;
      totalUsd: number;
      pagadoUsd: number;
      pendienteUsd: number;
      /** Cuándo se le transfirió y con qué comprobante. Ver abajo. */
      pagadoEl: Date | null;
      comprobanteUrl: string | null;
      referencia: string | null;
    };

    const persona = (
      mapa: Map<string, Persona>,
      c: {
        amount: unknown;
        amountPaid: unknown;
        recipientCodeId: string | null;
        recipientCode: { code: string; ownerName: string; role: string } | null;
      },
    ) => {
      const code = c.recipientCode?.code ?? '—';
      const p = mapa.get(code) ?? {
        code,
        codeId: c.recipientCodeId ?? null,
        nombre: c.recipientCode?.ownerName ?? 'Sin beneficiario asignado',
        rol: c.recipientCode?.role ?? '—',
        count: 0,
        totalUsd: 0,
        pagadoUsd: 0,
        pendienteUsd: 0,
        pagadoEl: null,
        comprobanteUrl: null,
        referencia: null,
      };
      p.count += 1;
      p.totalUsd = round2(p.totalUsd + Number(c.amount));
      p.pagadoUsd = round2(p.pagadoUsd + Number(c.amountPaid));
      p.pendienteUsd = round2(p.totalUsd - p.pagadoUsd);
      mapa.set(code, p);
      return p;
    };

    // El COMPROBANTE de cada transferencia.
    //
    // Lo pide el encargo de Sara (PDF del 17-09-2026): «cuando las comisiones se
    // marquen como pagadas en su módulo respectivo y se anexen los respectivos
    // comprobantes, se debe registrar en contabilidad». Hasta ahora Contabilidad
    // decía CUÁNTO se había pagado de cada corte, pero no cuándo ni con qué
    // respaldo, y para cuadrar contra el banco hace falta el comprobante.
    //
    // Vive en `BatchPersonPayment`, una fila por (corte, beneficiario) — que es
    // exactamente la granularidad con la que se paga.
    const pagos = cortes.length
      ? await this.prisma.batchPersonPayment.findMany({
          where: { batchId: { in: cortes.map((b) => b.id) } },
          select: {
            batchId: true,
            recipientCodeId: true,
            proofUrl: true,
            reference: true,
            paidAt: true,
          },
        })
      : [];
    const comprobante = new Map(
      pagos.map((x) => [`${x.batchId}|${x.recipientCodeId}`, x]),
    );

    const lista = cortes.map((b) => {
      const mapa = new Map<string, ReturnType<typeof persona>>();
      let totalUsd = 0;
      let pagadoUsd = 0;
      for (const c of b.commissions) {
        totalUsd += Number(c.amount);
        pagadoUsd += Number(c.amountPaid);
        persona(mapa, c);
      }
      return {
        code: b.code,
        cutoffDate: b.cutoffDate,
        periodStart: b.periodStart,
        periodEnd: b.periodEnd,
        status: b.status,
        paymentDate: b.paymentDate,
        receivedAt: b.receivedAt,
        count: b.commissions.length,
        totalUsd: round2(totalUsd),
        pagadoUsd: round2(pagadoUsd),
        pendienteUsd: round2(totalUsd - pagadoUsd),
        personas: [...mapa.values()]
          .map((p) => {
            const x = p.codeId ? comprobante.get(`${b.id}|${p.codeId}`) : null;
            return x
              ? { ...p, pagadoEl: x.paidAt, comprobanteUrl: x.proofUrl, referencia: x.reference }
              : p;
          })
          .sort((a, b2) => b2.totalUsd - a.totalUsd),
      };
    });

    const sinCorteUsd = round2(sueltas.reduce((a, c) => a + Number(c.amount), 0));
    return {
      period,
      cortes: lista,
      totalCortesUsd: round2(lista.reduce((a, c) => a + c.totalUsd, 0)),
      pagadoCortesUsd: round2(lista.reduce((a, c) => a + c.pagadoUsd, 0)),
      sinCorte: { count: sueltas.length, totalUsd: sinCorteUsd },
    };
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
      socioUsd: s.socioUsd,
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
