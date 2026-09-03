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

/** Extrae el messageId (correlación) y el email del payload, probando varias formas. */
export function extractRefs(payload: unknown): { messageId?: string; email?: string } {
  const p = (payload ?? {}) as Record<string, any>;
  const messageId =
    pickMessageId(p) ??
    (p.emailMessageId != null ? String(p.emailMessageId) : undefined) ??
    (p.messageId != null ? String(p.messageId) : undefined);
  const emailRaw =
    p.email ?? p.to ?? p.recipient ?? p.contact?.email ?? p.message?.email ?? p.data?.email ?? '';
  const email = String(emailRaw).trim().toLowerCase() || undefined;
  return { messageId, email };
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
