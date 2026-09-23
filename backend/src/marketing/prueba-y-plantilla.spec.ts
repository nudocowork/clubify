import { describe, it, expect, vi } from 'vitest';
import { MktWorkflowsController } from './mkt-workflows.controller';
import {
  conPrefijoDePrueba,
  correoDelPaso,
  ctxDePrueba,
  destinoDePruebaValido,
  ejecutarPruebaDeFlujo,
  FEATURE_PRUEBA,
  PREFIJO_PRUEBA,
  TOPE_PRUEBAS,
} from './prueba-y-plantilla.util';
import { catalogoDeContactos, resolveMerge } from './mkt-workflow.util';

/**
 * «Enviar prueba» y la plantilla del paso «Enviar correo», en el constructor de
 * CONTACTOS.
 *
 * Por qué estas pruebas y no otras. Las dos cosas que se añaden aquí pueden
 * salir caras de formas muy concretas:
 *   · una PRUEBA que no se distingue de un envío real (el dueño de la marca
 *     recibe «tu suscripción vence mañana» y se lo cree),
 *   · un botón de enviar sin tope, que es un generador de SMS gratis contra la
 *     subcuenta de la marca a golpe de clic,
 *   · una plantilla de OTRA marca usada en un flujo (la fuga de marca de
 *     siempre),
 *   · y una plantilla borrada o vacía que mande un correo EN BLANCO a la lista
 *     entera, que es lo único que no se puede deshacer.
 *
 * El controlador no se instancia con Nest: se le ponen a mano el prisma falso y
 * el proveedor, igual que hacen `mkt-pasos.spec.ts` y `brand-workflow-pasos.spec.ts`.
 */

const MARCA = 'marca-sellea';
const OTRA_MARCA = 'marca-clubify';

const PLANTILLA = {
  id: 'tpl1',
  whiteLabelId: MARCA,
  isPreset: false,
  subject: 'Novedades de octubre',
  html: '<p>Hola {{nombre}}, esto es de {{negocio}}.</p>',
};

function controlador(opts: { plantillas?: any[]; destinos?: [string, string][]; pruebasRecientes?: number } = {}) {
  const settings = new Map<string, string>(opts.destinos ?? []);
  const prisma: any = {
    whiteLabel: { findUnique: async () => ({ name: 'Sellea' }) },
    // El `where` se respeta: un negocio de otra marca no puede colarse como
    // muestra de esta.
    tenant: {
      findFirst: async ({ where }: any) => (where.whiteLabelId === MARCA ? { name: 'Wok Explosivo' } : null),
    },
    mktEmailTemplate: {
      findUnique: async ({ where }: any) => (opts.plantillas ?? []).find((p) => p.id === where.id) ?? null,
    },
    setting: {
      findUnique: async ({ where }: any) =>
        settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null,
      upsert: async ({ where, update, create }: any) => {
        settings.set(where.key, update?.value ?? create?.value);
      },
      findMany: async ({ where }: any) =>
        (where.key.in as string[])
          .filter((k) => settings.has(k))
          .map((k) => ({ key: k, value: settings.get(k) })),
    },
    messageLog: { count: async () => opts.pruebasRecientes ?? 0 },
  };
  const provider = {
    sendEmail: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
    sendSms: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  };
  const svc = Object.create(MktWorkflowsController.prototype) as any;
  svc.prisma = prisma;
  svc.provider = provider;
  return { svc, provider, settings };
}

const USUARIO = { whiteLabelId: MARCA } as any;

