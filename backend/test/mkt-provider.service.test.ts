import { describe, expect, it, vi } from 'vitest';

// Creds de marca fijas (evita depender de secret-box en el test).
vi.mock('../src/integrations/brand-sms-creds.util', () => ({
  BRAND_GROW_SELECT: {},
  brandGrowCreds: (wl: any) => (wl ? { locationId: 'loc', apiKey: 'key', switchNumber: null } : null),
}));

import { MktProviderService } from '../src/marketing/provider/mkt-provider.service';

function make(opts: { brand?: any; emailRes?: any; smsRes?: any }) {
  const grow = {
    sendEmailWithCreds: vi.fn(async () => opts.emailRes ?? { ok: true, id: 'mid', contactId: 'cid' }),
    sendSmsWithCreds: vi.fn(async () => opts.smsRes ?? { ok: true, id: 'sid' }),
  };
  const prisma = {
    // 'brand' in opts distingue "sin marca" (brand:null) de "no especificado" ({}).
    whiteLabel: { findUnique: vi.fn(async () => ('brand' in opts ? opts.brand : {})) },
  };
  const svc = new MktProviderService(prisma as any, grow as any);
  return { svc, grow, prisma };
}

describe('MktProviderService — validación previa (no gasta al proveedor)', () => {
  it('cuerpo vacío → skipped SIN llamar al proveedor', async () => {
    const { svc, grow } = make({});
    const r = await svc.sendEmail({ whiteLabelId: 'b', toEmail: 'a@b.com', subject: '', html: '' });
    expect(r.skipped).toBe(true);
    expect(grow.sendEmailWithCreds).not.toHaveBeenCalled();
  });

  it('sin destinatario → skipped sin llamar al proveedor', async () => {
    const { svc, grow } = make({});
    const r = await svc.sendEmail({ whiteLabelId: 'b', toEmail: 'no-arroba', subject: 'x', html: 'y' });
    expect(r.skipped).toBe(true);
    expect(grow.sendEmailWithCreds).not.toHaveBeenCalled();
  });

  it('marca sin subcuenta → skipped sin llamar al proveedor', async () => {
    const { svc, grow } = make({ brand: null }); // brandGrowCreds(null) → null
    const r = await svc.sendEmail({ whiteLabelId: 'b', toEmail: 'a@b.com', subject: 'x', html: 'y' });
    expect(r.skipped).toBe(true);
    expect(grow.sendEmailWithCreds).not.toHaveBeenCalled();
  });

  it('envío válido → llama al proveedor y mapea messageId + contactId', async () => {
    const { svc, grow } = make({ emailRes: { ok: true, id: 'mid-9', contactId: 'cid-9' } });
    const r = await svc.sendEmail({ whiteLabelId: 'b', toEmail: 'a@b.com', subject: 'Hola', html: '<p>x</p>' });
    expect(grow.sendEmailWithCreds).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(true);
    expect(r.messageId).toBe('mid-9');
    expect(r.contactId).toBe('cid-9');
  });

  it('proveedor falla → ok:false (no skipped) para que reintente', async () => {
    const { svc } = make({ emailRes: { ok: false, message: 'boom' } });
    const r = await svc.sendEmail({ whiteLabelId: 'b', toEmail: 'a@b.com', subject: 'Hola', html: '<p>x</p>' });
    expect(r.ok).toBe(false);
    expect(r.skipped).toBeFalsy();
    expect(r.error).toBe('boom');
  });
});
