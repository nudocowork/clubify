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
  correo?: string | null;
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
        fullName: 'Cliente Prueba',
        phone: opts.telefono === undefined ? '+573001112233' : opts.telefono,
        email: opts.correo ?? null,
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
        logoUrl: null,
        primaryColor: null,
        growBusinessLocationId: opts.credsNegocio === false ? null : 'loc-1',
        growBusinessApiKey: opts.credsNegocio === false ? null : 'key-1',
        growBusinessSwitchNumber: null,
        whiteLabel: (opts as any).whiteLabel ?? null,
      })),
    },
  };
}

function makeService(prisma: any) {
  const sms = vi.fn(async () => ({ ok: true as const }));
  const mail = vi.fn(async () => ({ ok: true as const }));
  const svc = new PassesService(
    prisma,
    { emit: vi.fn(async () => undefined) } as any, // automations
    {} as any,
    {} as any, // brand
    { log: vi.fn(async () => undefined) } as any, // audit
    { sendSmsWithCreds: sms, sendEmailWithCreds: mail } as any, // growBusiness
  );
  return { svc, sms, mail };
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

  it('EL ENLACE SALE POR EL DOMINIO DE LA MARCA DEL PROPIO NEGOCIO', async () => {
    // La pregunta exacta de Javier (2026-09-29): «¿cómo vas a colocar el
    // nombre de un negocio de Clubify con un enlace de Sellea?». No se puede:
    // el dominio sale del whiteLabel DEL NEGOCIO, no de ninguna otra parte.
    // Un negocio de Sellea manda su enlace por el dominio de Sellea…
    const deSellea = makePrisma({
      whiteLabel: {
        domain: 'www.selleala.com',
        appDomain: 'app.selleala.com',
        growLocationId: null,
        growApiKey: null,
        growSwitchNumber: null,
      },
    } as any);
    const a = makeService(deSellea);
    await a.svc.issue(OWNER, 'card-1', 'cust-1');
    const cuerpoSellea = (a.sms.mock.calls[0] as any[])[2] as string;
    expect(cuerpoSellea).toContain('https://app.selleala.com/w/');
    expect(cuerpoSellea).not.toContain('soyclubify');

    // …y uno de Clubify (sin marca blanca), por el de Clubify.
    const deClubify = makePrisma();
    const b = makeService(deClubify);
    await b.svc.issue(OWNER, 'card-1', 'cust-1');
    const cuerpoClubify = (b.sms.mock.calls[0] as any[])[2] as string;
    // Contra el respaldo REAL del entorno (APP_URL, o el dominio de la
    // plataforma): lo que importa es que jamás sea el dominio de otra marca.
    let respaldo = process.env.APP_URL ?? 'https://app.soyclubify.com';
    while (respaldo.endsWith('/')) respaldo = respaldo.slice(0, -1);
    expect(cuerpoClubify).toContain(`${respaldo}/w/`);
    expect(cuerpoClubify).not.toContain('selleala');
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

  it('SIN CONEXIÓN PROPIA NO SE MANDA NADA — ni por la subcuenta de su marca', async () => {
    // La regla de Javier (2026-09-29): «el negocio no puede enviar mensajes a
    // los clientes finales» por un número que no es suyo. Y no es un caso
    // raro: en producción solo 1 de 133 negocios tiene conexión propia — con
    // el respaldo de marca, casi todo aviso habría salido por el número de
    // Clubify o de Sellea hacia el cliente final de otro.
    const prisma = makePrisma({
      credsNegocio: false,
      whiteLabel: {
        domain: 'www.selleala.com',
        appDomain: 'app.selleala.com',
        // La marca SÍ tiene subcuenta GHL: aun así, no se usa.
        growBusinessLocationId: 'loc-sellea',
        growBusinessApiKey: 'key-cifrada',
        growBusinessSwitchNumber: null,
      },
    } as any);
    const { svc, sms } = makeService(prisma);

    const r: any = await svc.issue(OWNER, 'card-1', 'cust-1');

    expect(r.entrega).toEqual({ via: 'sin-credenciales' });
    expect(sms).not.toHaveBeenCalled();
  });

  it('CON CORREO EN LA FICHA llega ADEMÁS la invitación por email, por la subcuenta de SU marca', async () => {
    // Javier (2026-09-29): «si el cliente tiene correo en sus datos, que salga
    // un correo de Clubify a ese cliente con la invitación» — y de Sellea para
    // los negocios de Sellea: el remitente lo pone la subcuenta de la marca.
    const prisma = makePrisma({
      correo: 'cliente@gmail.com',
      whiteLabel: {
        name: 'Sellea',
        domain: 'www.selleala.com',
        appDomain: 'app.selleala.com',
        growBusinessLocationId: 'loc-sellea',
        growBusinessApiKey: 'key-sellea',
        growBusinessSwitchNumber: null,
      },
    } as any);
    const { svc, mail } = makeService(prisma);

    const r: any = await svc.issue(OWNER, 'card-1', 'cust-1');

    expect(r.entrega.correo).toBe('enviado');
    expect(r.entrega.email).toBe('cliente@gmail.com');
    expect(mail).toHaveBeenCalledTimes(1);
    const [creds, para, asunto, html] = mail.mock.calls[0] as any[];
    expect(creds.locationId).toBe('loc-sellea'); // la subcuenta de SU marca
    expect(para).toBe('cliente@gmail.com');
    expect(asunto).toContain('Tarjeta de sellos');
    // El correo lo FIRMA el negocio (a quien el cliente conoce), con el
    // enlace por el dominio de su marca.
    expect(html).toContain('Cafe Prueba');
    expect(html).toContain('https://app.selleala.com/w/pass-nuevo');
    expect(html).not.toContain('soyclubify');
  });

  it('sin subcuenta de marca, el correo NO sale — por ningún otro lado', async () => {
    const prisma = makePrisma({ correo: 'cliente@gmail.com' }); // whiteLabel null
    const { svc, mail } = makeService(prisma);

    const r: any = await svc.issue(OWNER, 'card-1', 'cust-1');

    expect(r.entrega.correo).toBe('sin-conexion');
    expect(mail).not.toHaveBeenCalled();
    expect(r.entrega.via).toBe('sms'); // el SMS por la línea propia sí salió
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
