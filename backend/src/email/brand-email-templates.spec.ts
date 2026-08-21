import { describe, it, expect } from 'vitest';
import {
  EMAIL_TEMPLATES,
  EMAIL_FOLDER,
  emailTplKey,
  globalEmailTplKey,
  emailEnabledKey,
  globalEmailEnabledKey,
  parseEmailTplValue,
  serializeEmailTplValue,
  resolveEmailTemplate,
  isEmailTemplateEnabled,
  interpolateEmail,
} from './brand-email-templates';

/**
 * Prisma mínimo: solo `setting.findMany` sobre un mapa en memoria. Alcanza
 * para las funciones de resolución, que no tocan nada más.
 */
const settingsOf = (rows: Record<string, string>) => ({
  setting: {
    async findMany({ where }: { where: { key: { in: string[] } } }) {
      return where.key.in
        .filter((k) => k in rows)
        .map((k) => ({ key: k, value: rows[k] }));
    },
  },
});

const tokensIn = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

const WL = 'wl_sellea';

describe('catálogo de correos de marca', () => {
  it('no repite ids', () => {
    const ids = EMAIL_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declara en `vars` todos los tokens que usa', () => {
    for (const t of EMAIL_TEMPLATES) {
      const usados = new Set([
        ...tokensIn(t.subject),
        ...tokensIn(t.default),
      ]);
      const sinDeclarar = [...usados].filter((v) => !t.vars.includes(v));
      expect(sinDeclarar, `${t.id} usa tokens no declarados`).toEqual([]);
    }
  });

  it('solo declara tokens que alguien rellena de verdad al enviar', () => {
    // `vars` es lo que el panel le ofrece a la marca para usar en su texto. Si
    // ahí aparece un token que nadie calcula, la marca lo escribe y al cliente
    // le llega un hueco. Estos son los que existen: los que arma `buildVars`
    // (BrandEmailService) más los que pasan los llamadores por `vars`.
    const RELLENABLES = new Set([
      // buildVars
      'platform',
      'brandName',
      'ownerName',
      'panelUrl',
      'loginEmail',
      'supportEmail',
      'nextChargeDate',
      // extras que pasan los call sites del cron de cobros
      'chargeDate',
      'pauseDate',
      // extras del aviso de compra sin cuenta (PendingActivationService)
      'buyerName',
      'activateUrl',
    ]);
    for (const t of EMAIL_TEMPLATES) {
      const inventados = t.vars.filter((v) => !RELLENABLES.has(v));
      expect(inventados, `${t.id} declara tokens que nadie rellena`).toEqual(
        [],
      );
    }
  });

  it('el token del CTA está declarado', () => {
    for (const t of EMAIL_TEMPLATES) {
      if (!t.cta) continue;
      expect(t.vars, `${t.id} CTA`).toContain(t.cta.urlVar);
    }
  });

  it('todos viven en la carpeta Correos y le hablan a quien corresponde', () => {
    for (const t of EMAIL_TEMPLATES) {
      expect(t.folder, t.id).toBe(EMAIL_FOLDER.id);
      // Casi todos van al dueño del negocio; el aviso de compra sin cuenta va
      // al comprador, que todavía no tiene negocio. Cualquier otra audiencia
      // es un typo que el panel mostraría tal cual.
      expect(['Al negocio', 'Al comprador'], t.id).toContain(t.audience);
    }
  });

  it('no deja escapes `\\n` literales en el texto que ve el cliente', () => {
    // Un `\n` literal en el string se vería tal cual en el correo. Los saltos
    // deben ser saltos de verdad.
    for (const t of EMAIL_TEMPLATES) {
      expect(t.subject, `${t.id} asunto`).not.toContain('\\n');
      expect(t.default, `${t.id} cuerpo`).not.toContain('\\n');
    }
  });

  it('separa párrafos con línea en blanco y nunca deja asunto o cuerpo vacío', () => {
    for (const t of EMAIL_TEMPLATES) {
      expect(t.subject.trim().length, `${t.id} asunto`).toBeGreaterThan(0);
      expect(t.default.trim().length, `${t.id} cuerpo`).toBeGreaterThan(0);
      expect(t.default, `${t.id} párrafos`).toContain('\n\n');
    }
  });
});

describe('claves de Setting', () => {
  it('separa el espacio de la marca del global', () => {
    expect(emailTplKey(WL, 'email_dispute')).toBe(
      'email.wl.wl_sellea.email_dispute',
    );
    expect(globalEmailTplKey('email_dispute')).toBe('email.email_dispute');
    expect(emailEnabledKey(WL, 'email_dispute')).toBe(
      'email.enabled.wl.wl_sellea.email_dispute',
    );
    expect(globalEmailEnabledKey('email_dispute')).toBe(
      'email.enabled.email_dispute',
    );
  });
});

