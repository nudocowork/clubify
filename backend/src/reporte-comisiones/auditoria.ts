/**
 * Reglas de la BITÁCORA del reporte de comisiones (`CommissionAuditLog`).
 *
 * Toda modificación hecha desde este módulo deja una fila con quién, cuándo,
 * qué había antes, qué quedó y POR QUÉ. El motivo es obligatorio: «Pagado» o un
 * campo vacío no explica nada cuando, meses después, alguien pregunta por qué
 * una comisión se retuvo o se reversó. Por eso el mínimo de caracteres.
 *
 * Y nada de lo auditado se borra: las notas y los comprobantes se ANULAN (quedan
 * con fecha, autor y motivo de anulación), y la bitácora es solo de escritura.
 */

export const MOTIVO_MIN = 5;
export const MOTIVO_MAX = 500;

export type RevisionDeMotivo = { ok: true; motivo: string } | { ok: false; error: string };

export function revisarMotivo(motivo: unknown): RevisionDeMotivo {
  const limpio = typeof motivo === 'string' ? motivo.trim().replace(/\s+/g, ' ') : '';
  if (!limpio) return { ok: false, error: 'Escribe el motivo del cambio: queda en el historial.' };
  if (limpio.length < MOTIVO_MIN) {
    return { ok: false, error: `El motivo es muy corto: explica el cambio en al menos ${MOTIVO_MIN} letras.` };
  }
  if (limpio.length > MOTIVO_MAX) {
    return { ok: false, error: `El motivo es muy largo: máximo ${MOTIVO_MAX} caracteres.` };
  }
  return { ok: true, motivo: limpio };
}

/** Fotografía de los campos de una comisión que se guardan como antes/después. */
export function fotoDeComision(c: {
  status: string;
  paymentStatus: string;
  amount: unknown;
  amountPaid: unknown;
  payoutBatchId: string | null;
  notes?: string | null;
}) {
  return {
    status: c.status,
    paymentStatus: c.paymentStatus,
    amount: Number(c.amount),
    amountPaid: Number(c.amountPaid),
    payoutBatchId: c.payoutBatchId,
    ...(c.notes !== undefined ? { notes: c.notes } : {}),
  };
}
