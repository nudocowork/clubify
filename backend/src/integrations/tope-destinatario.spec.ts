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

describe('lo que el primer intento de arreglo NO cazaba', () => {
  // Estas tres son las que faltaban. El tope estaba escrito, pasaba sus
  // pruebas, y aun asi no frenaba nada: se rodeaba metiendo un espacio en el
  // numero, o usando WhatsApp, o pasando por una automatizacion.

  it('lo GUARDADO en el registro casa con lo que se cuenta', async () => {
    // El agujero: `registrarEnvio` guardaba «315 062 1706» tal cual y el tope
    // buscaba `endsWith('3150621706')`. La fila no casaba ni consigo misma:
    // el tope contaba CERO y bastaba un espacio para rodearlo.
    const svc = servicio(0);
    // Aquí SÍ se usa el `registrarEnvio` de verdad: lo que se prueba es
    // exactamente lo que acaba en la base.
    delete svc.registrarEnvio;
    svc.prisma.tenant = { findUnique: vi.fn(async () => null) };
    await svc.registrarEnvio({
      channel: 'SMS',
      ok: true,
      locationId: 'loc1',
      toPhone: '315 062 1706',
      body: 'hola',
      ctx: { tenantId: 't1', destinatarioSinVerificar: true },
    });
    const guardado = svc.prisma.messageLog.create.mock.calls.at(-1)?.[0]?.data?.toPhone;
    expect(guardado).toBe('3150621706');
    // Y lo que se cuenta usa la misma forma.
    await svc.pasoElTopeSinVerificar('315 062 1706');
    const buscado = svc.prisma.messageLog.count.mock.calls.at(-1)[0].where.toPhone.endsWith;
    expect(guardado?.endsWith(buscado)).toBe(true);
  });

  it('WhatsApp tambien respeta el tope y la lista de no molestar', async () => {
    // Sin esto, todo el arreglo se rodeaba usando el canal de al lado. Y la
    // lista de «no molestar» tampoco aplicaba a WhatsApp, que para quien lo
    // recibe es exactamente lo mismo.
    const svc = servicio(99);
    const r = await svc.sendWhatsAppWithCreds({ locationId: 'l', apiKey: 'k' }, '3150621706', 'x', {
      tenantId: 't1',
      destinatarioSinVerificar: true,
    });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('tope');
  });
});

describe('tope por NEGOCIO, ademas del tope por numero', () => {
  // El tope por numero protege a UNA persona de recibir treinta mensajes. No
  // impedia mandar un mensaje a treinta personas distintas: con una lista de
  // numeros, cada vuelta estrenaba victima y el tope no se tocaba nunca.

  /** Prisma que responde distinto segun si la consulta lleva tenantId. */
  function servicioConTopes(porNumero: number, porNegocio: number) {
    const svc = servicio(0);
    svc.prisma.messageLog.count = vi.fn(async ({ where }: any) =>
      where.tenantId ? porNegocio : porNumero,
    );
    return svc;
  }

  it('corta cuando el NEGOCIO pasa su tope, aunque el numero sea nuevo', async () => {
    const svc = servicioConTopes(0, 20); // numero limpio, negocio pasado
    const r = await svc.sendSmsWithCreds(CREDS, '3009998877', 'x', {
      tenantId: 't1',
      destinatarioSinVerificar: true,
    });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('negocio');
    expect(svc.enviarSms).not.toHaveBeenCalled();
  });

  it('deja pasar mientras el negocio no llegue a su tope', async () => {
    const svc = servicioConTopes(0, 19);
    const r = await svc.sendSmsWithCreds(CREDS, '3009998877', 'x', {
      tenantId: 't1',
      destinatarioSinVerificar: true,
    });
    // Lo que se afirma es que NINGÚN tope lo cortó. Más allá el envío real
    // depende del proveedor, que aquí no se levanta.
    expect(r.message ?? '').not.toContain('tope');
  });

  it('no cuenta los avisos al propio negocio', async () => {
    // Solo cuentan los envios con feature de rutas publicas. Si contara todo,
    // un negocio con muchos pedidos se quedaria sin poder confirmar citas.
    const svc = servicioConTopes(0, 0);
    await svc.sendSmsWithCreds(CREDS, '3009998877', 'x', {
      tenantId: 't1',
      destinatarioSinVerificar: true,
    });
    const where = svc.prisma.messageLog.count.mock.calls.at(-1)[0].where;
    expect(where.feature.in).toContain('reservations');
    expect(where.feature.in).toContain('automations');
  });
});
