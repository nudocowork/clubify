import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

vi.mock('./team-access', async (importOriginal) => {
  const real = await importOriginal<typeof import('./team-access')>();
  return { ...real, resolveTeamAccess: vi.fn() };
});

import { resolveTeamAccess } from './team-access';
import {
  avisoDePersona,
  claveDeRenovaciones,
  codigoParaLaVenta,
  normalizarBusqueda,
  mismoTelefono,
  normalizarId,
  pagaRenovacionesSegunAjuste,
  precargarPersonas,
  puedeBuscarNegocios,
  puedeVincularVentas,
  sugerirNegocios,
} from './ventas-de-equipo';
import { VentasDeEquipoService } from './ventas-de-equipo.service';
import { SalesLeadsService } from './sales-leads.service';
import { SalesTeamsService } from './sales-teams.service';

/**
 * «Venta del equipo». Lo que fijan estas pruebas, y que alguien podría
 * «arreglar» sin saber por qué está así:
 *
 *  1. El negocio tiene que ser de la MARCA DEL EQUIPO, y el código de afiliado
 *     se busca solo en esa marca: pagarle a un afiliado de Clubify una venta de
 *     Sellea sería una fuga de marca con dinero detrás.
 *  2. Vinculan el líder o un admin; un closer no.
 *  3. Una sugerencia no vincula sola, y el teléfono pide el número completo:
 *     São Paulo y Río comparten los últimos 10 dígitos, y un «3001122» tecleado
 *     sin indicativo no es el negocio de nadie. Si dos negocios coinciden por lo
 *     mismo, las dos sugerencias salen marcadas en vez de elegir por azar.
 *  4. Un lead sin ganar no se vincula, y un negocio ya vinculado no se roba.
 *  5. Borrar NO se lleva la venta por delante: quedaría sin lead —o sea,
 *     invisible— y con el negocio bloqueado para siempre. Son DOS puertas a lo
 *     mismo: borrar el cliente (`borrarLead`) y borrar el equipo entero
 *     (`SalesTeamsService.remove`, que arrastra sus leads por Cascade).
 */

// ── Reglas puras ────────────────────────────────────────────────────────────

describe('quién vincula', () => {
  const acc = (o: Partial<{ esAdminDeMarca: boolean; roles: string[]; puedeEscribir: boolean }>) => ({
    esAdminDeMarca: false,
    roles: [] as any,
    puedeEscribir: true,
    ...o,
  });
  it('el líder y el admin sí; un closer no', () => {
    expect(puedeVincularVentas(acc({ esAdminDeMarca: true }))).toBe(true);
    expect(puedeVincularVentas(acc({ roles: ['lider'] }))).toBe(true);
    expect(puedeVincularVentas(acc({ roles: ['closer'] }))).toBe(false);
    expect(puedeVincularVentas(acc({ roles: ['lider'], puedeEscribir: false }))).toBe(false);
  });
  it('buscar negocios por texto, solo el admin', () => {
    expect(puedeBuscarNegocios({ esAdminDeMarca: true })).toBe(true);
    expect(puedeBuscarNegocios({ esAdminDeMarca: false })).toBe(false);
  });
});

describe('codigoParaLaVenta', () => {
  const c = (o: Partial<{ id: string; role: string; isActive: boolean; approvedAt: Date | null }> = {}) => ({
    id: 'c1',
    role: 'INFLUENCER',
    isActive: true,
    approvedAt: new Date(),
    ...o,
  });
  it('uno aprobado y activo: ese', () => {
    expect(codigoParaLaVenta([c()])).toEqual({ estado: 'aprobado', codigoId: 'c1' });
  });
  it('ninguno, sin aprobar, inactivo o con rol sin fijo', () => {
    expect(codigoParaLaVenta([])).toEqual({ estado: 'sin_codigo', codigoId: null });
    expect(codigoParaLaVenta([c({ approvedAt: null })])).toEqual({ estado: 'sin_aprobar', codigoId: null });
    expect(codigoParaLaVenta([c({ isActive: false })])).toEqual({ estado: 'sin_codigo', codigoId: null });
    expect(codigoParaLaVenta([c({ role: 'VENDOR' })])).toEqual({ estado: 'sin_codigo', codigoId: null });
  });
  it('con varios aprobados no se adivina', () => {
    expect(codigoParaLaVenta([c(), c({ id: 'c2' })])).toEqual({ estado: 'varios', codigoId: null });
  });
});

