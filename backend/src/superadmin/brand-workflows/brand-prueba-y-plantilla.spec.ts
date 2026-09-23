import { describe, it, expect, vi } from 'vitest';
import { BrandWorkflowsController } from './brand-workflows.controller';
import { BrandWorkflowEngineService } from './brand-workflow-engine.service';
import { catalogoDeMarca } from './brand-workflow.util';
import { FEATURE_PRUEBA, TOPE_PRUEBAS } from '../../marketing/prueba-y-plantilla.util';

/**
 * «Enviar prueba» y la plantilla del paso «Enviar correo», en el constructor de
 * NEGOCIOS. Las reglas puras (prefijo, ejemplos, tope, fail-closed) se prueban
 * una sola vez en `marketing/prueba-y-plantilla.spec.ts`, que es donde viven.
 * Aquí se prueba lo que es de ESTE lado y no se puede deducir de allí:
 *
 *   · que la prueba sale por la subcuenta de la marca del que la pide y no por
 *     otra —y que una marca sin subcuenta propia NO envía, porque un remitente
 *     de la plataforma en un correo firmado por una marca blanca la delata y
 *     rompe el DMARC del dominio ajeno—,
 *   · y que el motor de marca se SALTA el paso cuando la plantilla ya no sirve,
 *     en vez de mandar un correo en blanco a todos los negocios del flujo.
 */

const MARCA = 'marca-sellea';
const OTRA_MARCA = 'marca-clubify';
const CREDS_DE_SELLEA = { growBusinessLocationId: 'loc-sellea', growBusinessApiKey: 'clave', growBusinessSwitchNumber: 2 };

const PLANTILLA = {
  id: 'tpl1',
  whiteLabelId: MARCA,
  isPreset: false,
  subject: 'Novedades de octubre',
  html: '<p>Hola {{owner}}, lo de {{negocio}} ya está.</p>',
};

function controlador(opts: { marcas?: Record<string, any>; plantillas?: any[]; destinos?: [string, string][]; pruebasRecientes?: number } = {}) {
  const settings = new Map<string, string>(opts.destinos ?? []);
  const marcas = opts.marcas ?? {
    [MARCA]: { name: 'Sellea', ...CREDS_DE_SELLEA },
    [OTRA_MARCA]: { name: 'Clubify', growBusinessLocationId: 'loc-clubify', growBusinessApiKey: 'otra', growBusinessSwitchNumber: null },
  };
  const prisma: any = {
    whiteLabel: { findUnique: async ({ where }: any) => marcas[where.id] ?? null },
    tenant: { findFirst: async ({ where }: any) => (where.whiteLabelId === MARCA ? { name: 'Wok Explosivo' } : null) },
    mktEmailTemplate: {
      findUnique: async ({ where }: any) => (opts.plantillas ?? []).find((p) => p.id === where.id) ?? null,
    },
    setting: {
      findUnique: async ({ where }: any) => (settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null),
      upsert: async ({ where, update, create }: any) => void settings.set(where.key, update?.value ?? create?.value),
      findMany: async ({ where }: any) =>
        (where.key.in as string[]).filter((k) => settings.has(k)).map((k) => ({ key: k, value: settings.get(k) })),
    },
    messageLog: { count: async () => opts.pruebasRecientes ?? 0 },
  };
  const grow = {
    sendSmsWithCreds: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
    sendEmailWithCreds: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  };
  const svc = Object.create(BrandWorkflowsController.prototype) as any;
  svc.prisma = prisma;
  svc.grow = grow;
  return { svc, grow, settings };
}

const USUARIO = { whiteLabelId: MARCA } as any;

