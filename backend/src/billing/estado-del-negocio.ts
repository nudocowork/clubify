/**
 * CANCELADO y SUSPENDIDO no son lo mismo, y el negocio tiene que decir POR QUÉ.
 *
 * Javier, 2026-11-23: un negocio que se va por decisión propia (el cliente
 * pulsa «Cancelar mi suscripción», cancela en Hotmart, o lo cancela alguien del
 * equipo) está CANCELADO. Uno que deja de pagar está SUSPENDIDO. Y un reembolso
 * o un contracargo también es una cancelación —perdió el derecho al servicio—,
 * no una mora. Hasta hoy el reembolso y el contracargo solo suspendían, sin
 * marcar la cancelación, y por eso salían en la lista como «Suspendido», igual
 * que quien no pagó.
 *
 * El acceso lo sigue mandando `Tenant.status` (ACTIVE / TRIAL / SUSPENDED). La
 * cancelación la marca `canceledAt`, y `estadoComercial()` ya la lee primero.
 * Lo nuevo es DE DÓNDE salió y POR QUÉ (`cancelSource`, `cancelReason`,
 * `suspendReason`), para poder contarlo después sin abrir la auditoría.
 *
 * Todo lo de aquí es puro: sin base de datos, para probarlo sin montar nada.
 */

/** De dónde salió la cancelación. */
export const ORIGENES_DE_CANCELACION = {
  /** El cliente pulsó «Cancelar mi suscripción» en su panel de Clubify. */
  CLIENTE_PANEL: 'el cliente desde su panel de Clubify',
  /** El cliente canceló directamente en la pasarela (Hotmart o Stripe). */
  CLIENTE_PASARELA: 'el cliente directamente en la pasarela de pagos',
  /** Alguien del equipo de Clubify. */
  COLABORADOR: 'un colaborador de Clubify',
  /** La pasarela devolvió el dinero. */
  REEMBOLSO: 'reembolso del pago',
  /** El banco retiró el dinero. */
  CONTRACARGO: 'contracargo del pago',
  /** El cliente abrió una disputa del pago en la pasarela. */
  DISPUTA: 'disputa del pago abierta por el cliente',
} as const;
export type OrigenDeCancelacion = keyof typeof ORIGENES_DE_CANCELACION;

/** Por qué está suspendido. Solo se lee con `status = SUSPENDED`. */
export const MOTIVOS_DE_SUSPENSION = {
  FALTA_DE_PAGO: 'falta de pago',
  PRUEBA_VENCIDA: 'se venció la prueba gratis sin pago',
  FIN_DEL_PERIODO_CANCELADO: 'terminó el período pagado de una suscripción cancelada',
  DEVOLUCION: 'el dinero del período actual se devolvió',
  MANUAL: 'suspensión manual de un colaborador',
} as const;
export type MotivoDeSuspension = keyof typeof MOTIVOS_DE_SUSPENSION;

/** Los tres orígenes en los que el dinero salió (o está saliendo) de Clubify. */
export const ORIGENES_DE_DEVOLUCION: readonly OrigenDeCancelacion[] = ['REEMBOLSO', 'CONTRACARGO', 'DISPUTA'];

export function esOrigenDeDevolucion(o: string | null | undefined): boolean {
  return (ORIGENES_DE_DEVOLUCION as readonly string[]).includes(o ?? '');
}

/** El aviso de Hotmart que corresponde a cada devolución. */
export function origenDelEventoDeHotmart(evento: string): OrigenDeCancelacion | null {
  if (evento === 'PURCHASE_REFUNDED') return 'REEMBOLSO';
  if (evento === 'PURCHASE_CHARGEBACK') return 'CONTRACARGO';
  if (evento === 'PURCHASE_PROTEST') return 'DISPUTA';
  if (evento === 'SUBSCRIPTION_CANCELLATION') return 'CLIENTE_PASARELA';
  return null;
}

/**
 * Qué escribir en el negocio cuando entra una cancelación nueva sobre una que
 * ya había.
 *
 * Una devolución PISA a una cancelación anterior: el cliente que canceló el 21
 * y pidió el reembolso el 23 (Protein Station) se fue por reembolso, que es lo
 * que importa al mirar el dinero. Lo contrario no: una cancelación en Hotmart
 * que llega después de un reembolso no le quita la etiqueta de reembolso.
 * Entre devoluciones, la más fuerte manda: un contracargo confirma una disputa.
 */
const PESO: Record<OrigenDeCancelacion, number> = {
  CLIENTE_PASARELA: 1,
  CLIENTE_PANEL: 1,
  COLABORADOR: 1,
  DISPUTA: 2,
  REEMBOLSO: 3,
  CONTRACARGO: 3,
};

export function origenQueManda(
  anterior: string | null | undefined,
  nuevo: OrigenDeCancelacion,
): OrigenDeCancelacion {
  const a = anterior && anterior in PESO ? (anterior as OrigenDeCancelacion) : null;
  if (!a) return nuevo;
  // Solo pisa si es ESTRICTAMENTE más fuerte. A igual peso manda la primera:
  // el cliente que cancela en el panel provoca, segundos después, el aviso de
  // cancelación de Hotmart (lo cancelamos nosotros por la API), y ese aviso no
  // puede borrar que fue el cliente desde Clubify.
  return PESO[nuevo] > PESO[a] ? nuevo : a;
}

export interface DatosDelMotivo {
  status: string;
  canceledAt: Date | null;
  cancelSource?: string | null;
  cancelReason?: string | null;
  suspendReason?: string | null;
  currentPeriodEnd?: Date | null;
}

