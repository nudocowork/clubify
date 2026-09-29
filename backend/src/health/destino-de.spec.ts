import { describe, it, expect } from 'vitest';
import { destinoDe } from './health.module';

/**
 * `/health/red` dice por qué camino sale el backend hacia la base. Para eso
 * tiene que abrir la `DATABASE_URL`, que lleva usuario y contraseña dentro.
 *
 * El riesgo de este endpoint no es que mida mal: es que la credencial acabe en
 * una respuesta pública. `destinoDe` es el único sitio que toca esa URL, así
 * que lo que se prueba acá es que de ahí SOLO salgan host y puerto.
 */
describe('destinoDe', () => {
  it('saca host y puerto, y nada más', () => {
    expect(destinoDe('postgresql://usuario:clave-secreta@tramway.proxy.rlwy.net:39155/railway')).toEqual({
      host: 'tramway.proxy.rlwy.net',
      port: 39155,
    });
  });

  it('nunca devuelve la contraseña ni el usuario', () => {
    const d = destinoDe('postgresql://clubify:P4ssw0rd-larga@yyy.railway.internal:5432/railway?sslmode=require');
    const json = JSON.stringify(d);
    expect(json).not.toContain('P4ssw0rd-larga');
    expect(json).not.toContain('clubify');
    expect(Object.keys(d ?? {}).sort()).toEqual(['host', 'port']);
  });

  it('cae al 5432 cuando la URL no trae puerto', () => {
    expect(destinoDe('postgresql://u:p@yyy.railway.internal/railway')).toEqual({
      host: 'yyy.railway.internal',
      port: 5432,
    });
  });

  it('devuelve null en vez de reventar cuando la URL no sirve', () => {
    // Sin esto, un `DATABASE_URL` mal puesto tumbaría el endpoint entero.
    expect(destinoDe(undefined)).toBeNull();
    expect(destinoDe('')).toBeNull();
    expect(destinoDe('esto-no-es-una-url')).toBeNull();
  });

  it('distingue la red interna del proxy público, que es para lo que existe', () => {
    expect(destinoDe('postgresql://u:p@yyy.railway.internal:5432/db')!.host.endsWith('.railway.internal')).toBe(true);
    expect(destinoDe('postgresql://u:p@tramway.proxy.rlwy.net:39155/db')!.host.endsWith('.railway.internal')).toBe(false);
  });
});
