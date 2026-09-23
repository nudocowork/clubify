import { createHash } from 'node:crypto';

/**
 * API de Conversiones de Meta — armado del evento.
 *
 * POR QUÉ DESDE EL SERVIDOR Y NO CON EL PÍXEL DEL NAVEGADOR
 * ---------------------------------------------------------
 * Sellea cobra por **Stripe**, con Payment Links alojados en stripe.com. El
 * cliente paga FUERA de nuestro sitio y no vuelve a ninguna página nuestra, así
 * que no hay dónde poner un `fbq('track','Purchase')`. Lo único que sabe de
 * verdad que hubo un cobro es el webhook (`billing/stripe.service.ts`), que ya
 * recibe el correo y el importe.
 *
 * LO QUE META EXIGE Y SE OLVIDA
 * -----------------------------
 * - `em`/`ph` van **hasheados en SHA-256**, y normalizados ANTES de hashear.
 *   Mandar el correo en claro no es solo una fuga: Meta lo descarta y el evento
 *   queda sin emparejar, que se ve igual que «no llega nada».
 * - El teléfono va **sin `+` y sin espacios**, solo dígitos con indicativo.
 * - `event_id` sirve para **deduplicar** con el píxel del navegador. Aquí se usa
 *   el id del evento de Stripe: si Stripe reintenta el webhook —lo hace—, Meta
 *   ve el mismo id y no cuenta dos compras.
 * - `event_time` en SEGUNDOS, no milisegundos. En milisegundos Meta lo rechaza
 *   por «fuera de rango» sin decir por qué.
 *
 * Este archivo NO habla con la red: solo arma y normaliza, para poder probarlo
 * sin credenciales. El envío vive en `meta-capi.service.ts`.
 */

export const VERSION_GRAFO = 'v21.0';

/** SHA-256 en hexadecimal, que es lo único que Meta acepta. */
function hash(valor: string): string {
  return createHash('sha256').update(valor).digest('hex');
}

/** Correo: recortado y en minúsculas antes de hashear. */
export function correoHasheado(correo: string | null | undefined): string | null {
  const v = (correo ?? '').trim().toLowerCase();
  if (!v || !v.includes('@')) return null;
  return hash(v);
}

/**
 * Teléfono: SOLO dígitos, con indicativo y sin `+`.
 *
 * Un `+57 300 111 2233` hasheado tal cual no casa con el `573001112233` que
 * Meta tiene guardado, y el evento se queda sin emparejar.
 */
export function telefonoHasheado(tel: string | null | undefined): string | null {
  const digitos = (tel ?? '').replace(/\D/g, '');
  // Menos de 8 dígitos no es un teléfono con indicativo; hashearlo solo mete
  // ruido en el emparejamiento.
  if (digitos.length < 8) return null;
  return hash(digitos);
}

export type CompraParaMeta = {
  /** Id estable del evento. El de Stripe, para que un reintento no cuente dos. */
  eventId: string;
  /** Cuándo ocurrió. Se envía en segundos. */
  cuando: Date;
  correo?: string | null;
  telefono?: string | null;
  /** Importe. Si no se sabe, el evento se manda igual pero sin valor. */
  valor?: number | null;
  moneda?: string | null;
  /** De dónde venía, si se sabe. Mejora el emparejamiento. */
  urlOrigen?: string | null;
};

export type EventoMeta = {
  data: Array<Record<string, unknown>>;
  test_event_code?: string;
};

/**
 * Arma el cuerpo del POST. Devuelve `null` si no hay NINGÚN dato de persona:
 * un Purchase sin correo ni teléfono no se puede emparejar con nadie, así que
 * solo ensuciaría la cuenta y gastaría cuota.
 */
export function construirCompra(
  compra: CompraParaMeta,
  codigoDePrueba?: string | null,
): EventoMeta | null {
  const em = correoHasheado(compra.correo);
  const ph = telefonoHasheado(compra.telefono);
  if (!em && !ph) return null;

  const user_data: Record<string, unknown> = {};
  if (em) user_data.em = [em];
  if (ph) user_data.ph = [ph];

  const custom_data: Record<string, unknown> = {};
  if (typeof compra.valor === 'number' && Number.isFinite(compra.valor) && compra.valor > 0) {
    custom_data.value = Math.round(compra.valor * 100) / 100;
    custom_data.currency = (compra.moneda ?? 'USD').toUpperCase();
  }

  const evento: Record<string, unknown> = {
    event_name: 'Purchase',
    // SEGUNDOS. En milisegundos Meta lo rechaza por «fuera de rango».
    event_time: Math.floor(compra.cuando.getTime() / 1000),
    event_id: compra.eventId,
    action_source: 'website',
    user_data,
  };
  if (Object.keys(custom_data).length) evento.custom_data = custom_data;
  if (compra.urlOrigen) evento.event_source_url = compra.urlOrigen;

  const cuerpo: EventoMeta = { data: [evento] };
  const prueba = (codigoDePrueba ?? '').trim();
  if (prueba) cuerpo.test_event_code = prueba;
  return cuerpo;
}

/** La URL del endpoint. El token va en el cuerpo, no en la query: en la query
 *  acaba escrito en los logs de cualquier proxy por el que pase. */
export function urlDeEventos(pixelId: string): string {
  return `https://graph.facebook.com/${VERSION_GRAFO}/${encodeURIComponent(pixelId)}/events`;
}