describe('la prueba sale por la subcuenta de SU marca', () => {
  it('usa las credenciales de la marca del que pide la prueba, no las de otra', async () => {
    const { svc, grow } = controlador({ destinos: [[`autom.testphone.${MARCA}`, '+573001112233']] });
    const res = await svc.prueba({ canal: 'sms', message: 'Hola {{owner}}, {{negocio}} vence pronto.' }, USUARIO);

    expect(res).toMatchObject({ ok: true, canal: 'sms', destino: '+573001112233' });
    const [creds, destino, texto, ctx] = grow.sendSmsWithCreds.mock.calls[0] as any[];
    expect(creds.locationId).toBe('loc-sellea');
    expect(destino).toBe('+573001112233');
    expect(texto).toBe('PRUEBA · Hola Ana, Wok Explosivo vence pronto.');
    expect(ctx).toEqual({ whiteLabelId: MARCA, feature: FEATURE_PRUEBA });
  });

  it('la marca sale de la SESIÓN, no del cuerpo de la petición', async () => {
    const { svc, grow } = controlador({ destinos: [[`autom.testphone.${OTRA_MARCA}`, '+573004445566']] });
    await svc.prueba({ canal: 'sms', message: 'Hola', whiteLabelId: MARCA } as any, { whiteLabelId: OTRA_MARCA } as any);
    expect((grow.sendSmsWithCreds.mock.calls[0] as any[])[0].locationId).toBe('loc-clubify');
  });

  it('una marca blanca sin subcuenta propia no envía nada', async () => {
    // Regla dura del producto: un remitente @soyclubify.com en un correo
    // firmado por la marca ajena la delata y rompe el DMARC de su dominio.
    const { svc, grow } = controlador({
      marcas: { [MARCA]: { name: 'Sellea', growBusinessLocationId: null, growBusinessApiKey: null } },
      destinos: [[`autom.testemail.${MARCA}`, 'javier@ejemplo.com']],
    });
    await expect(svc.prueba({ canal: 'email', subject: 'Hola', body: 'Texto' }, USUARIO)).rejects.toThrow(/subcuenta/);
    expect(grow.sendEmailWithCreds).not.toHaveBeenCalled();
  });

  it('el tope por marca también corta aquí', async () => {
    const { svc, grow } = controlador({
      destinos: [[`autom.testphone.${MARCA}`, '+573001112233']],
      pruebasRecientes: TOPE_PRUEBAS,
    });
    await expect(svc.prueba({ canal: 'sms', message: 'Hola' }, USUARIO)).rejects.toThrow(/pruebas en los últimos/);
    expect(grow.sendSmsWithCreds).not.toHaveBeenCalled();
  });

  it('no se puede probar una plantilla de otra marca', async () => {
    const { svc, grow } = controlador({
      plantillas: [PLANTILLA],
      destinos: [[`autom.testemail.${OTRA_MARCA}`, 'javier@ejemplo.com']],
    });
    await expect(
      svc.prueba({ canal: 'email', templateId: 'tpl1' }, { whiteLabelId: OTRA_MARCA } as any),
    ).rejects.toThrow(/de otra marca/);
    expect(grow.sendEmailWithCreds).not.toHaveBeenCalled();
  });

  it('con plantilla, el asunto cae al de la plantilla y lleva el prefijo', async () => {
    const { svc, grow } = controlador({
      plantillas: [PLANTILLA],
      destinos: [[`autom.testemail.${MARCA}`, 'javier@ejemplo.com']],
    });
    await svc.prueba({ canal: 'email', templateId: 'tpl1' }, USUARIO);
    const [, destino, subject, html] = grow.sendEmailWithCreds.mock.calls[0] as any[];
    expect(destino).toBe('javier@ejemplo.com');
    expect(subject).toBe('PRUEBA · Novedades de octubre');
    expect(html).toBe('<p>Hola Ana, lo de Wok Explosivo ya está.</p>');
  });
});

// ── El motor: lo que pasa cuando el flujo corre de verdad ───────────────────

function motor(plantillas: any[]) {
  const logs: any[] = [];
  const prisma: any = {
    tenant: {
      findUnique: async () => ({
        name: 'Wok Explosivo',
        status: 'ACTIVE',
        planPeriodicity: 'MENSUAL',
        currentPeriodEnd: null,
        trialEndsAt: null,
        businessCategorySlug: 'restaurant',
        plan: { name: 'Pro' },
        whiteLabel: { name: 'Sellea', ...CREDS_DE_SELLEA },
        whatsappPhone: null,
        phone: '+573001112233',
      }),
    },
    user: { findFirst: async () => ({ fullName: 'Mauricio', phone: '+573009998877', email: 'mau@wok.com' }) },
    order: { count: async () => 7 },
    mktEmailTemplate: { findUnique: async ({ where }: any) => plantillas.find((p) => p.id === where.id) ?? null },
    brandWorkflowLog: { create: async ({ data }: any) => logs.push(data) },
  };
  const grow = {
    sendSmsWithCreds: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
    sendEmailWithCreds: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  };
  const svc = Object.create(BrandWorkflowEngineService.prototype) as any;
  svc.prisma = prisma;
  svc.grow = grow;
  svc.log = { warn: vi.fn(), log: vi.fn() };
  return { svc, grow, logs };
}

