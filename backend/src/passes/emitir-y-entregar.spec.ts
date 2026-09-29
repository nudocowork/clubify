import { describe, it, expect, vi } from 'vitest';
import { PassesService } from './passes.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';

/**
 * EMITIR UNA TARJETA TIENE QUE CONTARLE AL CLIENTE QUE EXISTE.
 *
 * El malentendido que motivó esto (Javier, vía su implementador, 2026-09-29):
 * «al emitir, la tarjeta no se actualiza en el teléfono del cliente». No puede:
 * ni Apple ni Google permiten meter un pase en un teléfono — el cliente tiene
 * que abrir el enlace e instalarlo.
 *
 * El contrato, tras iterarlo con Javier ese mismo día:
 *  - CORREO automático si la ficha lo tiene, por la subcuenta GHL de la MARCA
 *    del negocio (el remitente lo pone ella). Solo en la primera emisión.
 *  - WhatsApp MANUAL: la emisión devuelve teléfono y texto listos, y el panel
 *    pinta «Invitar o enviar pase» que abre el WhatsApp del cliente para que
 *    lo mande EL NEGOCIO desde el suyo. «Es más sano para nuestro WhatsApp».
 *  - NINGÚN SMS automático: se quitó ese mismo día, por lo mismo — ninguna
 *    línea de la casa le escribe al cliente final.
 */

const OWNER: AuthUser = {
  id: 'user-1',
  email: 'owner@test.com',
  role: 'OWNER' as any,
  tenantId: 'tenant-1',
};

const SELLEA = {
  name: 'Sellea',
  domain: 'www.selleala.com',
  appDomain: 'app.selleala.com',
  growBusinessLocationId: 'loc-sellea',
  growBusinessApiKey: 'key-sellea',
  growBusinessSwitchNumber: null,
};

function makePrisma(opts: {
  pasePrevio?: boolean;
  telefono?: string | null;
  correo?: string | null;
  whiteLabel?: any;
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
        phone: opts.telefono === undefined ? '+57 300 111 2233' : opts.telefono,
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
    tenant: {
      findUnique: vi.fn(async () => ({
        brandName: 'Cafe Prueba',
        logoUrl: null,
        primaryColor: null,
        whiteLabel: opts.whiteLabel ?? null,
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
  it('JAMÁS manda un SMS automático — ninguna línea de la casa escribe al cliente', async () => {
    // La razón de Javier (2026-09-29): «es más sano para nuestro WhatsApp».
    // El SMS automático que existió unas horas salía por líneas de la casa.
    const prisma = makePrisma({ correo: 'cliente@gmail.com', whiteLabel: SELLEA });
    const { svc, sms } = makeService(prisma);

    await svc.issue(OWNER, 'card-1', 'cust-1');

    expect(sms).not.toHaveBeenCalled();
  });

  it('DEJA LISTO el WhatsApp: teléfono en dígitos y texto con el enlace de SU marca', async () => {
    // El envío es del NEGOCIO, con su botón «Invitar o enviar pase». wa.me
    // exige el número internacional en dígitos pelados.
    const prisma = makePrisma({ whiteLabel: SELLEA });
    const { svc } = makeService(prisma);

    const r: any = await svc.issue(OWNER, 'card-1', 'cust-1');

    expect(r.entrega.via).toBe('emitida');
    expect(r.entrega.whatsapp.telefono).toBe('573001112233');
    expect(r.entrega.whatsapp.texto).toContain('Cliente');
    expect(r.entrega.whatsapp.texto).toContain('Tarjeta de sellos');
    expect(r.entrega.whatsapp.texto).toContain('Cafe Prueba');
    // La pregunta exacta de Javier: «¿cómo vas a colocar el nombre de un
    // negocio de Clubify con un enlace de Sellea?» — no se puede: el dominio
    // sale del whiteLabel DEL NEGOCIO.
    expect(r.entrega.whatsapp.texto).toContain('https://app.selleala.com/w/pass-nuevo');
    expect(r.entrega.whatsapp.texto).not.toContain('soyclubify');
  });

  it('sin marca blanca, el enlace va por el respaldo de la plataforma — nunca por otra marca', async () => {
    const prisma = makePrisma();
    const { svc } = makeService(prisma);

    const r: any = await svc.issue(OWNER, 'card-1', 'cust-1');

    let respaldo = process.env.APP_URL ?? 'https://app.soyclubify.com';
    while (respaldo.endsWith('/')) respaldo = respaldo.slice(0, -1);
    expect(r.entrega.whatsapp.texto).toContain(`${respaldo}/w/`);
    expect(r.entrega.whatsapp.texto).not.toContain('selleala');
  });

  it('CON CORREO EN LA FICHA sale la invitación por email, por la subcuenta de SU marca', async () => {
    // Javier (2026-09-29): «que solo salga el correo de Clubify al cliente» —
    // y de Sellea para los negocios de Sellea: el remitente lo pone la
    // subcuenta de la marca.
    const prisma = makePrisma({ correo: 'cliente@gmail.com', whiteLabel: SELLEA });
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
  });

  it('sin correo en la ficha, no hay envío ni campo que lo finja', async () => {
    const prisma = makePrisma({ whiteLabel: SELLEA });
    const { svc, mail } = makeService(prisma);

    const r: any = await svc.issue(OWNER, 'card-1', 'cust-1');

    expect(r.entrega.correo).toBeUndefined();
    expect(mail).not.toHaveBeenCalled();
  });

  it('sin teléfono no hay botón de WhatsApp, y lo dice no trayéndolo', async () => {
    const prisma = makePrisma({ telefono: null, whiteLabel: SELLEA });
    const { svc } = makeService(prisma);

    const r: any = await svc.issue(OWNER, 'card-1', 'cust-1');

    expect(r.entrega.whatsapp).toBeUndefined();
  });

  it('REEMITIR no reenvía el correo, pero sí deja el WhatsApp listo', async () => {
    // Quien ya tiene su tarjeta no necesita otro correo automático; el botón
    // manual no estorba: lo aprieta el negocio si quiere.
    const prisma = makePrisma({
      pasePrevio: true,
      correo: 'cliente@gmail.com',
      whiteLabel: SELLEA,
    });
    const { svc, mail } = makeService(prisma);

    const r: any = await svc.issue(OWNER, 'card-1', 'cust-1');

    expect(r.entrega.via).toBe('ya-existia');
    expect(r.entrega.correo).toBeUndefined();
    expect(mail).not.toHaveBeenCalled();
    expect(r.entrega.whatsapp.telefono).toBe('573001112233');
  });

  it('UN FALLO DEL AVISO NO ROMPE LA EMISIÓN: el pase queda', async () => {
    const prisma = makePrisma({ correo: 'cliente@gmail.com', whiteLabel: SELLEA });
    const { svc, mail } = makeService(prisma);
    mail.mockRejectedValueOnce(new Error('proveedor caído') as never);

    const r: any = await svc.issue(OWNER, 'card-1', 'cust-1');

    expect(r.id).toBe('pass-nuevo');
    expect(r.entrega.via).toBe('emitida');
    expect(r.entrega.correo).toBe('fallo');
  });
});
