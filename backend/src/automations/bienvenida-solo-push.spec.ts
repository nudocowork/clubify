import { describe, it, expect, vi } from 'vitest';
import { AutomationsService } from './automations.service';

/**
 * La bienvenida a la tarjeta (PASS_CREATED) sale SOLO por push.
 *
 * Javier, 2026-11-09: a un cliente de Exentrix le llegó un SMS de bienvenida a
 * la tarjeta. Una regla del negocio puede llevar «Enviar SMS»; sin línea propia
 * sale por la de la MARCA. El motor la descarta pase lo que pase en el panel.
 */
function montar() {
  const sms = vi.fn(async () => ({}));
  const whatsapp = vi.fn(async () => ({}));
  const encolados = vi.fn(async () => ({}));
  const prisma: any = {
    automationRule: {
      findMany: async () => [
        {
          id: 'r1',
          trigger: { type: 'PASS_CREATED' },
          conditions: [],
          actions: [
            { type: 'SEND_SMS', body: 'Bienvenido a tu tarjeta' },
            { type: 'SEND_WHATSAPP', body: 'Bienvenido' },
            { type: 'SEND_WHATSAPP_LINK', body: 'Bienvenido' },
          ],
          stats: {},
        },
      ],
      update: async () => ({}),
    },
    automationRun: { create: async () => ({}) },
    automationRunLog: { create: async () => ({}) },
    automationWorkflow: { findMany: async () => [] },
    customer: { findUnique: async () => ({ phone: '+573001112233' }) },
    tenant: {
      findUnique: async () => ({
        growBusinessLocationId: 'loc',
        growBusinessApiKey: 'k',
        growBusinessSwitchNumber: null,
        whiteLabel: null,
      }),
    },
  };
  const svc = new AutomationsService(
    prisma,
    { enqueueMessage: encolados } as any,
    {} as any,
    { sendSmsWithCreds: sms, sendWhatsAppWithCreds: whatsapp } as any,
  );
  (svc as any).logRun = async () => undefined;
  return { svc, sms, whatsapp, encolados };
}

describe('bienvenida a la tarjeta: solo push', () => {
  it('una regla de PASS_CREATED con SMS o WhatsApp no envía nada por esos canales', async () => {
    const m = montar();
    await m.svc.emit('PASS_CREATED' as any, { tenantId: 't1', customerId: 'c1' });
    expect(m.sms).not.toHaveBeenCalled();
    expect(m.whatsapp).not.toHaveBeenCalled();
    expect(m.encolados).not.toHaveBeenCalled();
  });

  it('LA PRUEBA SABE PONERSE EN ROJO: fuera de la bienvenida el SMS sí sale', async () => {
    const m = montar();
    await (m.svc as any).executeAction(
      { type: 'SEND_SMS', body: 'Hola' },
      { tenantId: 't1', customerId: 'c1' },
      'r1',
    );
    expect(m.sms).toHaveBeenCalledTimes(1);
  });
});
