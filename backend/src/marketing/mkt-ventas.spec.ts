import { describe, it, expect, vi } from 'vitest';
import { MktEngineService } from './mkt-engine.service';
import {
  diaEnBogota,
  elegirCitaDeReferencia,
  elegirPorNombre,
  horaEnBogota,
  momentoDeLaCita,
  queHacerSiYaPaso,
  refDeEvento,
} from './mkt-ventas.util';
import { catalogoDeContactos, MKT_NODE_TYPES, MKT_TRIGGERS } from './mkt-workflow.util';
import { etiquetaDeDisparador } from '../superadmin/brand-workflows/wf-filtros.util';

/**
 * Los pasos y disparadores que tocan EQUIPOS DE VENTAS (2026-09-22).
 *
 * Lo que puede costar dinero o credibilidad aquí, y por eso se prueba:
 *   · que una acción escriba en el equipo de OTRA marca (el peor de todos),
 *   · que un reintento cree la tarea o la oportunidad DOS veces,
 *   · que «cancelar cita» voltee un plantón y esconda lo que de verdad pasó,
 *   · que el barrido de cada hora inscriba dos veces por el mismo cambio —
 *     su ventana solapa a propósito con la vuelta anterior,
 *   · que «Ir a un paso» se quede dando vueltas para siempre,
 *   · y que un {{merge}} de la cita salga con un dato inventado.
 *
 * El motor no se instancia con Nest: se le pone a mano un prisma falso que
 * aplica el `where` TAL CUAL, para que un filtro que el motor se deje (el de la
 * marca, por ejemplo) devuelva la fila de la otra marca igual que lo haría
 * Postgres. Un falso que ignorara el `where` no vigilaría nada.
 */

const MARCA = 'marca-sellea';
const OTRA_MARCA = 'marca-ajena';
const EQUIPO = 'equipo-1';

// ── Un Prisma falso que se toma el `where` en serio ────────────────────────

function casaWhere(fila: Record<string, unknown>, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([campo, cond]) => {
    if (campo === 'NOT') return !casaWhere(fila, cond as Record<string, unknown>);
    if (campo === 'AND') return (cond as Record<string, unknown>[]).every((c) => casaWhere(fila, c));
    if (campo === 'OR') return (cond as Record<string, unknown>[]).some((c) => casaWhere(fila, c));
    // Filtro sobre un campo JSON: { context: { path: ['x'], equals: true } }
    if (cond && typeof cond === 'object' && 'path' in (cond as object)) {
      const c = cond as { path: string[]; equals: unknown };
      const v = c.path.reduce<any>((acc, k) => (acc == null ? acc : acc[k]), fila[campo]);
      return v === c.equals;
    }
    return casaCond(fila[campo], cond);
  });
}

function casaCond(valor: unknown, cond: unknown): boolean {
  if (cond instanceof Date) return valor instanceof Date && valor.getTime() === cond.getTime();
  if (cond === null || typeof cond !== 'object') return valor === cond;
  const ops = cond as Record<string, any>;
  return Object.entries(ops).every(([op, v]) => {
    switch (op) {
      case 'in':
        return (v as unknown[]).some((x) => casaCond(valor, x));
      case 'notIn':
        return !(v as unknown[]).some((x) => casaCond(valor, x));
      case 'not':
        return !casaCond(valor, v);
      case 'gte':
        return (valor as any) >= v;
      case 'lte':
        return (valor as any) <= v;
      case 'gt':
        return (valor as any) > v;
      case 'lt':
        return (valor as any) < v;
      default:
        // Una relación: { team: { whiteLabelId: 'x' } }
        return casaWhere((valor ?? {}) as Record<string, unknown>, cond as Record<string, unknown>);
    }
  });
}

function ordenar(filas: any[], orderBy: any): any[] {
  const reglas = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Record<string, string>[];
  return [...filas].sort((a, b) => {
    for (const r of reglas) {
      const [campo, dir] = Object.entries(r)[0];
      const va = a[campo];
      const vb = b[campo];
      if (va === vb) continue;
      const menor = va instanceof Date && vb instanceof Date ? va.getTime() < vb.getTime() : va < vb;
      return (menor ? -1 : 1) * (dir === 'desc' ? -1 : 1);
    }
    return 0;
  });
}

type Registro = { modelo: string; op: string; where?: any; data?: any };

function tabla(nombre: string, filas: any[], reg: Registro[]) {
  const buscar = ({ where, orderBy }: any = {}) => ordenar(filas.filter((f) => casaWhere(f, where)), orderBy);
  return {
    findFirst: async (args: any = {}) => {
      reg.push({ modelo: nombre, op: 'findFirst', where: args.where });
      return buscar(args)[0] ?? null;
    },
    findMany: async (args: any = {}) => {
      reg.push({ modelo: nombre, op: 'findMany', where: args.where });
      return buscar(args);
    },
    findUnique: async (args: any = {}) => {
      reg.push({ modelo: nombre, op: 'findUnique', where: args.where });
      return filas.find((f) => casaWhere(f, args.where)) ?? null;
    },
    count: async (args: any = {}) => buscar(args).length,
    create: async ({ data }: any) => {
      reg.push({ modelo: nombre, op: 'create', data });
      const fila = { id: `${nombre}-${filas.length + 1}`, ...data };
      filas.push(fila);
      return fila;
    },
    update: async ({ where, data }: any) => {
      reg.push({ modelo: nombre, op: 'update', where, data });
      const fila = filas.find((f) => casaWhere(f, where));
      if (fila) Object.assign(fila, data);
      return fila ?? { id: where?.id, ...data };
    },
    updateMany: async ({ where, data }: any) => {
      reg.push({ modelo: nombre, op: 'updateMany', where, data });
      const afectadas = filas.filter((f) => casaWhere(f, where));
      for (const f of afectadas) Object.assign(f, data);
      return { count: afectadas.length };
    },
  };
}

