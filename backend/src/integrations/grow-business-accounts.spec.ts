import { describe, it, expect } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { GrowBusinessAccountsController } from './grow-business-accounts.controller';
import { GrowBusinessAccountsService } from './grow-business-accounts.service';

/**
 * Las subcuentas de Grow Business son de la PLATAFORMA: la tabla no tiene
 * marca y por ella salen los SMS de Clubify.
 *
 * EL FALLO (arqueo 2026-09-17): la ruta admitía a cualquier SUPER_ADMIN, y un
 * admin de marca blanca ES un SUPER_ADMIN con `whiteLabelId`. Además `create` y
 * `update` devolvían la fila entera, con `apiKey` en claro: bastaba con editar
 * el nombre de la subcuenta de Clubify para llevarse su clave.
 */

const CLAVE = 'pit-0a1b2c3d-CLAVE-DE-CLUBIFY-9999';
const fila = () => ({
  id: 'gb1',
  name: 'Reseñas',
  locationId: 'loc-1',
  apiKey: CLAVE,
  switchNumber: null,
  purpose: 'GENERAL',
  isDefault: true,
  lastTestAt: null,
  lastTestOk: null,
  createdAt: new Date('2026-01-01'),
  deletedAt: null,
  _count: { reviewTenants: 2, billingTenants: 1, deliveryTenants: 0 },
});

function prismaFalso() {
  return {
    whiteLabel: {
      findFirst: async () => ({ id: 'wl-clubify' }),
      findUnique: async () => ({ id: 'wl-clubify' }),
    },
    growBusinessAccount: {
      findMany: async () => [fila()],
      findUnique: async () => fila(),
      findFirst: async () => fila(),
      create: async () => fila(),
      update: async () => fila(),
      updateMany: async () => ({ count: 0 }),
    },
  } as any;
}

describe('GrowBusinessAccountsService: la clave no sale en ninguna respuesta', () => {
  it('create() devuelve la subcuenta saneada, sin apiKey', async () => {
    const svc = new GrowBusinessAccountsService(prismaFalso());
    const r = await svc.create({ name: 'Reseñas', locationId: 'loc-1', apiKey: CLAVE });
    expect(JSON.stringify(r)).not.toContain('CLAVE-DE-CLUBIFY');
    expect((r as any).id).toBe('gb1');
  });

  it('update() tampoco la devuelve', async () => {
    const svc = new GrowBusinessAccountsService(prismaFalso());
    const r = await svc.update('gb1', { name: 'Otro nombre' });
    expect(JSON.stringify(r)).not.toContain('CLAVE-DE-CLUBIFY');
  });
});

describe('GrowBusinessAccountsController: solo la plataforma', () => {
  const svcFalso = () =>
    ({
      list: async () => [{ id: 'gb1', name: 'Reseñas' }],
      create: async () => ({ id: 'gb1' }),
      update: async () => ({ id: 'gb1' }),
      test: async () => ({ ok: true }),
      remove: async () => ({ ok: true }),
    }) as any;
  const ctrl = () => new GrowBusinessAccountsController(svcFalso(), prismaFalso());
  const adminDeSellea = { id: 'u1', role: 'SUPER_ADMIN', tenantId: null, whiteLabelId: 'wl-sellea' } as any;
  const marketingDeSellea = { id: 'u2', role: 'MARKETING', tenantId: null, whiteLabelId: 'wl-sellea' } as any;
  const cuerpo = { name: 'x', locationId: 'loc', apiKey: 'k'.repeat(12) } as any;

  it('un admin de otra marca NO puede crear, editar, probar ni borrar', async () => {
    const c = ctrl();
    await expect(c.create(adminDeSellea, cuerpo)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.update(adminDeSellea, 'gb1', cuerpo)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.test(adminDeSellea, 'gb1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.remove(adminDeSellea, 'gb1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.create(marketingDeSellea, cuerpo)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('al listar, un admin de otra marca recibe una lista vacía (la ficha del negocio no revienta)', async () => {
    expect(await ctrl().list(adminDeSellea)).toEqual([]);
  });

  it('la plataforma sigue entrando: sesión sin marca y sesión «dentro» de Clubify', async () => {
    const sinMarca = { id: 'u3', role: 'SUPER_ADMIN', tenantId: null, whiteLabelId: null } as any;
    const dentroDeClubify = { id: 'u4', role: 'SUPER_ADMIN', tenantId: null, whiteLabelId: 'wl-clubify' } as any;
    for (const u of [sinMarca, dentroDeClubify]) {
      const c = ctrl();
      expect(await c.list(u)).toHaveLength(1);
      expect(await c.create(u, cuerpo)).toEqual({ id: 'gb1' });
      expect(await c.update(u, 'gb1', cuerpo)).toEqual({ id: 'gb1' });
    }
  });
});
