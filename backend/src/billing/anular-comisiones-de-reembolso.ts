/**
 * Anular las comisiones de un pago que Hotmart DEVOLVIÓ.
 *
 * EL CASO (Essentrix, 2026-09-18): el cliente pagó el 15-09, pidió el reembolso
 * directamente a Hotmart y Hotmart se lo dio. En Clubify el ingreso pasó a
 * REEMBOLSADO, pero la comisión de $15 del influencer siguió «Bloqueada» y
 * camino de pagarse el 30-09.
 *
 * LA CAUSA: el código ya intentaba anularla (`churnReferral`), pero buscaba las
 * relaciones con el afiliado que NO estuvieran dadas de baja. El 17-09 el cliente
 * había CANCELADO la suscripción, y eso ya la había dado de baja, así que el
 * reembolso del 18-09 no encontró ninguna y se fue sin hacer nada. Y ese orden
 * —cancelar y luego pedir el reembolso— es el NORMAL: no era mala suerte, era lo
 * que iba a pasar casi siempre. Además anulaba «la última comisión» de cada
 * afiliado, no la de ESE pago.
 *
 * LA REGLA (Javier y Sara, 2026-09-18):
 *  - Si Hotmart revierte un pago, sus comisiones se ANULAN, para que no queden
 *    pendientes, aprobadas ni se paguen por error.
 *  - Si alguna YA se pagó al afiliado, NO se anula ni se retracta.
 *  - Tiene que funcionar solo, «en macro»: 10 reembolsos de 1.000 clientes.
 *
 * CÓMO: por TRANSACCIÓN. Toda comisión nacida del aviso de un cobro de Hotmart
 * guarda la transacción en `externalTxId` (y en `hotmartTransactionId` el
 * reparto a tres y los grupos): es el único enlace inequívoco entre una comisión
 * y su pago, y cubre a la vez la directa, la indirecta, la del socio y la del
 * vendedor. No depende de si la relación con el afiliado sigue viva.
 *
 * Y por FECHA, para las que nacen SIN transacción: las que repone el cron de
 * renovaciones cuando el aviso no las generó, y las creadas a mano. En
 * producción eran 10 de 33 vivas (2026-09-18); sin esto, un reembolso de uno de
 * esos cobros era Essentrix otra vez. Solo con el negocio SEGURO y la fecha del
 * cobro devuelto: la comisión de renovación lleva en `businessDate` justo la
 * fecha de ese cobro (`lastChargeAt`, que sale del mismo `approved_date`).
 *
 * Solo REEMBOLSO y CONTRACARGO. Una DISPUTA (`PURCHASE_PROTEST`) no anula nada:
 * se puede ganar, y el mismo criterio sigue ya el libro de ingresos.
 */
import type { Prisma } from '@prisma/client';
import { recalcBatchTotal } from '../referrals/payout-batch.util';

/** Los avisos de Hotmart que significan «el dinero se devolvió». */
export const EVENTOS_DE_DEVOLUCION = ['PURCHASE_REFUNDED', 'PURCHASE_CHARGEBACK'] as const;

export function esDevolucion(evento: string | null | undefined): boolean {
  return (EVENTOS_DE_DEVOLUCION as readonly string[]).includes(evento ?? '');
}

/**
 * Lo que queda escrito en la nota de una comisión anulada por esto. Sirve para
 * reconocerla después: ver `fueReactivada`.
 */
export const MARCA_DE_ANULACION = 'Hotmart devolvió el pago';

/** La nota que queda en la comisión anulada, para que se sepa por qué. */
export function motivoDeAnulacion(evento: string, tx: string, cuando: Date = new Date()): string {
  const que = evento === 'PURCHASE_CHARGEBACK' ? 'un contracargo' : 'un reembolso';
  return `Anulada el ${cuando.toISOString().slice(0, 10)}: ${MARCA_DE_ANULACION} (${que}, tx ${tx}). No se había pagado al afiliado.`;
}

/**
 * ¿Esta comisión ya la anuló una devolución de ESTE pago, y alguien la volvió a
 * poner viva?
 *
 * Si es así, fue a propósito —p. ej. un contracargo que Hotmart resolvió a
 * favor, del que no manda aviso— y no se vuelve a anular. Sin esto, el
 * conciliador, que repasa todas las devoluciones cada noche, la tumbaba otra vez
 * a las 4:00 en silencio, noche tras noche. Ya pasó con otro cron: Wok Explosivo,
 * 2026-09-01, re-anulada después de restaurarla a mano.
 *
 * Límite conocido: si alguien BORRA la nota, deja de reconocerse.
 */
export function fueReactivada(notes: string | null | undefined, tx: string): boolean {
  return !!notes && notes.includes(MARCA_DE_ANULACION) && notes.includes(`tx ${tx})`);
}