function fecha(d: Date): string {
  return d.toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Bogota',
  });
}

/**
 * La NOTA que explica el estado del negocio, en una frase que lee el equipo.
 * Null si no hay nada que explicar (activo o en prueba, sin cancelación).
 *
 *   «Cancelado por contracargo del pago (tx HP0032012122) el 23 de noviembre
 *    de 2026. Servicio desconectado.»
 *   «Suspendido por falta de pago.»
 */
export function notaDelEstado(t: DatosDelMotivo, ahora: Date = new Date()): string | null {
  if (t.canceledAt) {
    const origen =
      t.cancelSource && t.cancelSource in ORIGENES_DE_CANCELACION
        ? ORIGENES_DE_CANCELACION[t.cancelSource as OrigenDeCancelacion]
        : null;
    const porQue = origen ? ` por ${origen}` : '';
    const detalle = t.cancelReason?.trim() ? ` (${t.cancelReason.trim()})` : '';
    const acceso =
      t.status === 'SUSPENDED'
        ? ' Servicio desconectado.'
        : t.currentPeriodEnd && t.currentPeriodEnd > ahora
          ? ` Conserva el servicio hasta el ${fecha(t.currentPeriodEnd)}, el final del período que ya pagó.`
          : '';
    return `Cancelado${porQue}${detalle} el ${fecha(t.canceledAt)}.${acceso}`;
  }
  if (t.status === 'SUSPENDED') {
    const m =
      t.suspendReason && t.suspendReason.split(':')[0] in MOTIVOS_DE_SUSPENSION
        ? MOTIVOS_DE_SUSPENSION[t.suspendReason.split(':')[0] as MotivoDeSuspension]
        : null;
    // `MANUAL: <lo que escribió el colaborador>`: se muestra lo escrito.
    const escrito = t.suspendReason?.includes(':') ? t.suspendReason.slice(t.suspendReason.indexOf(':') + 1).trim() : '';
    if (!m) return 'Suspendido (sin motivo registrado: la suspensión es anterior al registro de motivos).';
    return `Suspendido por ${m}${escrito ? `: ${escrito}` : ''}.`;
  }
  return null;
}

// ── El SMS de «verifica la cancelación en la pasarela» ─────────────────────

/**
 * Las plantillas del aviso, UNA por situación. Se editan en Automatizaciones →
 * mensajes de la marca (catálogo en `integrations/brand-message-templates.ts`).
 */
export const PLANTILLA_DEL_AVISO: Record<OrigenDeCancelacion, string | null> = {
  CLIENTE_PANEL: 'cancel_aviso_panel',
  COLABORADOR: 'cancel_aviso_colaborador',
  REEMBOLSO: 'cancel_aviso_reembolso',
  CONTRACARGO: 'cancel_aviso_contracargo',
  DISPUTA: 'cancel_aviso_contracargo',
  // Canceló EN la pasarela: no hay que pedirle que vaya a verificarlo allí.
  // Para eso existe el aviso `admin_cancellation`, que la marca enciende si
  // quiere.
  CLIENTE_PASARELA: null,
};

/** Una cancelación simple pesa 1; una devolución, 2. */
function pesoDelAviso(plantilla: string | null | undefined): number {
  if (!plantilla) return 0;
  return plantilla === 'cancel_aviso_reembolso' || plantilla === 'cancel_aviso_contracargo' ? 2 : 1;
}

/**
 * ¿Hay que mandar el aviso, o ya se mandó en este proceso de cancelación?
 *
 * Uno por proceso: el cliente que pulsa «Cancelar» tres veces, o el colaborador
 * que lo cancela después de que el cliente ya lo hizo, no reciben tres SMS. La
 * excepción es una DEVOLUCIÓN que llega después de una cancelación: es otra
 * noticia (el dinero volvió) y lleva su propio texto. Dos devoluciones del
 * mismo pago (la disputa y luego el reembolso) no repiten.
 *
 * `cancelNoticeSentAt` se limpia cuando el negocio se reactiva: un proceso de
 * cancelación nuevo vuelve a avisar.
 */
export function tocaAvisar(
  yaEnviado: { cancelNoticeSentAt: Date | null; cancelNoticeTemplate: string | null },
  plantilla: string | null,
): boolean {
  if (!plantilla) return false;
  if (!yaEnviado.cancelNoticeSentAt) return true;
  return pesoDelAviso(plantilla) > pesoDelAviso(yaEnviado.cancelNoticeTemplate);
}

/** Con qué pasarela cobra el negocio, para decírselo al cliente por su nombre. */
export function nombreDeLaPasarela(t: {
  hotmartSubscriberCode?: string | null;
  stripeSubscriptionId?: string | null;
}): string {
  if (t.stripeSubscriptionId) return 'Stripe';
  if (t.hotmartSubscriberCode) return 'Hotmart';
  return 'la plataforma de pagos';
}

/**
 * Lo que se limpia cuando el negocio VUELVE: un pago nuevo, o un colaborador
 * que lo marca activo. Quien vuelve a pagar ya no está cancelado, y un proceso
 * de cancelación futuro tiene que poder avisar de nuevo.
 *
 * Un solo objeto para todos los caminos de reactivación: si uno limpia
 * `canceledAt` y se olvida del origen, el negocio sale ACTIVO con la nota
 * «Cancelado por contracargo» de la vez anterior.
 */
export const CANCELACION_DESHECHA = {
  canceledAt: null,
  cancelSource: null,
  cancelReason: null,
  cancelNoticeSentAt: null,
  cancelNoticeTemplate: null,
  suspendReason: null,
} as const;
