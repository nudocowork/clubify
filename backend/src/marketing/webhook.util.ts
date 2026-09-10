/**
 * Helpers PUROS del webhook de eventos de correo (entregado/abrió/clic/rebote/
 * respuesta). El proveedor manda formas distintas según el evento; normalizamos.
 *
 * CRÍTICO: solo `reply | open | click` cuentan como INTERACCIÓN (reanudan
 * "esperar respuesta" y disparan el trigger). "delivered" NO — llega segundos
 * después del envío y satisfaría el wait_reply como si el cliente hubiera
 * contestado.
 */
import { pickMessageId } from './provider/mkt-provider.util';

export type EmailEventKind =
  | 'reply'
  | 'open'
  | 'click'
  | 'delivered'
  | 'bounce'
  | 'complaint'
  | 'unsubscribe'
  | 'unknown';

/** Clasifica el evento entrante a partir de los campos habituales del proveedor. */
export function detectKind(payload: unknown): EmailEventKind {
  const p = (payload ?? {}) as Record<string, unknown>;
  const raw = String(
    p.type ?? p.event ?? p.eventType ?? p.messageType ?? p.status ?? p.name ?? '',
  ).toLowerCase();
  if (/inbound|reply|replied|response|incoming/.test(raw)) return 'reply';
  if (/unsub|optout|unsubscribe/.test(raw)) return 'unsubscribe';
  if (/complaint|spamreport|spam/.test(raw)) return 'complaint';
  if (/bounce|dropped|failed|reject|undeliver/.test(raw)) return 'bounce';
  if (/click/.test(raw)) return 'click';
  if (/open/.test(raw)) return 'open';
  if (/deliver/.test(raw)) return 'delivered';
  return 'unknown';
}

/**
 * Extrae de quién viene el evento: el messageId (correlación), el correo y el
 * TELÉFONO.
 *
 * El teléfono hace falta para los SMS entrantes. Un SMS no trae correo: quien
 * escribe al número del negocio se identifica por su número y nada más. Sin
 * esto, la respuesta llegaba, se clasificaba bien como interacción, y luego no
 * se encontraba al contacto — así que el workflow no seguía y nadie contestaba.
 *
 * Se prueban las formas habituales de GoHighLevel, que manda el número en el
 * contacto y a veces en la raíz.
 */
export function extractRefs(payload: unknown): {
  messageId?: string;
  email?: string;
  phone?: string;
} {
  const p = (payload ?? {}) as Record<string, any>;
  const messageId =
    pickMessageId(p) ??
    (p.emailMessageId != null ? String(p.emailMessageId) : undefined) ??
    (p.messageId != null ? String(p.messageId) : undefined);
  const emailRaw =
    p.email ?? p.to ?? p.recipient ?? p.contact?.email ?? p.message?.email ?? p.data?.email ?? '';
  const email = String(emailRaw).trim().toLowerCase() || undefined;
  const phoneRaw =
    p.phone ??
    p.from ??
    p.fromNumber ??
    p.contact?.phone ??
    p.message?.phone ??
    p.data?.phone ??
    p.data?.contact?.phone ??
    '';
  const phone = String(phoneRaw).trim() || undefined;
  return { messageId, email, phone };
}

/**
 * El TEXTO del mensaje entrante.
 *
 * `extractRefs` saca quién escribe y a qué envío responde, pero tiraba lo que
 * dijo. Para las automatizaciones daba igual —solo importaba que hubiera
 * respuesta— pero el equipo de ventas necesita leerlo: sin esto, el vendedor ve
 * «respondió» y tiene que salir a GoHighLevel a enterarse de qué.
 *
 * GoHighLevel no manda el cuerpo en un sitio fijo: depende de si el flujo usa
 * el disparador de SMS, el de conversación o un webhook a mano. Se miran todas
 * las rutas vistas en payloads reales, en orden de más específica a más
 * genérica.
 *
 * Se recorta a 4.000 caracteres: un SMS no llega ni a 1.600, y un correo
 * entero con su cadena de citados no cabe en una burbuja de chat ni aporta.
 */
export function extractBody(payload: unknown): string | undefined {
  const p = (payload ?? {}) as Record<string, any>;
  const candidatos = [
    p.body,
    p.message?.body,
    p.data?.body,
    p.data?.message?.body,
    p.text,
    p.message?.text,
    p.data?.text,
    p.messageBody,
    p.sms?.body,
    p.conversation?.lastMessageBody,
  ];
  for (const c of candidatos) {
    if (typeof c !== 'string') continue;
    const t = c.trim();
    if (t) return t.slice(0, 4000);
  }
  return undefined;
}

/** Solo estas cuentan como interacción (reanudan wait_reply + disparan el trigger). */
export function isInteraction(kind: EmailEventKind): boolean {
  return kind === 'reply' || kind === 'open' || kind === 'click';
}

/** Columna de MktAction a sellar por tipo (reply no tiene columna: es solo interacción). */
export function stampColumn(kind: EmailEventKind): 'deliveredAt' | 'openedAt' | 'clickedAt' | 'bouncedAt' | null {
  switch (kind) {
    case 'delivered':
      return 'deliveredAt';
    case 'open':
      return 'openedAt';
    case 'click':
      return 'clickedAt';
    case 'bounce':
      return 'bouncedAt';
    default:
      return null;
  }
}