/**
 * ¿Se le pagó ya algo al afiliado?
 *
 * Cualquiera de estas cosas lo dice, y basta UNA:
 *  - `status = PAID` o `paymentStatus = PAID`: pagada entera.
 *  - `paymentStatus = PARTIAL` o `amountPaid > 0`: se le pagó una parte — el
 *    `status` sigue en APPROVED en ese caso, así que mirar solo el status la
 *    daría por anulable.
 *  - Tiene `payoutItem`: está dentro de un desembolso, aunque todavía no se haya
 *    marcado. Anularla ahí es peligroso: `adminMarkPayoutPaid` pone PAID por id
 *    sin mirar el estado y la devolvería a la vida.
 *
 * Un corte ABIERTO no cuenta como «pagado»: `markPersonPaid` paga persona a
 * persona con el corte abierto, y eso ya lo recogen las condiciones de arriba.
 */
export function yaSePago(c: {
  status: string;
  paymentStatus: string;
  amountPaid: unknown;
  payoutItem?: unknown;
}): boolean {
  return (
    c.status === 'PAID' ||
    c.paymentStatus === 'PAID' ||
    c.paymentStatus === 'PARTIAL' ||
    Number(c.amountPaid) > 0 ||
    !!c.payoutItem
  );
}

export type PagoDevuelto = {
  tx: string;
  /** El negocio del cobro. Solo si se sabe con CERTEZA. */
  tenantId?: string | null;
  /** `approved_date` del cobro devuelto: lo trae el propio aviso de devolución. */
  fechaDelCobro?: Date | null;
};

const DIA = 86_400_000;
/**
 * Holgura para casar una comisión SIN transacción con el cobro por su fecha. La
 * de renovación lleva la fecha exacta; los 3 días cubren un `lastChargeAt`
 * retocado a mano. Un negocio no tiene dos cobros de Hotmart tan juntos.
 */
const HOLGURA_SIN_TX = 3 * DIA;
/**
 * Una comisión que SÍ lleva la transacción pero cuya fecha queda a más de esto
 * del cobro devuelto no es de ese cobro: el relleno de comisiones
 * (`backfillCommissionForAssignment`) estampa la ÚLTIMA transacción de Hotmart
 * del negocio aunque el ciclo lo haya pagado por fuera. No se anula; se informa.
 */
const LEJOS_DEL_COBRO = 25 * DIA;

function fechaValida(d: Date | null | undefined): d is Date {
  return !!d && !Number.isNaN(d.getTime());
}

/** Las comisiones nacidas de ESTE pago: por transacción y, si se puede, por fecha. */
export function deEstePago(p: PagoDevuelto): Prisma.CommissionWhereInput[] {
  const porTx: Prisma.CommissionWhereInput[] = [
    { externalTxId: p.tx },
    { hotmartTransactionId: p.tx },
  ];
  if (!p.tenantId || !fechaValida(p.fechaDelCobro)) return porTx;
  const t = p.fechaDelCobro.getTime();
  return [
    ...porTx,
    {
      externalTxId: null,
      hotmartTransactionId: null,
      referralUse: { tenantId: p.tenantId },
      businessDate: { gte: new Date(t - HOLGURA_SIN_TX), lte: new Date(t + HOLGURA_SIN_TX) },
    },
  ];
}

/**
 * El WHERE de lo que SÍ se anula. Es el reverso exacto de `yaSePago`, escrito
 * para la base, y va DENTRO de la escritura: si alguien paga la comisión entre
 * que se lee y se anula, el UPDATE ya no la encuentra y no la toca.
 */
export function whereAnulables(p: PagoDevuelto): Prisma.CommissionWhereInput {
  return {
    OR: deEstePago(p),
    // ADJUSTMENT no: son asientos, no comisiones. REJECTED no: ya está.
    status: { in: ['PENDING', 'APPROVED', 'RETAINED'] },
    paymentStatus: 'PENDING',
    amountPaid: { lte: 0 },
    payoutItem: { is: null },
  };
}

/**
 * Convierte el `approved_date` de Hotmart (milisegundos, a veces como texto) en
 * fecha. `null` si no viene o no se entiende: entonces solo se anula por
 * transacción, que es lo seguro.
 */
export function fechaDelCobroDeHotmart(approvedDate: unknown): Date | null {
  if (approvedDate == null || approvedDate === '') return null;
  const n =
    typeof approvedDate === 'string' && /^\d+$/.test(approvedDate)
      ? Number(approvedDate)
      : (approvedDate as number | string);
  const d = new Date(n);
  return fechaValida(d) ? d : null;
}

type Db = {
  commission: {
    findMany: (args: any) => Promise<any[]>;
    updateMany: (args: any) => Promise<{ count: number }>;
    aggregate: (args: any) => Promise<any>;
  };
  payoutBatch: {
    findMany: (args: any) => Promise<any[]>;
    update: (args: any) => Promise<any>;
  };
};

