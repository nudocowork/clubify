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

function makeService(
  opts: { updateFalla?: any; parecidos?: any[]; ficha?: any; formulario?: any } = {},
) {
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
        ...opts.ficha,
      })),
      findMany: vi.fn(async () => opts.parecidos ?? []),
      update,
    },
    order: { findMany: vi.fn(async () => []) },
    tenant: {
      findUnique: vi.fn(async () => ({
        country: 'CO',
        formularioRegistro: opts.formulario ?? null,
        whiteLabel: null,
      })),
    },
    pass: { updateMany: vi.fn(async (_args: any) => ({ count: 1 })) },
  };
  const jobs = { enqueue: vi.fn(async (..._args: any[]) => undefined) };
  const svc = new CustomersService(prisma as any, {} as any, jobs as any);
  return { svc, update, jobs, prisma };
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

  it('el número se guarda como en el alta: sin espacios y con indicativo', async () => {
    const con = makeService();
    await con.svc.update(OWNER, 'cust-1', { phone: '+56 971269502' });
    expect(con.update.mock.calls[0][0].data.phone).toBe('+56971269502');

    const sin = makeService();
    await sin.svc.update(OWNER, 'cust-1', { phone: '3001112233' });
    expect(sin.update.mock.calls[0][0].data.phone).toBe('+573001112233');
  });

  it('el mismo número en otro formato de otra ficha se detiene antes de guardar', async () => {
    const { svc, update } = makeService({
      parecidos: [{ fullName: 'Ana Ruiz', phone: '3001112233' }],
    });
    await expect(svc.update(OWNER, 'cust-1', { phone: '+573001112233' })).rejects.toThrow(
      'Ese teléfono ya es de Ana Ruiz',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('corregir el nombre no choca con un duplicado viejo si el número no cambió', async () => {
    const { svc, update, prisma } = makeService({ ficha: { phone: '3001112233' } });
    await svc.update(OWNER, 'cust-1', { fullName: 'Ana', phone: '+57 3001112233' });
    expect(prisma.customer.findMany).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalled();
  });

  it('un número demasiado corto no se guarda', async () => {
    const { svc } = makeService();
    await expect(svc.update(OWNER, 'cust-1', { phone: '+57123' })).rejects.toThrow('Teléfono inválido');
  });
});

describe('corregir los demás datos del registro', () => {
  it('el correo queda en minúsculas, como en el alta, y se puede borrar si es opcional', async () => {
    const a = makeService();
    await a.svc.update(OWNER, 'cust-1', { email: ' Ana@Gmail.COM ' });
    expect(a.update.mock.calls[0][0].data.email).toBe('ana@gmail.com');

    const b = makeService({ ficha: { email: 'ana@gmail.com' } });
    await b.svc.update(OWNER, 'cust-1', { email: null });
    expect(b.update.mock.calls[0][0].data.email).toBeNull();
  });

  it('un dato obligatorio no se puede vaciar, pero su hueco viejo no bloquea', async () => {
    const formulario = { email: 'obligatorio', cumpleanos: 'obligatorio', extras: [] };
    const con = makeService({ formulario, ficha: { email: 'a@b.co', birthday: new Date() } });
    await expect(con.svc.update(OWNER, 'cust-1', { email: null })).rejects.toThrow('obligatorio');
    await expect(con.svc.update(OWNER, 'cust-1', { birthday: null })).rejects.toThrow('obligatoria');

    const sin = makeService({ formulario });
    await sin.svc.update(OWNER, 'cust-1', { email: null, fullName: 'Ana' });
    expect(sin.update).toHaveBeenCalled();
  });

  it('un cumpleaños imposible se rechaza; vacío lo borra', async () => {
    const { svc } = makeService();
    await expect(svc.update(OWNER, 'cust-1', { birthday: '2000-02-31' })).rejects.toThrow('no es válida');

    const b = makeService({ ficha: { birthday: new Date() } });
    await b.svc.update(OWNER, 'cust-1', { birthday: null });
    expect(b.update.mock.calls[0][0].data.birthday).toBeNull();
  });

  it('las casillas propias se corrigen y conservan las que ya no están en el formulario', async () => {
    const { svc, update } = makeService({
      formulario: { extras: [{ id: 'cedula', etiqueta: 'Cédula', tipo: 'numero' }] },
      ficha: {
        datosDelRegistro: {
          cedula: { etiqueta: 'Cédula', valor: '111' },
          vieja: { etiqueta: 'Retirada', valor: 'x' },
        },
      },
    });
    await svc.update(OWNER, 'cust-1', { extras: { cedula: '222' } });
    expect(update.mock.calls[0][0].data.datosDelRegistro).toEqual({
      cedula: { etiqueta: 'Cédula', valor: '222' },
      vieja: { etiqueta: 'Retirada', valor: 'x' },
    });
  });

  it('una casilla propia mal contestada dice cuál', async () => {
    const { svc } = makeService({
      formulario: { extras: [{ id: 'cedula', etiqueta: 'Cédula', tipo: 'numero' }] },
    });
    await expect(svc.update(OWNER, 'cust-1', { extras: { cedula: 'abc' } })).rejects.toThrow(
      '«Cédula» debe ser un número',
    );
  });

  it('corregir el nombre refresca el pase en silencio, salvo el revocado', async () => {
    const { svc, jobs, prisma } = makeService({
      ficha: {
        passes: [
          { id: 'p1', status: 'ACTIVE' },
          { id: 'p2', status: 'REVOKED' },
        ],
      },
    });
    await svc.update(OWNER, 'cust-1', { fullName: 'Devison Rangel M.' });
    expect(prisma.pass.updateMany.mock.calls[0][0].where.id.in).toEqual(['p1']);
    expect(jobs.enqueue).toHaveBeenCalledTimes(1);
    expect(jobs.enqueue.mock.calls[0][1]).toMatchObject({ passId: 'p1', silent: true });
  });

  it('guardar notas o etiquetas no toca el pase ni consulta el formulario', async () => {
    const { svc, jobs, prisma } = makeService();
    await svc.update(OWNER, 'cust-1', { notes: 'VIP', tags: ['VIP'] });
    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
  });
});
