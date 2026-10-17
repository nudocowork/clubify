/**
 * LOS SIETE ESTADOS DEL REPORTE DE COMISIONES.
 *
 * El dueño pidió leer las comisiones en siete estados (Generada, En revisión,
 * Aprobada, Pendiente de pago, Pagada, Retenida, Reversada). El modelo no los
 * tiene así: `Commission` guarda un `status` del flujo de aprobación
 * (PENDING/APPROVED/PAID/REJECTED/RETAINED/ADJUSTMENT), un `paymentStatus` del
 * dinero (PENDING/PARTIAL/PAID) y el corte en el que está (`payoutBatchId`).
 *
 * Este archivo es el ÚNICO sitio donde se traduce de lo uno a lo otro. Lo usan a
 * la vez el conteo de las tarjetas, el filtro de la lista y la etiqueta de cada
 * fila: si vivieran en tres sitios, la tarjeta diría «12 aprobadas» y la lista
 * filtrada enseñaría 11 (el mismo fallo de las dos fuentes de fecha que se
 * arregló en `referrals/rango-de-fechas.ts`).
 *
 * La traducción, en orden de precedencia (la primera que aplica gana):
 *
 *  1. REJECTED                         → Reversada (anulada; nunca suma).
 *  2. PAID, o el dinero ya salió entero → Pagada.
 *  3. RETAINED + marcada «en revisión» desde este módulo → En revisión.
 *  4. RETAINED                         → Retenida.
 *  5. APPROVED con pago parcial, o dentro de un corte → Pendiente de pago
 *     (ya se aprobó y está en la cola de una transferencia).
 *  6. APPROVED                         → Aprobada (libre, esperando su corte).
 *  7. PENDING                          → Generada (en los 15 días de espera).
 *
 * «En revisión» NO existe en el modelo de comisiones. Lo que sí existe es
 * RETAINED («el SUPER_ADMIN frenó el pago»). Para no inventar un estado que el
 * motor no respetaría —el cron de las 3 a. m. libera toda PENDING vencida—, una
 * comisión «en revisión» es una RETENIDA cuya última retención se hizo desde
 * este módulo con la acción «Enviar a revisión» (queda en `CommissionAuditLog`).
 * Congela igual que retener; solo cambia la etiqueta. Las retenidas desde otro
 * sitio siguen siendo «Retenida».
 *
 * ADJUSTMENT (asiento manual) no entra en ninguno: según el schema nunca llegó a
 * crearse ninguno. Si apareciera, se cuenta aparte como ajuste.
 */

export const ESTADOS = [
  'GENERADA',
  'EN_REVISION',
  'APROBADA',
  'PENDIENTE_PAGO',
  'PAGADA',
  'RETENIDA',
  'REVERSADA',
] as const;

export type Estado = (typeof ESTADOS)[number];

export const ETIQUETA_DE_ESTADO: Record<Estado, string> = {
  GENERADA: 'Generada',
  EN_REVISION: 'En revisión',
  APROBADA: 'Aprobada',
  PENDIENTE_PAGO: 'Pendiente de pago',
  PAGADA: 'Pagada',
  RETENIDA: 'Retenida',
  REVERSADA: 'Reversada',
};

export function esEstado(v: unknown): v is Estado {
  return typeof v === 'string' && (ESTADOS as readonly string[]).includes(v);
}

/** Lo mínimo de una comisión para saber su estado. Plano para poder probarlo. */
export type DatosDeEstado = {
  status: string;
  paymentStatus: string;
  amount: number;
  amountPaid: number;
  payoutBatchId: string | null;
};

/**
 * El estado de una comisión. `enRevision` lo decide quien llama mirando la
 * bitácora de este módulo (ver `estaEnRevision`); por defecto false.
 *
 * Devuelve null solo para ADJUSTMENT, que no es una comisión.
 */
export function estadoDeComision(
  c: DatosDeEstado,
  opts: { enRevision?: boolean } = {},
): Estado | null {
  if (c.status === 'ADJUSTMENT') return null;
  if (c.status === 'REJECTED') return 'REVERSADA';
  // El dinero manda: una comisión con paymentStatus PAID ya salió aunque el
  // `status` se haya quedado atrás (filas viejas del panel de pagos).
  if (c.status === 'PAID' || c.paymentStatus === 'PAID') return 'PAGADA';
  if (c.status === 'RETAINED') return opts.enRevision ? 'EN_REVISION' : 'RETENIDA';
  if (c.status === 'APPROVED') {
    if (c.paymentStatus === 'PARTIAL' || c.amountPaid > 0 || c.payoutBatchId) {
      return 'PENDIENTE_PAGO';
    }
    return 'APROBADA';
  }
  // PENDING y cualquier valor desconocido: aún no se puede pagar.
  return 'GENERADA';
}

/**
 * `where` de Prisma equivalente a un estado, para filtrar en la base y paginar
 * allí. Es la función inversa de `estadoDeComision` y por eso vive al lado: las
 * pruebas comprueban que las dos dicen lo mismo.
 *
 * `enRevisionIds` son las retenidas que la bitácora marca en revisión: separan
 * EN_REVISION de RETENIDA, que en la base son el mismo RETAINED.
 */