describe('avisoDePersona', () => {
  it('manda lo guardado; si no había código y ahora sí, se dice', () => {
    expect(avisoDePersona('code-1', 'aprobado')).toBeNull();
    expect(avisoDePersona('code-1', 'sin_aprobar')).toBeNull();
    expect(avisoDePersona(null, 'aprobado')).toBe('codigo_nuevo');
    expect(avisoDePersona(null, 'sin_codigo')).toBe('sin_codigo');
    expect(avisoDePersona(null, 'varios')).toBe('varios');
  });
});

describe('sugerirNegocios', () => {
  const negocio = (id: string, o: Partial<{ nombre: string; email: string | null; phone: string | null; whatsappPhone: string | null }> = {}) => ({
    id,
    nombre: id,
    email: null,
    phone: null,
    whatsappPhone: null,
    ...o,
  });

  it('casa el teléfono aunque esté escrito distinto, y el correo sin mirar mayúsculas', () => {
    const r = sugerirNegocios({ phone: '+57 300 111 2233', email: 'Ana@Pizza.co' }, [
      negocio('porTelefono', { phone: '3001112233' }),
      negocio('porCorreo', { email: 'ana@pizza.co' }),
      negocio('nada', { phone: '3009998877', email: 'otro@x.co' }),
    ]);
    expect(r.map((x) => `${x.id}:${x.motivo}`)).toEqual(['porTelefono:telefono', 'porCorreo:correo']);
  });

  it('el que casa por los dos va primero', () => {
    const r = sugerirNegocios({ phone: '3001112233', email: 'ana@pizza.co' }, [
      negocio('solo', { email: 'ana@pizza.co' }),
      negocio('ambos', { whatsappPhone: '+57 300 111 2233', email: 'ana@pizza.co' }),
    ]);
    // Las dos comparten el correo del cliente, así que las dos van marcadas.
    expect(r[0]).toEqual({ id: 'ambos', nombre: 'ambos', motivo: 'telefono_y_correo', ambigua: true });
  });

  it('São Paulo y Río comparten los últimos 10 dígitos y NO se sugieren', () => {
    expect(sugerirNegocios({ phone: '+55 11 98765-4321' }, [negocio('rio', { phone: '+55 21 98765-4321' })])).toEqual([]);
  });

  it('un teléfono sin indicativo no casa por la cola', () => {
    // 7 dígitos tecleados a mano: con el umbral de `samePhone` (sufijo ≥7)
    // casaban con cualquier negocio acabado en eso, y la comisión de esa venta
    // se le atribuía a quien no la cerró.
    expect(sugerirNegocios({ phone: '3001122' }, [negocio('otro', { phone: '+57 300 300 1122' })])).toEqual([]);
    expect(mismoTelefono('3001122', '+57 300 300 1122')).toBe(false);
    // El nacional completo dentro de su E.164 sigue siendo el mismo número.
    expect(mismoTelefono('3001112233', '+57 300 111 2233')).toBe(true);
  });

  it('si dos negocios coinciden por lo mismo, las dos salen marcadas', () => {
    const r = sugerirNegocios({ phone: '+57 300 111 2233' }, [
      negocio('unoDeLosDos', { phone: '3001112233' }),
      negocio('otroDeLosDos', { whatsappPhone: '573001112233' }),
    ]);
    expect(r.map((x) => x.ambigua)).toEqual([true, true]);
  });

  it('sin teléfono ni correo no sugiere nada', () => {
    expect(sugerirNegocios({}, [negocio('x', { phone: '3001112233' })])).toEqual([]);
  });
});

