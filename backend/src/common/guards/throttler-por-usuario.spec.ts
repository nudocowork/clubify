/**
 * El limitador cuenta por usuario, no por IP.
 *
 * NO necesita base de datos.
 *
 * Por qué importa: el `ThrottlerGuard` de serie cuenta por IP, y los empleados
 * de un negocio salen todos por la del wifi del local. Con el cubo global en
 * 100/min y tres personas trabajando, el dueño se quedaba fuera de su propio
 * panel. Ese —y no el `trust proxy`— es el motivo por el que esto llevaba meses
 * sin poder activarse.
 *
 * Si alguien vuelve a contar por IP a los usuarios con sesión, estas pruebas lo
 * cazan antes de que un negocio se autobloquee un lunes por la mañana.
 */
import { describe, it, expect } from 'vitest';
import { ThrottlerPorUsuario } from './throttler-por-usuario.guard';

/** `getTracker` es protected: se accede como en runtime. */
function tracker(guard: ThrottlerPorUsuario, req: any): Promise<string> {
  return (guard as any).getTracker(req);
}

const guard = Object.create(ThrottlerPorUsuario.prototype) as ThrottlerPorUsuario;

describe('a quien se le cuentan las peticiones', () => {
  it('con sesion, cada usuario gasta SU cubo', async () => {
    // El caso del local: misma IP, dos empleados. No pueden restarse.
    const ana = await tracker(guard, { user: { id: 'ana' }, ip: '190.1.1.1' });
    const luis = await tracker(guard, { user: { id: 'luis' }, ip: '190.1.1.1' });
    expect(ana).not.toBe(luis);
    expect(ana).toBe('u:ana');
  });

  it('el mismo usuario desde dos sitios comparte cubo', async () => {
    const casa = await tracker(guard, { user: { id: 'ana' }, ip: '190.1.1.1' });
    const movil = await tracker(guard, { user: { id: 'ana' }, ip: '10.20.30.40' });
    expect(casa).toBe(movil);
  });

  it('SIN sesion se cuenta por IP: es donde importa frenar la fuerza bruta', async () => {
    // Login, registro y webhooks caen aqui.
    const t = await tracker(guard, { ip: '203.0.113.9' });
    expect(t).toBe('ip:203.0.113.9');
  });

  it('con trust proxy activo usa la IP real del cliente, no la del proxy', async () => {
    // `req.ips` lo rellena Express con X-Forwarded-For cuando trust proxy esta
    // encendido; el primero es el cliente.
    const t = await tracker(guard, { ips: ['181.50.2.3', '10.0.0.1'], ip: '10.0.0.1' });
    expect(t).toBe('ip:181.50.2.3');
  });

  it('si no hay ni usuario ni IP, agrupa — nunca deja pasar sin contar', async () => {
    // El peor caso tiene que ser "cuenta de mas", jamas "no cuenta".
    const t = await tracker(guard, {});
    expect(t).toBe('ip:desconocida');
  });
});