export function whereDeEstado(
  estado: Estado,
  enRevisionIds: string[],
): Record<string, unknown> {
  switch (estado) {
    case 'REVERSADA':
      return { status: 'REJECTED' };
    case 'PAGADA':
      return {
        status: { notIn: ['REJECTED', 'ADJUSTMENT'] },
        OR: [{ status: 'PAID' }, { paymentStatus: 'PAID' }],
      };
    case 'EN_REVISION':
      return { status: 'RETAINED', paymentStatus: { not: 'PAID' }, id: { in: enRevisionIds } };
    case 'RETENIDA':
      return {
        status: 'RETAINED',
        paymentStatus: { not: 'PAID' },
        ...(enRevisionIds.length ? { id: { notIn: enRevisionIds } } : {}),
      };
    case 'PENDIENTE_PAGO':
      return {
        status: 'APPROVED',
        paymentStatus: { not: 'PAID' },
        OR: [{ paymentStatus: 'PARTIAL' }, { amountPaid: { gt: 0 } }, { payoutBatchId: { not: null } }],
      };
    case 'APROBADA':
      return { status: 'APPROVED', paymentStatus: 'PENDING', amountPaid: 0, payoutBatchId: null };
    case 'GENERADA':
      return { status: 'PENDING', paymentStatus: { not: 'PAID' } };
  }
}

// ── Bitácora → «en revisión» ────────────────────────────────────────────────

/** Acciones de la bitácora que deciden si una retenida está en revisión. */
export const ACCIONES_QUE_FIJAN_REVISION = [
  'CREAR_EN_REVISION',
  'ENVIAR_A_REVISION',
  'RETENER',
  'APROBAR',
  'REVERSAR',
] as const;

const PONEN_EN_REVISION = new Set(['CREAR_EN_REVISION', 'ENVIAR_A_REVISION']);

/**
 * Dadas las entradas de la bitácora de UNA comisión (cualquier orden), ¿la
 * última que cuenta la puso en revisión? Si después alguien la retuvo, aprobó o
 * reversó, ya no lo está.
 */
export function estaEnRevision(
  entradas: Array<{ accion: string; createdAt: Date | string }>,
): boolean {
  let ultima: { accion: string; ms: number } | null = null;
  for (const e of entradas) {
    if (!(ACCIONES_QUE_FIJAN_REVISION as readonly string[]).includes(e.accion)) continue;
    const ms = new Date(e.createdAt).getTime();
    if (!ultima || ms >= ultima.ms) ultima = { accion: e.accion, ms };
  }
  return !!ultima && PONEN_EN_REVISION.has(ultima.accion);
}

/** Agrupa la bitácora por comisión y devuelve las que están en revisión. */
export function idsEnRevision(
  entradas: Array<{ commissionId: string | null; accion: string; createdAt: Date | string }>,
): string[] {
  const porComision = new Map<string, Array<{ accion: string; createdAt: Date | string }>>();
  for (const e of entradas) {
    if (!e.commissionId) continue;
    const lista = porComision.get(e.commissionId) ?? [];
    lista.push(e);
    porComision.set(e.commissionId, lista);
  }
  return [...porComision.entries()].filter(([, l]) => estaEnRevision(l)).map(([id]) => id);
}

// ── Qué se puede hacer con una comisión desde este módulo ───────────────────

export const ACCIONES = ['APROBAR', 'ENVIAR_A_REVISION', 'RETENER', 'REVERSAR'] as const;
export type Accion = (typeof ACCIONES)[number];

export const ETIQUETA_DE_ACCION: Record<Accion, string> = {
  APROBAR: 'Aprobar',
  ENVIAR_A_REVISION: 'Enviar a revisión',
  RETENER: 'Retener',
  REVERSAR: 'Reversar',
};

/**
 * ¿Se puede aplicar `accion` a una comisión en `estado`? Devuelve el motivo del
 * rechazo, o null si se puede.
 *
 * La regla de fondo es la de Javier y Sara: lo pagado no se retracta. Una
 * comisión con un abono ya tiene dinero fuera, y cambiarle el estado
 * descuadraría el corte que la pagó.
 */
export function motivoParaNoPermitir(
  estado: Estado,
  accion: Accion,
  c: { amountPaid: number },
): string | null {
  if (estado === 'PAGADA' || c.amountPaid > 0) {
    return 'Esta comisión ya tiene dinero pagado: no se puede cambiar su estado.';
  }
  if (estado === 'REVERSADA') return 'Esta comisión está reversada: no admite más cambios.';
  switch (accion) {
    case 'APROBAR':
      return estado === 'GENERADA' || estado === 'EN_REVISION' || estado === 'RETENIDA'
        ? null
        : 'Esta comisión ya está aprobada.';
    case 'ENVIAR_A_REVISION':
      return estado === 'EN_REVISION' ? 'Esta comisión ya está en revisión.' : null;
    case 'RETENER':
      return estado === 'RETENIDA' ? 'Esta comisión ya está retenida.' : null;
    case 'REVERSAR':
      return null;
  }
}
