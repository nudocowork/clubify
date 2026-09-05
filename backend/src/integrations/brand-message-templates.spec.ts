import { describe, it, expect } from 'vitest';
import type { PrismaService } from '../common/prisma/prisma.service';
import {
  brandMsgCatalog,
  brandMsgTplKey,
  globalMsgTplKey,
  brandMsgEnabledKey,
  globalMsgEnabledKey,
  isBrandTemplateSendEnabled,
  resolveBrandTemplateText,
} from './brand-message-templates';
import { EMAIL_TEMPLATES } from '../email/brand-email-templates';

const settingsOf = (rows: Record<string, string>) =>
  ({
    setting: {
      async findMany({ where }: { where: { key: { in: string[] } } }) {
        return where.key.in
          .filter((k) => k in rows)
          .map((k) => ({ key: k, value: rows[k] }));
      },
    },
  }) as unknown as Pick<PrismaService, 'setting'>;

const WL = 'wl_sellea';

/**
 * CONTRATO: toda automatización de cobro o administrativa que le manda mensaje
 * al negocio tiene que tener su gemelo por CORREO. Si alguien agrega una
 * automatización nueva a esas carpetas sin su correo, este test falla — que es
 * exactamente lo que queremos que pase.
 *
 * Las de la carpeta `operativa` (reservas, delivery, reseñas) quedan fuera a
 * propósito: son alertas de operación al teléfono del negocio, no del ciclo de
 * vida de la suscripción.
 */
const GEMELO_POR_CORREO: Record<string, string> = {
  // Cobros y recordatorios
  payment_reminder_7d: 'email_payment_reminder_7d',
  payment_reminder_3d: 'email_payment_reminder_3d',
  payment_reminder_tomorrow: 'email_payment_reminder_tomorrow',
  payment_due_today: 'email_payment_due_today',
  payment_overdue_reminder: 'email_payment_overdue',
  payment_not_processed_2d: 'email_account_will_pause',
  account_will_pause: 'email_account_will_pause',
  account_paused: 'email_account_paused',
  account_reactivated: 'email_account_reactivated',
  // Administrativas
  trial_started: 'email_trial_started',
  payment_confirmed: 'email_payment_confirmed',
  payment_failed: 'email_payment_failed',
  admin_protest: 'email_dispute',
  admin_refunded: 'email_refunded',
  admin_chargeback: 'email_chargeback',
  admin_cancellation: 'email_cancellation',
  admin_charge_date_moved: 'email_charge_date_moved',
};

const CARPETAS_CON_CORREO = ['cobros', 'administrativa'];

describe('cobertura de canal: todo aviso al negocio también sale por correo', () => {
  const catalogo = brandMsgCatalog();
  const idsCorreo = new Set(EMAIL_TEMPLATES.map((t) => t.id));

  it('cada automatización de cobros/administrativa tiene gemelo por correo', () => {
    const sinGemelo = catalogo
      .filter(
        (t) => t.channel !== 'EMAIL' && CARPETAS_CON_CORREO.includes(t.folder),
      )
      .map((t) => t.id)
      .filter((id) => !GEMELO_POR_CORREO[id]);
    expect(sinGemelo, 'automatizaciones sin correo gemelo').toEqual([]);
  });

  it('todos los gemelos declarados existen en el catálogo de correos', () => {
    const fantasmas = Object.values(GEMELO_POR_CORREO).filter(
      (id) => !idsCorreo.has(id),
    );
    expect(fantasmas, 'gemelos que apuntan a un correo inexistente').toEqual([]);
  });

  it('el mapa no declara automatizaciones que ya no existen', () => {
    const ids = new Set(catalogo.map((t) => t.id));
    const huerfanos = Object.keys(GEMELO_POR_CORREO).filter(
      (id) => !ids.has(id),
    );
    expect(huerfanos).toEqual([]);
  });

  it('el catálogo del panel incluye los correos como canal EMAIL', () => {
    const correosEnCatalogo = catalogo.filter((t) => t.channel === 'EMAIL');
    expect(correosEnCatalogo).toHaveLength(EMAIL_TEMPLATES.length);
    for (const t of correosEnCatalogo) {
      // Los correos no se "activan": vienen ON y su gate es la conexión.
      expect(t.status, t.id).toBe('active');
    }
  });
});

