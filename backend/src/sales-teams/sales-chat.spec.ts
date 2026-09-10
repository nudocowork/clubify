import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SalesChatService, SalesInboxService } from './sales-chat.service';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { MktProviderService } from '../marketing/provider/mkt-provider.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';

/**
 * La conversación con un lead — fase 5.
 *
 * Lo que se prueba es lo que hace daño de verdad: que un mensaje entrante no
 * salga tres veces, que llegue a los DOS equipos que trabajan a la misma
 * persona, que no se le escriba a quien se dio de baja, y que no aparezca una
 * burbuja de algo que nunca salió.
 */

const SELLEA = 'wl-sellea';
type Fila = Record<string, any>;

function baseFalsa(opts: { envio?: { ok: boolean; error?: string; messageId?: string } } = {}) {
  const bd = {
    leads: [] as Fila[],
    mensajes: [] as Fila[],
    actividades: [] as Fila[],
    contactos: [] as Fila[],
    miembros: [
      { teamId: 't1', userId: 'u-vendedor', isActive: true, roles: ['closer'] },
    ] as Fila[],
  };
  let sec = 0;
  const id = (p: string) => `${p}-${++sec}`;
  const casa = (f: Fila, where: Fila = {}) =>
    Object.entries(where).every(([k, v]) => f[k] === v);

  const prisma: any = {
    salesTeam: {
      findUnique: async () => ({
        id: 't1',
        name: 'Equipo Norte',
        whiteLabelId: SELLEA,
        isActive: true,
      }),
    },
    whiteLabelModule: { findUnique: async () => ({ enabled: true }) },
    whiteLabel: { findFirst: async () => ({ id: SELLEA }) },
    salesTeamMember: {
      findUnique: async ({ where }: any) => {
        const { teamId, userId } = where.teamId_userId;
        return bd.miembros.find((m) => m.teamId === teamId && m.userId === userId) ?? null;
      },
    },
    salesLead: {
      findMany: async ({ where }: any) => bd.leads.filter((l) => casa(l, where)),
      findFirst: async ({ where }: any) => bd.leads.find((l) => casa(l, where)) ?? null,
      update: async ({ where, data }: any) => {
        const l = bd.leads.find((x) => x.id === where.id)!;
        Object.assign(l, data);
        return { ...l };
      },
    },
    salesMessage: {
      findMany: async ({ where }: any) =>
        bd.mensajes
          .filter((m) => casa(m, where))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      findFirst: async ({ where }: any) => bd.mensajes.find((m) => casa(m, where)) ?? null,
      create: async ({ data }: any) => {
        const m = { id: id('msg'), createdAt: new Date(), ...data };
        bd.mensajes.push(m);
        return { ...m };
      },
    },
    salesLeadActivity: {
      create: async ({ data }: any) => {
        const a = { id: id('act'), ...data };
        bd.actividades.push(a);
        return { ...a };
      },
    },
    mktContact: {
      findFirst: async ({ where }: any) => bd.contactos.find((c) => casa(c, where)) ?? null,
    },
  };

  const enviados: any[] = [];
  const mkt: any = {
    sendSms: async (input: any) => {
      enviados.push(input);
      return opts.envio ?? { ok: true, messageId: 'prov-1' };
    },
  };
  return { prisma, bd, mkt, enviados };
}

const VENDEDOR: AuthUser = {
  id: 'u-vendedor',
  email: 'v@sellea.com',
  role: 'TENANT_STAFF' as AuthUser['role'],
  whiteLabelId: SELLEA,
} as any;

let inbox: SalesInboxService;
let chat: SalesChatService;
let bd: ReturnType<typeof baseFalsa>['bd'];
let enviados: any[];

function abrir(opts: Parameters<typeof baseFalsa>[0] = {}) {
  const f = baseFalsa(opts);
  bd = f.bd;
  enviados = f.enviados;
  inbox = new SalesInboxService(f.prisma as unknown as PrismaService);
  chat = new SalesChatService(
    f.prisma as unknown as PrismaService,
    f.mkt as unknown as MktProviderService,
  );
}

const lead = (over: Fila = {}) => ({
  id: 'lead-1',
  salesTeamId: 't1',
  whiteLabelId: SELLEA,
  stageId: 'st1',
  name: 'Ana Ruiz',
  phone: '3001112233',
  phoneKey: '3001112233',
  lastActivityAt: new Date('2026-09-01T00:00:00Z'),
  ...over,
});

beforeEach(() => {
  abrir();
});

