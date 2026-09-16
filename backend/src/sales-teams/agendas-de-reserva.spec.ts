import { describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AgendasDeReservaService } from './agendas-de-reserva.service';
import {
  COLORES_DE_AGENDA,
  MAX_AGENDAS_POR_EQUIPO,
  errorDeSlug,
  normalizarAgenda,
  primerSlugLibre,
  raizDeSlug,
  resumenDeHorario,
  slugDeAgenda,
} from './agendas-de-reserva';
import { CAMPOS_DE_AGENDA } from './formularios-de-equipo';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';

/**
 * «Agendas de reserva del equipo».
 *
 * Lo que duele si falla: que una agenda nueva tape el enlace que otro equipo ya
 * repartió, que alguien sin permiso cambie un enlace público, que un guardado
 * borre lo que escribió otro, y que un equipo desactivado siga estrenando
 * agendas. La base de mentira respeta los `where` (también el del equipo
 * activo), las transacciones, el candado y el índice único del slug: si alguien
 * quita una de esas comprobaciones, estas pruebas se ponen en rojo.
 */

const SELLEA = 'wl-sellea';
type Fila = Record<string, any>;

function baseFalsa() {
  let sec = 0;
  const bd = {
    equipos: [
      { id: 't1', name: 'Equipo Norte', slug: 'norte', whiteLabelId: SELLEA, isActive: true, status: 'activo' },
      // De OTRA marca y sin ninguna agenda: su enlace de antes sigue repartido.
      { id: 't2', name: 'Equipo Sur', slug: 'ventas-sur', whiteLabelId: 'wl-otra', isActive: true, status: 'activo' },
    ] as Fila[],
    agendas: [
      {
        id: 'ag1',
        salesTeamId: 't1',
        whiteLabelId: SELLEA,
        slug: 'norte',
        name: 'Agenda principal',
        color: null,
        isActive: true,
        formId: null,
        settings: {},
        createdAt: new Date('2026-09-01T00:00:00Z'),
      },
    ] as Fila[],
    formularios: [
      { id: 'f-ok', salesTeamId: 't1', name: 'Agenda', isActive: true, fields: CAMPOS_DE_AGENDA },
      { id: 'f-inactivo', salesTeamId: 't1', name: 'Viejo', isActive: false, fields: CAMPOS_DE_AGENDA },
      { id: 'f-sin-contacto', salesTeamId: 't1', name: 'Encuesta', isActive: true, fields: [] },
      { id: 'f-ajeno', salesTeamId: 't2', name: 'De otro equipo', isActive: true, fields: CAMPOS_DE_AGENDA },
    ] as Fila[],
    miembros: [
      { teamId: 't1', userId: 'u-lider', roles: ['lider'], isActive: true },
      { teamId: 't1', userId: 'u-closer', roles: ['closer'], isActive: true },
    ] as Fila[],
    candados: [] as string[],
  };
  /** Lo que ocurre «a la vez» que la escritura: corre al tomar el candado. */
  let alTomarCandado: (() => unknown) | null = null;

  const casa = (f: Fila | undefined, where: Fila = {}): boolean =>
    !!f &&
    Object.entries(where).every(([k, v]) => {
      if (k === 'team') return casa(bd.equipos.find((e) => e.id === f.salesTeamId), v);
      if (v && typeof v === 'object') {
        if ('not' in v) return f[k] !== v.not;
        if ('startsWith' in v) return typeof f[k] === 'string' && f[k].startsWith(v.startsWith);
        if ('in' in v) return v.in.includes(f[k]);
      }
      return f[k] === v;
    });
  // Como el índice único de la base.
  const repetido = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`slug`)', {
      code: 'P2002',
      clientVersion: 'test',
    });
  const porAntiguedad = () => [...bd.agendas].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const prisma: any = {
    whiteLabel: { findFirst: async () => ({ id: 'wl-clubify' }) },
    whiteLabelModule: { findUnique: async () => ({ enabled: true }) },
    salesTeam: {
      findUnique: async ({ where }: any) => bd.equipos.find((e) => e.id === where.id) ?? null,
      findFirst: async ({ where }: any) => bd.equipos.find((e) => casa(e, where)) ?? null,
      findMany: async ({ where }: any) => bd.equipos.filter((e) => casa(e, where)),
    },
    salesTeamMember: {
      findUnique: async ({ where }: any) =>
        bd.miembros.find(
          (m) => m.teamId === where.teamId_userId.teamId && m.userId === where.teamId_userId.userId,
        ) ?? null,
    },
    salesAgenda: {
      findMany: async ({ where }: any) => porAntiguedad().filter((a) => casa(a, where)),
      findFirst: async ({ where }: any) => porAntiguedad().find((a) => casa(a, where)) ?? null,
      findUnique: async ({ where }: any) => bd.agendas.find((a) => a.slug === where.slug) ?? null,
      count: async ({ where }: any) => bd.agendas.filter((a) => casa(a, where)).length,
      create: async ({ data }: any) => {
        if (bd.agendas.some((a) => a.slug === data.slug)) throw repetido();
        const a = {
          id: `ag-nueva-${++sec}`,
          color: null,
          isActive: true,
          formId: null,
          createdAt: new Date(`2026-09-10T00:00:${String(sec).padStart(2, '0')}Z`),
          ...data,
        };
        bd.agendas.push(a);
        return { ...a };
      },
      updateMany: async ({ where, data }: any) => {
        const tocadas = bd.agendas.filter((a) => casa(a, where));
        if (data.slug && bd.agendas.some((a) => a.slug === data.slug && !tocadas.includes(a))) throw repetido();
        for (const a of tocadas) Object.assign(a, data);
        return { count: tocadas.length };
      },
      deleteMany: async ({ where }: any) => {
        const antes = bd.agendas.length;
        bd.agendas = bd.agendas.filter((a) => !casa(a, where));
        return { count: antes - bd.agendas.length };
      },
    },
    salesForm: {
      findFirst: async ({ where }: any) => bd.formularios.find((f) => casa(f, where)) ?? null,
      findMany: async ({ where }: any) => bd.formularios.filter((f) => casa(f, where)),
    },
    $transaction: async (fn: any) => fn(prisma),
    $executeRawUnsafe: async (_sql: string, clave: string) => {
      bd.candados.push(clave);
      const antes = alTomarCandado;
      alTomarCandado = null;
      antes?.();
      return 0;
    },
  };
  return {
    bd,
    svc: new AgendasDeReservaService(prisma as unknown as PrismaService),
    mientras: (fn: () => unknown) => {
      alTomarCandado = fn;
    },
  };
}