type Mundo = {
  contactos?: any[];
  leads?: any[];
  citas?: any[];
  oportunidades?: any[];
  embudos?: any[];
  etapas?: any[];
  miembros?: any[];
  tareas?: any[];
  flujos?: any[];
  inscripciones?: any[];
  equipos?: any[];
};

const CONTACTO = {
  id: 'c1',
  whiteLabelId: MARCA,
  name: 'Ana',
  email: 'ana@ejemplo.com',
  phone: '+573001112233',
  company: 'Wok',
  tags: ['vip'],
  deleted: false,
  optOut: false,
};
const LEAD = {
  id: 'l1',
  mktContactId: 'c1',
  whiteLabelId: MARCA,
  salesTeamId: EQUIPO,
  name: 'Ana',
  assignedUserId: 'u-vendedor',
  lastActivityAt: new Date('2026-09-20T10:00:00Z'),
};

function motor(m: Mundo = {}) {
  const reg: Registro[] = [];
  const enrolls: { wfId: string; contactId: string; contexto?: any }[] = [];
  const prisma: any = {
    mktContact: tabla('mktContact', m.contactos ?? [{ ...CONTACTO }], reg),
    whiteLabel: tabla('whiteLabel', [{ id: MARCA, name: 'Sellea' }, { id: OTRA_MARCA, name: 'Otra' }], reg),
    mktWorkflow: tabla('mktWorkflow', m.flujos ?? [], reg),
    // La inscripción tiene que existir de verdad: el candado de «hazlo una
    // sola vez» es un UPDATE condicional sobre ESTA fila, y sin ella ningún
    // paso que cree algo llegaría a crearlo.
    mktEnrollment: tabla(
      'mktEnrollment',
      m.inscripciones ?? [{ id: 'e1', contactId: 'c1', whiteLabelId: MARCA, workflowId: 'wf1', status: 'active', context: {} }],
      reg,
    ),
    salesLead: tabla('salesLead', m.leads ?? [{ ...LEAD }], reg),
    salesMeeting: tabla('salesMeeting', m.citas ?? [], reg),
    salesOpportunity: tabla('salesOpportunity', m.oportunidades ?? [], reg),
    salesPipeline: tabla('salesPipeline', m.embudos ?? [], reg),
    salesPipelineStage: tabla('salesPipelineStage', m.etapas ?? [], reg),
    salesTeamMember: tabla('salesTeamMember', m.miembros ?? [], reg),
    salesTask: tabla('salesTask', m.tareas ?? [], reg),
    salesTeam: tabla('salesTeam', m.equipos ?? [{ id: EQUIPO, whiteLabelId: MARCA, name: 'Cierre' }], reg),
    user: tabla('user', [{ id: 'u-vendedor', fullName: 'Pedro', email: 'pedro@x.com' }], reg),
  };
  const svc = Object.create(MktEngineService.prototype) as any;
  svc.prisma = prisma;
  svc.actions = { dispatch: vi.fn(async () => ({})) };
  svc.log = { warn: vi.fn(), log: vi.fn() };
  svc.enroll = vi.fn(async (wfId: string, contactId: string, contexto?: any) => {
    enrolls.push({ wfId, contactId, contexto });
    return 'inscrito';
  });
  const creados = (modelo: string) => reg.filter((r) => r.modelo === modelo && r.op === 'create').map((r) => r.data);
  const wheres = (modelo: string, op: string) => reg.filter((r) => r.modelo === modelo && r.op === op).map((r) => r.where);
  return { svc, prisma, reg, enrolls, creados, wheres };
}

const FLUJO = { id: 'wf1', whiteLabelId: MARCA, drip: {}, sendWindow: {} };
const inscripcion = (context: any = {}) => ({ id: 'e1', contactId: 'c1', context });

const correr = (svc: any, node: any, enr: any = inscripcion(), wf: any = FLUJO) =>
  svc.runNode(wf, { config: {}, ...node }, enr);

// ── Los helpers puros ──────────────────────────────────────────────────────

describe('elegir embudo o etapa por nombre', () => {
  const lista = [
    { id: 'p1', name: 'Chat general' },
    { id: 'p2', name: 'Closers' },
  ];

  it('sin nombre configurado vale el primero', () => {
    expect(elegirPorNombre(lista, '')?.id).toBe('p1');
  });

  it('da igual cómo se teclee: tildes y mayúsculas', () => {
    expect(elegirPorNombre([{ id: 'p3', name: 'Reunión' }], 'REUNION')?.id).toBe('p3');
  });

  it('un nombre que ese equipo no tiene devuelve null, NO el primero', () => {
    // Caer en otra columna porque la configurada no existe es peor que no hacer
    // nada: el equipo trabajaría la tarjeta como si alguien lo hubiera decidido.
    expect(elegirPorNombre(lista, 'Embudo de otro equipo')).toBeNull();
  });
});

describe('de qué cita habla el flujo', () => {
  const cita = (iso: string) => ({ id: iso, startAt: new Date(iso) });
  const AHORA = new Date('2026-09-22T12:00:00Z').getTime();

  it('la próxima que viene, aunque haya otras más adelante', () => {
    const elegida = elegirCitaDeReferencia(
      [cita('2026-09-30T12:00:00Z'), cita('2026-09-23T12:00:00Z')],
      AHORA,
    );
    expect(elegida?.id).toBe('2026-09-23T12:00:00Z');
  });

  it('si ya no queda ninguna por delante, la última que tuvo', () => {
    // Sin esto, un seguimiento de «un día DESPUÉS de la reunión» no encuentra
    // cita nunca: cuando ese paso se evalúa, la reunión ya pasó.
    const elegida = elegirCitaDeReferencia([cita('2026-09-01T12:00:00Z'), cita('2026-09-20T12:00:00Z')], AHORA);
    expect(elegida?.id).toBe('2026-09-20T12:00:00Z');
  });

  it('sin citas, null', () => {
    expect(elegirCitaDeReferencia([], AHORA)).toBeNull();
  });
});