describe('claves: correos y SMS no comparten espacio de nombres', () => {
  it('un id de correo va al espacio email.*', () => {
    expect(brandMsgTplKey(WL, 'email_dispute')).toBe(
      'email.wl.wl_sellea.email_dispute',
    );
    expect(globalMsgTplKey('email_dispute')).toBe('email.email_dispute');
    expect(brandMsgEnabledKey(WL, 'email_dispute')).toBe(
      'email.enabled.wl.wl_sellea.email_dispute',
    );
    expect(globalMsgEnabledKey('email_dispute')).toBe(
      'email.enabled.email_dispute',
    );
  });

  it('un id de SMS va al espacio sms.*', () => {
    expect(brandMsgTplKey(WL, 'admin_refunded')).toBe(
      'sms.wl.wl_sellea.admin_refunded',
    );
    expect(globalMsgTplKey('admin_refunded')).toBe('sms.admin_refunded');
    expect(brandMsgEnabledKey(WL, 'admin_refunded')).toBe(
      'sms.enabled.wl.wl_sellea.admin_refunded',
    );
  });
});

describe('isBrandTemplateSendEnabled', () => {
  it('las plantillas activas envían siempre', async () => {
    expect(
      await isBrandTemplateSendEnabled(settingsOf({}), 'payment_confirmed', WL),
    ).toBe(true);
  });

  it('las administrativas (admin_*) están apagadas hasta que la marca las prenda', async () => {
    expect(
      await isBrandTemplateSendEnabled(settingsOf({}), 'admin_refunded', WL),
    ).toBe(false);
    const prendida = settingsOf({
      [brandMsgEnabledKey(WL, 'admin_refunded')]: 'true',
    });
    expect(
      await isBrandTemplateSendEnabled(prendida, 'admin_refunded', WL),
    ).toBe(true);
    // Prenderla en una marca no la prende en otra.
    expect(
      await isBrandTemplateSendEnabled(prendida, 'admin_refunded', 'otra'),
    ).toBe(false);
  });

  it('los correos vienen encendidos — su gate real es la conexión de email', async () => {
    for (const t of EMAIL_TEMPLATES) {
      expect(
        await isBrandTemplateSendEnabled(settingsOf({}), t.id, WL),
        t.id,
      ).toBe(true);
    }
  });

  it('un id inexistente no envía', async () => {
    expect(await isBrandTemplateSendEnabled(settingsOf({}), 'nope', WL)).toBe(
      false,
    );
  });
});

describe('resolveBrandTemplateText', () => {
  it('de un correo devuelve solo el CUERPO, no el JSON guardado', async () => {
    const s = settingsOf({
      [brandMsgTplKey(WL, 'email_dispute')]: JSON.stringify({
        subject: 'Asunto de la marca',
        body: 'Cuerpo de la marca',
      }),
    });
    expect(await resolveBrandTemplateText(s, 'email_dispute', WL)).toBe(
      'Cuerpo de la marca',
    );
  });

  it('respeta marca > global > default en SMS', async () => {
    const def = brandMsgCatalog().find((t) => t.id === 'admin_refunded')!;
    expect(
      await resolveBrandTemplateText(settingsOf({}), 'admin_refunded', WL),
    ).toBe(def.default);
    expect(
      await resolveBrandTemplateText(
        settingsOf({ [globalMsgTplKey('admin_refunded')]: 'texto global' }),
        'admin_refunded',
        WL,
      ),
    ).toBe('texto global');
    expect(
      await resolveBrandTemplateText(
        settingsOf({
          [globalMsgTplKey('admin_refunded')]: 'texto global',
          [brandMsgTplKey(WL, 'admin_refunded')]: 'texto de marca',
        }),
        'admin_refunded',
        WL,
      ),
    ).toBe('texto de marca');
  });
});
