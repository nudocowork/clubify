import { describe, expect, it } from 'vitest';
import { detectKind, extractRefs, isInteraction, stampColumn } from '../src/marketing/webhook.util';

describe('detectKind — clasifica el evento', () => {
  it('delivered', () => expect(detectKind({ type: 'email.delivered' })).toBe('delivered'));
  it('open', () => expect(detectKind({ event: 'EmailOpened' })).toBe('open'));
  it('click', () => expect(detectKind({ type: 'LC.email.click' })).toBe('click'));
  it('bounce', () => expect(detectKind({ status: 'bounced' })).toBe('bounce'));
  it('reply/inbound', () => expect(detectKind({ type: 'InboundMessage' })).toBe('reply'));
  it('unsubscribe', () => expect(detectKind({ event: 'unsubscribe' })).toBe('unsubscribe'));
  it('desconocido', () => expect(detectKind({ type: 'whatever' })).toBe('unknown'));
});

describe('la regla CRÍTICA: delivered NO es interacción; open/click/reply sí', () => {
  it('delivered NO satisface esperar respuesta', () => expect(isInteraction('delivered')).toBe(false));
  it('open sí', () => expect(isInteraction('open')).toBe(true));
  it('click sí', () => expect(isInteraction('click')).toBe(true));
  it('reply sí', () => expect(isInteraction('reply')).toBe(true));
  it('bounce NO', () => expect(isInteraction('bounce')).toBe(false));
});

describe('extractRefs — messageId (correlación) + email', () => {
  it('messageId en la raíz + email en to', () => {
    expect(extractRefs({ messageId: 'm1', to: 'A@B.com' })).toEqual({ messageId: 'm1', email: 'a@b.com' });
  });
  it('email anidado en contact', () => {
    expect(extractRefs({ id: 'x', contact: { email: 'c@d.com' } })).toEqual({ messageId: 'x', email: 'c@d.com' });
  });
});

describe('stampColumn', () => {
  it('mapea a la columna correcta', () => {
    expect(stampColumn('delivered')).toBe('deliveredAt');
    expect(stampColumn('open')).toBe('openedAt');
    expect(stampColumn('click')).toBe('clickedAt');
    expect(stampColumn('bounce')).toBe('bouncedAt');
    expect(stampColumn('reply')).toBeNull();
  });
});
