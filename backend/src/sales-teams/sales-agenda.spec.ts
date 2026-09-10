import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { SalesAgendaService } from './sales-agenda.service';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { MktProviderService } from '../marketing/provider/mkt-provider.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';

/**
 * La agenda del equipo — fase 4.
 *
 * Lo que se prueba es lo que duele si falla: que no se agenden dos personas en
 * la misma hora, que el enlace público no sirva de llave maestra, que el
 * recordatorio no salga dos veces, y que con el módulo apagado la agenda
 * pública deje de existir.
 */

const SELLEA = 'wl-sellea';
type Fila = Record<string, any>;

function baseFalsa(opts: { modulo?: boolean; slug?: string | null } = {}) {
  const bd = {
    franjas: [] as Fila[],
    citas: [] as Fila[],
    leads: [] as Fila[],
    // A propósito VACÍO. Traer una columna puesta es lo que hizo que la
    // prueba pasara mientras producción perdía al prospecto: «Equipo Ecuador»
    // nunca había abierto su tablero. Aquí se siembra como en la vida real.
    stages: [] as Fila[],
    actividades: [] as Fila[],
    miembros: [
      { teamId: 't1', userId: 'u-vendedor', isActive: true, roles: ['closer'] },
    ] as Fila[],
  };
  let sec = 0;
  const id = (p: string) => `${p}-${++sec}`;
  const casa = (f: Fila, where: Fila = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('in' in v) return v.in.includes(f[k]);
        if ('gte' in v || 'lt' in v) {
          const t = f[k] instanceof Date ? f[k].getTime() : f[k];
          if ('gte' in v && t < new Date(v.gte).getTime()) return false;
          if ('lt' in v && t >= new Date(v.lt).getTime()) return false;
          return true;
        }
      }
      return f[k] === v;
    });

  const equipo = {
    id: 't1',
    name: 'Equipo Norte',
    slug: opts.slug === undefined ? 'norte' : opts.slug,
    whiteLabelId: SELLEA,
    isActive: true,
  };

  const enviados: any[] = [];
  const prisma: any = {
    salesTeam: {
      findUnique: async () => ({ ...equipo }),
      findFirst: async ({ where }: any) =>
        where?.slug && where.slug !== equipo.slug ? null : { ...equipo },
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
    salesAvailability: {
      findMany: async ({ where }: any) => bd.franjas.filter((f) => casa(f, where)),
      deleteMany: async ({ where }: any) => {
        const antes = bd.franjas.length;
        bd.franjas = bd.franjas.filter((f) => !casa(f, where));
        return { count: antes - bd.franjas.length };
      },
      createMany: async ({ data }: any) => {
        for (const d of data) bd.franjas.push({ id: id('av'), ...d });
        return { count: data.length };
      },
    },
    salesMeeting: {
      findMany: async ({ where, include }: any) =>
        bd.citas
          .filter((c) => casa(c, where))
          .map((c) => ({
            ...c,
            ...(include?.team ? { team: { name: equipo.name, whiteLabelId: equipo.whiteLabelId } } : {}),
            ...(include?.lead
              ? { lead: bd.leads.find((l) => l.id === c.leadId) ?? null }
              : {}),
          })),
      findUnique: async ({ where, include, select }: any) => {
        const c = bd.citas.find(
          (x) => x.id === where.id || x.manageToken === where.manageToken,
        );
        if (!c) return null;
        const extra: Fila = {};
        if (include?.team || select?.team) {
          extra.team = { name: equipo.name, whiteLabelId: equipo.whiteLabelId };
        }
        return { ...c, ...extra };
      },
      findFirst: async ({ where }: any) => bd.citas.find((c) => casa(c, where)) ?? null,
      create: async ({ data, include }: any) => {
        // Los valores por defecto de la tabla: en Postgres estas columnas
        // nacen en NULL, y `undefined` no casa con un `where` de `null`.
        const c = { id: id('cita'), reminderSentAt: null, leadId: null, hostUserId: null, ...data };
        bd.citas.push(c);
        return {
          ...c,
          ...(include?.lead ? { lead: bd.leads.find((l) => l.id === c.leadId) ?? null } : {}),
        };
      },
      update: async ({ where, data, include }: any) => {
        const c = bd.citas.find((x) => x.id === where.id)!;
        Object.assign(c, data);
        return {
          ...c,
          ...(include?.lead ? { lead: bd.leads.find((l) => l.id === c.leadId) ?? null } : {}),
        };
      },
      updateMany: async ({ where, data }: any) => {
        const tocadas = bd.citas.filter((c) => casa(c, where));
        for (const c of tocadas) Object.assign(c, data);
        return { count: tocadas.length };
      },
    },
    salesLead: {
      findFirst: async ({ where }: any) => bd.leads.find((l) => casa(l, where)) ?? null,
      create: async ({ data }: any) => {
        const l = { id: id('lead'), ...data };
        bd.leads.push(l);
        return { ...l };
      },
      update: async ({ where, data }: any) => {
        const l = bd.leads.find((x) => x.id === where.id)!;
        Object.assign(l, data);
        return { ...l };
      },
    },
    salesStage: {
      findFirst: async ({ where }: any) => bd.stages.find((s) => casa(s, where)) ?? null,
      findMany: async ({ where }: any) =>
        bd.stages.filter((s) => casa(s, where)).sort((a, b) => a.position - b.position),
      createMany: async ({ data }: any) => {
        for (const d of data) bd.stages.push({ id: id('st'), ...d });
        return { count: data.length };
      },
    },
    salesLeadActivity: {
      create: async ({ data }: any) => {
        const a = { id: id('act'), ...data };
        bd.actividades.push(a);
        return { ...a };
      },
    },
    $transaction: async (fn: any) => fn(prisma),
  };

  const mkt: any = {
    sendSms: async (input: any) => {
      enviados.push(input);
      return { ok: true };
    },
  };
  return { prisma, bd, mkt, enviados };
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

let svc: SalesAgendaService;
let bd: ReturnType<typeof baseFalsa>['bd'];
let enviados: any[];
let disparos: ReturnType<typeof automatizacionesFalsas>['disparos'];

function abrir(opts: Parameters<typeof baseFalsa>[0] = {}) {
  const f = baseFalsa(opts);
  bd = f.bd;
  enviados = f.enviados;
  const autos = automatizacionesFalsas();
  disparos = autos.disparos;
  svc = new SalesAgendaService(
    f.prisma as unknown as PrismaService,
    f.mkt as unknown as MktProviderService,
    autos.svc,
  );
}

/** Martes 8 de septiembre de 2026, 8 de la mañana en Bogotá. */
const MARTES_8AM = new Date('2026-09-08T13:00:00Z');
/** Un martes de 9 a 11, horario del equipo. */
const HORARIO_EQUIPO = {
  id: 'av1',
  salesTeamId: 't1',
  userId: null,
  weekday: 2,
  startMin: 540,
  endMin: 660,
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MARTES_8AM);
  abrir();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('el horario', () => {
  it('se guarda entero y se puede vaciar', async () => {
    await svc.guardarHorario(VENDEDOR, 't1', {
      franjas: [{ weekday: 2, startMin: 540, endMin: 660 }],
    });
    expect(bd.franjas).toHaveLength(1);

    await svc.guardarHorario(VENDEDOR, 't1', { franjas: [] });
    expect(bd.franjas).toHaveLength(0);
  });

  it('dos tramos que se pisan el mismo día se rechazan', async () => {
    // Ofrecerían el mismo hueco dos veces en la pantalla del vendedor.
    await expect(
      svc.guardarHorario(VENDEDOR, 't1', {
        franjas: [
          { weekday: 2, startMin: 540, endMin: 720 },
          { weekday: 2, startMin: 600, endMin: 780 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('los mismos tramos en días DISTINTOS sí valen', async () => {
    await svc.guardarHorario(VENDEDOR, 't1', {
      franjas: [
        { weekday: 2, startMin: 540, endMin: 720 },
        { weekday: 3, startMin: 540, endMin: 720 },
      ],
    });
    expect(bd.franjas).toHaveLength(2);
  });

  it('un fin anterior al inicio se rechaza', async () => {
    await expect(
      svc.guardarHorario(VENDEDOR, 't1', {
        franjas: [{ weekday: 2, startMin: 720, endMin: 540 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('no se le pone horario a quien no está en el equipo', async () => {
    await expect(
      svc.guardarHorario(VENDEDOR, 't1', {
        userId: 'u-de-fuera',
        franjas: [{ weekday: 2, startMin: 540, endMin: 660 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('los huecos', () => {
  beforeEach(() => {
    bd.franjas.push({ ...HORARIO_EQUIPO });
  });

  it('salen del horario del equipo', async () => {
    const r = await svc.huecos(VENDEDOR, 't1', { fecha: '2026-09-08' });
    expect(r.huecos.map((h) => h.label)).toEqual([
      '09:00',
      '09:15',
      '09:30',
      '09:45',
      '10:00',
      '10:15',
      '10:30',
    ]);
  });

  it('un día sin horario no ofrece nada', async () => {
    // Miércoles: el equipo solo tiene martes.
    const r = await svc.huecos(VENDEDOR, 't1', { fecha: '2026-09-09' });
    expect(r.huecos).toEqual([]);
  });

  it('el horario PROPIO del vendedor manda sobre el del equipo', async () => {
    bd.franjas.push({
      id: 'av2',
      salesTeamId: 't1',
      userId: 'u-vendedor',
      weekday: 2,
      startMin: 900, // 15:00
      endMin: 960,
    });
    const r = await svc.huecos(VENDEDOR, 't1', {
      fecha: '2026-09-08',
      hostUserId: 'u-vendedor',
    });
    expect(r.huecos.map((h) => h.label)).toEqual(['15:00', '15:15', '15:30']);
  });

  it('una cita ya puesta tapa su hora', async () => {
    await svc.agendar(VENDEDOR, 't1', { startAt: '2026-09-08T14:30:00Z' }); // 09:30
    const r = await svc.huecos(VENDEDOR, 't1', { fecha: '2026-09-08' });
    expect(r.huecos.map((h) => h.label)).not.toContain('09:30');
    expect(r.huecos.map((h) => h.label)).toContain('10:00');
  });

  it('una cita CANCELADA libera su hora', async () => {
    const c = await svc.agendar(VENDEDOR, 't1', { startAt: '2026-09-08T14:30:00Z' });
    await svc.cambiarEstado(VENDEDOR, 't1', c.id, 'CANCELADA');
    const r = await svc.huecos(VENDEDOR, 't1', { fecha: '2026-09-08' });
    expect(r.huecos.map((h) => h.label)).toContain('09:30');
  });

  it('una fecha inventada se rechaza en vez de devolver basura', async () => {
    await expect(
      svc.huecos(VENDEDOR, 't1', { fecha: '31 de febrero' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('agendar', () => {
  beforeEach(() => {
    bd.franjas.push({ ...HORARIO_EQUIPO });
  });

  it('la misma hora dos veces se rechaza', async () => {
    // Este es el caso real: dos prospectos con la pantalla abierta ven el
    // mismo hueco libre y pulsan casi a la vez.
    await svc.agendar(VENDEDOR, 't1', { startAt: '2026-09-08T14:30:00Z' });
    await expect(
      svc.agendar(VENDEDOR, 't1', { startAt: '2026-09-08T14:30:00Z' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(bd.citas).toHaveLength(1);
  });

  it('una hora que SOLAPA a medias también se rechaza', async () => {
    await svc.agendar(VENDEDOR, 't1', {
      startAt: '2026-09-08T14:30:00Z',
      durationMin: 60,
    });
    await expect(
      svc.agendar(VENDEDOR, 't1', { startAt: '2026-09-08T15:00:00Z' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('una cita que empieza justo al terminar la anterior SÍ entra', async () => {
    await svc.agendar(VENDEDOR, 't1', { startAt: '2026-09-08T14:30:00Z' }); // 30 min
    await svc.agendar(VENDEDOR, 't1', { startAt: '2026-09-08T15:00:00Z' });
    expect(bd.citas).toHaveLength(2);
  });

  it('dos vendedores DISTINTOS pueden tener cita a la misma hora', async () => {
    bd.miembros.push({ teamId: 't1', userId: 'u-otro', isActive: true, roles: ['closer'] });
    await svc.agendar(VENDEDOR, 't1', {
      startAt: '2026-09-08T14:30:00Z',
      hostUserId: 'u-vendedor',
    });
    await svc.agendar(VENDEDOR, 't1', {
      startAt: '2026-09-08T14:30:00Z',
      hostUserId: 'u-otro',
    });
    expect(bd.citas).toHaveLength(2);
  });

  it('una hora que ya pasó se rechaza', async () => {
    await expect(
      svc.agendar(VENDEDOR, 't1', { startAt: '2026-09-01T14:00:00Z' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cada cita nace con su propio token, y es largo', async () => {
    const a = await svc.agendar(VENDEDOR, 't1', { startAt: '2026-09-08T14:30:00Z' });
    const b = await svc.agendar(VENDEDOR, 't1', { startAt: '2026-09-08T15:00:00Z' });
    expect(a.manageToken).not.toBe(b.manageToken);
    expect(a.manageToken.length).toBe(32);
  });

  it('agendar con un lead deja rastro en su historial', async () => {
    bd.leads.push({ id: 'lead-1', salesTeamId: 't1', stageId: 'st1' });
    await svc.agendar(VENDEDOR, 't1', {
      leadId: 'lead-1',
      startAt: '2026-09-08T14:30:00Z',
    });
    expect(bd.actividades.some((a) => a.kind === 'cita')).toBe(true);
  });

  it('un lead de otro equipo no vale', async () => {
    bd.leads.push({ id: 'lead-ajeno', salesTeamId: 't2', stageId: 'x' });
    await expect(
      svc.agendar(VENDEDOR, 't1', {
        leadId: 'lead-ajeno',
        startAt: '2026-09-08T14:30:00Z',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('la agenda pública', () => {
  beforeEach(() => {
    bd.franjas.push({ ...HORARIO_EQUIPO });
  });

  it('el prospecto que reserva ENTRA al tablero', async () => {
    // Si no, la cita queda huérfana: el vendedor no la ve en su embudo y el
    // recordatorio no tiene a quién avisar.
    await svc.reservarPublico('norte', {
      startAt: '2026-09-08T14:30:00Z',
      name: 'Ana Ruiz',
      phone: '3001112233',
    });
    expect(bd.leads).toHaveLength(1);
    expect(bd.leads[0].source).toBe('agenda');
    expect(bd.citas[0].leadId).toBe(bd.leads[0].id);
  });

  it('un equipo SIN tablero estrenado tambien recoge al prospecto', async () => {
    // El fallo real: «Equipo Ecuador» se creo en agosto, nadie abrio su
    // tablero, y quien reservaba por el enlace desaparecia. La cita quedaba y
    // la persona no: el vendedor veia un hueco ocupado sin saber de quien.
    expect(bd.stages).toHaveLength(0);
    await svc.reservarPublico('norte', {
      startAt: '2026-09-08T14:30:00Z',
      name: 'Ana Ruiz',
      phone: '3001112233',
    });
    expect(bd.stages.length).toBeGreaterThan(0);
    expect(bd.leads).toHaveLength(1);
    expect(bd.citas[0].leadId).toBe(bd.leads[0].id);
  });

  it('reagendar NO crea una segunda tarjeta de la misma persona', async () => {
    await svc.reservarPublico('norte', {
      startAt: '2026-09-08T14:30:00Z',
      phone: '300 111 2233',
    });
    await svc.reservarPublico('norte', {
      startAt: '2026-09-08T15:00:00Z',
      phone: '+57 3001112233',
    });
    expect(bd.leads).toHaveLength(1);
    expect(bd.citas).toHaveLength(2);
  });

  it('devuelve el token y NUNCA el id de la cita', async () => {
    const r = await svc.reservarPublico('norte', {
      startAt: '2026-09-08T14:30:00Z',
      phone: '3001112233',
    });
    expect(r.manageToken).toBeTruthy();
    expect(Object.keys(r)).not.toContain('id');
  });

  it('un equipo que no existe no dice que no existe: dice que no hay agenda', async () => {
    await expect(svc.calendarioPublico('inventado')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('con el módulo apagado, la agenda pública deja de existir', async () => {
    abrir({ modulo: false });
    bd.franjas.push({ ...HORARIO_EQUIPO });
    await expect(svc.calendarioPublico('norte')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      svc.reservarPublico('norte', { startAt: '2026-09-08T14:30:00Z' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('el enlace de la cita', () => {
  beforeEach(() => {
    bd.franjas.push({ ...HORARIO_EQUIPO });
  });

  it('el token abre SU cita', async () => {
    const c = await svc.agendar(VENDEDOR, 't1', { startAt: '2026-09-08T14:30:00Z' });
    const vista = await svc.verPorToken(c.manageToken);
    expect(vista.status).toBe('PENDIENTE');
  });

  it('un token inventado no abre nada', async () => {
    await expect(svc.verPorToken('no-existe')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('cancelar desde el enlace funciona, y dos veces no rompe', async () => {
    const c = await svc.agendar(VENDEDOR, 't1', { startAt: '2026-09-08T14:30:00Z' });
    const uno = await svc.cancelarPorToken(c.manageToken);
    expect(uno.yaEstaba).toBe(false);
    const dos = await svc.cancelarPorToken(c.manageToken);
    expect(dos.yaEstaba).toBe(true);
    expect(bd.citas[0].status).toBe('CANCELADA');
  });

  it('una cita REALIZADA no se deshace desde un enlace público', async () => {
    const c = await svc.agendar(VENDEDOR, 't1', { startAt: '2026-09-08T14:30:00Z' });
    await svc.cambiarEstado(VENDEDOR, 't1', c.id, 'REALIZADA');
    const r = await svc.cancelarPorToken(c.manageToken);
    expect(r.yaEstaba).toBe(true);
    expect(bd.citas[0].status).toBe('REALIZADA');
  });
});

describe('el recordatorio', () => {
  beforeEach(() => {
    bd.franjas.push({ ...HORARIO_EQUIPO });
    bd.leads.push({
      id: 'lead-1',
      salesTeamId: 't1',
      stageId: 'st1',
      name: 'Ana Ruiz',
      phone: '3001112233',
      source: 'manual',
    });
  });

  it('avisa de la cita que empieza dentro de la hora', async () => {
    await svc.agendar(VENDEDOR, 't1', {
      leadId: 'lead-1',
      startAt: '2026-09-08T13:30:00Z', // dentro de 30 min
    });
    await svc.recordarCitas();
    expect(enviados).toHaveLength(1);
    expect(enviados[0].toPhone).toBe('3001112233');
    expect(enviados[0].message).toContain('Ana');
  });

  it('DOS pasadas del cron NO mandan dos veces', async () => {
    // El candado: `reminderSentAt` se reclama con un UPDATE condicional ANTES
    // de mandar. Sin él, dos ciclos solapados avisan dos veces.
    await svc.agendar(VENDEDOR, 't1', {
      leadId: 'lead-1',
      startAt: '2026-09-08T13:30:00Z',
    });
    await svc.recordarCitas();
    await svc.recordarCitas();
    expect(enviados).toHaveLength(1);
  });

  it('no avisa de lo que está lejos', async () => {
    await svc.agendar(VENDEDOR, 't1', {
      leadId: 'lead-1',
      startAt: '2026-09-08T18:00:00Z', // dentro de 5 horas
    });
    await svc.recordarCitas();
    expect(enviados).toHaveLength(0);
  });

  it('no avisa de una cita cancelada', async () => {
    const c = await svc.agendar(VENDEDOR, 't1', {
      leadId: 'lead-1',
      startAt: '2026-09-08T13:30:00Z',
    });
    await svc.cambiarEstado(VENDEDOR, 't1', c.id, 'CANCELADA');
    await svc.recordarCitas();
    expect(enviados).toHaveLength(0);
  });

  it('un teléfono que escribió alguien sin sesión va marcado', async () => {
    // El tope de envíos tiene que contarlo: reservar y cancelar en bucle es
    // la forma de usar el remitente de la marca contra un tercero.
    bd.leads[0].source = 'agenda';
    await svc.agendar(VENDEDOR, 't1', {
      leadId: 'lead-1',
      startAt: '2026-09-08T13:30:00Z',
    });
    await svc.recordarCitas();
    expect(enviados[0].ctx.destinatarioSinVerificar).toBe(true);
  });

  it('una cita sin lead no manda nada, pero tampoco revienta', async () => {
    await svc.agendar(VENDEDOR, 't1', { startAt: '2026-09-08T13:30:00Z' });
    await expect(svc.recordarCitas()).resolves.toBeUndefined();
    expect(enviados).toHaveLength(0);
  });
});

describe('los disparadores de la agenda', () => {
  beforeEach(() => {
    bd.franjas.push({ ...HORARIO_EQUIPO });
    bd.leads.push({ id: 'lead-1', salesTeamId: 't1', stageId: 'st1', phone: '3001112233' });
  });

  it('agendar con lead dispara «cita agendada»', async () => {
    await svc.agendar(VENDEDOR, 't1', {
      leadId: 'lead-1',
      startAt: '2026-09-08T14:30:00Z',
    });
    expect(disparos.map((d) => d.evento)).toContain('sales_meeting_booked');
  });

  it('una cita SIN lead no dispara nada: no hay a quién escribirle', async () => {
    await svc.agendar(VENDEDOR, 't1', { startAt: '2026-09-08T14:30:00Z' });
    expect(disparos).toHaveLength(0);
  });

  it('la reserva pública también dispara: el lead lo crea ella misma', async () => {
    await svc.reservarPublico('norte', {
      startAt: '2026-09-08T15:00:00Z',
      name: 'Nueva Persona',
      phone: '3007776655',
    });
    expect(disparos.map((d) => d.evento)).toContain('sales_meeting_booked');
  });

  it('marcar «no asistió» dispara su evento', async () => {
    const c = await svc.agendar(VENDEDOR, 't1', {
      leadId: 'lead-1',
      startAt: '2026-09-08T14:30:00Z',
    });
    await svc.cambiarEstado(VENDEDOR, 't1', c.id, 'NO_ASISTIO');
    expect(disparos.map((d) => d.evento)).toContain('sales_meeting_no_show');
  });

  it('los OTROS estados no disparan: los ve el vendedor en su agenda', async () => {
    const c = await svc.agendar(VENDEDOR, 't1', {
      leadId: 'lead-1',
      startAt: '2026-09-08T14:30:00Z',
    });
    const antes = disparos.length;
    await svc.cambiarEstado(VENDEDOR, 't1', c.id, 'CONFIRMADA');
    await svc.cambiarEstado(VENDEDOR, 't1', c.id, 'REALIZADA');
    await svc.cambiarEstado(VENDEDOR, 't1', c.id, 'CANCELADA');
    expect(disparos).toHaveLength(antes);
  });
});