describe('lo que entra por el webhook', () => {
  it('se guarda en la conversación del lead', async () => {
    bd.leads.push(lead());
    const n = await inbox.guardarEntrante({
      whiteLabelId: SELLEA,
      phone: '+57 300 111 2233',
      body: 'Sí me interesa',
      providerMessageId: 'm1',
    });
    expect(n).toBe(1);
    expect(bd.mensajes[0]).toMatchObject({
      direction: 'in',
      channel: 'sms',
      body: 'Sí me interesa',
    });
  });

  it('contestar cuenta como actividad: el lead deja de parecer abandonado', async () => {
    // Es el peor momento para que un vendedor lo dé por perdido: acaba de dar
    // señales de vida.
    bd.leads.push(lead());
    const antes = bd.leads[0].lastActivityAt;
    await inbox.guardarEntrante({ whiteLabelId: SELLEA, phone: '3001112233', body: 'hola' });
    expect(bd.leads[0].lastActivityAt.getTime()).toBeGreaterThan(antes.getTime());
  });

  it('el MISMO mensaje reintentado no sale dos veces', async () => {
    // GoHighLevel reintenta cuando tarda la respuesta.
    bd.leads.push(lead());
    const uno = { whiteLabelId: SELLEA, phone: '3001112233', body: 'hola', providerMessageId: 'm1' };
    await inbox.guardarEntrante(uno);
    await inbox.guardarEntrante(uno);
    expect(bd.mensajes).toHaveLength(1);
  });

  it('sin id del proveedor no se deduplica, y es a propósito', async () => {
    // Dos «hola» seguidos de verdad son dos mensajes. Sin id no hay forma de
    // distinguirlos de un reintento, y perder uno es peor que repetirlo.
    bd.leads.push(lead());
    await inbox.guardarEntrante({ whiteLabelId: SELLEA, phone: '3001112233', body: 'hola' });
    await inbox.guardarEntrante({ whiteLabelId: SELLEA, phone: '3001112233', body: 'hola' });
    expect(bd.mensajes).toHaveLength(2);
  });

  it('llega a los DOS equipos que trabajan a la misma persona', async () => {
    // El índice `[whiteLabelId, phoneKey]` de SalesLead NO es único a
    // propósito. Guardarlo solo en uno dejaría al otro creyendo que nunca
    // contestó.
    bd.leads.push(lead());
    bd.leads.push(lead({ id: 'lead-2', salesTeamId: 't2' }));
    const n = await inbox.guardarEntrante({
      whiteLabelId: SELLEA,
      phone: '3001112233',
      body: 'hola',
    });
    expect(n).toBe(2);
    expect(bd.mensajes.map((m) => m.leadId).sort()).toEqual(['lead-1', 'lead-2']);
  });

  it('un lead de OTRA marca no recibe nada', async () => {
    bd.leads.push(lead({ whiteLabelId: 'wl-otra' }));
    expect(
      await inbox.guardarEntrante({ whiteLabelId: SELLEA, phone: '3001112233', body: 'hola' }),
    ).toBe(0);
  });

  it('sin teléfono o sin texto no se guarda nada', async () => {
    bd.leads.push(lead());
    expect(await inbox.guardarEntrante({ whiteLabelId: SELLEA, body: 'hola' })).toBe(0);
    expect(await inbox.guardarEntrante({ whiteLabelId: SELLEA, phone: '3001112233' })).toBe(0);
    expect(bd.mensajes).toHaveLength(0);
  });

  it('un teléfono desconocido no revienta ni inventa un lead', async () => {
    expect(
      await inbox.guardarEntrante({ whiteLabelId: SELLEA, phone: '3009998877', body: 'hola' }),
    ).toBe(0);
  });

  it('si la base falla, devuelve 0 y NO lanza: el webhook sigue su camino', async () => {
    bd.leads.push(lead());
    const roto: any = {
      salesLead: {
        findMany: async () => {
          throw new Error('base caída');
        },
      },
    };
    const svc = new SalesInboxService(roto as PrismaService);
    await expect(
      svc.guardarEntrante({ whiteLabelId: SELLEA, phone: '3001112233', body: 'hola' }),
    ).resolves.toBe(0);
  });
});