export type QuePasoConLaComision =
  /** Anulada (o, en simulación, que se anularía). */
  | 'anulada'
  /** Ya se le había pagado al afiliado: se queda. */
  | 'pagada'
  /** Ya la había anulado esta devolución y alguien la revivió: se respeta. */
  | 'reactivada'
  /** Lleva la transacción pero su fecha es de otro ciclo: se informa, no se toca. */
  | 'deOtroCiclo';

export type ResultadoDeAnulacion = {
  anuladas: number;
  yaPagadas: number;
  reactivadas: number;
  deOtroCiclo: number;
  /** Cortes abiertos de los que se sacaron y a los que se les rehizo el total. */
  cortesRecalculados: number;
  /** Cada comisión que se miró, para el informe nocturno. */
  detalle: Array<{ id: string; monto: number; que: QuePasoConLaComision }>;
};

/**
 * Idempotente: una segunda pasada con la misma transacción no encuentra nada
 * que anular (ya están en REJECTED), así que el mismo aviso reenviado, o el
 * conciliador repasándolo cada noche, no cambian nada.
 *
 * `simular`: no escribe; dice lo que haría.
 */
export async function anularComisionesDeTransaccion(
  db: Db,
  tx: string,
  motivo: string,
  opts: { tenantId?: string | null; fechaDelCobro?: Date | null; simular?: boolean } = {},
): Promise<ResultadoDeAnulacion> {
  const resultado: ResultadoDeAnulacion = {
    anuladas: 0,
    yaPagadas: 0,
    reactivadas: 0,
    deOtroCiclo: 0,
    cortesRecalculados: 0,
    detalle: [],
  };
  if (!tx) return resultado;
  const pago: PagoDevuelto = { tx, tenantId: opts.tenantId, fechaDelCobro: opts.fechaDelCobro };

  const todas = await db.commission.findMany({
    where: {
      OR: deEstePago(pago),
      status: { notIn: ['ADJUSTMENT', 'REJECTED'] },
    },
    select: {
      id: true,
      amount: true,
      status: true,
      paymentStatus: true,
      amountPaid: true,
      payoutBatchId: true,
      notes: true,
      externalTxId: true,
      hotmartTransactionId: true,
      businessDate: true,
      createdAt: true,
      payoutItem: { select: { id: true } },
    },
  });
  if (todas.length === 0) return resultado;

  const anotar = (c: { id: string; amount: unknown }, que: QuePasoConLaComision) => {
    resultado.detalle.push({ id: c.id, monto: Number(c.amount ?? 0), que });
    if (que === 'anulada') resultado.anuladas++;
    else if (que === 'pagada') resultado.yaPagadas++;
    else if (que === 'reactivada') resultado.reactivadas++;
    else resultado.deOtroCiclo++;
  };

  const anuladas: string[] = [];
  const cortes = new Set<string>();
  for (const c of todas) {
    if (yaSePago(c)) {
      anotar(c, 'pagada');
      continue;
    }
    if (fueReactivada(c.notes, tx)) {
      anotar(c, 'reactivada');
      continue;
    }
    const porTx = c.externalTxId === tx || c.hotmartTransactionId === tx;
    const fecha: Date | null = c.businessDate ?? c.createdAt ?? null;
    if (
      porTx &&
      fechaValida(opts.fechaDelCobro) &&
      fechaValida(fecha) &&
      Math.abs(fecha.getTime() - opts.fechaDelCobro.getTime()) > LEJOS_DEL_COBRO
    ) {
      anotar(c, 'deOtroCiclo');
      continue;
    }
    if (opts.simular) {
      anotar(c, 'anulada');
      continue;
    }
    // Fila a fila para AÑADIR el motivo a la nota, no pisar lo que hubiera. El
    // WHERE repite la condición de anulable: es lo que lo hace seguro frente a
    // un pago que llegue justo ahora.
    const r = await db.commission.updateMany({
      where: { id: c.id, ...whereAnulables(pago) },
      data: {
        status: 'REJECTED',
        notes: c.notes ? `${c.notes}\n${motivo}` : motivo,
      },
    });
    if (r.count === 1) {
      anotar(c, 'anulada');
      anuladas.push(c.id);
      if (c.payoutBatchId) cortes.add(c.payoutBatchId);
    }
  }

  // Fuera de los cortes ABIERTOS y con su total rehecho. Un corte cerrado no se
  // toca: lo que tiene dentro ya se pagó (y eso ya lo filtró `yaSePago`).
  if (cortes.size > 0) {
    const abiertos = await db.payoutBatch.findMany({
      where: { id: { in: [...cortes] }, status: 'OPEN' },
      select: { id: true },
    });
    const ids = abiertos.map((b: { id: string }) => b.id);
    if (ids.length > 0) {
      await db.commission.updateMany({
        where: { id: { in: anuladas }, status: 'REJECTED', payoutBatchId: { in: ids } },
        data: { payoutBatchId: null },
      });
      for (const id of ids) await recalcBatchTotal(db, id);
      resultado.cortesRecalculados = ids.length;
    }
  }

  return resultado;
}