describe('precargarPersonas', () => {
  const activos = new Set(['closer1', 'setter1']);
  const cita = (o: Partial<{ status: string; hostUserId: string | null; agendadaPorUserId: string | null; startAt: string }>) => ({
    status: 'PENDIENTE',
    hostUserId: 'closer1',
    agendadaPorUserId: null,
    startAt: '2026-09-10T15:00:00.000Z',
    ...o,
  });

  it('manda la última REALIZADA, y el setter sale de ESA cita', () => {
    const r = precargarPersonas(
      [
        cita({ status: 'PENDIENTE', startAt: '2026-09-14T15:00:00.000Z', agendadaPorUserId: 'setter1' }),
        cita({ status: 'REALIZADA', startAt: '2026-09-10T15:00:00.000Z', agendadaPorUserId: 'setter1' }),
      ],
      activos,
    );
    expect(r).toEqual({ closerUserId: 'closer1', setterUserId: 'setter1' });
  });

  it('una reserva pública no tiene setter, y no se rellena con quien agendó otra cita', () => {
    const r = precargarPersonas(
      [
        cita({ status: 'REALIZADA', startAt: '2026-09-12T15:00:00.000Z', agendadaPorUserId: null }),
        cita({ status: 'REALIZADA', startAt: '2026-09-01T15:00:00.000Z', agendadaPorUserId: 'setter1' }),
      ],
      activos,
    );
    expect(r).toEqual({ closerUserId: 'closer1', setterUserId: null });
  });

  it('las canceladas no cuentan y quien ya no está en el equipo no se precarga', () => {
    expect(precargarPersonas([cita({ status: 'CANCELADA' })], activos)).toEqual({ closerUserId: null, setterUserId: null });
    expect(precargarPersonas([cita({ hostUserId: 'seFue' })], activos)).toEqual({ closerUserId: null, setterUserId: null });
  });
});

describe('ajustes y textos', () => {
  it('la clave de renovaciones lleva la marca, y solo «renovaciones» enciende', () => {
    expect(claveDeRenovaciones('sellea')).toBe('salesTeams.commission.renewals.sellea');
    expect(claveDeRenovaciones(null)).toBeNull();
    expect(pagaRenovacionesSegunAjuste('renovaciones')).toBe(true);
    for (const v of ['solo_venta', 'true', '', null, undefined]) expect(pagaRenovacionesSegunAjuste(v as any)).toBe(false);
  });
  it('búsqueda e ids', () => {
    expect(normalizarBusqueda(' pi ')).toBe('pi');
    expect(normalizarBusqueda('x')).toBeNull();
    expect(normalizarBusqueda(5)).toBeNull();
    expect(normalizarId(' n1 ')).toBe('n1');
    expect(normalizarId('')).toBeNull();
    expect(normalizarId(7)).toBeNull();
  });
});

// ── El servicio ─────────────────────────────────────────────────────────────

const SELLEA = 'wl-sellea';
const CLAVE_RENOVACIONES = 'salesTeams.commission.renewals.sellea';

const acceso = (tipo: 'admin' | 'lider' | 'closer') => ({
  team: { id: 't1', name: 'Norte', whiteLabelId: SELLEA, isActive: true, status: 'activo' },
  esAdminDeMarca: tipo === 'admin',
  roles: tipo === 'admin' ? [] : [tipo],
  puedeEscribir: true,
});

const LEAD = {
  id: 'l1',
  salesTeamId: 't1',
  name: 'Ana',
  phone: '+57 300 111 2233',
  email: 'ana@pizza.co',
  wonAt: new Date('2026-09-10'),
};

const NEGOCIOS = [
  { id: 'n1', whiteLabelId: SELLEA, brandName: 'Pizza Ana', name: 'pizza-ana', email: 'ANA@pizza.co', phone: '3001112233', whatsappPhone: null, deletedAt: null },
  { id: 'n2', whiteLabelId: 'wl-clubify', brandName: 'De Clubify', name: 'de-clubify', email: null, phone: null, whatsappPhone: null, deletedAt: null },
  { id: 'n3', whiteLabelId: SELLEA, brandName: 'Café', name: 'cafe', email: null, phone: '3009998877', whatsappPhone: null, deletedAt: null },
];

const MIEMBROS = [
  { userId: 'u-closer', roles: ['closer'], isActive: true, nombre: 'Carla Closer' },
  { userId: 'u-setter', roles: ['setter'], isActive: true, nombre: 'Sergio Setter' },
  { userId: 'u-fuera', roles: ['closer'], isActive: false, nombre: 'Quien Se Fue' },
];