describe('el mensaje de prueba se nota que es una prueba', () => {
  it('empieza por PRUEBA · y los {{merge}} llevan valores de ejemplo', async () => {
    const { svc, provider } = controlador({ destinos: [[`autom.testphone.${MARCA}`, '+573001112233']] });
    const res = await svc.prueba({ canal: 'sms', message: 'Hola {{nombre}}, lo de {{negocio}} ya está.' }, USUARIO);

    expect(res.ok).toBe(true);
    expect(res.destino).toBe('+573001112233');
    const enviado = provider.sendSms.mock.calls[0][0] as any;
    expect(enviado.message).toBe('PRUEBA · Hola Ana, lo de Wok Explosivo ya está.');
    // Sin esto, la prueba se contaría como un mensaje al cliente en el panel de
    // envíos y falsearía «cuántos SMS mandó esta marca».
    expect(enviado.ctx).toEqual({ whiteLabelId: MARCA, feature: FEATURE_PRUEBA });
  });

  it('el prefijo no se duplica si el texto ya lo trae', () => {
    expect(conPrefijoDePrueba('PRUEBA · Hola')).toBe('PRUEBA · Hola');
    expect(conPrefijoDePrueba('Hola')).toBe(`${PREFIJO_PRUEBA}Hola`);
  });

  it('{{nombre}} es Ana y {{negocio}} es un negocio de la marca, no un hueco', () => {
    const ctx = ctxDePrueba({ marca: 'Sellea', negocio: 'Wok Explosivo' });
    expect(resolveMerge('{{nombre}} · {{negocio}} · {{platform}}', ctx)).toBe('Ana · Wok Explosivo · Sellea');
    // Sin negocios todavía, un texto legible antes que un hueco.
    expect(ctxDePrueba({ marca: 'Sellea', negocio: null }).negocio).toBe('Tu negocio');
    // Una variable que el catálogo no conoce sigue quedando VACÍA, igual que en
    // un envío de verdad: si aquí se inventara algo, la prueba se vería bien y
    // el mensaje real saldría con el hueco.
    expect(resolveMerge('{{inventado}}', ctx)).toBe('');
  });

  it('el asunto del correo de prueba también lleva el prefijo', async () => {
    const { svc, provider } = controlador({ destinos: [[`autom.testemail.${MARCA}`, 'javier@ejemplo.com']] });
    await svc.prueba({ canal: 'email', subject: 'Hola {{nombre}}', body: 'Texto' }, USUARIO);
    expect((provider.sendEmail.mock.calls[0][0] as any).subject).toBe('PRUEBA · Hola Ana');
  });
});

describe('el tope de pruebas', () => {
  it('a la número 11 en la ventana ya no manda nada', async () => {
    const { svc, provider } = controlador({
      destinos: [[`autom.testphone.${MARCA}`, '+573001112233']],
      pruebasRecientes: TOPE_PRUEBAS,
    });
    await expect(svc.prueba({ canal: 'sms', message: 'Hola' }, USUARIO)).rejects.toThrow(/pruebas en los últimos/);
    // Lo que importa no es el mensaje de error: es que NO salió.
    expect(provider.sendSms).not.toHaveBeenCalled();
  });

  it('por debajo del tope sí manda', async () => {
    const { svc, provider } = controlador({
      destinos: [[`autom.testphone.${MARCA}`, '+573001112233']],
      pruebasRecientes: TOPE_PRUEBAS - 1,
    });
    await svc.prueba({ canal: 'sms', message: 'Hola' }, USUARIO);
    expect(provider.sendSms).toHaveBeenCalledOnce();
  });
});

describe('el destino de la prueba', () => {
  it('sin destino guardado no se manda nada: se pide primero', async () => {
    const { svc, provider } = controlador();
    await expect(svc.prueba({ canal: 'sms', message: 'Hola' }, USUARIO)).rejects.toThrow(/teléfono/);
    expect(provider.sendSms).not.toHaveBeenCalled();
  });

  it('el que se escribe queda GUARDADO como destino de la marca', async () => {
    // Es lo que impide usar el botón como remitente prestado contra el número
    // de un tercero: lo que se manda va siempre al destino de prueba de la
    // marca, y escribir uno es declararlo suyo.
    const { svc, settings } = controlador();
    await svc.prueba({ canal: 'sms', message: 'Hola', destino: '+573009998877' }, USUARIO);
    expect(settings.get(`autom.testphone.${MARCA}`)).toBe('+573009998877');
  });

  it('un correo en el campo del teléfono no pasa', () => {
    expect(destinoDePruebaValido('sms', 'ana@ejemplo.com').ok).toBe(false);
    expect(destinoDePruebaValido('email', '+573001112233').ok).toBe(false);
    expect(destinoDePruebaValido('email', 'Ana@Ejemplo.com')).toEqual({ ok: true, valor: 'ana@ejemplo.com' });
  });

  it('un fallo del proveedor no se disfraza de éxito', async () => {
    const { svc, provider } = controlador({ destinos: [[`autom.testphone.${MARCA}`, '+573001112233']] });
    provider.sendSms.mockResolvedValueOnce({ ok: false, error: 'numero en la lista de no molestar' } as any);
    const res = await svc.prueba({ canal: 'sms', message: 'Hola' }, USUARIO);
    expect(res.ok).toBe(false);
    expect(res.motivo).toBe('numero en la lista de no molestar');
  });
});

