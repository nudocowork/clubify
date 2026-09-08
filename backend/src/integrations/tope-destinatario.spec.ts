/**
 * Tope de mensajes a un número que eligió un desconocido.
 *
 * NO necesita base de datos ni red.
 *
 * Por qué. `POST /public/service-reservations/:slug/book` manda la confirmación
 * al teléfono que venga en el cuerpo, con las credenciales del negocio, y la
 * llave es el slug —que es público—. El bucle no acababa: la respuesta trae el
 * `manageToken`, cancelar libera el hueco y reagendar reenvía la confirmación.
 * Reservar → cancelar → reservar = un SMS por vuelta, para siempre (P0-5).
 *
 * El daño no era solo el coste: se podía **acosar a un tercero desde el
 * remitente del negocio**, que es lo que ve quien recibe el mensaje.
 *
 * Lo que NO se puede romper con el arreglo, y por eso hay pruebas de ambas
 * cosas: los avisos al propio negocio no llevan tope. Un local con veinte
 * pedidos en una hora tiene que recibir veinte avisos.
 */
import { describe, it, expect, vi } from 'vitest';
import { GrowBusinessService } from './grow-business.service';

const CREDS = { locationId: 'loc1', apiKey: 'k', switchNumber: 1 };

function servicio(enviadosEnLaUltimaHora: number) {
  const svc = Object.create(GrowBusinessService.prototype) as any;
  svc.logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  svc.prisma = {
    messageLog: {
      count: vi.fn(async () => enviadosEnLaUltimaHora),
      create: vi.fn(async () => ({})),
    },
    setting: { findUnique: vi.fn(async () => null) }, // sin lista de bloqueados
  };
  // El envío real no se toca: lo que se prueba es si se LLEGA a él.
  svc.enviarSms = vi.fn(async () => ({ ok: true }));
  svc.registrarEnvio = vi.fn(async () => undefined);
  return svc;
}

/** Llama al tope directamente: es la decisión que se está probando. */
function topePasado(svc: any, phone: string): Promise<boolean> {
  return svc.pasoElTopeSinVerificar(phone);
}

describe('tope para destinatarios sin verificar', () => {
  it('deja pasar mientras no se llegue al tope', async () => {
    expect(await topePasado(servicio(0), '3150621706')).toBe(false);
    expect(await topePasado(servicio(2), '3150621706')).toBe(false);
  });

  it('corta al llegar al tope', async () => {
    expect(await topePasado(servicio(3), '3150621706')).toBe(true);
    expect(await topePasado(servicio(50), '3150621706')).toBe(true);
  });

  it('cuenta el mismo numero escrito de formas distintas', async () => {
    // «+57 315…», «57315…» y «315…» son el mismo teléfono: si no se comparan
    // los últimos dígitos, el tope se rodea cambiando el formato.
    const svc = servicio(3);
    expect(await topePasado(svc, '+57 315 062 1706')).toBe(true);
    const where = svc.prisma.messageLog.count.mock.calls[0][0].where;
    expect(where.toPhone.endsWith).toBe('3150621706');
  });

  it('si el conteo falla, DEJA PASAR', async () => {
    // Quedarse sin mandar la confirmación de una cita real es peor que un
    // mensaje de más. El peor caso tiene que ser permisivo, no romper el
    // servicio.
    const svc = servicio(0);
    svc.prisma.messageLog.count = vi.fn(async () => {
      throw new Error('base caída');
    });
    expect(await topePasado(svc, '3150621706')).toBe(false);
  });

  it('sin numero no cuenta nada', async () => {
    expect(await topePasado(servicio(99), '')).toBe(false);
  });
});

describe('el tope solo se aplica si el destinatario no esta verificado', () => {
  it('sin la marca, no se consulta el tope', async () => {
    // Los avisos al propio negocio pasan por aquí sin la marca: si el tope se
    // aplicara a todos, un local con veinte pedidos en una hora dejaría de
    // recibir avisos a partir del tercero.
    const svc = servicio(99);
    await svc.sendSmsWithCreds(CREDS, '3150621706', 'Entró un pedido', {
      tenantId: 't1',
      feature: 'orders',
    });
    // count() solo se llama para el tope; sin la marca no debe consultarse.
    expect(svc.prisma.messageLog.count).not.toHaveBeenCalled();
  });

  it('con la marca, corta el envio', async () => {
    const svc = servicio(99);
    const r = await svc.sendSmsWithCreds(CREDS, '3150621706', 'Tu cita', {
      tenantId: 't1',
      feature: 'reservations',
      destinatarioSinVerificar: true,
    });
    expect(r.ok).toBe(false);
    expect(svc.enviarSms).not.toHaveBeenCalled();
  });
});