const CODIGOS = [
  { id: 'code-closer', ownerUserId: 'u-closer', whiteLabelId: SELLEA, role: 'INFLUENCER', isActive: true, approvedAt: new Date('2026-08-01') },
  { id: 'code-setter', ownerUserId: 'u-setter', whiteLabelId: SELLEA, role: 'AMBASSADOR', isActive: true, approvedAt: null },
  // El mismo setter tiene código APROBADO en otra marca: no puede usarse aquí.
  { id: 'code-setter-clubify', ownerUserId: 'u-setter', whiteLabelId: 'wl-clubify', role: 'INFLUENCER', isActive: true, approvedAt: new Date('2026-08-01') },
];

const ventaFila = (o: Partial<Record<string, unknown>> = {}) => ({
  id: 'v1',
  salesTeamId: 't1',
  whiteLabelId: SELLEA,
  leadId: 'l1',
  negocioId: 'n1',
  closerUserId: 'u-closer',
  closerCodeId: 'code-closer',
  setterUserId: null,
  setterCodeId: null,
  pagaRenovaciones: false,
  estado: 'vinculada',
  vinculadaPorUserId: 'u-admin',
  vinculadaEl: new Date('2026-09-11'),
  desvinculadaPorUserId: null,
  desvinculadaEl: null,
  createdAt: new Date('2026-09-11'),
  updatedAt: new Date('2026-09-11'),
  ...o,
});

function montar(
  o: {
    ventas?: any[];
    ajuste?: string;
    citas?: any[];
    crearFalla?: string;
    lead?: any;
    /**
     * Otra persona escribe la venta JUSTO entre el `findFirst` y el
     * `updateMany`: lo leído ya no es lo guardado. Es la única forma de probar
     * el condicional que evita pisarle el cambio.
     */
    entreMedias?: (fila: any) => void;
  } = {},
) {
  const ventas = [...(o.ventas ?? [])];
  const casa = (fila: any, where: any) =>
    Object.entries(where).every(([k, v]) => (v instanceof Date ? fila[k]?.getTime() === v.getTime() : fila[k] === v));
  const prisma = {
    whiteLabel: {
      findUnique: vi.fn(async () => ({ name: 'Sellea', slug: 'sellea' })),
      // `resolveBrandScope` (el panel /admin) busca la marca Clubify: nunca es
      // la del equipo, así que Sellea queda estricta a lo suyo.
      findFirst: vi.fn(async () => ({ id: 'wl-clubify' })),
    },
    salesTeam: {
      findUnique: vi.fn(async () => ({ id: 't1', whiteLabelId: SELLEA })),
      delete: vi.fn(async () => ({})),
    },
    setting: {
      findUnique: vi.fn(async ({ where }: any) => (o.ajuste && where.key === CLAVE_RENOVACIONES ? { value: o.ajuste } : null)),
    },
    salesLead: {
      // El `salesTeamId` del `where` CUENTA: un doble que lo ignorara dejaría
      // pasar que un equipo prepare, vincule o borre el lead de otro.
      findFirst: vi.fn(async ({ where }: any) => {
        const lead = o.lead === undefined ? LEAD : o.lead;
        if (!lead || where.id !== lead.id) return null;
        return where.salesTeamId === undefined || where.salesTeamId === lead.salesTeamId ? lead : null;
      }),
      delete: vi.fn(async () => ({})),
    },
    tenant: {
      findFirst: vi.fn(async ({ where }: any) =>
        NEGOCIOS.find((n) => n.id === where.id && n.whiteLabelId === where.whiteLabelId && !n.deletedAt) ?? null,
      ),
      findMany: vi.fn(async ({ where }: any) =>
        NEGOCIOS.filter(
          (n) => n.whiteLabelId === where.whiteLabelId && (!where.id || where.id.in.includes(n.id)) && !n.deletedAt,
        ),
      ),
    },
    salesTeamMember: {
      findMany: vi.fn(async ({ where }: any) =>
        MIEMBROS.filter(
          (m) =>
            (where.isActive === undefined || m.isActive === where.isActive) &&
            (!where.userId || where.userId.in.includes(m.userId)),
        ).map((m) => ({ userId: m.userId, roles: m.roles, user: { fullName: m.nombre, email: null } })),
      ),
    },
    user: { findUnique: vi.fn(async () => ({ fullName: 'Admin de la marca', email: null })) },
    referralCode: {
      findMany: vi.fn(async ({ where }: any) =>
        CODIGOS.filter((c) => c.whiteLabelId === where.whiteLabelId && where.ownerUserId.in.includes(c.ownerUserId)),
      ),
    },
    salesMeeting: { findMany: vi.fn(async () => o.citas ?? []) },
    salesLeadActivity: { create: vi.fn(async () => ({})) },
    salesTeamSale: {
      findFirst: vi.fn(async ({ where }: any) => {
        const fila = ventas.find((v) => casa(v, where)) ?? null;
        if (fila && o.entreMedias) {
          const leida = { ...fila };
          o.entreMedias(fila);
          return leida;
        }
        return fila;
      }),
      findMany: vi.fn(async ({ where }: any) => ventas.filter((v) => casa(v, where))),
      count: vi.fn(async ({ where }: any) => ventas.filter((v) => casa(v, where)).length),
      create: vi.fn(async ({ data }: any) => {
        if (o.crearFalla) throw Object.assign(new Error('unique'), { code: o.crearFalla });
        const fila = ventaFila({ ...data, id: 'v-nueva' });
        ventas.push(fila);
        return fila;
      }),
      // MIRA EL `where`. Ignorarlo —como hacía este doble— daba verde aunque se
      // quitara `estado` o `updatedAt` del condicional, que es lo que impide
      // pisar a quien editó la misma venta a la vez o revivir una desvinculada.
      updateMany: vi.fn(async ({ where, data }: any) => {
        const tocadas = ventas.filter((v) => casa(v, where));
        for (const v of tocadas) Object.assign(v, data);
        return { count: tocadas.length };
      }),
    },
  };
  const audit = { log: vi.fn(async () => undefined) };
  return { prisma, audit, servicio: new VentasDeEquipoService(prisma as any, audit as any), ventas };
}