describe('la plantilla del paso «Enviar correo»', () => {
  const merge = (t: string) => resolveMerge(t, ctxDePrueba({ marca: 'Sellea', negocio: 'Wok Explosivo' }));

  it('el cuerpo sale del HTML de la plantilla, con los {{merge}} resueltos', () => {
    const r = correoDelPaso({ templateId: 'tpl1', plantilla: PLANTILLA, whiteLabelId: MARCA, subject: '', body: 'esto se ignora', merge });
    expect(r).toEqual({ ok: true, subject: 'Novedades de octubre', html: '<p>Hola Ana, esto es de Wok Explosivo.</p>' });
  });

  it('el asunto del paso manda; si está vacío, cae al de la plantilla', () => {
    const conAsunto = correoDelPaso({ templateId: 'tpl1', plantilla: PLANTILLA, whiteLabelId: MARCA, subject: 'Para {{nombre}}', body: '', merge });
    expect(conAsunto).toMatchObject({ ok: true, subject: 'Para Ana' });
    const sinAsunto = correoDelPaso({ templateId: 'tpl1', plantilla: PLANTILLA, whiteLabelId: MARCA, subject: '   ', body: '', merge });
    expect(sinAsunto).toMatchObject({ ok: true, subject: 'Novedades de octubre' });
  });

  it('una plantilla de OTRA marca no se usa, aunque su id esté escrito en el flujo', () => {
    const r = correoDelPaso({ templateId: 'tpl1', plantilla: { ...PLANTILLA, whiteLabelId: OTRA_MARCA }, whiteLabelId: MARCA, subject: 'Hola', body: 'cuerpo propio', merge });
    expect(r).toEqual({ ok: false, motivo: 'La plantilla de correo del paso es de otra marca' });
  });

  it('una de fábrica sí la puede usar cualquier marca', () => {
    const r = correoDelPaso({ templateId: 'tpl1', plantilla: { ...PLANTILLA, whiteLabelId: OTRA_MARCA, isPreset: true }, whiteLabelId: MARCA, subject: '', body: '', merge });
    expect(r).toMatchObject({ ok: true });
  });

  it('fail-closed: borrada o vacía, NO se cae al cuerpo del paso ni sale en blanco', () => {
    // El caso caro: si esto devolviera `ok` con el cuerpo del paso (vacío,
    // porque quien eligió plantilla no escribió nada), saldría un correo en
    // blanco a la lista entera. Eso no se deshace.
    expect(correoDelPaso({ templateId: 'tpl1', plantilla: null, whiteLabelId: MARCA, subject: 'Hola', body: 'cuerpo', merge })).toEqual({
      ok: false,
      motivo: 'La plantilla de correo del paso ya no existe',
    });
    expect(correoDelPaso({ templateId: 'tpl1', plantilla: { ...PLANTILLA, html: '   ' }, whiteLabelId: MARCA, subject: 'Hola', body: 'cuerpo', merge })).toEqual({
      ok: false,
      motivo: 'La plantilla de correo del paso está vacía',
    });
  });

  it('sin plantilla, el cuerpo escrito a mano sigue funcionando', () => {
    const r = correoDelPaso({ templateId: '', plantilla: null, whiteLabelId: MARCA, subject: 'Hola', body: 'Línea 1\nLínea 2', merge });
    expect(r).toEqual({ ok: true, subject: 'Hola', html: 'Línea 1<br>Línea 2' });
  });

  it('el catálogo ofrece el desplegable y esconde el cuerpo cuando hay plantilla', () => {
    const cat = catalogoDeContactos({ embudos: [], etapas: [], miembros: [], plantillas: [{ value: 'tpl1', label: 'Boletín' }] });
    const paso = cat.pasos.find((p) => p.key === 'send_email')!;
    const tpl = paso.campos.find((c) => c.key === 'templateId')!;
    expect(tpl.opciones).toEqual([
      { value: '', label: 'Sin plantilla (escribo el cuerpo aquí)' },
      { value: 'tpl1', label: 'Boletín' },
    ]);
    expect(paso.campos.find((c) => c.key === 'body')?.ocultoSi).toBe('templateId');
    expect(paso.campos.find((c) => c.key === 'subject')?.requeridoSalvo).toBe('templateId');
    // Los dos pasos de mensaje declaran su canal de prueba: la pantalla dibuja
    // el botón con esto, no con una lista de tipos escrita a mano.
    expect(cat.pasos.find((p) => p.key === 'send_sms')?.prueba).toBe('sms');
    expect(paso.prueba).toBe('email');
  });

  it('las plantillas de una marca no se quedan pegadas para la siguiente', () => {
    catalogoDeContactos({ embudos: [], etapas: [], miembros: [], plantillas: [{ value: 'tpl1', label: 'Solo de Sellea' }] });
    const limpio = catalogoDeContactos();
    const tpl = limpio.pasos.find((p) => p.key === 'send_email')!.campos.find((c) => c.key === 'templateId')!;
    expect(tpl.opciones).toEqual([{ value: '', label: 'Sin plantilla (escribo el cuerpo aquí)' }]);
  });
});