const usuario = (id: string, role: string, whiteLabelId: string | null = SELLEA): AuthUser =>
  ({ id, email: `${id}@sellea.com`, role, whiteLabelId }) as any;
const LIDER = usuario('u-lider', 'AFFILIATE_VENDOR');
const CLOSER = usuario('u-closer', 'AFFILIATE_VENDOR');
const ADMIN = usuario('u-admin', 'SUPER_ADMIN');
const ADMIN_DE_OTRA = usuario('u-admin-otra', 'SUPER_ADMIN', 'wl-otra');

describe('el enlace, sin base', () => {
  it('sale del nombre: minúsculas, sin tildes y con guiones', () => {
    expect(slugDeAgenda('Agenda Clubify - Instagram')).toBe('agenda-clubify-instagram');
    expect(slugDeAgenda('  Año Ñandú!! ')).toBe('ano-nandu');
  });

  it('corto, mal escrito o reservado no vale', () => {
    expect(errorDeSlug('ab')).toBeTruthy();
    expect(errorDeSlug('cita')).toBeTruthy();
    expect(errorDeSlug('agenda-rrss')).toBeNull();
  });

  it('sin enlace escrito, el primero libre a partir del nombre', () => {
    expect(raizDeSlug('TI')).toBe('agenda');
    expect(primerSlugLibre('norte', new Set(['norte', 'norte-2']))).toBe('norte-3');
  });

  it('«09:00–17:30»: de la primera hora que abre a la última que cierra', () => {
    expect(
      resumenDeHorario([
        { weekday: 1, startMin: 540, endMin: 1050 },
        { weekday: 6, startMin: 600, endMin: 780 },
      ]),
    ).toBe('09:00–17:30');
    expect(resumenDeHorario([])).toBeNull();
  });

  it('lo de «Configurar» se separa en columnas y ajustes, y lo raro se rechaza', () => {
    expect(
      normalizarAgenda({ nombre: ' Instagram ', slug: 'Agenda RRSS', activa: false, formularioId: '', duracionMin: 45 }),
    ).toEqual({
      columnas: { name: 'Instagram', slug: 'agenda-rrss', isActive: false, formId: null },
      ajustes: { duracionMin: 45 },
    });
    expect(normalizarAgenda({ color: '#123456' })).toHaveProperty('error');
    expect(normalizarAgenda({ color: COLORES_DE_AGENDA[0].toLowerCase() })).toMatchObject({
      columnas: { color: COLORES_DE_AGENDA[0] },
    });
    expect(normalizarAgenda({ nombre: '   ' })).toHaveProperty('error');
    expect(normalizarAgenda({ activa: 'sí' })).toHaveProperty('error');
  });
});