describe('el momento de la espera relativa a la cita', () => {
  const CITA = new Date('2026-09-22T15:00:00Z');

  it('2 horas antes', () => {
    expect(momentoDeLaCita(CITA, { direction: 'before', amount: 2, unit: 'hours' })).toBe(
      CITA.getTime() - 2 * 3600000,
    );
  });

  it('1 día después', () => {
    expect(momentoDeLaCita(CITA, { direction: 'after', amount: 1, unit: 'days' })).toBe(
      CITA.getTime() + 86400000,
    );
  });

  it('sin cantidad NO es «a la hora de la cita»: mínimo 1', () => {
    // Con un 0 el recordatorio de «1 hora antes» salía justo cuando empezaba la
    // reunión, que es cuando ya no sirve para nada.
    expect(momentoDeLaCita(CITA, { direction: 'before', unit: 'hours' })).toBe(CITA.getTime() - 3600000);
  });
});

describe('qué hacer si el momento ya pasó', () => {
  it('antes de la cita: sacarlo (el recordatorio ya no sirve)', () => {
    expect(queHacerSiYaPaso({ direction: 'before' })).toBe('salir');
  });

  it('después de la cita: seguir (el seguimiento vale igual, tarde)', () => {
    expect(queHacerSiYaPaso({ direction: 'after' })).toBe('seguir');
  });

  it('lo que diga el paso manda sobre lo automático', () => {
    expect(queHacerSiYaPaso({ direction: 'before', siYaPaso: 'seguir' })).toBe('seguir');
  });
});

describe('fecha y hora de Bogotá', () => {
  it('la madrugada UTC todavía es el día anterior en Bogotá', () => {
    // Una tarea creada a las 02:00 UTC vence HOY en Bogotá, no mañana.
    expect(diaEnBogota(Date.parse('2026-09-23T02:00:00Z'))).toBe('2026-09-22');
  });

  it('la hora se da en Bogotá, no en UTC', () => {
    expect(horaEnBogota(new Date('2026-09-22T15:00:00Z'))).toBe('10:00');
  });
});

// ── Crear tarea ────────────────────────────────────────────────────────────

const PASO_TAREA = { id: 'n1', type: 'create_task', next: 'n2' };

describe('crear tarea', () => {
  it('la crea en el equipo y sobre el lead del contacto', async () => {
    const { svc, creados } = motor();
    const r = await correr(svc, { ...PASO_TAREA, config: { titulo: 'Llamar a {{nombre}}', detalle: 'Ya respondió', vence: 2 } });
    expect(creados('salesTask')).toEqual([
      expect.objectContaining({
        salesTeamId: EQUIPO,
        leadId: 'l1',
        title: 'Llamar a Ana',
        body: 'Ya respondió',
        assignedUserId: 'u-vendedor',
      }),
    ]);
    expect(r).toEqual({ kind: 'continue', next: 'n2' });
  });

  it('NO crea dos veces aunque el paso se repita (reintento del cron)', async () => {
    // Cada vuelta llega con una inscripción RECIÉN leída de la base, como
    // después de un reinicio: quien tiene que decir «esto ya está hecho» es el
    // UPDATE condicional, no la copia en memoria.
    const { svc, creados } = motor();
    await correr(svc, { ...PASO_TAREA, config: { titulo: 'Llamar' } }, inscripcion());
    await correr(svc, { ...PASO_TAREA, config: { titulo: 'Llamar' } }, inscripcion());
    expect(creados('salesTask')).toHaveLength(1);
  });

  it('pero una vuelta nueva del flujo SÍ crea otra tarea', async () => {
    // «Espera un día e insiste» es un diseño legítimo: si el candado mirara
    // solo el nodo, la segunda vuelta se quedaría sin tarea y sin decir nada.
    const { svc, creados } = motor();
    await correr(svc, { ...PASO_TAREA, config: { titulo: 'Llamar' } }, inscripcion({ saltosDePaso: 0 }));
    await correr(svc, { ...PASO_TAREA, config: { titulo: 'Llamar' } }, inscripcion({ saltosDePaso: 1 }));
    expect(creados('salesTask')).toHaveLength(2);
  });

  it('un contacto de OTRA marca no crea nada en el equipo de esta', async () => {
    // El lead existe y es del mismo contacto, pero es de otra marca. Sin el
    // filtro por marca, el flujo de Sellea escribiría en el equipo de la otra.
    const { svc, creados } = motor({ leads: [{ ...LEAD, whiteLabelId: OTRA_MARCA }] });
    const r = await correr(svc, { ...PASO_TAREA, config: { titulo: 'Llamar' } });
    expect(creados('salesTask')).toEqual([]);
    expect(r).toEqual({ kind: 'continue', next: 'n2' });
  });

  it('sin acción configurada no crea nada y el flujo sigue', async () => {
    const { svc, creados } = motor();
    const r = await correr(svc, { ...PASO_TAREA, config: { titulo: '   ' } });
    expect(creados('salesTask')).toEqual([]);
    expect(r).toEqual({ kind: 'continue', next: 'n2' });
  });

  it('una persona que no está en el equipo del lead no se queda la tarea', async () => {
    const { svc, creados } = motor({ miembros: [{ id: 'm1', teamId: 'otro-equipo', userId: 'u-ajeno', isActive: true }] });
    await correr(svc, { ...PASO_TAREA, config: { titulo: 'Llamar', asignarA: 'u-ajeno' } });
    expect(creados('salesTask')[0].assignedUserId).toBe('u-vendedor');
  });

  it('un miembro del equipo sí se la queda', async () => {
    const { svc, creados } = motor({ miembros: [{ id: 'm1', teamId: EQUIPO, userId: 'u-setter', isActive: true }] });
    await correr(svc, { ...PASO_TAREA, config: { titulo: 'Llamar', asignarA: 'u-setter' } });
    expect(creados('salesTask')[0].assignedUserId).toBe('u-setter');
  });

  it('sin días de vencimiento la tarea queda sin fecha', async () => {
    const { svc, creados } = motor();
    await correr(svc, { ...PASO_TAREA, config: { titulo: 'Llamar', vence: '' } });
    expect(creados('salesTask')[0].dueDate).toBeNull();
  });
});

