import { describe, it, expect, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { ReferralsService } from './referrals.service';

/**
 * Quién puede sacar un código en el formulario público `/refer`.
 *
 * El caso que lo motivó (2026-09-24): Fernando, dueño de un negocio y cliente
 * desde junio, quiso recomendar Clubify y le salió «Este correo ya se encuentra
 * registrado». No era un duplicado — no tenía ningún código — sino la protección
 * contra un robo de cuenta: el alta de afiliado REASIGNA la contraseña, y si el
 * correo ya era de un dueño de negocio le pisaba la suya en silencio.
 *
 * La protección se queda. Lo que cambia es que a quien ya tiene cuenta y NO es
 * afiliado se le crea el código sin tocarle nada, y entra con su contraseña de
 * siempre. En producción había 77 códigos cuyo correo ya existía como usuario:
 * la pareja «cliente que además refiere» es lo normal, no la excepción.
 */

const DUENO = { id: 'u-dueno', role: 'TENANT_OWNER' };
const AFILIADO = { id: 'u-afiliado', role: 'AFFILIATE_INFLUENCER' };

function montar(opts: { usuario?: { id: string; role: string } | null; codigo?: unknown } = {}) {
  const inviteAffiliate = vi.fn(async () => ({ password: 'nueva' }));
  const prisma: any = {
    referralCode: {
      findFirst: async () => opts.codigo ?? null,
      findUnique: async () => null,
      create: async ({ data }: any) => ({ id: 'rc1', ...data }),
    },
    user: { findUnique: async () => opts.usuario ?? null },
    whiteLabel: { findFirst: async () => null, findUnique: async () => null },
    setting: { findUnique: async () => null, findMany: async () => [] },
  };
  const svc = new ReferralsService(
    prisma,
    { inviteAffiliate } as any,
    {} as any, // jwt
    {} as any, // commissionExceptions
    {} as any, // recalc
    {} as any, // audit
  );
  // Lo que `createCode` consulta y no es el objeto de esta prueba.
  (svc as any).allocateSlug = async () => 'fernando';
  (svc as any).resolveSignupBrandByHost = async () => null;
  (svc as any).resolveAffiliateWhiteLabelId = async () => null;
  (svc as any).getBrandCommissionMode = async () => 'PCT';
  (svc as any).getBrandFixedAmount = async () => null;
  (svc as any).brandShareBaseUrl = async () => 'https://soyclubify.com';
  return { svc, inviteAffiliate };
}

const ALTA = {
  fullName: 'Fernando Martínez',
  email: 'fer.pineda.fmn@gmail.com',
  whatsapp: '+573163797534',
  password: 'unaClaveLarga',
};

describe('el dueño de un negocio puede sacar su código', () => {
  it('le sale el código, no un error', async () => {
    const { svc } = montar({ usuario: DUENO });
    const r: any = await svc.createCode(ALTA as any);
    expect(r.code).toBeTruthy();
    expect(r.ownerEmail).toBe(ALTA.email);
  });

  it('NO se le toca la contraseña', async () => {
    // Lo importante de todo el arreglo: `inviteAffiliate` reasigna la
    // contraseña. Llamarlo aquí sería robarle la cuenta a un cliente.
    const { svc, inviteAffiliate } = montar({ usuario: DUENO });
    await svc.createCode(ALTA as any);
    expect(inviteAffiliate).not.toHaveBeenCalled();
  });

  it('se le dice que entre con la cuenta que ya tiene', async () => {
    const { svc } = montar({ usuario: DUENO });
    const r: any = await svc.createCode(ALTA as any);
    expect(r.yaTeniaCuenta).toBe(true);
    expect(r.accountReady).toBe(false);
  });
});

describe('a quien no tiene cuenta se le crea, como siempre', () => {
  it('se le crea la cuenta de afiliado con su contraseña', async () => {
    const { svc, inviteAffiliate } = montar({ usuario: null });
    const r: any = await svc.createCode(ALTA as any);
    expect(inviteAffiliate).toHaveBeenCalledTimes(1);
    expect(r.accountReady).toBe(true);
    expect(r.yaTeniaCuenta).toBe(false);
  });
});

describe('el duplicado de verdad se sigue rechazando', () => {
  it('si ya es afiliado', async () => {
    const { svc } = montar({ usuario: AFILIADO });
    await expect(svc.createCode(ALTA as any)).rejects.toBeInstanceOf(ConflictException);
  });

  it('si ya tiene un código con ese correo', async () => {
    const { svc } = montar({ usuario: null, codigo: { id: 'rc-viejo', role: 'INFLUENCER' } });
    await expect(svc.createCode(ALTA as any)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('los demás flujos siguen estrictos', () => {
  it('sin el permiso explícito, una cuenta existente se rechaza', async () => {
    // Las invitaciones SÍ reasignan contraseña: ahí el 409 tiene que quedarse.
    // Si alguien pone `permitirCuentaNoAfiliada` por defecto, esto se pone rojo.
    const { svc } = montar({ usuario: DUENO });
    await expect(
      svc.assertUniqueAffiliateEmail(ALTA.email),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('con el permiso, devuelve la cuenta en vez de lanzar', async () => {
    const { svc } = montar({ usuario: DUENO });
    const r = await svc.assertUniqueAffiliateEmail(ALTA.email, {
      permitirCuentaNoAfiliada: true,
    });
    expect(r.cuentaExistente).toMatchObject({ id: 'u-dueno' });
  });
});
