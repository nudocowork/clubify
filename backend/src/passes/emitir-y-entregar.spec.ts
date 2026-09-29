import { describe, it, expect, vi } from 'vitest';
import { PassesService } from './passes.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';

/**
 * EMITIR UNA TARJETA TIENE QUE CONTARLE AL CLIENTE QUE EXISTE.
 *
 * El malentendido que motivó esto (Javier, vía su implementador, 2026-09-29):
 * «al emitir, la tarjeta no se actualiza en el teléfono del cliente». No puede:
 * ni Apple ni Google permiten meter un pase en un teléfono — el cliente tiene
 * que abrir el enlace e instalarlo. «Emitir» creaba el pase y ahí se acababa:
 * nadie le mandaba el enlace, y en producción había pases emitidos días atrás
 * con cero instalaciones.
 *
 * El contrato nuevo: emitir ENVÍA el enlace por SMS (o lo delega en la
 * bienvenida automática del negocio) y devuelve `entrega`, que el panel enseña
 * tal cual. Estas pruebas fijan cada salida.
 */

const OWNER: AuthUser = {
  id: 'user-1',
  email: 'owner@test.com',
  role: 'OWNER' as any,
  tenantId: 'tenant-1',
};

function makePrisma(opts: {
  pasePrevio?: boolean;
  telefono?: string | null;
  reglas?: any[];
  credsNegocio?: boolean;
} = {}) {
  return {
    card: {
      findUnique: vi.fn(async () => ({
        id: 'card-1',
        tenantId: 'tenant-1',
        name: 'Tarjeta de sellos',
      })),
    },
    customer: {
      findUnique: vi.fn(async () => ({
        id: 'cust-1',
        tenantId: 'tenant-1',
        fullName: 'Cliente',
        phone: opts.telefono === undefined ? '+573001112233' : opts.telefono,
      })),
    },
    pass: {
      findUnique: vi.fn(async (args: any) =>
        args?.where?.cardId_customerId && opts.pasePrevio
          ? { id: 'pass-viejo' }
          : null,
      ),
      create: vi.fn(async (args: any) => ({ id: 'pass-nuevo', ...args.data })),
    },
    automationRule: {
      findMany: vi.fn(async () => opts.reglas ?? []),
    },
    tenant: {
      findUnique: vi.fn(async () => ({
        brandName: 'Cafe Prueba',
        growBusinessLocationId: opts.credsNegocio === false ? null : 'loc-1',
        growBusinessApiKey: opts.credsNegocio === false ? null : 'key-1',
        growBusinessSwitchNumber: null,
        whiteLabel: null,
      })),
    },
  };
}

function makeService(prisma: any) {
  const sms = vi.fn(async () => ({ ok: true as const }));
  const svc = new PassesService(
    prisma,
    { emit: vi.fn(async () => undefined) } as any, // automations
    {} as any,
    {} as any, // brand
    { log: vi.fn(async () => undefined) } as any, // audit
    { sendSmsWithCreds: sms } as any, // growBusiness
  );
  return { svc, sms };
}

describe('emitir una tarjeta desde el panel', () => {
  it('LE MANDA EL ENLACE POR SMS, con el pase dentro del texto', async () => {
    const prisma = makePrisma();
    const { svc, sms } = makeService(prisma);

    const r: any = await svc.issue(OWNER, 'card-1', 'cust-1');

    expect(r.entrega).toEqual({ via: 'sms', telefono: '+573001112233' });
    expect(sms).toHaveBeenCalledTimes(1);
    const [, telefono, cuerpo, ctx] = sms.mock.calls[0] as any[];
    expect(telefono).toBe('+573001112233');
    expect(cuerpo).toContain('/w/pass-nuevo');
    expect(cuerpo).toContain('Cafe Prueba');
    // Y con dueño en «Mensajes enviados»: la regla de la casa.
    expect(ctx).toMatchObject({ tenantId: 'tenant-1', feature: 'tarjetas' });
  });

  it('SI HAY BIENVENIDA AUTOMÁTICA, manda ella y no se duplica el SMS', async () => {
    const prisma = makePrisma({
      reglas: [
        {
          trigger: { type: 'PASS_CREATED' },
          actions: [{ type: 'SEND_WHATSAPP' }],
        },
      ],
    });
    const { svc, sms } = makeService(prisma);

    const r: any = await svc.issue(OWNER, 'card-1', 'cust-1');

    expect(r.entrega).toEqual({ via: 'bienvenida' });
    expect(sms).not.toHaveBeenCalled();
  });

  it('una regla de bienvenida SIN mensajes (solo push) no cuenta como entrega', async () => {
    // El matiz que haría el filtro mentiroso: una regla PASS_CREATED que solo
    // manda push no le hace llegar ningún enlace instalable al cliente.
    const prisma = makePrisma({
      reglas: [
        { trigger: { type: 'PASS_CREATED' }, actions: [{ type: 'SEND_PUSH' }] },
      ],
    });
    const { svc, sms } = makeService(prisma);

    const r: any = await svc.issue(OWNER, 'card-1', 'cust-1');

    expect(r.entrega.via).toBe('sms');
    expect(sms).toHaveBeenCalledTimes(1);
  });

  it('sin teléfono, LO DICE — y no manda nada', async () => {
    const prisma = makePrisma({ telefono: null });
    const { svc, sms } = makeService(prisma);

    const r: any = await svc.issue(OWNER, 'card-1', 'cust-1');

    expect(r.entrega).toEqual({ via: 'sin-telefono' });
    expect(sms).not.toHaveBeenCalled();
  });

  it('REEMITIR no vuelve a mandar el SMS a quien ya tiene su tarjeta', async () => {
    const prisma = makePrisma({ pasePrevio: true });
    const { svc, sms } = makeService(prisma);

    const r: any = await svc.issue(OWNER, 'card-1', 'cust-1');

    expect(r.entrega).toEqual({ via: 'ya-existia' });
    expect(sms).not.toHaveBeenCalled();
  });

  it('UN FALLO DEL AVISO NO ROMPE LA EMISIÓN: el pase queda, y se cuenta', async () => {
    const prisma = makePrisma();
    const { svc, sms } = makeService(prisma);
    sms.mockRejectedValueOnce(new Error('proveedor caído') as never);

    const r: any = await svc.issue(OWNER, 'card-1', 'cust-1');

    expect(r.id).toBe('pass-nuevo');
    expect(r.entrega.via).toBe('fallo');
    expect(r.entrega.detalle).toContain('proveedor caído');
  });
});
