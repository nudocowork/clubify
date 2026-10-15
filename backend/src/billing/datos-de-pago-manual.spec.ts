import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { SoloPlataformaGuard } from '../common/guards/solo-plataforma.guard';
import {
  CLAVE_DATOS_DE_PAGO,
  DATOS_DE_PAGO_POR_DEFECTO,
  MAX_MENSAJE,
  TEMPLATE_DATOS_DE_PAGO,
  debeEnviarDatosDePago,
  leerDatosDePago,
  normalizarDatosDePago,
} from './datos-de-pago-manual';

/**
 * Los negocios que pagan por fuera (transferencia, Nequi) reciben, justo
 * después de cada aviso de cobro, un segundo mensaje con la imagen de las
 * cuentas y la indicación de consultar la tasa del día. Ver
 * `datos-de-pago-manual.ts`.
 */

describe('normalizarDatosDePago', () => {
  it('sin nada guardado → los de fábrica, activos', () => {
    expect(leerDatosDePago(null)).toEqual(DATOS_DE_PAGO_POR_DEFECTO);
    expect(leerDatosDePago('')).toEqual(DATOS_DE_PAGO_POR_DEFECTO);
    expect(DATOS_DE_PAGO_POR_DEFECTO.activo).toBe(true);
    expect(DATOS_DE_PAGO_POR_DEFECTO.imagenUrl).toBe(
      'https://app.soyclubify.com/cobros/metodos-de-pago-clubify.jpg',
    );
    expect(DATOS_DE_PAGO_POR_DEFECTO.mensaje).toMatch(/tasa del día/);
  });

  it('JSON ilegible → los de fábrica, sin lanzar', () => {
    expect(leerDatosDePago('{no es json')).toEqual(DATOS_DE_PAGO_POR_DEFECTO);
    expect(normalizarDatosDePago(null)).toEqual(DATOS_DE_PAGO_POR_DEFECTO);
    expect(normalizarDatosDePago('texto')).toEqual(DATOS_DE_PAGO_POR_DEFECTO);
  });

  it('respeta lo que el admin guardó', () => {
    const v = normalizarDatosDePago({
      activo: false,
      imagenUrl: 'https://cdn.ejemplo.com/cuentas.png',
      mensaje: '  Paga a estas cuentas.  ',
    });
    expect(v).toEqual({
      activo: false,
      imagenUrl: 'https://cdn.ejemplo.com/cuentas.png',
      mensaje: 'Paga a estas cuentas.',
    });
  });

  it('la imagen solo es https: http, data: y javascript: caen a la de fábrica', () => {
    for (const mala of [
      'http://app.soyclubify.com/x.jpg',
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
      'no-es-url',
      'https://' + 'a'.repeat(2000) + '.com/x.jpg',
    ]) {
      expect(normalizarDatosDePago({ imagenUrl: mala }).imagenUrl).toBe(
        DATOS_DE_PAGO_POR_DEFECTO.imagenUrl,
      );
    }
  });

  it('el mensaje se limpia y se recorta', () => {
    const v = normalizarDatosDePago({ mensaje: 'Hola\r\n\r\n\r\n\r\nmundo\u0007' });
    expect(v.mensaje).toBe('Hola\n\nmundo');
    expect(normalizarDatosDePago({ mensaje: 'x'.repeat(5000) }).mensaje.length).toBe(MAX_MENSAJE);
  });

  it('mensaje vacío → el de fábrica: la advertencia de la tasa no se puede perder', () => {
    expect(normalizarDatosDePago({ mensaje: '   ' }).mensaje).toBe(DATOS_DE_PAGO_POR_DEFECTO.mensaje);
  });

  it('activo que no es booleano → encendido', () => {
    expect(normalizarDatosDePago({ activo: 'no' }).activo).toBe(true);
  });
});

