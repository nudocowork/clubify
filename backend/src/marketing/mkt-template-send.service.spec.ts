import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { MktProviderService } from './provider/mkt-provider.service';
import { MktTemplateSendService, MAX_SEND_PER_CALL } from './mkt-template-send.service';

// ── Envío de plantilla a contactos: reglas que no se negocian ───────────────
//   · optOut se respeta SIEMPRE: el contacto de baja se omite (no es error),
//   · el tope por llamada existe porque un envío masivo no se puede deshacer,
//   · un contactId de otra marca no manda nada (aislamiento), y
//   · cada envío lleva el contexto para MessageLog (feature plantilla-correo).

type TplRow = {
  id: string;
  whiteLabelId: string;
  name: string;
  subject: string | null;
  html: string | null;
  isPreset: boolean;
};
type ContactRow = {
  id: string;
  whiteLabelId: string;
  name: string | null;
  email: string | null;
  optOut: boolean;
  deleted: boolean;
};

type Where = Record<string, unknown>;
const matches = (row: Record<string, unknown>, where: Where): boolean =>
  Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Where[]).some((w) => matches(row, w));
    return row[k] === v;
  });

function fakePrisma(state: { tpls: TplRow[]; contacts: ContactRow[] }) {
  return {
    mktEmailTemplate: {
      findFirst: async ({ where }: { where: Where }) => state.tpls.find((t) => matches(t, where)) ?? null,
    },
    mktContact: {
      findFirst: async ({ where }: { where: Where }) =>
        state.contacts.find((c) => matches(c, where)) ?? null,
    },
  } as unknown as PrismaService;
}

type SentCall = { toEmail: string; subject: string; html: string; ctx?: Record<string, unknown> };

function fakeProvider(behavior?: (input: SentCall) => { ok: boolean; skipped?: boolean; error?: string }) {
  const calls: SentCall[] = [];
  const provider = {
    sendEmail: async (input: SentCall) => {
      calls.push(input);
      return behavior ? behavior(input) : { ok: true, messageId: `m${calls.length}` };
    },
  } as unknown as MktProviderService;
  return { provider, calls };
}

const WL = 'wl_sellea';
const OTRA = 'wl_otra';

const TPL: TplRow = {
  id: 'tpl1',
  whiteLabelId: WL,
  name: 'Promo agosto',
  subject: 'Oferta del mes',
  html: '<p>Hola</p>',
  isPreset: false,
};