describe('leer la conversación', () => {
  it('sale en orden y con el teléfono, para saber si se puede responder', async () => {
    bd.leads.push(lead());
    await inbox.guardarEntrante({ whiteLabelId: SELLEA, phone: '3001112233', body: 'primero' });
    await inbox.guardarEntrante({ whiteLabelId: SELLEA, phone: '3001112233', body: 'segundo' });
    const c = await chat.conversacion(VENDEDOR, 't1', 'lead-1');
    expect(c.mensajes.map((m: any) => m.body)).toEqual(['primero', 'segundo']);
    expect(c.telefono).toBe('3001112233');
    expect(c.optOut).toBe(false);
  });

  it('un lead de otro equipo no se abre', async () => {
    bd.leads.push(lead({ salesTeamId: 't2' }));
    await expect(
      chat.conversacion(VENDEDOR, 't1', 'lead-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('escribirle', () => {
  it('sale por la subcuenta de la marca y queda guardado', async () => {
    bd.leads.push(lead());
    await chat.enviar(VENDEDOR, 't1', 'lead-1', { body: 'Te llamo mañana' });
    expect(enviados[0]).toMatchObject({
      whiteLabelId: SELLEA,
      toPhone: '3001112233',
      message: 'Te llamo mañana',
    });
    expect(bd.mensajes[0]).toMatchObject({ direction: 'out', status: 'enviado' });
  });

  it('si el proveedor NO lo aceptó, no queda burbuja', async () => {
    // Una burbuja de algo que nunca salió es peor que un error: el vendedor se
    // queda esperando respuesta a algo que nadie leyó.
    abrir({ envio: { ok: false, error: 'La marca no tiene subcuenta de SMS configurada.' } });
    bd.leads.push(lead());
    await expect(
      chat.enviar(VENDEDOR, 't1', 'lead-1', { body: 'hola' }),
    ).rejects.toThrow(/subcuenta de SMS/);
    expect(bd.mensajes).toHaveLength(0);
  });

  it('a quien se dio de baja NO se le escribe', async () => {
    // El opt-out es de la persona, no del canal. Respetarlo solo en campañas y
    // saltárselo en el chat es cómo entra una queja legal por la puerta de al
    // lado.
    bd.leads.push(lead());
    bd.contactos.push({
      id: 'c1',
      whiteLabelId: SELLEA,
      phoneKey: '3001112233',
      deleted: false,
      optOut: true,
    });
    await expect(
      chat.enviar(VENDEDOR, 't1', 'lead-1', { body: 'hola' }),
    ).rejects.toThrow(/baja/i);
    expect(enviados).toHaveLength(0);
  });

  it('y la pantalla se entera antes de escribir', async () => {
    bd.leads.push(lead());
    bd.contactos.push({
      id: 'c1',
      whiteLabelId: SELLEA,
      phoneKey: '3001112233',
      deleted: false,
      optOut: true,
    });
    expect((await chat.conversacion(VENDEDOR, 't1', 'lead-1')).optOut).toBe(true);
  });

  it('una baja BORRADA ya no cuenta', async () => {
    bd.leads.push(lead());
    bd.contactos.push({
      id: 'c1',
      whiteLabelId: SELLEA,
      phoneKey: '3001112233',
      deleted: true,
      optOut: true,
    });
    await chat.enviar(VENDEDOR, 't1', 'lead-1', { body: 'hola' });
    expect(enviados).toHaveLength(1);
  });

  it('un lead sin teléfono lo dice con palabras', async () => {
    bd.leads.push(lead({ phone: null, phoneKey: null }));
    await expect(
      chat.enviar(VENDEDOR, 't1', 'lead-1', { body: 'hola' }),
    ).rejects.toThrow(/no tiene teléfono/i);
  });

  it('un mensaje vacío se rechaza', async () => {
    bd.leads.push(lead());
    await expect(
      chat.enviar(VENDEDOR, 't1', 'lead-1', { body: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('solo lectura no escribe', async () => {
    bd.leads.push(lead());
    bd.miembros[0].roles = ['lectura'];
    await expect(
      chat.enviar(VENDEDOR, 't1', 'lead-1', { body: 'hola' }),
    ).rejects.toThrow(/solo lectura/i);
    expect(enviados).toHaveLength(0);
  });
});

describe('la nota interna', () => {
  it('se guarda en el hilo y NO sale a ninguna parte', async () => {
    bd.leads.push(lead());
    await chat.notaInterna(VENDEDOR, 't1', 'lead-1', {
      body: 'Ojo, ya le bajamos el precio una vez',
    });
    expect(bd.mensajes[0]).toMatchObject({ direction: 'internal', channel: 'note' });
    expect(enviados).toHaveLength(0);
  });

  it('funciona aunque la persona se haya dado de baja', async () => {
    // No se le manda nada: es para el equipo.
    bd.leads.push(lead());
    bd.contactos.push({
      id: 'c1',
      whiteLabelId: SELLEA,
      phoneKey: '3001112233',
      deleted: false,
      optOut: true,
    });
    await chat.notaInterna(VENDEDOR, 't1', 'lead-1', { body: 'no llamar' });
    expect(bd.mensajes).toHaveLength(1);
  });
});
