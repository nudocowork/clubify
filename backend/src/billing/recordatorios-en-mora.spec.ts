import { describe, it, expect } from 'vitest';
import { BillingService } from './billing.service';

/**
 * Dos fallos de los avisos de cobro que salieron en el arqueo del 2026-09-17.
 *
 * 1. A quien YA está en mora le llegaban también los recordatorios de «pronto
 *    renovamos». La burguesía: el cobro falló el 12-09 y después recibió «en 3
 *    días» (13-09), «mañana» (15-09) y «hoy se procesa» (16-09), intercalados
 *    con «tu pago no se procesó» y «tu cuenta se pausa el 18». Café Macondo, en
 *    la misma pasada, «en 7 días se renueva» y «tu pago sigue pendiente». Los
 *    cuatro recordatorios previos no miraban `failedPaymentCount`.
 *
 * 2. Un `whatsappPhone = ''` tapaba el `phone` bueno: `'' ?? phone` es `''`.
 *    Hydor Coffee House, Dolce vita, Cocoa Beauty Studio y La Gloriosa no
 *    recibían ni un SMS de cobro, solo el correo.
 */

function servicioQueCaptura() {
  const consultas: any[] = [];
  const prisma: any = {
    tenant: {
      findMany: async (args: any) => {
        consultas.push(args.where);
        return [];
      },
    },
  };
  const svc = new BillingService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
  return { svc: svc as any, consultas };
}

describe('los recordatorios previos al cobro no le llegan a quien ya está en mora', () => {
  const ahora = new Date('2026-09-17T03:00:00.000Z');

  for (const metodo of [
    'sendPreChargeReminder7d',
    'sendPreChargeReminder3d',
    'sendPreChargeReminderToday',
    'sendPaymentReminders',
  ]) {
    it(`${metodo} deja fuera a los negocios con un cobro fallido`, async () => {
      const { svc, consultas } = servicioQueCaptura();
      await svc[metodo](ahora);
      expect(consultas).toHaveLength(1);
      expect(consultas[0].failedPaymentCount).toBe(0);
    });
  }
});

describe('el teléfono de cobros salta los campos vacíos', () => {
  function servicio(dueno: string | null, tenant: { whatsappPhone: string | null; phone: string | null }) {
    const prisma: any = {
      user: { findFirst: async () => (dueno === undefined ? null : { phone: dueno }) },
      tenant: { findUnique: async () => tenant },
    };
    return new BillingService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any) as any;
  }

  it('whatsappPhone vacío → usa el phone del negocio (caso Hydor)', async () => {
    const svc = servicio(null, { whatsappPhone: '', phone: '+507 5071234297' });
    expect(await svc.ownerPhone('t1')).toBe('+507 5071234297');
  });

  it('whatsappPhone con solo espacios también se salta', async () => {
    const svc = servicio(null, { whatsappPhone: '   ', phone: '+57 3201234946' });
    expect(await svc.ownerPhone('t1')).toBe('+57 3201234946');
  });

  it('el móvil del dueño sigue ganando', async () => {
    const svc = servicio('+57 3161234313', { whatsappPhone: '+57 1', phone: '+57 2' });
    expect(await svc.ownerPhone('t1')).toBe('+57 3161234313');
  });

  it('sin ningún número → null, no una cadena vacía', async () => {
    const svc = servicio('', { whatsappPhone: '', phone: '' });
    expect(await svc.ownerPhone('t1')).toBeNull();
  });
});