// ── Oportunidades ──────────────────────────────────────────────────────────

const EMBUDOS = [
  { id: 'p1', salesTeamId: EQUIPO, name: 'Closers', position: 0 },
  { id: 'p9', salesTeamId: 'otro-equipo', name: 'Closers', position: 0 },
];
const ETAPAS = [
  { id: 's1', pipelineId: 'p1', salesTeamId: EQUIPO, name: 'Agendado', position: 0 },
  { id: 's2', pipelineId: 'p1', salesTeamId: EQUIPO, name: 'Propuesta', position: 1 },
  { id: 's9', pipelineId: 'p9', salesTeamId: 'otro-equipo', name: 'Agendado', position: 0 },
];

describe('crear oportunidad', () => {
  const paso = (config: any) => ({ id: 'n1', type: 'create_opportunity', next: 'n2', config });

  it('nace en el embudo y la etapa de ESE nombre dentro del equipo del lead', async () => {
    const { svc, creados } = motor({ embudos: EMBUDOS, etapas: ETAPAS });
    await correr(svc, paso({ embudo: 'Closers', etapa: 'Propuesta', valor: 1500 }));
    expect(creados('salesOpportunity')).toEqual([
      expect.objectContaining({
        salesTeamId: EQUIPO,
        whiteLabelId: MARCA,
        pipelineId: 'p1', // el de SU equipo, no el homónimo de «otro-equipo»
        stageId: 's2',
        leadId: 'l1',
        name: 'Ana',
        value: 1500,
        source: 'flujo',
      }),
    ]);
  });

  it('si ya tiene una ABIERTA en ese embudo la mueve, no la duplica', async () => {
    const { svc, creados, reg } = motor({
      embudos: EMBUDOS,
      etapas: ETAPAS,
      oportunidades: [
        { id: 'o1', leadId: 'l1', salesTeamId: EQUIPO, pipelineId: 'p1', stageId: 's1', status: 'abierta', position: 0, updatedAt: new Date() },
      ],
    });
    await correr(svc, paso({ embudo: 'Closers', etapa: 'Propuesta' }));
    expect(creados('salesOpportunity')).toEqual([]);
    const movida = reg.find((r) => r.modelo === 'salesOpportunity' && r.op === 'updateMany');
    expect(movida?.data).toMatchObject({ stageId: 's2' });
  });

  it('una oportunidad ya GANADA no bloquea: se abre una nueva', async () => {
    const { svc, creados } = motor({
      embudos: EMBUDOS,
      etapas: ETAPAS,
      oportunidades: [
        { id: 'o1', leadId: 'l1', salesTeamId: EQUIPO, pipelineId: 'p1', stageId: 's1', status: 'ganada', position: 0, updatedAt: new Date() },
      ],
    });
    await correr(svc, paso({ embudo: 'Closers', etapa: 'Agendado' }));
    expect(creados('salesOpportunity')).toHaveLength(1);
  });

  it('un embudo que el equipo no tiene no crea nada', async () => {
    const { svc, creados } = motor({ embudos: EMBUDOS, etapas: ETAPAS });
    const r = await correr(svc, paso({ embudo: 'Embudo inventado' }));
    expect(creados('salesOpportunity')).toEqual([]);
    expect(r).toEqual({ kind: 'continue', next: 'n2' });
  });

  it('NO crea dos veces si el paso se repite', async () => {
    const { svc, creados } = motor({ embudos: EMBUDOS, etapas: ETAPAS });
    // La segunda vuelta ve la oportunidad recién creada y la trata como «ya la
    // tiene»; el candado del contexto cubre además la carrera entre las dos
    // comprobaciones.
    await correr(svc, paso({ embudo: 'Closers', etapa: 'Agendado' }), inscripcion());
    await correr(svc, paso({ embudo: 'Closers', etapa: 'Agendado' }), inscripcion());
    expect(creados('salesOpportunity')).toHaveLength(1);
  });
});

describe('actualizar oportunidad', () => {
  const paso = (config: any) => ({ id: 'n1', type: 'update_opportunity', next: 'n2', config });
  const mundo = (status = 'abierta') => ({
    embudos: EMBUDOS,
    etapas: ETAPAS,
    oportunidades: [
      { id: 'o1', leadId: 'l1', salesTeamId: EQUIPO, pipelineId: 'p1', stageId: 's1', status, position: 0, updatedAt: new Date() },
    ],
  });

  it('la mueve de etapa dentro de SU embudo', async () => {
    const { svc, reg } = motor(mundo());
    await correr(svc, paso({ etapa: 'Propuesta' }));
    const w = reg.find((r) => r.modelo === 'salesOpportunity' && r.op === 'updateMany');
    expect(w?.data).toMatchObject({ stageId: 's2' });
  });

  it('una etapa que no existe en su embudo NO se escribe', async () => {
    // Escribir la etapa de otro embudo deja la tarjeta fuera de todas las
    // columnas de su tablero: invisible para el equipo.
    const { svc, reg } = motor(mundo());
    await correr(svc, paso({ etapa: 'Etapa de otro embudo' }));
    expect(reg.some((r) => r.modelo === 'salesOpportunity' && r.op === 'updateMany')).toBe(false);
  });

  it('«perdida» le pone la fecha de cierre', async () => {
    const { svc, reg } = motor(mundo());
    await correr(svc, paso({ estado: 'perdida' }));
    const w = reg.find((r) => r.modelo === 'salesOpportunity' && r.op === 'updateMany');
    expect(w?.data.status).toBe('perdida');
    expect(w?.data.lostAt).toBeInstanceOf(Date);
  });

  it('«ganada» NO se puede escribir desde un flujo', async () => {
    // Ganar mueve el lead a clientes y registra la venta, y eso lo hace el CRM.
    // Escribirlo aquí dejaría la oportunidad ganada sin venta.
    const { svc, reg } = motor(mundo());
    await correr(svc, paso({ estado: 'ganada' }));
    expect(reg.some((r) => r.modelo === 'salesOpportunity' && r.op === 'updateMany')).toBe(false);
  });

  it('una oportunidad YA GANADA no la pierde un flujo', async () => {
    // Al ganarla, el CRM movió el lead a clientes y registró la venta. Cambiar
    // aquí la palabra dejaría una venta contada sobre una oportunidad perdida.
    const { svc, reg } = motor(mundo('ganada'));
    await correr(svc, paso({ estado: 'perdida' }));
    const w = reg.find((r) => r.modelo === 'salesOpportunity' && r.op === 'updateMany');
    expect(w?.data?.status).toBeUndefined();
  });

  it('sin oportunidad no crea ninguna: para eso está el otro paso', async () => {
    const { svc, creados } = motor({ embudos: EMBUDOS, etapas: ETAPAS });
    const r = await correr(svc, paso({ etapa: 'Propuesta', estado: 'perdida' }));
    expect(creados('salesOpportunity')).toEqual([]);
    expect(r).toEqual({ kind: 'continue', next: 'n2' });
  });
});