const FLUJO = { id: 'wf1', whiteLabelId: MARCA, drip: {}, sendWindow: {} };
const INSCRIPCION = { id: 'e1', tenantId: 't1', context: {} };
const correoDe = (config: any, plantillas: any[] = []) => {
  const m = motor(plantillas);
  return { ...m, correr: () => m.svc.runNode(FLUJO, { id: 'n1', type: 'send_email', config }, INSCRIPCION) };
};

describe('el paso «Enviar correo» del motor de marca', () => {
  it('con plantilla manda su HTML, y el {{merge}} se resuelve DENTRO del HTML', async () => {
    const { correr, grow } = correoDe({ templateId: 'tpl1' }, [PLANTILLA]);
    await correr();
    const [, destino, subject, html] = grow.sendEmailWithCreds.mock.calls[0] as any[];
    expect(destino).toBe('mau@wok.com');
    expect(subject).toBe('Novedades de octubre');
    expect(html).toBe('<p>Hola Mauricio, lo de Wok Explosivo ya está.</p>');
  });

  it('fail-closed: plantilla borrada → el paso se salta y queda el motivo, sin correo en blanco', async () => {
    const { correr, grow, logs } = correoDe({ templateId: 'tpl1', subject: 'Hola', body: 'cuerpo' }, []);
    const res = await correr();
    expect(grow.sendEmailWithCreds).not.toHaveBeenCalled();
    expect(logs[0]).toMatchObject({ status: 'skipped', result: 'La plantilla de correo del paso ya no existe' });
    // Y el negocio NO se queda colgado: el flujo sigue por donde iba.
    expect(res).toEqual({ kind: 'continue', next: null });
  });

  it('fail-closed: plantilla de otra marca → tampoco sale', async () => {
    const { correr, grow, logs } = correoDe({ templateId: 'tpl1' }, [{ ...PLANTILLA, whiteLabelId: OTRA_MARCA }]);
    await correr();
    expect(grow.sendEmailWithCreds).not.toHaveBeenCalled();
    expect(logs[0]).toMatchObject({ status: 'skipped', result: 'La plantilla de correo del paso es de otra marca' });
  });

  it('sin plantilla sigue enviando lo escrito a mano, como siempre', async () => {
    const { correr, grow } = correoDe({ subject: 'Hola {{owner}}', body: 'Línea 1\nLínea 2' });
    await correr();
    const [, , subject, html] = grow.sendEmailWithCreds.mock.calls[0] as any[];
    expect(subject).toBe('Hola Mauricio');
    expect(html).toBe('Línea 1<br>Línea 2');
  });
});

describe('el catálogo de marca', () => {
  it('ofrece las plantillas de la marca y declara los canales de prueba', () => {
    const cat = catalogoDeMarca('HOTMART', [{ value: 'tpl1', label: 'Boletín' }]);
    const paso = cat.pasos.find((p) => p.key === 'send_email')!;
    expect(paso.campos.find((c) => c.key === 'templateId')?.opciones).toEqual([
      { value: '', label: 'Sin plantilla (escribo el cuerpo aquí)' },
      { value: 'tpl1', label: 'Boletín' },
    ]);
    expect(paso.prueba).toBe('email');
    expect(cat.pasos.find((p) => p.key === 'send_sms')?.prueba).toBe('sms');
  });

  it('las plantillas de una marca no se quedan pegadas para la siguiente', () => {
    catalogoDeMarca(null, [{ value: 'tpl1', label: 'Solo de Sellea' }]);
    const limpio = catalogoDeMarca(null);
    const tpl = limpio.pasos.find((p) => p.key === 'send_email')!.campos.find((c) => c.key === 'templateId')!;
    expect(tpl.opciones).toEqual([{ value: '', label: 'Sin plantilla (escribo el cuerpo aquí)' }]);
  });
});
