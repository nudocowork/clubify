import { describe, expect, it } from 'vitest';
import { firmarEstadoOauth, verificarEstadoOauth } from './mp-oauth-state';

// El state es lo único que ata el callback público a UNA cuponera: si esta
// verificación deja pasar algo, las credenciales de un desconocido caen en la
// cuponera de otro y los cobros se van a la cuenta equivocada.
describe('estado firmado del OAuth de MercadoPago', () => {
  const secret = 'client-secret-de-prueba';

  it('ida y vuelta: lo firmado se verifica y devuelve la cuponera', () => {
    const state = firmarEstadoOauth(secret, 'camp-123');
    expect(verificarEstadoOauth(secret, state)).toBe('camp-123');
  });

  it('rechaza una firma hecha con otra clave', () => {
    const state = firmarEstadoOauth('otra-clave', 'camp-123');
    expect(verificarEstadoOauth(secret, state)).toBeNull();
  });

  it('rechaza un state al que le cambiaron la cuponera', () => {
    const state = firmarEstadoOauth(secret, 'camp-123');
    const manipulado = state.replace('camp-123', 'camp-ajena');
    expect(verificarEstadoOauth(secret, manipulado)).toBeNull();
  });

  it('rechaza un state vencido (el código de MP vive 10 minutos)', () => {
    const haceUnaHora = Date.now() - 60 * 60 * 1000;
    const state = firmarEstadoOauth(secret, 'camp-123', haceUnaHora);
    expect(verificarEstadoOauth(secret, state)).toBeNull();
  });

  it('rechaza basura y vacíos sin lanzar', () => {
    for (const s of [null, undefined, '', 'a.b', 'a.b.c.d.e', 'camp.x.n.zz']) {
      expect(verificarEstadoOauth(secret, s as any)).toBeNull();
    }
  });

  it('cada intento produce un state distinto (nonce)', () => {
    expect(firmarEstadoOauth(secret, 'c')).not.toBe(firmarEstadoOauth(secret, 'c'));
  });
});