describe('quién las cambia', () => {
  it('cualquiera del equipo las ve; solo el líder o un admin de la marca las cambian', async () => {
    const { svc } = baseFalsa();
    const vista = await svc.listar(CLOSER, 't1');
    expect(vista.puedeConfigurar).toBe(false);
    expect(vista.agendas).toHaveLength(1);
    expect(vista.slugDelEquipo).toBe('norte');
    await expect(svc.crear(CLOSER, 't1', { nombre: 'Mía' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.editar(CLOSER, 't1', 'ag1', { nombre: 'Mía' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.borrar(CLOSER, 't1', 'ag1')).rejects.toBeInstanceOf(ForbiddenException);
    expect((await svc.listar(LIDER, 't1')).puedeConfigurar).toBe(true);
    expect((await svc.listar(ADMIN, 't1')).puedeConfigurar).toBe(true);
  });

  it('un admin de OTRA marca recibe 404, como si el equipo no existiera', async () => {
    const { svc } = baseFalsa();
    await expect(svc.listar(ADMIN_DE_OTRA, 't1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.crear(ADMIN_DE_OTRA, 't1', { nombre: 'Intrusa' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('con el equipo desactivado el líder ya no cambia nada; un admin sí', async () => {
    const { svc, bd } = baseFalsa();
    bd.equipos[0].isActive = false;
    await expect(svc.crear(LIDER, 't1', { nombre: 'Tarde' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.crear(ADMIN, 't1', { nombre: 'Tarde' })).resolves.toMatchObject({ slug: 'tarde' });
  });

  it('si el equipo se desactiva entre el permiso y la escritura, no se escribe', async () => {
    const { svc, bd, mientras } = baseFalsa();
    mientras(() => {
      bd.equipos[0].isActive = false;
    });
    await expect(svc.editar(LIDER, 't1', 'ag1', { nombre: 'Cambiada' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(bd.agendas[0].name).toBe('Agenda principal');
  });
});

describe('el enlace es único', () => {
  it('el de otra agenda se rechaza', async () => {
    const { svc } = baseFalsa();
    await expect(svc.crear(LIDER, 't1', { nombre: 'Otra', slug: 'norte' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('el slug de OTRO equipo también, aunque no tenga agenda: taparía su enlace de siempre', async () => {
    const { svc, bd } = baseFalsa();
    await expect(svc.crear(LIDER, 't1', { nombre: 'Sur', slug: 'ventas-sur' })).rejects.toBeInstanceOf(ConflictException);
    // Sacado del nombre, salta al siguiente libre en vez de pisarlo.
    const creada = await svc.crear(LIDER, 't1', { nombre: 'Ventas Sur' });
    expect(creada.slug).toBe('ventas-sur-2');
    expect(bd.agendas).toHaveLength(2);
  });

  it('el slug del propio equipo sí, cuando ninguna agenda lo usa', async () => {
    const { svc } = baseFalsa();
    await svc.editar(LIDER, 't1', 'ag1', { slug: 'principal' });
    await expect(svc.crear(LIDER, 't1', { nombre: 'Norte otra vez', slug: 'norte' })).resolves.toMatchObject({
      slug: 'norte',
    });
  });

  it('mal escrito o reservado es un 400', async () => {
    const { svc } = baseFalsa();
    await expect(svc.crear(LIDER, 't1', { nombre: 'X', slug: '¡!' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.crear(LIDER, 't1', { nombre: 'X', slug: 'cita' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.editar(LIDER, 't1', 'ag1', { slug: 'ab' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cambiar el enlace a uno ocupado se rechaza y no toca nada', async () => {
    const { svc, bd } = baseFalsa();
    const ig = await svc.crear(LIDER, 't1', { nombre: 'Instagram' });
    await expect(svc.editar(LIDER, 't1', ig.id, { slug: 'norte', nombre: 'Renombrada' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(bd.agendas.find((a) => a.id === ig.id)).toMatchObject({ slug: 'instagram', name: 'Instagram' });
  });

  it('si otra agenda coge el enlace a la vez, la base lo frena y se responde 409', async () => {
    const { svc, bd, mientras } = baseFalsa();
    mientras(() =>
      bd.agendas.push({
        id: 'ag-a-la-vez',
        salesTeamId: 't1',
        slug: 'instagram',
        name: 'A la vez',
        isActive: true,
        formId: null,
        settings: {},
        createdAt: new Date('2026-09-02T00:00:00Z'),
      }),
    );
    await expect(svc.crear(LIDER, 't1', { nombre: 'Instagram', slug: 'instagram' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('guardar', () => {
  it('mezcla los ajustes con lo guardado sin pisar lo que no llegó, y con candado', async () => {
    const { svc, bd } = baseFalsa();
    bd.agendas[0].settings = { titulo: 'Reunión estratégica', duracionMin: 45 };
    const r = await svc.editar(LIDER, 't1', 'ag1', { antelacionMin: 60, cuposPorHorario: 3 });
    expect(bd.agendas[0].settings).toEqual({
      titulo: 'Reunión estratégica',
      duracionMin: 45,
      antelacionMin: 60,
      cuposPorHorario: 3,
    });
    expect(r.ajustes).toMatchObject({ titulo: 'Reunión estratégica', duracionMin: 45, antelacionMin: 60, cuposPorHorario: 3 });
    expect(bd.candados).toContain('agenda:ag1');
  });

  it('una agenda nueva nace con horario de lunes a viernes', async () => {
    const { svc } = baseFalsa();
    const nueva = await svc.crear(LIDER, 't1', { nombre: 'Referidos' });
    expect(nueva.horario).toBe('09:00–18:00');
    expect(nueva.ajustes.franjas.map((f) => f.weekday)).toEqual([1, 2, 3, 4, 5]);
  });

  it('el formulario tiene que ser del equipo, estar activo y pedir un dato de contacto', async () => {
    const { svc, bd } = baseFalsa();
    await expect(svc.editar(LIDER, 't1', 'ag1', { formularioId: 'f-ajeno' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.editar(LIDER, 't1', 'ag1', { formularioId: 'f-inactivo' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(svc.editar(LIDER, 't1', 'ag1', { formularioId: 'f-sin-contacto' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await svc.editar(LIDER, 't1', 'ag1', { formularioId: 'f-ok' });
    expect(bd.agendas[0].formId).toBe('f-ok');
    await svc.editar(LIDER, 't1', 'ag1', { formularioId: null });
    expect(bd.agendas[0].formId).toBeNull();
    // En la lista solo se pueden elegir los que sirven.
    const { formularios } = await svc.listar(LIDER, 't1');
    expect(formularios.filter((f) => f.usable).map((f) => f.id)).toEqual(['f-ok']);
  });

  it('un equipo tiene un tope de agendas', async () => {
    const { svc, bd } = baseFalsa();
    for (let i = bd.agendas.length; i < MAX_AGENDAS_POR_EQUIPO; i++) {
      bd.agendas.push({ ...bd.agendas[0], id: `ag-extra-${i}`, slug: `extra-${i}` });
    }
    await expect(svc.crear(LIDER, 't1', { nombre: 'Una más' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('solo se borra una agenda del propio equipo', async () => {
    const { svc, bd } = baseFalsa();
    bd.agendas.push({ ...bd.agendas[0], id: 'ag-sur', salesTeamId: 't2', slug: 'sur-agenda' });
    await expect(svc.borrar(LIDER, 't1', 'ag-sur')).rejects.toBeInstanceOf(NotFoundException);
    await svc.borrar(LIDER, 't1', 'ag1');
    expect(bd.agendas.map((a) => a.id)).toEqual(['ag-sur']);
  });
});
