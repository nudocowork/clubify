import { describe, it, expect } from 'vitest';
import { SmsTemplatesService } from './sms-templates.service';
import {
  brandMsgEnabledKey,
  brandMsgTplKey,
  resolveBrandTemplate,
} from '../integrations/brand-message-templates';

/**
 * APAGAR UN MENSAJE TIENE QUE APAGARLO DE VERDAD.
 *
 * El 2026-09-23 Javier reportó que apagar un mensaje automático no servía de
 * nada. El primer arreglo tocó el candado, pero el candado NO lo miraba nadie:
 * los mensajes de cobro salen por `SmsTemplatesService.render` y los
 * operativos (reservas, pedidos, reseñas) por `resolveBrandTemplate`, y
 * ninguno preguntaba si la marca lo había apagado.
 *
 * Estas pruebas cubren el camino de verdad: una plantilla apagada devuelve
 * texto VACÍO, y un texto vacío no se envía (lo corta `sendSmsWithCreds`).
 */

const SELLEA = 'wl-sellea';
const NEGOCIO = 't-sellea';

function prismaFalso(ajustes: Record<string, string>) {
  return {
    setting: {
      async findUnique({ where }: { where: { key: string } }) {
        const value = ajustes[where.key];
        return value === undefined ? null : { key: where.key, value };
      },
      async findMany({ where }: { where: { key: { in: string[] } } }) {
        return where.key.in
          .filter((k) => k in ajustes)
          .map((k) => ({ key: k, value: ajustes[k] }));
      },
    },
    whiteLabel: {
      async findFirst() {
        return { id: 'wl-clubify' };
      },
    },
    tenant: {
      async findUnique() {
        return { whiteLabel: { id: SELLEA, name: 'Sellea' } };
      },
    },
  } as any;
}

describe('un mensaje de cobro apagado por la marca', () => {
  it('no trae texto, así que no se envía', async () => {
    const svc = new SmsTemplatesService(
      prismaFalso({
        [brandMsgEnabledKey(SELLEA, 'payment_reminder_7d')]: 'false',
      }),
    );
    expect(await svc.render('payment_reminder_7d', {}, NEGOCIO)).toBe('');
  });

  it('mientras nadie lo apague, sale como siempre', async () => {
    const svc = new SmsTemplatesService(prismaFalso({}));
    const texto = await svc.render('payment_reminder_7d', { ownerName: 'Ana' }, NEGOCIO);
    expect(texto.length).toBeGreaterThan(0);
    expect(texto).toContain('Sellea');
  });

  it('el texto propio de la marca se respeta… hasta que la apagan', async () => {
    const conTexto = {
      [brandMsgTplKey(SELLEA, 'payment_reminder_7d')]: 'Hola {ownerName}, te cobramos pronto.',
    };
    const encendida = new SmsTemplatesService(prismaFalso(conTexto));
    expect(await encendida.render('payment_reminder_7d', { ownerName: 'Ana' }, NEGOCIO)).toBe(
      'Hola Ana, te cobramos pronto.',
    );
    const apagada = new SmsTemplatesService(
      prismaFalso({
        ...conTexto,
        [brandMsgEnabledKey(SELLEA, 'payment_reminder_7d')]: 'false',
      }),
    );
    expect(await apagada.render('payment_reminder_7d', { ownerName: 'Ana' }, NEGOCIO)).toBe('');
  });
});

describe('un mensaje operativo apagado por la marca', () => {
  it('tampoco trae texto', async () => {
    const id = 'op_reservation_new';
    const apagado = prismaFalso({ [brandMsgEnabledKey(SELLEA, id)]: 'false' });
    expect(
      await resolveBrandTemplate(apagado, { id, whiteLabelId: SELLEA, vars: {} }),
    ).toBe('');
  });
});