describe('el aislamiento por marca del endpoint de prueba', () => {
  it('la marca sale de la SESIÓN, no del cuerpo de la petición', async () => {
    const { svc, provider, settings } = controlador({ destinos: [[`autom.testphone.${OTRA_MARCA}`, '+573004445566']] });
    // El usuario es de OTRA_MARCA: el cuerpo no tiene forma de decir otra cosa.
    await svc.prueba({ canal: 'sms', message: 'Hola', whiteLabelId: MARCA } as any, { whiteLabelId: OTRA_MARCA } as any);
    const enviado = provider.sendSms.mock.calls[0][0] as any;
    expect(enviado.whiteLabelId).toBe(OTRA_MARCA);
    expect(enviado.ctx.whiteLabelId).toBe(OTRA_MARCA);
    // Y el destino se lee y se guarda bajo la clave de SU marca.
    expect(settings.get(`autom.testphone.${MARCA}`)).toBeUndefined();
  });

  it('no se puede probar una plantilla de otra marca desde el panel', async () => {
    const { svc, provider } = controlador({
      plantillas: [PLANTILLA],
      destinos: [[`autom.testemail.${OTRA_MARCA}`, 'javier@ejemplo.com']],
    });
    await expect(
      svc.prueba({ canal: 'email', templateId: 'tpl1', subject: 'Hola' }, { whiteLabelId: OTRA_MARCA } as any),
    ).rejects.toThrow(/de otra marca/);
    expect(provider.sendEmail).not.toHaveBeenCalled();
  });
});

describe('el orquestador de la prueba', () => {
  it('guarda el destino ANTES de enviar: un envío fallido no lo pierde', async () => {
    const guardados: string[] = [];
    const res = await ejecutarPruebaDeFlujo({
      canal: 'email',
      destino: 'Javier@Ejemplo.com',
      leerDestinoGuardado: async () => null,
      guardarDestino: async (v) => void guardados.push(v),
      contarPruebas: async () => 0,
      enviar: async () => ({ ok: false, motivo: 'el proveedor está caído' }),
    });
    expect(guardados).toEqual(['javier@ejemplo.com']);
    expect(res).toMatchObject({ ok: false, destino: 'javier@ejemplo.com', motivo: 'el proveedor está caído' });
    // Un fallo del proveedor NO es culpa de quien pulsó: no se convierte en 400.
    expect(res.deEntrada).toBeUndefined();
  });
});
