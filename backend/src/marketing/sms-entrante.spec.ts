import { describe, it, expect } from 'vitest';
import { detectKind, extractRefs, isInteraction } from './webhook.util';
import { phoneKeyOf } from './identity';

/**
 * Un SMS que entra al número del negocio tiene que llegar al workflow.
 *
 * Quien responde un SMS **no trae correo**: se identifica por su número y nada
 * más. El webhook solo buscaba al contacto por correo, así que la respuesta
 * entraba, se clasificaba bien como interacción, y ahí se moría — el contacto
 * no aparecía y el workflow no seguía. Desde fuera se ve como «escribo y no me
 * contesta nadie».
 *
 * Estas pruebas fijan las dos mitades: que el teléfono se saca del cuerpo
 * venga como venga, y que un SMS entrante cuenta como interacción.
 */

describe('SMS entrante · se reconoce como respuesta', () => {
  const comoRespuesta = ['inbound', 'reply', 'replied', 'response', 'incoming'];

  for (const palabra of comoRespuesta) {
    it(`«${palabra}» cuenta como interacción`, () => {
      const kind = detectKind({ type: palabra });
      expect(kind).toBe('reply');
      expect(isInteraction(kind)).toBe(true);
    });
  }

  it('un acuse de entrega NO reanuda el workflow', () => {
    // Llega segundos después del envío: si contara, el «esperar respuesta»
    // se resolvería solo y el cliente recibiría el siguiente mensaje sin
    // haber contestado.
    const kind = detectKind({ type: 'delivered' });
    expect(isInteraction(kind)).toBe(false);
  });

  it('lo mira en cualquiera de los campos que usan los proveedores', () => {
    for (const cuerpo of [
      { event: 'InboundMessage' },
      { eventType: 'sms.incoming' },
      { messageType: 'SMS_INBOUND' },
      { status: 'replied' },
      { name: 'Inbound Message' },
    ]) {
      expect(detectKind(cuerpo)).toBe('reply');
    }
  });
});

describe('SMS entrante · de quién viene', () => {
  it('saca el teléfono de la raíz', () => {
    expect(extractRefs({ phone: '+57 300 123 4567' }).phone).toBe('+57 300 123 4567');
  });

  it('lo saca del contacto, que es donde lo pone GoHighLevel', () => {
    expect(extractRefs({ contact: { phone: '+13053107130' } }).phone).toBe('+13053107130');
  });

  it('lo saca de `from`, que es lo natural en un mensaje entrante', () => {
    expect(extractRefs({ type: 'inbound', from: '+573001234567' }).phone).toBe('+573001234567');
  });

  it('lo saca de data.contact.phone, un nivel más adentro', () => {
    expect(extractRefs({ data: { contact: { phone: '3001234567' } } }).phone).toBe('3001234567');
  });

  it('sin teléfono por ningún lado, no se inventa uno', () => {
    expect(extractRefs({ type: 'inbound' }).phone).toBeUndefined();
  });

  it('el correo sigue saliendo como antes', () => {
    const r = extractRefs({ email: '  ALGUIEN@Ejemplo.com ' });
    expect(r.email).toBe('alguien@ejemplo.com');
  });

  it('un SMS trae teléfono y NO trae correo — que es el caso que fallaba', () => {
    const r = extractRefs({ type: 'inbound', from: '+13053107130', message: 'hola' });
    expect(r.phone).toBe('+13053107130');
    expect(r.email).toBeUndefined();
  });
});

describe('SMS entrante · el mismo número escrito de cinco formas', () => {
  // Se busca por los últimos 10 dígitos a propósito: el número que guarda el
  // negocio y el que manda el proveedor casi nunca vienen igual.
  it('todas las formas caen en el mismo contacto', () => {
    const formas = [
      '+57 300 123 4567',
      '573001234567',
      '300 123 4567',
      '(300) 123-4567',
      '300-123-4567',
    ];
    const claves = formas.map((f) => phoneKeyOf(f));
    expect(new Set(claves).size).toBe(1);
    expect(claves[0]).toBe('3001234567');
  });

  it('un número demasiado corto no casa con nadie', () => {
    expect(phoneKeyOf('12345')).toBeNull();
    expect(phoneKeyOf('')).toBeNull();
    expect(phoneKeyOf(null)).toBeNull();
  });
});