describe('debeEnviarDatosDePago', () => {
  const base = {
    manualPayment: true,
    esPlataforma: true,
    config: DATOS_DE_PAGO_POR_DEFECTO,
    avisoDeCobroSalio: true,
  };
  it('pago manual + plataforma + activo + aviso salió → sí', () => {
    expect(debeEnviarDatosDePago(base)).toBe(true);
  });
  it('quien paga por pasarela NO recibe cuentas (pagaría dos veces)', () => {
    expect(debeEnviarDatosDePago({ ...base, manualPayment: false })).toBe(false);
    expect(debeEnviarDatosDePago({ ...base, manualPayment: null })).toBe(false);
  });
  it('un negocio de marca blanca NO recibe las cuentas de Clubify', () => {
    expect(debeEnviarDatosDePago({ ...base, esPlataforma: false })).toBe(false);
  });
  it('apagado desde el panel → no', () => {
    expect(
      debeEnviarDatosDePago({ ...base, config: { ...DATOS_DE_PAGO_POR_DEFECTO, activo: false } }),
    ).toBe(false);
  });
  it('si el aviso de cobro no salió, tampoco los datos', () => {
    expect(debeEnviarDatosDePago({ ...base, avisoDeCobroSalio: false })).toBe(false);
  });
});

// ── El helper dentro de los avisos reales ──────────────────────────────────

const CREDS = { locationId: 'loc-1', apiKey: 'k', switchNumber: null };

function montar(opts: {
  manualPayment: boolean;
  whiteLabel?: { id: string; slug: string } | null;
  config?: Record<string, unknown> | null;
  avisoOk?: boolean;
  datosLanza?: boolean;
}) {
  const envios: any[] = [];
  const updates: any[] = [];
  const ahora = new Date('2026-10-15T14:00:00.000Z');
  const periodEnd = new Date(ahora.getTime() + 3.5 * 24 * 60 * 60 * 1000);
  const prisma: any = {
    tenant: {
      findMany: async () => [
        {
          id: 't1',
          brandName: 'Café Prueba',
          currentPeriodEnd: periodEnd,
          lastChargeAt: null,
          planPeriodicity: 'MENSUAL',
          preReminder3dSentFor: null,
          manualPayment: opts.manualPayment,
        },
      ],
      findUnique: async () => ({
        whiteLabelId: opts.whiteLabel?.id ?? null,
        whiteLabel: opts.whiteLabel ? { slug: opts.whiteLabel.slug } : null,
      }),
      update: vi.fn(async (a: any) => updates.push(a)),
    },
    setting: {
      findUnique: async ({ where }: any) =>
        where.key === CLAVE_DATOS_DE_PAGO && opts.config
          ? { value: JSON.stringify(opts.config) }
          : null,
    },
    user: { findFirst: async () => ({ fullName: 'Ana Pérez' }) },
  };
  const growBusiness: any = {
    sendSmsWithCreds: vi.fn(async (_c: any, _p: string, _b: string, ctx: any) => {
      envios.push(ctx);
      if (ctx?.templateId === TEMPLATE_DATOS_DE_PAGO) {
        if (opts.datosLanza) throw new Error('GHL caído');
        return { ok: true, id: 'm2' };
      }
      return opts.avisoOk === false
        ? { ok: false, message: 'falló' }
        : { ok: true, id: 'm1' };
    }),
  };
  const smsTemplates: any = { render: async () => 'Hola Ana, en 3 días renovamos tu plan.' };
  const brandEmail: any = { sendTemplate: async () => ({ sent: false }) };
  const svc = new BillingService(
    prisma,
    growBusiness,
    smsTemplates,
    brandEmail,
    {} as any,
    {} as any,
    { estaConfigurada: () => false } as any,
  ) as any;
  svc.resolveBillingTarget = async () => ({ creds: CREDS, phone: '+573001112233' });
  return { svc, growBusiness, updates, ahora };
}

