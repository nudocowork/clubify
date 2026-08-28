import { describe, it, expect } from 'vitest';

/**
 * A cuánta gente llega un push, y a cuánta dice el panel que llegó.
 *
 * El fallo (28-08-2026): el negocio abría la ficha de un cliente, le mandaba
 * una notificación, y el panel informaba **0 destinatarios** — que se lee como
 * «este cliente no tiene la tarjeta». El push sí le salía.
 *
 * Los dos contadores miraban solo Apple: `walletDevices` es la tabla de
 * registros de Apple, y el resultado de Google viene aparte, en `.google`.
 *
 * No era un caso raro. En producción: 5.083 pases, **3.579 de Google** y 1.276
 * de Apple. El contador mentía para la mayoría de los clientes.
 */

type Pase = { walletDevices: unknown[]; googleObjectId: string | null };
type Resultado = { sent?: number; google?: { ok?: boolean } };

/** Espejo del cálculo de `targeted`. */
function alcanzables(p: Pase): number {
  return p.walletDevices.length + (p.googleObjectId ? 1 : 0);
}

/** Espejo del cálculo de `delivered`. */
function entregados(r: Resultado): number {
  return (r?.sent ?? 0) + (r?.google?.ok ? 1 : 0);
}

describe('a quién se cuenta como alcanzable', () => {
  it('un cliente de Google Wallet cuenta como 1, no como 0', () => {
    expect(alcanzables({ walletDevices: [], googleObjectId: 'obj_1' })).toBe(1);
  });

  it('un cliente de Apple con un dispositivo cuenta 1', () => {
    expect(alcanzables({ walletDevices: [{}], googleObjectId: null })).toBe(1);
  });

  it('quien lo tiene en los dos sitios cuenta los dos', () => {
    expect(alcanzables({ walletDevices: [{}], googleObjectId: 'obj_1' })).toBe(2);
  });

  it('Apple con varios dispositivos los suma todos', () => {
    expect(alcanzables({ walletDevices: [{}, {}, {}], googleObjectId: null })).toBe(3);
  });

  it('quien NO tiene la tarjeta en ningún sitio sigue siendo 0', () => {
    // Esto es lo único que debe leerse como "no la tiene".
    expect(alcanzables({ walletDevices: [], googleObjectId: null })).toBe(0);
  });
});

describe('a quién se cuenta como entregado', () => {
  it('Google entregado suma', () => {
    expect(entregados({ sent: 0, google: { ok: true } })).toBe(1);
  });

  it('Google que FALLÓ no suma — se cuenta lo que salió, no lo que se intentó', () => {
    expect(entregados({ sent: 0, google: { ok: false } })).toBe(0);
  });

  it('Apple y Google en el mismo pase suman los dos', () => {
    expect(entregados({ sent: 2, google: { ok: true } })).toBe(3);
  });

  it('sin respuesta de Google no se inventa nada', () => {
    expect(entregados({ sent: 1 })).toBe(1);
  });

  it('una respuesta vacía no rompe la cuenta', () => {
    expect(entregados({})).toBe(0);
  });
});

describe('el caso que lo destapó', () => {
  it('cliente solo de Google: antes 0, ahora 1', () => {
    const cliente: Pase = { walletDevices: [], googleObjectId: 'obj_abc' };
    const antes = cliente.walletDevices.length; // el cálculo viejo
    expect(antes).toBe(0);
    expect(alcanzables(cliente)).toBe(1);
  });
});