// ── Citas ──────────────────────────────────────────────────────────────────

const enUnaHora = () => new Date(Date.now() + 3600000);

describe('confirmar y cancelar la cita', () => {
  const cita = (status: string, extra: any = {}) => ({
    id: 'cita1',
    leadId: 'l1',
    salesTeamId: EQUIPO,
    startAt: enUnaHora(),
    status,
    confirmedAt: null,
    ...extra,
  });

  it('confirmar deja la cita CONFIRMADA con su fecha', async () => {
    const citas = [cita('PENDIENTE')];
    const { svc } = motor({ citas });
    await correr(svc, { id: 'n1', type: 'meeting_confirm', next: 'n2' });
    expect(citas[0].status).toBe('CONFIRMADA');
    expect(citas[0].confirmedAt).toBeInstanceOf(Date);
  });

  it('confirmar dos veces no reescribe la fecha de la confirmación', async () => {
    const citas = [cita('PENDIENTE')];
    const { svc } = motor({ citas });
    await correr(svc, { id: 'n1', type: 'meeting_confirm', next: 'n2' });
    const primera = citas[0].confirmedAt;
    await correr(svc, { id: 'n1', type: 'meeting_confirm', next: 'n2' });
    expect(citas[0].confirmedAt).toBe(primera);
  });

  it('cancelar deja la cita CANCELADA', async () => {
    const citas = [cita('CONFIRMADA')];
    const { svc } = motor({ citas });
    await correr(svc, { id: 'n1', type: 'meeting_cancel', next: 'n2' });
    expect(citas[0].status).toBe('CANCELADA');
  });

  it('cancelar NO voltea un plantón ni una reunión ya realizada', async () => {
    // En TeamClubify esto escondió 50 plantones: un paso «cancelar» corría 15 h
    // después del no-show y los contaba como cancelaciones.
    for (const cerrada of ['NO_ASISTIO', 'REALIZADA']) {
      const citas = [cita(cerrada)];
      const { svc } = motor({ citas });
      await correr(svc, { id: 'n1', type: 'meeting_cancel', next: 'n2' });
      expect(citas[0].status).toBe(cerrada);
    }
  });

  it('una reunión que ya pasó y nadie cerró NO se cancela', async () => {
    // Casi siempre es un plantón sin registrar: contarla como cancelación
    // esconde el dato que el equipo necesita ver.
    const citas = [cita('PENDIENTE', { startAt: new Date(Date.now() - 3 * 86400000) })];
    const { svc } = motor({ citas });
    await correr(svc, { id: 'n1', type: 'meeting_cancel', next: 'n2' });
    expect(citas[0].status).toBe('PENDIENTE');
  });

  it('la cita de un lead de otra marca no se toca', async () => {
    const citas = [cita('PENDIENTE')];
    const { svc } = motor({ citas, leads: [{ ...LEAD, whiteLabelId: OTRA_MARCA }] });
    await correr(svc, { id: 'n1', type: 'meeting_cancel', next: 'n2' });
    expect(citas[0].status).toBe('PENDIENTE');
  });
});

describe('esperar respecto a la cita', () => {
  const paso = (config: any) => ({ id: 'n1', type: 'wait_appointment', next: 'n2', config });
  const citaViva = (startAt: Date) => [{ id: 'cita1', leadId: 'l1', salesTeamId: EQUIPO, startAt, status: 'PENDIENTE' }];

  it('espera hasta X antes de la cita y aparca en el paso siguiente', async () => {
    const startAt = new Date(Date.now() + 5 * 3600000);
    const { svc } = motor({ citas: citaViva(startAt) });
    const r = await correr(svc, paso({ direction: 'before', amount: 2, unit: 'hours' }));
    expect(r.kind).toBe('wait');
    expect(r.waitKind).toBe('cita');
    // Aparcar en `node.next` y no en el propio nodo: al volver hay que enviar,
    // no recalcular la espera y descubrir que el momento «ya pasó».
    expect(r.resumeNodeId).toBe('n2');
    expect(r.resumeAt.getTime()).toBe(startAt.getTime() - 2 * 3600000);
  });

  it('sin cita retiene al contacto y vuelve a mirar en 6 horas', async () => {
    const { svc } = motor({ citas: [] });
    const r = await correr(svc, paso({ direction: 'before', amount: 1, unit: 'days' }));
    expect(r.kind).toBe('wait');
    expect(r.resumeNodeId).toBe('n1');
  });

  it('sin cita y con «seguir», el flujo sigue', async () => {
    const { svc } = motor({ citas: [] });
    const r = await correr(svc, paso({ sinCita: 'seguir' }));
    expect(r).toEqual({ kind: 'continue', next: 'n2' });
  });

  it('un recordatorio vencido saca al contacto en vez de soltarlo tarde', async () => {
    const { svc } = motor({ citas: citaViva(new Date(Date.now() + 10 * 60000)) });
    const r = await correr(svc, paso({ direction: 'before', amount: 1, unit: 'days' }));
    expect(r).toEqual({ kind: 'removed' });
  });

  it('un seguimiento posterior sí sale aunque llegue tarde', async () => {
    const { svc } = motor({ citas: citaViva(new Date(Date.now() - 3 * 86400000)) });
    const r = await correr(svc, paso({ direction: 'after', amount: 1, unit: 'days' }));
    expect(r).toEqual({ kind: 'continue', next: 'n2' });
  });
});

