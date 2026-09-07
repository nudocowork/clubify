import { describe, it, expect } from 'vitest';
import { BillingService } from './billing.service';

/**
 * El negocio se reactiva solo, 3 días, para ir a pagar.
 *
 * Es una función buscada —lo dice el texto del panel— pero no tenía freno ni
 * dejaba rastro: cada vez que la cuenta volvía a pausarse, otro botón y otros
 * 3 días gratis, sin fin y sin que nadie se enterara. Salió a la luz con
 * Quipao (2026-09-07): apareció en «prueba» estando pausado por no pagar, y
 * en la auditoría no había NADA entre la suspensión de las 03:00 y el cobro
 * de la noche.
 *
 * Estas pruebas fijan las tres reglas: una sola vez por ciclo, con auditoría,
 * y con aviso al equipo.
 */

function servicio(opts: {
  status?: string;
  lastChargeAt?: Date | null;
  reactivacionPrevia?: Date | null;
}) {
  const auditadas: { action: string; tenantId: string | null }[] = [];
  const alertas: { kind: string; brandName: string }[] = [];
  const updates: any[] = [];

  const prisma: any = {
    tenant: {
      findUnique: async () => ({
        id: 't1',
        brandName: 'Quipao Bubble Tea',
        status: opts.status ?? 'SUSPENDED',
        suspendedAt: new Date('2026-09-07T03:00:00Z'),
        trialEndsAt: null,
        lastChargeAt: opts.lastChargeAt ?? null,
      }),
      update: async (args: any) => {
        updates.push(args.data);
        return {};
      },
    },
    auditLog: {
      findFirst: async () =>
        opts.reactivacionPrevia ? { createdAt: opts.reactivacionPrevia } : null,
    },
  };

  const audit: any = {
    log: async (e: any) => {
      auditadas.push({ action: e.action, tenantId: e.tenantId ?? null });
    },
  };
  const prereg: any = { sendInternalAlert: async () => ({ ok: true }) };

  const svc = new BillingService(prisma, {} as any, {} as any, {} as any, audit, prereg);
  // La alerta interna se espía aquí y no en los 3 SMS: lo que importa es que
  // el equipo se entere, no por qué número sale.
  const original = svc.notifyBillingTeam.bind(svc);
  svc.notifyBillingTeam = async (kind: any, brandName: string, o?: any) => {
    alertas.push({ kind, brandName });
    return original(kind, brandName, o);
  };

  return { svc, auditadas, alertas, updates };
}

describe('reactivarse solo para ir a pagar', () => {
  it('la primera vez le da sus 3 días', async () => {
    const { svc, updates } = servicio({});
    const r = await svc.reactivate('t1');
    expect(r.ok).toBe(true);
    expect(updates[0].status).toBe('TRIAL');
    expect(updates[0].suspendedAt).toBeNull();
    const dias =
      (updates[0].trialEndsAt.getTime() - Date.now()) / 86_400_000;
    expect(Math.round(dias)).toBe(3);
  });

  it('deja rastro: se audita', async () => {
    const { svc, auditadas } = servicio({});
    await svc.reactivate('t1');
    expect(auditadas.map((a) => a.action)).toContain(
      'subscription.self_reactivated',
    );
  });

  it('el equipo se entera sin tener que preguntarlo', async () => {
    const { svc, alertas } = servicio({});
    await svc.reactivate('t1');
    expect(alertas[0].kind).toBe('autoreactivado');
    expect(alertas[0].brandName).toBe('Quipao Bubble Tea');
  });

  it('la SEGUNDA vez del mismo ciclo se rechaza', async () => {
    const { svc, updates } = servicio({
      reactivacionPrevia: new Date('2026-09-07T10:51:00Z'),
    });
    await expect(svc.reactivate('t1')).rejects.toThrow(/completa/i);
    expect(updates).toHaveLength(0);
  });

  it('si pagó después de la reactivación previa, vuelve a tener una', async () => {
    // El `where` del findFirst filtra por createdAt > lastChargeAt, así que
    // una reactivación anterior al cobro ya no cuenta: aquí el falso devuelve
    // null igual que lo haría la base.
    const { svc, updates } = servicio({
      lastChargeAt: new Date('2026-09-07T21:48:00Z'),
      reactivacionPrevia: null,
    });
    await svc.reactivate('t1');
    expect(updates[0].status).toBe('TRIAL');
  });

  it('no se reactiva lo que no está pausado', async () => {
    const { svc, updates } = servicio({ status: 'ACTIVE' });
    await expect(svc.reactivate('t1')).rejects.toThrow(/no está suspendida/i);
    expect(updates).toHaveLength(0);
  });
});