const user = { id: 'u-admin', role: 'SUPER_ADMIN', whiteLabelId: SELLEA } as any;

beforeEach(() => {
  vi.mocked(resolveTeamAccess).mockReset();
});

describe('vincular', () => {
  it('un closer no puede, y no escribe nada', async () => {
    vi.mocked(resolveTeamAccess).mockResolvedValue(acceso('closer') as any);
    const { prisma, servicio } = montar();
    await expect(servicio.vincular(user, 't1', 'l1', { negocioId: 'n1' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.salesTeamSale.create).not.toHaveBeenCalled();
  });

  it('el líder vincula: congela el código de cada uno y el ajuste de renovaciones de la MARCA', async () => {
    vi.mocked(resolveTeamAccess).mockResolvedValue(acceso('lider') as any);
    const { prisma, audit, servicio } = montar({ ajuste: 'renovaciones' });
    const r = await servicio.vincular(user, 't1', 'l1', {
      negocioId: 'n1',
      closerUserId: 'u-closer',
      setterUserId: 'u-setter',
    });

    expect(prisma.setting.findUnique).toHaveBeenCalledWith({ where: { key: CLAVE_RENOVACIONES }, select: { value: true } });
    const data = prisma.salesTeamSale.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      salesTeamId: 't1',
      whiteLabelId: SELLEA,
      leadId: 'l1',
      negocioId: 'n1',
      closerUserId: 'u-closer',
      closerCodeId: 'code-closer',
      setterUserId: 'u-setter',
      // Su código de Sellea no está aprobado, y el de Clubify no vale aquí.
      setterCodeId: null,
      pagaRenovaciones: true,
      estado: 'vinculada',
      vinculadaPorUserId: 'u-admin',
    });
    expect(r.negocio).toEqual({ id: 'n1', nombre: 'Pizza Ana' });
    expect(r.closer).toMatchObject({ userId: 'u-closer', aviso: null });
    expect(r.setter).toMatchObject({ userId: 'u-setter', aviso: 'sin_aprobar' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'sales_team.sale_linked' }));
    expect(prisma.salesLeadActivity.create).toHaveBeenCalled();
  });

  it('sin el ajuste de la marca, la venta se congela en «solo la venta»', async () => {
    vi.mocked(resolveTeamAccess).mockResolvedValue(acceso('admin') as any);
    const { prisma, servicio } = montar();
    await servicio.vincular(user, 't1', 'l1', { negocioId: 'n1' });
    expect(prisma.salesTeamSale.create.mock.calls[0][0].data.pagaRenovaciones).toBe(false);
  });

  it('un negocio de otra marca responde como si no existiera', async () => {
    vi.mocked(resolveTeamAccess).mockResolvedValue(acceso('admin') as any);
    const { prisma, servicio } = montar();
    await expect(servicio.vincular(user, 't1', 'l1', { negocioId: 'n2' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.salesTeamSale.create).not.toHaveBeenCalled();
  });

  it('un lead sin ganar no se vincula', async () => {
    vi.mocked(resolveTeamAccess).mockResolvedValue(acceso('admin') as any);
    const { prisma, servicio } = montar({ lead: { ...LEAD, wonAt: null } });
    await expect(servicio.vincular(user, 't1', 'l1', { negocioId: 'n1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.salesTeamSale.create).not.toHaveBeenCalled();
  });

  it('el closer tiene que ser colaborador activo', async () => {
    vi.mocked(resolveTeamAccess).mockResolvedValue(acceso('admin') as any);
    const { servicio } = montar();
    await expect(
      servicio.vincular(user, 't1', 'l1', { negocioId: 'n1', closerUserId: 'u-fuera' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ni dos negocios para un cliente ni dos ventas para un negocio', async () => {
    vi.mocked(resolveTeamAccess).mockResolvedValue(acceso('admin') as any);
    const conLead = montar({ ventas: [ventaFila()] });
    await expect(conLead.servicio.vincular(user, 't1', 'l1', { negocioId: 'n3' })).rejects.toBeInstanceOf(ConflictException);
    const conNegocio = montar({ ventas: [ventaFila({ leadId: 'otro' })] });
    await expect(conNegocio.servicio.vincular(user, 't1', 'l1', { negocioId: 'n1' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('si dos vinculan a la vez, el índice único parcial lo frena y se responde conflicto', async () => {
    vi.mocked(resolveTeamAccess).mockResolvedValue(acceso('admin') as any);
    const { servicio } = montar({ crearFalla: 'P2002' });
    await expect(servicio.vincular(user, 't1', 'l1', { negocioId: 'n1' })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('cambiar personas y desvincular', () => {
  it('si otra persona la cambió entre medias, conflicto', async () => {
    vi.mocked(resolveTeamAccess).mockResolvedValue(acceso('admin') as any);
    // La guardaron DESPUÉS de que la leyéramos: el `updatedAt` del condicional
    // ya no casa y no se escribe encima del cambio de la otra persona.
    const { servicio } = montar({
      ventas: [ventaFila()],
      entreMedias: (v) => {
        v.updatedAt = new Date('2026-09-12');
      },
    });
    await expect(servicio.cambiarPersonas(user, 't1', 'l1', { setterUserId: 'u-setter' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('si la desvincularon entre medias, no se le cambian las personas', async () => {
    vi.mocked(resolveTeamAccess).mockResolvedValue(acceso('admin') as any);
    const { servicio } = montar({
      ventas: [ventaFila()],
      entreMedias: (v) => {
        v.estado = 'desvinculada';
      },
    });
    await expect(servicio.cambiarPersonas(user, 't1', 'l1', { closerUserId: 'u-setter' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('no se pone de closer a quien no es colaborador activo del equipo', async () => {
    vi.mocked(resolveTeamAccess).mockResolvedValue(acceso('admin') as any);
    const { prisma, servicio } = montar({ ventas: [ventaFila()] });
    await expect(servicio.cambiarPersonas(user, 't1', 'l1', { closerUserId: 'u-fuera' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.salesTeamSale.updateMany).not.toHaveBeenCalled();
  });

  it('guardar vuelve a tomar el código vigente de los dos', async () => {
    vi.mocked(resolveTeamAccess).mockResolvedValue(acceso('admin') as any);
    const { prisma, servicio } = montar({ ventas: [ventaFila({ closerUserId: 'u-closer', closerCodeId: null })] });
    await servicio.cambiarPersonas(user, 't1', 'l1', { setterUserId: 'u-setter' });
    expect(prisma.salesTeamSale.updateMany.mock.calls[0][0].data).toEqual({
      closerUserId: 'u-closer',
      closerCodeId: 'code-closer',
      setterUserId: 'u-setter',
      setterCodeId: null,
    });
  });

  it('desvincular deja la fila con su estado, no la borra', async () => {
    vi.mocked(resolveTeamAccess).mockResolvedValue(acceso('admin') as any);
    const { prisma, audit, servicio } = montar({ ventas: [ventaFila()] });
    expect(await servicio.desvincular(user, 't1', 'l1')).toEqual({ ok: true });
    expect(prisma.salesTeamSale.updateMany.mock.calls[0][0].data).toMatchObject({
      estado: 'desvinculada',
      desvinculadaPorUserId: 'u-admin',
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'sales_team.sale_unlinked' }));
  });

  it('desvincular dos veces a la vez no vuelve a escribir la segunda', async () => {
    vi.mocked(resolveTeamAccess).mockResolvedValue(acceso('admin') as any);
    const { servicio } = montar({
      ventas: [ventaFila()],
      entreMedias: (v) => {
        v.estado = 'desvinculada';
      },
    });
    // Sin el `estado` en el condicional, la segunda pasada reescribiría quién
    // desvinculó y cuándo, borrando el rastro de quien lo hizo de verdad.
    await expect(servicio.desvincular(user, 't1', 'l1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sin venta vinculada no hay nada que desvincular', async () => {
    vi.mocked(resolveTeamAccess).mockResolvedValue(acceso('admin') as any);
    const { servicio } = montar();
    await expect(servicio.desvincular(user, 't1', 'l1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('preparar y buscar', () => {
  it('no sugiere un negocio ya vinculado a otra venta', async () => {
    vi.mocked(resolveTeamAccess).mockResolvedValue(acceso('admin') as any);
    const { servicio } = montar({ ventas: [ventaFila({ leadId: 'otro', negocioId: 'n1' })] });
    const r = await servicio.preparar(user, 't1', 'l1');
    expect(r.sugerencias).toEqual([]);
    expect(r.miembros.find((m) => m.userId === 'u-setter')?.codigo).toBe('sin_aprobar');
    expect(r.marca).toEqual({ nombre: 'Sellea' });
  });

  it('sugiere el negocio del teléfono y precarga closer y setter de la cita', async () => {
    vi.mocked(resolveTeamAccess).mockResolvedValue(acceso('lider') as any);
    const { servicio } = montar({
      citas: [{ status: 'REALIZADA', hostUserId: 'u-closer', agendadaPorUserId: 'u-setter', startAt: new Date('2026-09-09') }],
    });
    const r = await servicio.preparar(user, 't1', 'l1');
    expect(r.sugerencias.map((s) => s.id)).toEqual(['n1']);
    expect(r.precarga).toEqual({ closerUserId: 'u-closer', setterUserId: 'u-setter' });
    expect(r.puedeBuscar).toBe(false);
  });

  it('el líder no puede buscar negocios por texto', async () => {
    vi.mocked(resolveTeamAccess).mockResolvedValue(acceso('lider') as any);
    const { servicio } = montar();
    await expect(servicio.buscarNegocios(user, 't1', 'piz')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('el admin busca y ve cuál está ya vinculado', async () => {
    vi.mocked(resolveTeamAccess).mockResolvedValue(acceso('admin') as any);
    const { servicio } = montar({ ventas: [ventaFila({ negocioId: 'n1' })] });
    const r = await servicio.buscarNegocios(user, 't1', 'a');
    expect(r.negocios).toEqual([]); // «a» es de una sola letra: no se busca
    const r2 = await servicio.buscarNegocios(user, 't1', 'pizza');
    expect(r2.negocios.find((n) => n.id === 'n1')?.yaVinculado).toBe(true);
  });

  it('el lead de otro equipo no se prepara ni se vincula desde este', async () => {
    vi.mocked(resolveTeamAccess).mockResolvedValue(acceso('admin') as any);
    const { prisma, servicio } = montar({ lead: { ...LEAD, salesTeamId: 't-otro' } });
    await expect(servicio.preparar(user, 't1', 'l1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(servicio.vincular(user, 't1', 'l1', { negocioId: 'n1' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.salesTeamSale.create).not.toHaveBeenCalled();
  });
});

describe('listar', () => {
  it('solo las ventas VINCULADAS de ESTE equipo', async () => {
    vi.mocked(resolveTeamAccess).mockResolvedValue(acceso('admin') as any);
    const { servicio } = montar({
      ventas: [
        ventaFila(),
        ventaFila({ id: 'v-otroEquipo', salesTeamId: 't-otro', leadId: 'l-otro', negocioId: 'n3' }),
        ventaFila({ id: 'v-suelta', estado: 'desvinculada', leadId: 'l-suelto', negocioId: 'n3' }),
      ],
    });
    const r = await servicio.listar(user, 't1');
    expect(r.ventas.map((v) => v.id)).toEqual(['v1']);
  });
});

/**
 * Borrar el cliente y su venta. `SalesTeamSale.leadId` es `ON DELETE SET NULL`:
 * si el lead se va, la fila se queda `vinculada` y sin lead, donde la pantalla
 * y `desvincular` —que la buscan por `leadId`— ya no la encuentran, mientras el
 * índice único parcial sigue dando ese negocio por ocupado. Se niega el borrado
 * en vez de soltar la venta sola: es lo que luego se cobra.
 */
describe('borrar el cliente', () => {
  const conLeads = (prisma: any) => new SalesLeadsService(prisma, {} as any, {} as any);

  it('un cliente con negocio vinculado no se borra', async () => {
    vi.mocked(resolveTeamAccess).mockResolvedValue(acceso('admin') as any);
    const { prisma } = montar({ ventas: [ventaFila()] });
    // 409: el choque es de ESTADO, no del cuerpo de la petición.
    await expect(conLeads(prisma).borrarLead(user, 't1', 'l1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.salesLead.delete).not.toHaveBeenCalled();
  });

  it('desvinculada antes, el cliente se borra', async () => {
    vi.mocked(resolveTeamAccess).mockResolvedValue(acceso('admin') as any);
    const { prisma } = montar({ ventas: [ventaFila({ estado: 'desvinculada' })] });
    expect(await conLeads(prisma).borrarLead(user, 't1', 'l1')).toEqual({ ok: true });
    expect(prisma.salesLead.delete).toHaveBeenCalled();
  });
});

/**
 * La segunda puerta a la misma huérfana: borrar el EQUIPO desde /admin arrastra
 * sus leads (`SalesLead.team` es Cascade) y dejaría TODAS sus ventas sin lead,
 * invisibles y con el negocio ocupado para siempre. `resolveTeamAccess` no pinta
 * aquí: este servicio es del panel y se aísla por marca con `exigirMiMarca`.
 */
describe('borrar el equipo', () => {
  const conEquipos = (prisma: any) => new SalesTeamsService(prisma);

  it('un equipo con ventas vinculadas no se borra, y dice cuántas', async () => {
    const { prisma } = montar({
      ventas: [ventaFila(), ventaFila({ id: 'v2', leadId: 'l2', negocioId: 'n3' })],
    });
    await expect(conEquipos(prisma).remove('t1', user)).rejects.toBeInstanceOf(ConflictException);
    await expect(conEquipos(prisma).remove('t1', user)).rejects.toThrow(/2 ventas/);
    expect(prisma.salesTeam.delete).not.toHaveBeenCalled();
  });

  it('solo cuentan las VINCULADAS de ESE equipo: sin ellas, el equipo se borra', async () => {
    const { prisma } = montar({
      ventas: [
        ventaFila({ estado: 'desvinculada' }),
        ventaFila({ id: 'v-otroEquipo', salesTeamId: 't-otro', leadId: 'l-otro', negocioId: 'n3' }),
      ],
    });
    expect(await conEquipos(prisma).remove('t1', user)).toEqual({ ok: true });
    expect(prisma.salesTeam.delete).toHaveBeenCalled();
  });
});
