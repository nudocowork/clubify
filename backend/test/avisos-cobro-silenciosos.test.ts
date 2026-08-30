import { describe, it, expect, vi } from 'vitest';
import { BillingService } from '../src/billing/billing.service';

/**
 * Por qué NO se envió el SMS de cobro.
 *
 * `resolveBillingTarget` devolvía null por cuatro motivos distintos y los tres
 * `notifyOwner` (Hotmart, Stripe, Cross) hacen `if (!target) return;` sin log.
 * Un negocio con los avisos ENCENDIDOS pero mal configurado no recibía nada y no
 * quedaba rastro de por qué — la falla silenciosa clásica de este proyecto.
 *
 * La distinción que importa: apagar los avisos es una DECISIÓN del negocio y no
 * debe generar ruido; no tener por dónde o a quién enviar es un PROBLEMA y sí.
 */
function make(tenant: any, opts: { cuenta?: any; telefonoDueno?: string | null } = {}) {
  const prisma = {
    tenant: { findUnique: vi.fn().mockResolvedValue(tenant) },
    growBusinessAccount: { findFirst: vi.fn().mockResolvedValue(opts.cuenta ?? null) },
  };
  const svc = Object.create(BillingService.prototype) as BillingService;
  (svc as any).prisma = prisma;
  (svc as any).ownerPhone = vi.fn().mockResolvedValue(opts.telefonoDueno ?? null);
  const warn = vi.fn();
  (svc as any).logger = { warn, log: vi.fn(), error: vi.fn() };
  return { svc, warn };
}

const CON_CREDS = {
  id: 't1', billingAlertsEnabled: true, billingAlertsPhone: null,
  billingAlertsAccountId: null,
  growBusinessLocationId: 'loc', growBusinessApiKey: 'key', growBusinessSwitchNumber: null,
  whiteLabel: null,
};

describe('resolveBillingTarget — por qué no se envía', () => {
  it('avisos apagados: devuelve null EN SILENCIO (es una decisión, no un fallo)', async () => {
    const { svc, warn } = make({ ...CON_CREDS, billingAlertsEnabled: false });
    await expect(svc.resolveBillingTarget('t1')).resolves.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('tenant inexistente: también en silencio', async () => {
    const { svc, warn } = make(null);
    await expect(svc.resolveBillingTarget('t1')).resolves.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('sin POR DÓNDE enviar: avisa que falta la subcuenta', async () => {
    const { svc, warn } = make({
      ...CON_CREDS, growBusinessLocationId: null, growBusinessApiKey: null,
    });
    await expect(svc.resolveBillingTarget('t1')).resolves.toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/no.*hay por d[oó]nde enviar/i);
  });

  it('sin A QUIÉN enviar: avisa que falta el teléfono', async () => {
    const { svc, warn } = make(CON_CREDS, { telefonoDueno: null });
    await expect(svc.resolveBillingTarget('t1')).resolves.toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/no A QUI[EÉ]N/i);
  });

  it('el aviso nombra al tenant, o no sirve para investigar', async () => {
    const { svc, warn } = make(CON_CREDS, { telefonoDueno: null });
    await svc.resolveBillingTarget('tenant-abc');
    expect(warn.mock.calls[0][0]).toContain('tenant-abc');
  });

  it('bien configurado: devuelve destino y NO avisa nada', async () => {
    const { svc, warn } = make(CON_CREDS, { telefonoDueno: '+573001112233' });
    await expect(svc.resolveBillingTarget('t1')).resolves.toMatchObject({
      phone: '+573001112233',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('el teléfono explícito de avisos gana sobre el del dueño', async () => {
    const { svc } = make(
      { ...CON_CREDS, billingAlertsPhone: '  +573009998877 ' },
      { telefonoDueno: '+573001112233' },
    );
    await expect(svc.resolveBillingTarget('t1')).resolves.toMatchObject({
      phone: '+573009998877',
    });
  });
});
