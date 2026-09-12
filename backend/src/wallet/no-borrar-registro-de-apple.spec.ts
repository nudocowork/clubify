import { describe, it, expect, vi } from 'vitest';
import { WalletService } from './wallet.service';

/**
 * Cuándo se borra el registro de un dispositivo de Apple, y cuándo NO.
 *
 * EL CASO (2026-09-12, Isabel Reyes en Cocoa Beauty): su tarjeta sigue
 * INSTALADA en el móvil —hay foto— y en nuestra base no había ni un
 * `WalletDevice`. El único código que borra esos registros es este. Sin
 * registro, APNs no tiene a quién avisar y el pase se congela como el día que
 * se instaló: el suyo marcaba 0/10 desde el 17 de julio mientras el panel
 * decía 6/10.
 *
 * Se borraba con tres motivos. Solo uno es definitivo:
 *
 *  · `Unregistered` (410) — el pase se borró del teléfono. Borrar: bien.
 *  · `BadDeviceToken` (400) — la documentación de Apple dice que también
 *    aparece cuando el token no casa con el ENTORNO. Un token bueno mandado
 *    al entorno equivocado se borraba para siempre.
 *  · `DeviceTokenNotForTopic` (400) — mismo problema.
 *
 * El intercambio no es simétrico: quedarse con un token muerto cuesta un envío
 * fallido; borrar uno bueno le cuesta la tarjeta a un cliente y no se puede
 * deshacer, porque el token no se recupera.
 */

vi.mock('apn', () => {
  class Notification {
    topic = '';
    payload: Record<string, unknown> = {};
  }
  return { Notification, default: { Notification } };
});

function servicio(motivo: string) {
  const borrados: string[] = [];
  let envios = 0;
  const prisma: any = {
    walletDevice: {
      findMany: async () => [{ id: 'd1', pushToken: 'a'.repeat(64) }],
      delete: async ({ where }: any) => {
        borrados.push(where.id);
        return {};
      },
    },
  };
  const google: any = {
    pushUpdate: async () => ({ ok: true, status: 'ok' }),
  };
  const srv = new WalletService(prisma, google, {} as never);
  // La conexión con Apple se sustituye entera: aquí no se prueba APNs, se
  // prueba qué decidimos hacer con lo que APNs responde.
  (srv as any).apnsProvider = async () => ({
    send: async () => {
      envios += 1;
      return { sent: [], failed: [{ status: '400', response: { reason: motivo } }] };
    },
  });
  return { srv, borrados, envios: () => envios };
}

describe('el registro de Apple solo se borra cuando Apple dice que murió', () => {
  it('«Unregistered» SÍ lo borra: el pase ya no está en el teléfono', async () => {
    const c = servicio('Unregistered');
    await c.srv.pushPassUpdate('pase-1');
    expect(c.borrados).toEqual(['d1']);
  });

  it('«BadDeviceToken» NO lo borra: puede ser el entorno equivocado', async () => {
    const c = servicio('BadDeviceToken');
    await c.srv.pushPassUpdate('pase-1');
    expect(c.borrados).toEqual([]);
  });

  it('«DeviceTokenNotForTopic» tampoco lo borra', async () => {
    const c = servicio('DeviceTokenNotForTopic');
    await c.srv.pushPassUpdate('pase-1');
    expect(c.borrados).toEqual([]);
  });

  it('ante un 400 de entorno se reintenta en el OTRO entorno antes de rendirse', async () => {
    // Antes solo se reintentaba con `BadEnvironmentKeyInToken`; un
    // `BadDeviceToken` ni se reintentaba, se borraba a la primera.
    const c = servicio('BadDeviceToken');
    await c.srv.pushPassUpdate('pase-1');
    expect(c.envios()).toBe(2);
    expect(c.borrados).toEqual([]);
  });

  it('un 410 no se reintenta: no hay nada que reintentar', async () => {
    const c = servicio('Unregistered');
    await c.srv.pushPassUpdate('pase-1');
    expect(c.envios()).toBe(1);
  });
});