// ── Ir a un paso y quitar de otros flujos ──────────────────────────────────

describe('ir a un paso de este flujo', () => {
  it('manda al contacto al paso elegido', async () => {
    const { svc } = motor();
    const r = await correr(svc, { id: 'n1', type: 'goto_node', next: 'n2', config: { paso: 'n7' } });
    expect(r).toEqual({ kind: 'continue', next: 'n7' });
  });

  it('sin destino termina el flujo, no sigue por «next»', async () => {
    const { svc } = motor();
    const r = await correr(svc, { id: 'n1', type: 'goto_node', next: 'n2', config: {} });
    expect(r).toEqual({ kind: 'continue', next: null });
  });

  it('a las 50 vueltas corta el bucle y saca al contacto', async () => {
    // El tope de 60 nodos del motor solo acota UNA pasada: con una espera de
    // por medio, «vuelve a intentarlo» escribiría al contacto para siempre.
    const { svc } = motor();
    const r = await correr(
      svc,
      { id: 'n1', type: 'goto_node', next: 'n2', config: { paso: 'n7' } },
      inscripcion({ saltosDePaso: 50 }),
    );
    expect(r).toEqual({ kind: 'removed' });
  });
});

describe('quitar de otros flujos', () => {
  const otrasInscripciones = () => [
    { id: 'e1', contactId: 'c1', whiteLabelId: MARCA, workflowId: 'wf1', status: 'active', context: {} },
    { id: 'e2', contactId: 'c1', whiteLabelId: MARCA, workflowId: 'wf2', status: 'waiting', context: {} },
    { id: 'e3', contactId: 'c1', whiteLabelId: OTRA_MARCA, workflowId: 'wf9', status: 'active', context: {} },
  ];

  it('«de todos menos de este» deja en pie el actual y NO toca otras marcas', async () => {
    const inscripciones = otrasInscripciones();
    const { svc } = motor({ inscripciones });
    const r = await correr(svc, { id: 'n1', type: 'remove_from_workflows', next: 'n2', config: { modo: 'otros' } });
    expect(inscripciones.map((e) => e.status)).toEqual(['active', 'removed', 'active']);
    expect(r).toEqual({ kind: 'continue', next: 'n2' });
  });

  it('«de todos» también saca de este y termina aquí', async () => {
    const inscripciones = otrasInscripciones();
    const { svc } = motor({ inscripciones });
    const r = await correr(svc, { id: 'n1', type: 'remove_from_workflows', config: { modo: 'todos' } });
    expect(inscripciones.map((e) => e.status)).toEqual(['removed', 'removed', 'active']);
    expect(r).toEqual({ kind: 'removed' });
  });

  it('«de uno en concreto» no acepta un flujo de otra marca', async () => {
    const inscripciones = otrasInscripciones();
    const { svc } = motor({ inscripciones, flujos: [{ id: 'wf9', whiteLabelId: OTRA_MARCA, status: 'published' }] });
    const r = await correr(svc, { id: 'n1', type: 'remove_from_workflows', next: 'n2', config: { modo: 'uno', workflowId: 'wf9' } });
    expect(inscripciones.map((e) => e.status)).toEqual(['active', 'waiting', 'active']);
    expect(r).toEqual({ kind: 'continue', next: 'n2' });
  });

  it('«de uno en concreto» saca del flujo elegido de esta marca', async () => {
    const inscripciones = otrasInscripciones();
    const { svc } = motor({ inscripciones, flujos: [{ id: 'wf2', whiteLabelId: MARCA, status: 'published' }] });
    await correr(svc, { id: 'n1', type: 'remove_from_workflows', next: 'n2', config: { modo: 'uno', workflowId: 'wf2' } });
    expect(inscripciones.map((e) => e.status)).toEqual(['active', 'removed', 'active']);
  });
});

// ── «Contacto actualizado» ─────────────────────────────────────────────────

describe('el disparador «contacto actualizado»', () => {
  const flujoQueEscucha = {
    id: 'wf2',
    whiteLabelId: MARCA,
    status: 'published',
    rootId: 'r1',
    trigger: { type: 'contact_updated' },
  };

  it('escribir un dato inscribe en el flujo que lo escucha', async () => {
    const { svc, enrolls } = motor({ flujos: [flujoQueEscucha] });
    await correr(svc, { id: 'n1', type: 'update_field', config: { campo: 'name', valor: 'Ana María' } });
    expect(enrolls.map((e) => e.wfId)).toEqual(['wf2']);
    expect(enrolls[0].contexto).toMatchObject({ campo: 'name', valor: 'Ana María' });
  });

  it('un valor vacío no escribe y por tanto no avisa', async () => {
    const { svc, enrolls } = motor({ flujos: [flujoQueEscucha] });
    await correr(svc, { id: 'n1', type: 'update_field', config: { campo: 'name', valor: '{{noexiste}}' } });
    expect(enrolls).toEqual([]);
  });

  it('el flujo de otra marca no se entera', async () => {
    const { svc, enrolls } = motor({ flujos: [{ ...flujoQueEscucha, whiteLabelId: OTRA_MARCA }] });
    await correr(svc, { id: 'n1', type: 'update_field', config: { campo: 'name', valor: 'Ana María' } });
    expect(enrolls).toEqual([]);
  });
});

