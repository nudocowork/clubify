import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SalesLeadsService } from './sales-leads.service';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';

/**
 * El tablero del equipo de ventas — fase 3.
 *
 * Lo que se prueba aquí es lo que se rompe de verdad en este módulo: que un
 * equipo de otra marca no exista, que dos vendedores no se pisen la tarjeta,
 * que un lead no se asigne a quien no está en el equipo, y que borrar una
 * columna no se lleve los leads por delante.
 *
 * El aislamiento por marca ya tiene sus propias pruebas en `team-access.spec`;
 * aquí se comprueba que el servicio lo USE en todas las puertas, que es donde
 * se olvida.
 */

const SELLEA = 'wl-sellea';
const CLUBIFY = 'wl-clubify';

type Fila = Record<string, any>;

/** Base en memoria, con lo justo para este servicio. */
function baseFalsa(opts: { modulo?: boolean; whiteLabelId?: string | null } = {}) {
  const bd = {
    stages: [] as Fila[],
    leads: [] as Fila[],
    actividades: [] as Fila[],
    miembros: [{ teamId: 't1', userId: 'u-vendedor', isActive: true, roles: ['closer'] }] as Fila[],
    contactos: [] as Fila[],
  };
  let sec = 0;
  const id = (p: string) => `${p}-${++sec}`;
  const casa = (fila: Fila, where: Fila = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && 'in' in v) return v.in.includes(fila[k]);
      if (v && typeof v === 'object' && 'not' in v) return fila[k] !== v.not;
      return fila[k] === v;
    });

  const prisma: any = {
    salesTeam: {
      findUnique: async () => ({
        id: 't1',
        name: 'Equipo Norte',
        whiteLabelId: opts.whiteLabelId === undefined ? SELLEA : opts.whiteLabelId,
        isActive: true,
      }),
    },
    whiteLabelModule: {
      findUnique: async () => ({ enabled: opts.modulo !== false }),
    },
    whiteLabel: { findFirst: async () => ({ id: SELLEA }) },
    salesTeamMember: {
      findUnique: async ({ where }: any) => {
        const { teamId, userId } = where.teamId_userId;
        return bd.miembros.find((m) => m.teamId === teamId && m.userId === userId) ?? null;
      },
    },
    salesStage: {
      findMany: async ({ where }: any) =>
        bd.stages
          .filter((s) => casa(s, where))
          .sort((a, b) => a.position - b.position)
          .map((s) => ({ ...s })),
      findFirst: async ({ where, orderBy }: any) => {
        let f = bd.stages.filter((s) => casa(s, where));
        if (orderBy?.position === 'desc') f = [...f].sort((a, b) => b.position - a.position);
        return f[0] ? { ...f[0] } : null;
      },
      findUnique: async ({ where }: any) => {
        const s = bd.stages.find((x) => x.id === where.id);
        return s ? { ...s } : null;
      },
      createMany: async ({ data }: any) => {
        for (const d of data) bd.stages.push({ id: id('st'), ...d });
        return { count: data.length };
      },
      create: async ({ data }: any) => {
        const f = { id: id('st'), ...data };
        bd.stages.push(f);
        return { ...f };
      },
      update: async ({ where, data }: any) => {
        const s = bd.stages.find((x) => x.id === where.id)!;
        for (const [k, v] of Object.entries(data)) if (v !== undefined) s[k] = v;
        return { ...s };
      },
      delete: async ({ where }: any) => {
        bd.stages = bd.stages.filter((x) => x.id !== where.id);
        return {};
      },
    },
    salesLead: {
      findMany: async ({ where }: any) =>
        bd.leads.filter((l) => casa(l, where)).map((l) => ({ ...l, assignedUser: null })),
      count: async ({ where }: any) => bd.leads.filter((l) => casa(l, where)).length,
      findFirst: async ({ where }: any) => {
        const l = bd.leads.find((x) => casa(x, where));
        return l ? { ...l, assignedUser: null } : null;
      },
      create: async ({ data }: any) => {
        const f = {
          id: id('lead'),
          tags: [],
          lostReason: null,
          wonAt: null,
          lastActivityAt: new Date(),
          createdAt: new Date(),
          ...data,
        };
        bd.leads.push(f);
        return { ...f, assignedUser: null };
      },
      update: async ({ where, data }: any) => {
        const l = bd.leads.find((x) => x.id === where.id)!;
        for (const [k, v] of Object.entries(data)) if (v !== undefined) l[k] = v;
        return { ...l, assignedUser: null };
      },
      updateMany: async ({ where, data }: any) => {
        const tocadas = bd.leads.filter((l) => casa(l, where));
        for (const l of tocadas) {
          for (const [k, v] of Object.entries(data)) if (v !== undefined) l[k] = v;
        }
        return { count: tocadas.length };
      },
      delete: async ({ where }: any) => {
        bd.leads = bd.leads.filter((x) => x.id !== where.id);
        return {};
      },
    },
    salesLeadActivity: {
      create: async ({ data }: any) => {
        const f = { id: id('act'), createdAt: new Date(), ...data };
        bd.actividades.push(f);
        return { ...f };
      },
      findMany: async ({ where }: any) =>
        bd.actividades.filter((a) => casa(a, where)).map((a) => ({ ...a })),
    },
    mktContact: {
      findMany: async () => bd.contactos.map((c) => ({ ...c })),
    },
    $transaction: async (fn: any) => fn(prisma),
  };
  return { prisma, bd };
}