describe('los avisos de cobro mandan los datos de pago a quien paga por fuera', () => {
  it('pago manual: aviso + datos, al mismo número, con la imagen adjunta', async () => {
    const { svc, growBusiness, updates, ahora } = montar({ manualPayment: true });
    await svc.sendPreChargeReminder3d(ahora);
    const llamadas = growBusiness.sendSmsWithCreds.mock.calls;
    expect(llamadas).toHaveLength(2);
    expect(llamadas[0][3].templateId).toBe('payment_reminder_3d');
    const [creds, phone, body, ctx, extra] = llamadas[1];
    expect(creds).toBe(CREDS);
    expect(phone).toBe('+573001112233');
    expect(body).toBe(DATOS_DE_PAGO_POR_DEFECTO.mensaje);
    expect(ctx).toMatchObject({ tenantId: 't1', templateId: TEMPLATE_DATOS_DE_PAGO, feature: 'billing' });
    expect(extra).toEqual({ attachments: [DATOS_DE_PAGO_POR_DEFECTO.imagenUrl] });
    // El ciclo queda marcado igual que siempre.
    expect(updates).toHaveLength(1);
  });

  it('usa el texto y la imagen que se guardaron en el panel', async () => {
    const { svc, growBusiness, ahora } = montar({
      manualPayment: true,
      config: { activo: true, imagenUrl: 'https://cdn.x.com/c.png', mensaje: 'Paga aquí.' },
    });
    await svc.sendPreChargeReminder3d(ahora);
    const datos = growBusiness.sendSmsWithCreds.mock.calls[1];
    expect(datos[2]).toBe('Paga aquí.');
    expect(datos[4]).toEqual({ attachments: ['https://cdn.x.com/c.png'] });
  });

  it('pago por pasarela: solo el aviso', async () => {
    const { svc, growBusiness, ahora } = montar({ manualPayment: false });
    await svc.sendPreChargeReminder3d(ahora);
    expect(growBusiness.sendSmsWithCreds).toHaveBeenCalledTimes(1);
  });

  it('apagado en el panel: solo el aviso', async () => {
    const { svc, growBusiness, ahora } = montar({ manualPayment: true, config: { activo: false } });
    await svc.sendPreChargeReminder3d(ahora);
    expect(growBusiness.sendSmsWithCreds).toHaveBeenCalledTimes(1);
  });

  it('negocio de una marca blanca: no recibe las cuentas de Clubify', async () => {
    const { svc, growBusiness, ahora } = montar({
      manualPayment: true,
      whiteLabel: { id: 'wl-sellea', slug: 'sellea' },
    });
    await svc.sendPreChargeReminder3d(ahora);
    expect(growBusiness.sendSmsWithCreds).toHaveBeenCalledTimes(1);
  });

  it('negocio dentro de la marca Clubify: sí los recibe', async () => {
    const { svc, growBusiness, ahora } = montar({
      manualPayment: true,
      whiteLabel: { id: 'wl-clubify', slug: 'clubify' },
    });
    await svc.sendPreChargeReminder3d(ahora);
    expect(growBusiness.sendSmsWithCreds).toHaveBeenCalledTimes(2);
  });

  it('si el aviso de cobro no salió, no se mandan los datos sueltos', async () => {
    const { svc, growBusiness, ahora } = montar({ manualPayment: true, avisoOk: false });
    await svc.sendPreChargeReminder3d(ahora);
    expect(growBusiness.sendSmsWithCreds).toHaveBeenCalledTimes(1);
  });

  it('un fallo de los datos no rompe el aviso ni su marca de ciclo', async () => {
    const { svc, updates, ahora } = montar({ manualPayment: true, datosLanza: true });
    await expect(svc.sendPreChargeReminder3d(ahora)).resolves.toBe(1);
    expect(updates).toHaveLength(1);
  });

  it('las consultas de los avisos previos piden manualPayment', async () => {
    const selects: any[] = [];
    const prisma: any = {
      tenant: {
        findMany: async (a: any) => {
          selects.push(a.select);
          return [];
        },
      },
    };
    const svc = new BillingService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, { estaConfigurada: () => false } as any) as any;
    const ahora = new Date('2026-10-15T14:00:00.000Z');
    for (const m of [
      'sendPreChargeReminder7d',
      'sendPreChargeReminder3d',
      'sendPreChargeReminderToday',
      'sendPaymentReminders',
    ]) {
      await svc[m](ahora);
    }
    expect(selects).toHaveLength(4);
    for (const s of selects) expect(s.manualPayment).toBe(true);
  });
});

describe('las rutas del panel son solo de la plataforma', () => {
  it('GET y PATCH llevan SoloPlataformaGuard', () => {
    for (const m of ['getDatosDePago', 'setDatosDePago']) {
      const guards = Reflect.getMetadata(
        '__guards__',
        (BillingController.prototype as any)[m],
      ) as unknown[];
      expect(guards ?? []).toContain(SoloPlataformaGuard);
    }
  });
});