// ── El barrido de cada hora ────────────────────────────────────────────────

const flujoDe = (type: string, extra: any = {}, id = 'wf1') => ({
  id,
  whiteLabelId: MARCA,
  status: 'published',
  rootId: 'r1',
  trigger: { type, ...extra },
  triggers: [{ type, ...extra }],
});

describe('barrido: estado de la cita', () => {
  const citaCambiada = (status: string, extra: any = {}) => ({
    id: 'cita1',
    status,
    startAt: new Date('2026-09-25T15:00:00Z'),
    updatedAt: new Date(),
    leadId: 'l1',
    team: { whiteLabelId: MARCA, name: 'Cierre' },
    lead: { mktContactId: 'c1', assignedUserId: 'u-vendedor' },
    ...extra,
  });

  it('inscribe con la fecha y la hora reales de la cita', async () => {
    const { svc, enrolls } = motor({ flujos: [flujoDe('sales_meeting_status')], citas: [citaCambiada('CONFIRMADA')] });
    await svc.escanearVentas();
    expect(enrolls).toHaveLength(1);
    expect(enrolls[0].contexto).toMatchObject({
      cita_estado: 'Confirmada',
      cita_fecha: '2026-09-25',
      cita_hora: '10:00',
      equipo: 'Cierre',
      vendedor: 'Pedro',
      eventoRef: 'cita:cita1:CONFIRMADA',
    });
  });

  it('la segunda vuelta del barrido NO vuelve a inscribir por el mismo cambio', async () => {
    // La ventana solapa a propósito con la vuelta anterior: sin la referencia
    // del evento, cada cambio mandaría el correo dos veces.
    const inscripciones: any[] = [];
    const { svc, enrolls } = motor({
      flujos: [flujoDe('sales_meeting_status')],
      citas: [citaCambiada('CANCELADA')],
      inscripciones,
    });
    await svc.escanearVentas();
    inscripciones.push({
      id: 'e1',
      workflowId: 'wf1',
      contactId: 'c1',
      enteredAt: new Date(),
      context: enrolls[0].contexto,
    });
    await svc.escanearVentas();
    expect(enrolls).toHaveLength(1);
  });

  it('el mismo contacto SÍ entra otra vez si la cita pasa a otro estado', async () => {
    const citas = [citaCambiada('CONFIRMADA')];
    const inscripciones: any[] = [];
    const { svc, enrolls } = motor({ flujos: [flujoDe('sales_meeting_status')], citas, inscripciones });
    await svc.escanearVentas();
    inscripciones.push({ id: 'e1', workflowId: 'wf1', contactId: 'c1', enteredAt: new Date(), context: enrolls[0].contexto });
    citas[0].status = 'CANCELADA';
    await svc.escanearVentas();
    expect(enrolls.map((e) => e.contexto.cita_estado)).toEqual(['Confirmada', 'Cancelada']);
  });

  it('el disparador configurado para «cancelada» no entra con una confirmación', async () => {
    const { svc, enrolls } = motor({
      flujos: [flujoDe('sales_meeting_status', { estado: 'CANCELADA' })],
      citas: [citaCambiada('CONFIRMADA')],
    });
    await svc.escanearVentas();
    expect(enrolls).toEqual([]);
  });

  it('las citas de OTRA marca no entran en el barrido de esta', async () => {
    const { svc, enrolls } = motor({
      flujos: [flujoDe('sales_meeting_status')],
      citas: [citaCambiada('CONFIRMADA', { team: { whiteLabelId: OTRA_MARCA, name: 'Ajeno' } })],
    });
    await svc.escanearVentas();
    expect(enrolls).toEqual([]);
  });

  it('una cita recién agendada (PENDIENTE) no entra: eso es «Cita agendada»', async () => {
    const { svc, enrolls } = motor({
      flujos: [flujoDe('sales_meeting_status')],
      citas: [citaCambiada('PENDIENTE')],
    });
    await svc.escanearVentas();
    expect(enrolls).toEqual([]);
  });

  it('un lead sin contacto de marketing no inscribe a nadie', async () => {
    const { svc, enrolls } = motor({
      flujos: [flujoDe('sales_meeting_status')],
      citas: [citaCambiada('CONFIRMADA', { lead: { mktContactId: null, assignedUserId: null } })],
    });
    await svc.escanearVentas();
    expect(enrolls).toEqual([]);
  });
});