/** Doble del puente de automatizaciones: apunta lo que se dispararía. */
function automatizacionesFalsas() {
  const disparos: Array<{ leadId: string; evento: string; ctx: Record<string, string> }> = [];
  const svc: any = {
    disparar: async (leadId: string, evento: string, ctx: Record<string, string> = {}) => {
      disparos.push({ leadId, evento, ctx });
      return true;
    },
  };
  return { svc, disparos };
}

const VENDEDOR: AuthUser = {
  id: 'u-vendedor',
  email: 'v@sellea.com',
  role: 'TENANT_STAFF' as AuthUser['role'],
  whiteLabelId: SELLEA,
} as any;

let svc: SalesLeadsService;
let bd: ReturnType<typeof baseFalsa>['bd'];
let disparos: ReturnType<typeof automatizacionesFalsas>['disparos'];

function abrir(opts: Parameters<typeof baseFalsa>[0] = {}) {
  const f = baseFalsa(opts);
  bd = f.bd;
  const autos = automatizacionesFalsas();
  disparos = autos.disparos;
  svc = new SalesLeadsService(f.prisma as unknown as PrismaService, autos.svc);
  return f;
}

beforeEach(() => {
  abrir();
});

describe('las columnas se siembran solas la primera vez', () => {
  it('abrir el tablero deja las cinco de siempre, en orden', async () => {
    const t = await svc.tablero(VENDEDOR, 't1');
    expect(t.columnas.map((c: any) => c.kind)).toEqual([
      'CONTACTS',
      'INTERESTED',
      'FOLLOWUP',
      'CLIENT',
      'NOT_INTERESTED',
    ]);
  });

  it('abrirlo dos veces NO siembra dos juegos', async () => {
    await svc.tablero(VENDEDOR, 't1');
    const t = await svc.tablero(VENDEDOR, 't1');
    expect(t.columnas).toHaveLength(5);
  });
});

