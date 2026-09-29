import { describe, it, expect, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';

/**
 * EDITAR EL TELÉFONO DESDE LA FICHA DEL CLIENTE (Javier, 2026-09-29: «que el
 * negocio no solo pueda editar el correo y el nombre, sino también el número
 * de teléfono»). El backend ya lo aceptaba; estas pruebas lo fijan para que
 * nadie lo quite del PATCH, y fijan el 409 legible cuando el número ya es de
 * otro cliente del negocio — Customer tiene índice único por teléfono y un
 * catch que no lo distinga sería un 500 mudo en el panel.
 */

const OWNER: AuthUser = {
  id: 'user-1',
  email: 'owner@test.com',
  role: 'OWNER' as any,
  tenantId: 'tenant-1',
};

function makeService(opts: { updateFalla?: any } = {}) {
  const update = vi.fn(async (args: any) => {
    if (opts.updateFalla) throw opts.updateFalla;
    return { id: args.where.id, ...args.data };
  });
  const prisma = {
    customer: {
      findUnique: vi.fn(async () => ({
        id: 'cust-1',
        tenantId: 'tenant-1',
        fullName: 'Devison Rangel',
        phone: '+584169877843',
        passes: [],
        stamps: [],
      })),
      update,
    },
    order: { findMany: vi.fn(async () => []) },
  };
  const svc = new CustomersService(prisma as any, {} as any);
  return { svc, update };
}

function p2002(campos: string[]) {
  const e: any = new Error('Unique constraint');
  e.code = 'P2002';
  e.meta = { target: campos };
  return e;
}

describe('editar el teléfono del cliente', () => {
  it('el PATCH guarda el teléfono nuevo tal cual lo mandó el panel', async () => {
    const { svc, update } = makeService();

    const r: any = await svc.update(OWNER, 'cust-1', {
      fullName: 'Devison Rangel',
      phone: '+573001112233',
    } as any);

    expect(r.phone).toBe('+573001112233');
    expect(update.mock.calls[0][0].data.phone).toBe('+573001112233');
  });

  it('un teléfono que ya es de OTRO cliente del negocio responde 409 legible, no 500', async () => {
    const { svc } = makeService({ updateFalla: p2002(['tenantId', 'phone']) });

    await expect(
      svc.update(OWNER, 'cust-1', { phone: '+573001112233' } as any),
    ).rejects.toThrow('Otro cliente ya tiene este teléfono');
    await expect(
      makeService({ updateFalla: p2002(['tenantId', 'phone']) }).svc.update(
        OWNER,
        'cust-1',
        { phone: '+573001112233' } as any,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('el choque de EMAIL sigue diciendo email — los dos índices únicos, cada uno con su mensaje', async () => {
    const { svc } = makeService({ updateFalla: p2002(['tenantId', 'email']) });

    await expect(
      svc.update(OWNER, 'cust-1', { email: 'ajeno@gmail.com' } as any),
    ).rejects.toThrow('Otro cliente ya tiene este email');
  });
});