describe('MktTemplateSendService', () => {
  let state: { tpls: TplRow[]; contacts: ContactRow[] };

  beforeEach(() => {
    state = {
      tpls: [{ ...TPL }],
      contacts: [
        { id: 'c1', whiteLabelId: WL, name: 'Ana', email: 'ana@ejemplo.com', optOut: false, deleted: false },
        { id: 'c2', whiteLabelId: WL, name: 'Beto', email: 'beto@ejemplo.com', optOut: true, deleted: false },
        { id: 'c3', whiteLabelId: WL, name: 'Caro', email: null, optOut: false, deleted: false },
        { id: 'c4', whiteLabelId: OTRA, name: 'Dora', email: 'dora@ejemplo.com', optOut: false, deleted: false },
        { id: 'c5', whiteLabelId: WL, name: 'Eli', email: 'eli@ejemplo.com', optOut: false, deleted: true },
      ],
    };
  });

  it('envía a los aptos y omite optOut, sin correo, borrados y de otra marca — cada uno con su motivo', async () => {
    const { provider, calls } = fakeProvider();
    const svc = new MktTemplateSendService(fakePrisma(state), provider);
    const res = await svc.sendToContacts(WL, 'tpl1', 'Asunto', ['c1', 'c2', 'c3', 'c4', 'c5']);
    expect(res.sent).toBe(1);
    expect(res.failed).toHaveLength(0);
    expect(res.skipped).toHaveLength(4);
    const motivo = (id: string) => res.skipped.find((s) => s.contactId === id)?.reason ?? '';
    expect(motivo('c2')).toMatch(/baja/i); // optOut: omitido, no error
    expect(motivo('c3')).toMatch(/correo/i);
    expect(motivo('c4')).toMatch(/no encontrado/i); // otra marca = invisible
    expect(motivo('c5')).toMatch(/no encontrado/i); // borrado = invisible
    // Al proveedor solo llegó la apta: al de baja no se le llama NUNCA.
    expect(calls.map((c) => c.toEmail)).toEqual(['ana@ejemplo.com']);
  });

  it('pasa el contexto del historial: whiteLabelId, feature plantilla-correo y el id de la plantilla', async () => {
    const { provider, calls } = fakeProvider();
    const svc = new MktTemplateSendService(fakePrisma(state), provider);
    await svc.sendToContacts(WL, 'tpl1', 'Asunto', ['c1']);
    expect(calls[0].ctx).toMatchObject({
      whiteLabelId: WL,
      feature: 'plantilla-correo',
      templateId: 'tpl1',
    });
  });

  it('respeta el tope por llamada y deduplica ids repetidos', async () => {
    const { provider, calls } = fakeProvider();
    const svc = new MktTemplateSendService(fakePrisma(state), provider);
    const tooMany = Array.from({ length: MAX_SEND_PER_CALL + 1 }, (_, i) => `c${i}`);
    await expect(svc.sendToContacts(WL, 'tpl1', 'Asunto', tooMany)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(calls).toHaveLength(0);
    // Repetir el mismo id no manda dos correos.
    const res = await svc.sendToContacts(WL, 'tpl1', 'Asunto', ['c1', 'c1', 'c1']);
    expect(res.requested).toBe(1);
    expect(res.sent).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it('un fallo del proveedor cuenta como failed pero no frena a los demás', async () => {
    state.contacts.push({
      id: 'c6',
      whiteLabelId: WL,
      name: 'Fede',
      email: 'fede@ejemplo.com',
      optOut: false,
      deleted: false,
    });
    const { provider, calls } = fakeProvider((input) =>
      input.toEmail === 'ana@ejemplo.com' ? { ok: false, error: 'boom' } : { ok: true },
    );
    const svc = new MktTemplateSendService(fakePrisma(state), provider);
    const res = await svc.sendToContacts(WL, 'tpl1', 'Asunto', ['c1', 'c6']);
    expect(res.sent).toBe(1);
    expect(res.failed).toEqual([{ contactId: 'c1', error: 'boom' }]);
    expect(calls).toHaveLength(2);
  });

  it('la plantilla tiene que ser visible para la marca (propia o de fábrica)', async () => {
    const { provider } = fakeProvider();
    state.tpls.push({ ...TPL, id: 'ajena', whiteLabelId: OTRA });
    const svc = new MktTemplateSendService(fakePrisma(state), provider);
    await expect(svc.sendToContacts(WL, 'ajena', 'Asunto', ['c1'])).rejects.toBeInstanceOf(
      NotFoundException,
    );
    state.tpls.push({ ...TPL, id: 'fabrica', whiteLabelId: OTRA, isPreset: true });
    const res = await svc.sendToContacts(WL, 'fabrica', 'Asunto', ['c1']);
    expect(res.sent).toBe(1);
  });

  it('sin HTML guardado no hay envío: se pide pasar por el editor', async () => {
    const { provider, calls } = fakeProvider();
    state.tpls[0].html = null;
    const svc = new MktTemplateSendService(fakePrisma(state), provider);
    await expect(svc.sendToContacts(WL, 'tpl1', 'Asunto', ['c1'])).rejects.toThrow(/editor/);
    expect(calls).toHaveLength(0);
  });

  it('sin asunto en el body usa el de la plantilla', async () => {
    const { provider, calls } = fakeProvider();
    const svc = new MktTemplateSendService(fakePrisma(state), provider);
    await svc.sendToContacts(WL, 'tpl1', '   ', ['c1']);
    expect(calls[0].subject).toBe('Oferta del mes');
  });
});
