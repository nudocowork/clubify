import { describe, it, expect } from 'vitest';
import { extractBody } from './webhook.util';

/**
 * El TEXTO de un mensaje entrante.
 *
 * `extractRefs` ya sacaba quién escribe; esto saca qué dijo. GoHighLevel no lo
 * manda en un sitio fijo —depende de si el flujo usa el disparador de SMS, el
 * de conversación o un webhook a mano—, así que aquí están las rutas vistas en
 * payloads reales.
 */
describe('de dónde sale el cuerpo', () => {
  it('el caso llano: `body` en la raíz', () => {
    expect(extractBody({ body: 'Sí me interesa' })).toBe('Sí me interesa');
  });

  it('anidado en `message`', () => {
    expect(extractBody({ message: { body: 'Hola' } })).toBe('Hola');
  });

  it('anidado en `data`', () => {
    expect(extractBody({ data: { body: 'Hola' } })).toBe('Hola');
    expect(extractBody({ data: { message: { body: 'Hola' } } })).toBe('Hola');
  });

  it('cuando viene como `text` en vez de `body`', () => {
    expect(extractBody({ text: 'Hola' })).toBe('Hola');
    expect(extractBody({ message: { text: 'Hola' } })).toBe('Hola');
  });

  it('manda la ruta más específica cuando hay varias', () => {
    // `body` en la raíz gana a `text`: es la que usan los payloads de SMS.
    expect(extractBody({ body: 'el bueno', text: 'el otro' })).toBe('el bueno');
  });
});

describe('lo que NO es un cuerpo', () => {
  it('un payload sin texto no inventa uno', () => {
    expect(extractBody({ phone: '3001112233' })).toBeUndefined();
    expect(extractBody({})).toBeUndefined();
    expect(extractBody(null)).toBeUndefined();
    expect(extractBody(undefined)).toBeUndefined();
  });

  it('una cadena de espacios es lo mismo que nada', () => {
    // Guardarla pintaría una burbuja vacía en la conversación.
    expect(extractBody({ body: '   ' })).toBeUndefined();
    expect(extractBody({ body: '  ', text: 'este sí' })).toBe('este sí');
  });

  it('un número o un objeto en el campo no se convierten a texto', () => {
    expect(extractBody({ body: 42 })).toBeUndefined();
    expect(extractBody({ body: { raro: true } })).toBeUndefined();
  });
});

describe('el recorte', () => {
  it('un correo entero con su cadena de citados se corta', () => {
    const largo = 'a'.repeat(9000);
    expect(extractBody({ body: largo })?.length).toBe(4000);
  });

  it('un SMS normal no se toca', () => {
    const sms = 'Hola, sí me interesa. ¿Me llamas mañana?';
    expect(extractBody({ body: sms })).toBe(sms);
  });

  it('se recortan los espacios de los bordes, no los de dentro', () => {
    expect(extractBody({ body: '  hola   qué tal  ' })).toBe('hola   qué tal');
  });
});