describe('barrido: oportunidades', () => {
  const oportunidad = (extra: any = {}) => ({
    id: 'o1',
    whiteLabelId: MARCA,
    status: 'abierta',
    value: 1500,
    stageId: 's2',
    salesTeamId: EQUIPO,
    createdAt: new Date(Date.now() - 10 * 86400000),
    updatedAt: new Date(),
    pipeline: { name: 'Closers' },
    stage: { name: 'Propuesta' },
    lead: { mktContactId: 'c1', assignedUserId: 'u-vendedor' },
    ...extra,
  });

  it('una oportunidad recién creada entra por «creada», no por «cambió de etapa»', async () => {
    const { svc, enrolls } = motor({
      flujos: [flujoDe('sales_opportunity_created', {}, 'wfA'), flujoDe('sales_opportunity_stage_changed', {}, 'wfB')],
      oportunidades: [oportunidad({ createdAt: new Date() })],
    });
    await svc.escanearVentas();
    expect(enrolls.map((e) => e.wfId)).toEqual(['wfA']);
    expect(enrolls[0].contexto).toMatchObject({
      embudo: 'Closers',
      etapa_oportunidad: 'Propuesta',
      valor_oportunidad: '1500',
      equipo: 'Cierre',
    });
  });

  it('una que ya existía y se movió entra por «cambió de etapa»', async () => {
    const { svc, enrolls } = motor({
      flujos: [flujoDe('sales_opportunity_created', {}, 'wfA'), flujoDe('sales_opportunity_stage_changed', {}, 'wfB')],
      oportunidades: [oportunidad()],
    });
    await svc.escanearVentas();
    expect(enrolls.map((e) => e.wfId)).toEqual(['wfB']);
    expect(enrolls[0].contexto.eventoRef).toBe('oportunidad:o1:etapa:s2');
  });

  it('el filtro por embudo no deja pasar el de otro nombre', async () => {
    const { svc, enrolls } = motor({
      flujos: [flujoDe('sales_opportunity_stage_changed', { embudo: 'Chat general' })],
      oportunidades: [oportunidad()],
    });
    await svc.escanearVentas();
    expect(enrolls).toEqual([]);
  });

  it('cerrar la oportunidad entra por «ganada o perdida»', async () => {
    const { svc, enrolls } = motor({
      flujos: [flujoDe('sales_opportunity_status', { estado: 'ganada' })],
      oportunidades: [oportunidad({ status: 'ganada' })],
    });
    await svc.escanearVentas();
    expect(enrolls).toHaveLength(1);
    expect(enrolls[0].contexto).toMatchObject({ estado_oportunidad: 'Ganada', eventoRef: 'oportunidad:o1:estado:ganada' });
  });

  it('una oportunidad abierta no entra por «ganada o perdida»', async () => {
    const { svc, enrolls } = motor({
      flujos: [flujoDe('sales_opportunity_status')],
      oportunidades: [oportunidad()],
    });
    await svc.escanearVentas();
    expect(enrolls).toEqual([]);
  });

  it('las oportunidades de OTRA marca no entran en el barrido de esta', async () => {
    const { svc, enrolls } = motor({
      flujos: [flujoDe('sales_opportunity_stage_changed')],
      oportunidades: [oportunidad({ whiteLabelId: OTRA_MARCA })],
    });
    await svc.escanearVentas();
    expect(enrolls).toEqual([]);
  });
});

// ── El catálogo sigue diciendo la verdad ───────────────────────────────────

describe('el catálogo de ventas', () => {
  it('los desplegables de embudo, etapa y miembro los completa el servidor', () => {
    const cat = catalogoDeContactos({
      embudos: [{ value: 'Closers', label: 'Closers' }],
      etapas: [{ value: 'Propuesta', label: 'Propuesta' }],
      miembros: [{ value: 'u1', label: 'Pedro' }],
    });
    const crear = cat.pasos.find((p) => p.key === 'create_opportunity')!;
    expect(crear.campos.find((c) => c.key === 'embudo')?.opciones).toEqual([
      { value: '', label: 'El primero del equipo' },
      { value: 'Closers', label: 'Closers' },
    ]);
    const tarea = cat.pasos.find((p) => p.key === 'create_task')!;
    expect(tarea.campos.find((c) => c.key === 'asignarA')?.opciones).toEqual([
      { value: '', label: 'Quien lleva el lead' },
      { value: 'u1', label: 'Pedro' },
    ]);
  });

  it('las opciones de una marca no se quedan pegadas para la siguiente', () => {
    // El catálogo del módulo es una constante compartida entre peticiones:
    // escribirle encima le enseñaría los embudos de Sellea a la marca siguiente.
    catalogoDeContactos({
      embudos: [{ value: 'Solo de Sellea', label: 'Solo de Sellea' }],
      etapas: [],
      miembros: [],
    });
    const limpio = catalogoDeContactos();
    const crear = limpio.pasos.find((p) => p.key === 'create_opportunity')!;
    expect(crear.campos.find((c) => c.key === 'embudo')?.opciones).toEqual([
      { value: '', label: 'El primero del equipo' },
    ]);
    expect(MKT_NODE_TYPES.find((p) => p.key === 'create_opportunity')!.campos.find((c) => c.key === 'embudo')?.opciones)
      .toHaveLength(1);
  });

  it('todo paso de ventas tiene su grupo y todo disparador su latencia', () => {
    const deVentas = MKT_NODE_TYPES.filter((p) => p.grupo === 'Ventas');
    expect(deVentas.length).toBeGreaterThan(0);
    expect(deVentas.every((p) => !!p.icono && Array.isArray(p.campos))).toBe(true);
    // Los del barrido dicen «se revisa cada hora»: prometer «entra en minutos»
    // haría que alguien lo diera por roto a los cinco minutos de publicar.
    const porBarrido = ['sales_meeting_status', 'sales_opportunity_created', 'sales_opportunity_stage_changed', 'sales_opportunity_status'];
    expect(MKT_TRIGGERS.filter((d) => porBarrido.includes(d.key)).map((d) => d.latencia)).toEqual([
      'hora',
      'hora',
      'hora',
      'hora',
    ]);
  });

  it('la referencia de un evento distingue el estado, no solo la fila', () => {
    expect(refDeEvento('cita', 'x', 'CANCELADA')).not.toBe(refDeEvento('cita', 'x', 'CONFIRMADA'));
  });

  it('dos disparadores del mismo tipo se distinguen por su ajuste', () => {
    // Si los dos se llamaran «Estado de la cita cambió #1», el registro no
    // diría por cuál entró el contacto ni lo diría la tarjeta del lienzo.
    const uno = etiquetaDeDisparador({ type: 'sales_meeting_status', estado: 'CANCELADA' }, 0, MKT_TRIGGERS);
    const dos = etiquetaDeDisparador({ type: 'sales_meeting_status', estado: 'CONFIRMADA' }, 1, MKT_TRIGGERS);
    expect(uno).toBe('Estado de la cita cambió · CANCELADA');
    expect(dos).not.toBe(uno);
  });
});
