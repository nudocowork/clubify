import { describe, it, expect, vi, afterEach } from 'vitest';
import { GrowBusinessService } from './grow-business.service';

/**
 * `sendSmsWithCreds` acepta adjuntos (la imagen con las cuentas de pago que
 * acompaña a los recordatorios de cobro manual) y los pasa a GHL como
 * `attachments`. Los llamadores de siempre no mandan adjuntos y su payload no
 * puede cambiar.
 */

const CREDS = { locationId: 'loc-1', apiKey: 'k', switchNumber: null };

function montar() {
  const prisma: any = {
    setting: { findUnique: async () => null },
    tenant: { findUnique: async () => ({ whiteLabelId: null }) },
    messageLog: { create: vi.fn(async () => null) },
  };
  const cuerpos: any[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: any) => {
      if (String(url).includes('/contacts/upsert')) {
        return new Response(JSON.stringify({ contact: { id: 'c1' } }), { status: 200 });
      }
      cuerpos.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ messageId: 'm1' }), { status: 200 });
    }),
  );
  return { svc: new GrowBusinessService(prisma), cuerpos };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SMS con adjuntos', () => {
  it('manda la imagen como attachments en el POST de conversaciones', async () => {
    const { svc, cuerpos } = montar();
    const r = await svc.sendSmsWithCreds(
      CREDS,
      '+573001112233',
      'Estos son nuestros datos',
      { tenantId: 't1' },
      { attachments: ['https://app.soyclubify.com/cobros/metodos-de-pago-clubify.jpg'] },
    );
    expect(r.ok).toBe(true);
    expect(cuerpos).toHaveLength(1);
    expect(cuerpos[0].type).toBe('SMS');
    expect(cuerpos[0].contactId).toBe('c1');
    expect(cuerpos[0].attachments).toEqual([
      'https://app.soyclubify.com/cobros/metodos-de-pago-clubify.jpg',
    ]);
  });

  it('sin adjuntos el payload no lleva la clave (llamadores de siempre)', async () => {
    const { svc, cuerpos } = montar();
    await svc.sendSmsWithCreds(CREDS, '+573001112233', 'Hola', { tenantId: 't1' });
    expect(cuerpos).toHaveLength(1);
    expect('attachments' in cuerpos[0]).toBe(false);
  });

  it('descarta adjuntos que no son https', async () => {
    const { svc, cuerpos } = montar();
    await svc.sendSmsWithCreds(CREDS, '+573001112233', 'Hola', undefined, {
      attachments: ['http://x.com/a.jpg', 'data:image/png;base64,AA'],
    });
    expect('attachments' in cuerpos[0]).toBe(false);
  });
});