describe('el módulo apagado cierra la API, no solo el menú', () => {
  it('el tablero responde como si el equipo no existiera', async () => {
    abrir({ modulo: false });
    await expect(svc.tablero(VENDEDOR, 't1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('y tampoco deja crear leads', async () => {
    abrir({ modulo: false });
    await expect(
      svc.crearLead(VENDEDOR, 't1', { name: 'Ana' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('quién entra al tablero', () => {
  it('el admin de OTRA marca recibe 404: ese equipo no existe para él', async () => {
    abrir({ whiteLabelId: CLUBIFY });
    const adminSellea = { ...VENDEDOR, role: 'SUPER_ADMIN' } as AuthUser;
    await expect(svc.tablero(adminSellea, 't1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('quien no es miembro no entra, aunque tenga sesión', async () => {
    const deFuera = { ...VENDEDOR, id: 'u-de-fuera' } as AuthUser;
    await expect(svc.tablero(deFuera, 't1')).rejects.toThrow(/no perteneces/i);
  });

  it('un miembro DESACTIVADO tampoco', async () => {
    bd.miembros[0].isActive = false;
    await expect(svc.tablero(VENDEDOR, 't1')).rejects.toThrow(/no perteneces/i);
  });
});

describe('alta de leads', () => {
  it('el lead nace en la primera columna y deja rastro', async () => {
    const l = await svc.crearLead(VENDEDOR, 't1', { name: 'Ana Ruiz', phone: '3001112233' });
    expect(l.name).toBe('Ana Ruiz');
    expect(bd.actividades.some((a) => a.kind === 'sistema')).toBe(true);
  });

  it('el mismo teléfono NO crea un segundo lead: devuelve el que había', async () => {
    // Dos vendedores metiendo al mismo prospecto es la forma más rápida de que
    // dos personas lo llamen el mismo día.
    const a = await svc.crearLead(VENDEDOR, 't1', { name: 'Ana', phone: '300 111 2233' });
    const b = await svc.crearLead(VENDEDOR, 't1', { name: 'Ana R.', phone: '+57 3001112233' });
    expect(b.id).toBe(a.id);
    expect((b as any).yaExistia).toBe(true);
    expect(bd.leads).toHaveLength(1);
  });

  it('sin teléfono, dos con el mismo nombre SÍ son dos leads', async () => {
    await svc.crearLead(VENDEDOR, 't1', { name: 'Ana' });
    await svc.crearLead(VENDEDOR, 't1', { name: 'Ana' });
    expect(bd.leads).toHaveLength(2);
  });

  it('no se asigna a alguien que no está en el equipo', async () => {
    await expect(
      svc.crearLead(VENDEDOR, 't1', { name: 'Ana', assignedUserId: 'u-de-fuera' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('el correo se guarda normalizado', async () => {
    const l = await svc.crearLead(VENDEDOR, 't1', { name: 'Ana', email: '  ANA@X.COM ' });
    expect(l.email).toBe('ana@x.com');
  });

  it('una columna de OTRO equipo no vale como destino', async () => {
    await svc.tablero(VENDEDOR, 't1');
    bd.stages.push({ id: 'st-ajena', salesTeamId: 't2', name: 'De otro', position: 0 });
    await expect(
      svc.crearLead(VENDEDOR, 't1', { name: 'Ana', stageId: 'st-ajena' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('mover la tarjeta', () => {
  it('mover a Clientes sella la fecha de cierre', async () => {
    const t = await svc.tablero(VENDEDOR, 't1');
    const lead = await svc.crearLead(VENDEDOR, 't1', { name: 'Ana' });
    const clientes = t.columnas.find((c: any) => c.kind === 'CLIENT')!;
    const m = await svc.moverLead(VENDEDOR, 't1', lead.id, clientes.id);
    expect(m.wonAt).toBeTruthy();
  });

  it('volver a sacarlo de Clientes NO borra la fecha: el cierre pasó', async () => {
    const t = await svc.tablero(VENDEDOR, 't1');
    const lead = await svc.crearLead(VENDEDOR, 't1', { name: 'Ana' });
    const clientes = t.columnas.find((c: any) => c.kind === 'CLIENT')!;
    await svc.moverLead(VENDEDOR, 't1', lead.id, clientes.id);
    const fuera = await svc.moverLead(VENDEDOR, 't1', lead.id, t.columnas[0].id);
    expect(fuera.wonAt).toBeTruthy();
  });

  it('si otro lo movió antes, no se pisa su cambio', async () => {
    // El vendedor arrastra desde «Contactos», pero mientras tanto otro ya lo
    // pasó a «Interesados». Sin el candado, el que suelta último gana y el
    // primero no se entera de que su movimiento desapareció.
    const t = await svc.tablero(VENDEDOR, 't1');
    const [contactos, interesados, seguimiento] = t.columnas;
    const lead = await svc.crearLead(VENDEDOR, 't1', { name: 'Ana' });
    await svc.moverLead(VENDEDOR, 't1', lead.id, interesados.id, contactos.id);

    const tarde = await svc.moverLead(
      VENDEDOR,
      't1',
      lead.id,
      seguimiento.id,
      contactos.id, // lo que este vendedor creía
    );
    expect((tarde as any).sinCambios).toBe(true);
    expect(tarde.stageId).toBe(interesados.id);
  });

  it('sin decir de dónde venía, el movimiento se aplica igual', async () => {
    const t = await svc.tablero(VENDEDOR, 't1');
    const lead = await svc.crearLead(VENDEDOR, 't1', { name: 'Ana' });
    const m = await svc.moverLead(VENDEDOR, 't1', lead.id, t.columnas[2].id);
    expect(m.stageId).toBe(t.columnas[2].id);
  });

  it('cada movimiento queda anotado con las dos columnas', async () => {
    const t = await svc.tablero(VENDEDOR, 't1');
    const lead = await svc.crearLead(VENDEDOR, 't1', { name: 'Ana' });
    await svc.moverLead(VENDEDOR, 't1', lead.id, t.columnas[1].id);
    const etapa = bd.actividades.find((a) => a.kind === 'etapa');
    expect(etapa?.body).toBe('Contactos → Interesados');
  });
});

describe('borrar una columna', () => {
  it('los leads se mudan, no se borran', async () => {
    const t = await svc.tablero(VENDEDOR, 't1');
    const lead = await svc.crearLead(VENDEDOR, 't1', { name: 'Ana' });
    await svc.borrarColumna(VENDEDOR, 't1', t.columnas[0].id);
    expect(bd.leads).toHaveLength(1);
    expect(bd.leads[0].stageId).not.toBe(t.columnas[0].id);
    expect(bd.leads[0].stageId).toBe(t.columnas[1].id);
    void lead;
  });

  it('no se puede quedar sin columnas', async () => {
    const t = await svc.tablero(VENDEDOR, 't1');
    for (const c of t.columnas.slice(1)) await svc.borrarColumna(VENDEDOR, 't1', c.id);
    await expect(
      svc.borrarColumna(VENDEDOR, 't1', t.columnas[0].id),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('editar el lead', () => {
  it('cambiar el teléfono recalcula la clave de identidad', async () => {
    const l = await svc.crearLead(VENDEDOR, 't1', { name: 'Ana', phone: '3001112233' });
    await svc.editarLead(VENDEDOR, 't1', l.id, { phone: '3009998877' });
    expect(bd.leads[0].phoneKey).toBe('3009998877');
  });

  it('borrar el teléfono deja la clave en null, no colgada', async () => {
    // Una clave huérfana seguiría casando al lead con alguien que ya no es.
    const l = await svc.crearLead(VENDEDOR, 't1', { name: 'Ana', phone: '3001112233' });
    await svc.editarLead(VENDEDOR, 't1', l.id, { phone: '' });
    expect(bd.leads[0].phoneKey).toBeNull();
  });

  it('un lead de otro equipo no se edita', async () => {
    bd.leads.push({ id: 'lead-ajeno', salesTeamId: 't2', stageId: 'x', tags: [] });
    await expect(
      svc.editarLead(VENDEDOR, 't1', 'lead-ajeno', { name: 'Hola' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('notas', () => {
  it('anotar cuenta como actividad: el lead deja de parecer abandonado', async () => {
    const l = await svc.crearLead(VENDEDOR, 't1', { name: 'Ana' });
    const antes = bd.leads[0].lastActivityAt;
    await new Promise((r) => setTimeout(r, 5));
    await svc.anotarNota(VENDEDOR, 't1', l.id, { body: 'Llamada, pide precio' });
    expect(bd.leads[0].lastActivityAt.getTime()).toBeGreaterThan(antes.getTime());
  });

  it('una nota vacía se rechaza', async () => {
    const l = await svc.crearLead(VENDEDOR, 't1', { name: 'Ana' });
    await expect(
      svc.anotarNota(VENDEDOR, 't1', l.id, { body: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un tipo inventado cae en «nota», no da permisos ni rompe', async () => {
    const l = await svc.crearLead(VENDEDOR, 't1', { name: 'Ana' });
    await svc.anotarNota(VENDEDOR, 't1', l.id, { body: 'x', kind: 'inventado' });
    expect(bd.actividades.at(-1)?.kind).toBe('nota');
  });
});

describe('solo lectura mira y no toca', () => {
  it('puede abrir el tablero', async () => {
    bd.miembros[0].roles = ['lectura'];
    const t = await svc.tablero(VENDEDOR, 't1');
    expect(t.puedeEscribir).toBe(false);
  });

  it('no puede crear leads', async () => {
    bd.miembros[0].roles = ['lectura'];
    await expect(svc.crearLead(VENDEDOR, 't1', { name: 'Ana' })).rejects.toThrow(
      /solo lectura/i,
    );
  });

  it('ni mover tarjetas', async () => {
    const t = await svc.tablero(VENDEDOR, 't1');
    const lead = await svc.crearLead(VENDEDOR, 't1', { name: 'Ana' });
    bd.miembros[0].roles = ['lectura'];
    await expect(
      svc.moverLead(VENDEDOR, 't1', lead.id, t.columnas[1].id),
    ).rejects.toThrow(/solo lectura/i);
  });
});

describe('los disparadores de ventas', () => {
  it('un lead nuevo dispara «lead nuevo» con su columna', async () => {
    await svc.crearLead(VENDEDOR, 't1', { name: 'Ana', phone: '3001112233' });
    expect(disparos).toHaveLength(1);
    expect(disparos[0].evento).toBe('sales_lead_created');
    expect(disparos[0].ctx.etapa).toBe('Contactos');
  });

  it('un lead REPETIDO no vuelve a disparar', async () => {
    // Si no, dos vendedores metiendo al mismo prospecto le mandan la
    // bienvenida dos veces.
    await svc.crearLead(VENDEDOR, 't1', { name: 'Ana', phone: '3001112233' });
    await svc.crearLead(VENDEDOR, 't1', { name: 'Ana R.', phone: '+57 3001112233' });
    expect(disparos.filter((d) => d.evento === 'sales_lead_created')).toHaveLength(1);
  });

  it('mover a Clientes dispara «cambio de columna» Y «ganado»', async () => {
    const t = await svc.tablero(VENDEDOR, 't1');
    const lead = await svc.crearLead(VENDEDOR, 't1', { name: 'Ana' });
    const clientes = t.columnas.find((c: any) => c.kind === 'CLIENT')!;
    await svc.moverLead(VENDEDOR, 't1', lead.id, clientes.id);
    const eventos = disparos.map((d) => d.evento);
    expect(eventos).toContain('sales_stage_changed');
    expect(eventos).toContain('sales_lead_won');
    expect(eventos).not.toContain('sales_lead_lost');
  });

  it('mover a No interesados dispara «perdido», no «ganado»', async () => {
    const t = await svc.tablero(VENDEDOR, 't1');
    const lead = await svc.crearLead(VENDEDOR, 't1', { name: 'Ana' });
    const perdidos = t.columnas.find((c: any) => c.kind === 'NOT_INTERESTED')!;
    await svc.moverLead(VENDEDOR, 't1', lead.id, perdidos.id);
    const eventos = disparos.map((d) => d.evento);
    expect(eventos).toContain('sales_lead_lost');
    expect(eventos).not.toContain('sales_lead_won');
  });

  it('una columna intermedia NO dispara ni ganado ni perdido', async () => {
    const t = await svc.tablero(VENDEDOR, 't1');
    const lead = await svc.crearLead(VENDEDOR, 't1', { name: 'Ana' });
    await svc.moverLead(VENDEDOR, 't1', lead.id, t.columnas[1].id);
    const eventos = disparos.map((d) => d.evento);
    expect(eventos).toContain('sales_stage_changed');
    expect(eventos).not.toContain('sales_lead_won');
    expect(eventos).not.toContain('sales_lead_lost');
  });

  it('el contexto lleva la columna nueva Y la anterior', async () => {
    const t = await svc.tablero(VENDEDOR, 't1');
    const lead = await svc.crearLead(VENDEDOR, 't1', { name: 'Ana' });
    await svc.moverLead(VENDEDOR, 't1', lead.id, t.columnas[1].id);
    const cambio = disparos.find((d) => d.evento === 'sales_stage_changed')!;
    expect(cambio.ctx).toMatchObject({
      etapa: 'Interesados',
      etapa_anterior: 'Contactos',
    });
  });

  it('un movimiento que NO se aplicó (otro llegó antes) no dispara nada', async () => {
    // Disparar aquí mandaría el mensaje de una etapa a la que el lead no fue.
    const t = await svc.tablero(VENDEDOR, 't1');
    const [contactos, interesados, seguimiento] = t.columnas;
    const lead = await svc.crearLead(VENDEDOR, 't1', { name: 'Ana' });
    await svc.moverLead(VENDEDOR, 't1', lead.id, interesados.id, contactos.id);
    const antes = disparos.length;
    await svc.moverLead(VENDEDOR, 't1', lead.id, seguimiento.id, contactos.id);
    expect(disparos).toHaveLength(antes);
  });

  it('mover a la MISMA columna no dispara nada', async () => {
    const t = await svc.tablero(VENDEDOR, 't1');
    const lead = await svc.crearLead(VENDEDOR, 't1', { name: 'Ana' });
    const antes = disparos.length;
    await svc.moverLead(VENDEDOR, 't1', lead.id, t.columnas[0].id);
    expect(disparos).toHaveLength(antes);
  });
});
