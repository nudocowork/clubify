import { describe, it, expect, beforeEach } from 'vitest';
import { SalesAutomationsService } from './sales-automations.service';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { MktContactService } from '../marketing/mkt-contact.service';
import type { MktEngineService } from '../marketing/mkt-engine.service';

/**
 * El puente entre el tablero y el motor de automatizaciones — fase 6.
 *
 * El fallo que evita es silencioso: el motor inscribe CONTACTOS, no leads. Un
 * lead con un teléfono que la marca no conocía no tiene contacto, así que el
 * flujo se publica, se ve bien en la pantalla y no se ejecuta para nadie.
 */

const SELLEA = 'wl-sellea';
type Fila = Record<string, any>;

function baseFalsa() {
  const bd = {
    leads: [] as Fila[],
    contactos: [] as Fila[],
    equipos: [{ id: 't1', name: 'Equipo Norte' }] as Fila[],
    usuarios: [{ id: 'u1', fullName: 'Sara Vendedora', email: 's@x.com' }] as Fila[],
  };
  const disparos: Array<{ tipo: string; contactId: string; wlId: string; ctx: any }> = [];
  let sec = 0;

  const prisma: any = {
    salesLead: {
      findUnique: async ({ where }: any) => bd.leads.find((l) => l.id === where.id) ?? null,
      update: async ({ where, data }: any) => {
        const l = bd.leads.find((x) => x.id === where.id)!;
        Object.assign(l, data);
        return { ...l };
      },
    },
    salesTeam: {
      findUnique: async ({ where }: any) => bd.equipos.find((e) => e.id === where.id) ?? null,
    },
    user: {
      findUnique: async ({ where }: any) => bd.usuarios.find((u) => u.id === where.id) ?? null,
    },
  };

  const contacts: any = {
    upsert: async (whiteLabelId: string, input: any) => {
      // Espejo del resolver real: una persona = una ficha, por teléfono.
      const clave = String(input.phone ?? input.email ?? '').replace(/\D/g, '').slice(-10);
      const ya = bd.contactos.find((c) => c.whiteLabelId === whiteLabelId && c.clave === clave);
      if (ya) return ya;
      const c = { id: `c-${++sec}`, whiteLabelId, clave, ...input };
      bd.contactos.push(c);
      return c;
    },
  };

  const engine: any = {
    fireTrigger: async (tipo: string, contactId: string, wlId: string, ctx: any) => {
      disparos.push({ tipo, contactId, wlId, ctx });
    },
  };

  return { prisma, bd, contacts, engine, disparos };
}

let svc: SalesAutomationsService;
let bd: ReturnType<typeof baseFalsa>['bd'];
let disparos: ReturnType<typeof baseFalsa>['disparos'];

const lead = (over: Fila = {}) => ({
  id: 'lead-1',
  name: 'Ana Ruiz',
  email: null,
  phone: '3001112233',
  company: null,
  whiteLabelId: SELLEA,
  mktContactId: null,
  salesTeamId: 't1',
  assignedUserId: null,
  ...over,
});

beforeEach(() => {
  const f = baseFalsa();
  bd = f.bd;
  disparos = f.disparos;
  svc = new SalesAutomationsService(
    f.prisma as unknown as PrismaService,
    f.contacts as unknown as MktContactService,
    f.engine as unknown as MktEngineService,
  );
});

describe('el contacto se garantiza ANTES de disparar', () => {
  it('un lead sin contacto se lo crea, y por eso el flujo llega', async () => {
    bd.leads.push(lead());
    expect(await svc.disparar('lead-1', 'sales_lead_created')).toBe(true);
    expect(bd.contactos).toHaveLength(1);
    expect(disparos[0]).toMatchObject({ tipo: 'sales_lead_created', wlId: SELLEA });
  });

  it('el id del contacto se guarda en el lead: no se resuelve dos veces', async () => {
    // Mover una tarjeta es lo que más veces pasa; resolver identidad en cada
    // movimiento es trabajo tirado.
    bd.leads.push(lead());
    await svc.disparar('lead-1', 'sales_lead_created');
    expect(bd.leads[0].mktContactId).toBe(bd.contactos[0].id);

    await svc.disparar('lead-1', 'sales_stage_changed');
    expect(bd.contactos).toHaveLength(1);
  });

  it('reutiliza el contacto que ya existía en la marca', async () => {
    bd.contactos.push({ id: 'c-viejo', whiteLabelId: SELLEA, clave: '3001112233' });
    bd.leads.push(lead());
    await svc.disparar('lead-1', 'sales_lead_created');
    expect(bd.contactos).toHaveLength(1);
    expect(disparos[0].contactId).toBe('c-viejo');
  });
});

describe('cuándo NO se dispara', () => {
  it('un lead sin correo ni teléfono no crea una ficha vacía', async () => {
    // No hay a quién escribirle; fabricar el contacto solo ensucia la lista.
    bd.leads.push(lead({ phone: null, email: null }));
    expect(await svc.disparar('lead-1', 'sales_lead_created')).toBe(false);
    expect(bd.contactos).toHaveLength(0);
    expect(disparos).toHaveLength(0);
  });

  it('un lead sin marca tampoco', async () => {
    bd.leads.push(lead({ whiteLabelId: null }));
    expect(await svc.disparar('lead-1', 'sales_lead_created')).toBe(false);
  });

  it('un lead que no existe no revienta', async () => {
    expect(await svc.disparar('no-existe', 'sales_lead_created')).toBe(false);
  });

  it('si algo falla devuelve false y NO lanza: no tumba el alta del lead', async () => {
    const roto: any = {
      salesLead: {
        findUnique: async () => {
          throw new Error('base caída');
        },
      },
    };
    const s = new SalesAutomationsService(
      roto as PrismaService,
      {} as MktContactService,
      {} as MktEngineService,
    );
    await expect(s.disparar('lead-1', 'sales_lead_created')).resolves.toBe(false);
  });
});

describe('el contexto que ve la condición del disparador', () => {
  it('lleva el equipo y el vendedor', async () => {
    bd.leads.push(lead({ assignedUserId: 'u1' }));
    await svc.disparar('lead-1', 'sales_lead_created');
    expect(disparos[0].ctx).toMatchObject({
      equipo: 'Equipo Norte',
      vendedor: 'Sara Vendedora',
    });
  });

  it('sin vendedor asignado, el campo va vacío y no revienta', async () => {
    bd.leads.push(lead());
    await svc.disparar('lead-1', 'sales_lead_created');
    expect(disparos[0].ctx.vendedor).toBe('');
  });

  it('lo que manda el evento gana sobre lo calculado', async () => {
    // La etapa a la que ACABA de pasar describe lo que ocurrió; cualquier otra
    // cosa sería una foto vieja.
    bd.leads.push(lead());
    await svc.disparar('lead-1', 'sales_stage_changed', {
      etapa: 'Interesados',
      equipo: 'lo que diga el evento',
    });
    expect(disparos[0].ctx.etapa).toBe('Interesados');
    expect(disparos[0].ctx.equipo).toBe('lo que diga el evento');
  });
});