describe('parseEmailTplValue / serializeEmailTplValue', () => {
  it('vacío no es personalización', () => {
    expect(parseEmailTplValue(null)).toEqual({});
    expect(parseEmailTplValue('   ')).toEqual({});
    expect(serializeEmailTplValue({ subject: ' ', body: '' })).toBeNull();
  });

  it('un string suelto se interpreta como cuerpo', () => {
    expect(parseEmailTplValue('hola')).toEqual({ body: 'hola' });
  });

  it('JSON corrupto no pierde el texto que escribió la marca', () => {
    const roto = '{"subject": "sin cerrar';
    expect(parseEmailTplValue(roto)).toEqual({ body: roto });
  });

  it('hace ida y vuelta sin perder partes', () => {
    const raw = serializeEmailTplValue({ subject: 'Asunto', body: 'Cuerpo' });
    expect(parseEmailTplValue(raw)).toEqual({
      subject: 'Asunto',
      body: 'Cuerpo',
    });
  });

  it('guarda solo la parte personalizada', () => {
    const raw = serializeEmailTplValue({ subject: 'Solo asunto', body: '' });
    expect(parseEmailTplValue(raw)).toEqual({ subject: 'Solo asunto' });
  });
});

describe('resolveEmailTemplate — precedencia marca > global > default', () => {
  const ID = 'email_payment_reminder_7d';
  const def = EMAIL_TEMPLATES.find((t) => t.id === ID)!;

  it('sin overrides devuelve el default del catálogo', async () => {
    const r = await resolveEmailTemplate(settingsOf({}), ID, WL);
    expect(r).toEqual({
      subject: def.subject,
      body: def.default,
      source: 'default',
    });
  });

  it('el override global gana al default', async () => {
    const r = await resolveEmailTemplate(
      settingsOf({
        [globalEmailTplKey(ID)]: JSON.stringify({ subject: 'G', body: 'gb' }),
      }),
      ID,
      WL,
    );
    expect(r).toMatchObject({ subject: 'G', body: 'gb', source: 'global' });
  });

  it('el override de la marca gana al global', async () => {
    const r = await resolveEmailTemplate(
      settingsOf({
        [globalEmailTplKey(ID)]: JSON.stringify({ subject: 'G', body: 'gb' }),
        [emailTplKey(WL, ID)]: JSON.stringify({ subject: 'M', body: 'mb' }),
      }),
      ID,
      WL,
    );
    expect(r).toMatchObject({ subject: 'M', body: 'mb', source: 'brand' });
  });

  it('la marca puede tocar solo el asunto y heredar el cuerpo', async () => {
    const r = await resolveEmailTemplate(
      settingsOf({
        [emailTplKey(WL, ID)]: JSON.stringify({ subject: 'Solo asunto' }),
      }),
      ID,
      WL,
    );
    expect(r).toMatchObject({
      subject: 'Solo asunto',
      body: def.default,
      source: 'brand',
    });
  });

  it('un negocio sin marca no lee overrides de ninguna marca', async () => {
    const r = await resolveEmailTemplate(
      settingsOf({
        [emailTplKey(WL, ID)]: JSON.stringify({ subject: 'De Sellea' }),
      }),
      ID,
      null,
    );
    expect(r).toMatchObject({ subject: def.subject, source: 'default' });
  });

  it('id inexistente devuelve null', async () => {
    expect(await resolveEmailTemplate(settingsOf({}), 'nope', WL)).toBeNull();
  });
});

describe('isEmailTemplateEnabled — ON por defecto, apagable de a uno', () => {
  const ID = 'email_dispute';

  it('sin ajustes está encendido', async () => {
    expect(await isEmailTemplateEnabled(settingsOf({}), ID, WL)).toBe(true);
  });

  it('un `false` global lo apaga para todas', async () => {
    const s = settingsOf({ [globalEmailEnabledKey(ID)]: 'false' });
    expect(await isEmailTemplateEnabled(s, ID, WL)).toBe(false);
  });

  it('la marca puede apagarlo solo para ella', async () => {
    const s = settingsOf({ [emailEnabledKey(WL, ID)]: 'false' });
    expect(await isEmailTemplateEnabled(s, ID, WL)).toBe(false);
    expect(await isEmailTemplateEnabled(s, ID, 'otra_marca')).toBe(true);
  });

  it('la marca puede reencenderlo aunque el global esté apagado', async () => {
    const s = settingsOf({
      [globalEmailEnabledKey(ID)]: 'false',
      [emailEnabledKey(WL, ID)]: 'true',
    });
    expect(await isEmailTemplateEnabled(s, ID, WL)).toBe(true);
  });
});

describe('interpolateEmail', () => {
  it('reemplaza tokens y deja vacíos los que no tienen valor', () => {
    expect(interpolateEmail('Hola {a}, van {b}', { a: 'Ana' })).toBe(
      'Hola Ana, van ',
    );
  });

  it('no toca texto sin tokens', () => {
    expect(interpolateEmail('sin tokens', {})).toBe('sin tokens');
  });
});
