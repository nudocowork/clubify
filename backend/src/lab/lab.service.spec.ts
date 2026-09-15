/**
 * El Lab por marca, puerta por puerta del servicio. NO necesita base de datos.
 *
 * Por qué. Las reglas puras viven en `lab-access.spec.ts`; aquí se comprueba
 * que CADA método las aplica. Basta que una puerta se olvide —el detalle por
 * id, un voto, los comentarios, la lista de la moderación— para que el admin
 * de Sellea lea las propuestas de Clubify, o para que un afiliado de Sellea
 * siga entrando a un Lab que ya no es suyo.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { LabService } from './lab.service';
import { FILTRO_PLATAFORMA, LAB_SUPLANTACION_SOLO_LECTURA } from './lab-access';

const CLUBIFY = 'wl-clubify';
const SELLEA = 'wl-sellea';

const MARCAS = [
  { id: CLUBIFY, slug: 'clubify', name: 'Clubify', primaryColor: '#16a34a', logoUrl: null },
  { id: SELLEA, slug: 'sellea', name: 'Sellea', primaryColor: '#ff6b57', logoUrl: 'https://cdn.test/sellea.png' },
];

const USUARIOS: Record<string, any> = {
  'u-humberto': { whiteLabelId: SELLEA, tenantId: null, referralCodes: [] },
  'u-equipo': { whiteLabelId: null, tenantId: null, referralCodes: [] },
  'u-afiliado-sellea': { whiteLabelId: null, tenantId: null, referralCodes: [{ whiteLabelId: SELLEA }] },
  'u-afiliado-clubify': { whiteLabelId: null, tenantId: null, referralCodes: [{ whiteLabelId: CLUBIFY }] },
  'u-dueno-sellea': { whiteLabelId: null, tenantId: 't-sellea', referralCodes: [] },
};

const NEGOCIOS: Record<string, any> = { 't-sellea': { whiteLabelId: SELLEA } };

const sesion: Record<string, any> = {
  humberto: { id: 'u-humberto', email: 'humberto@sellea.test', role: 'SUPER_ADMIN', tenantId: null, whiteLabelId: SELLEA },
  // Lo que firma `impersonateWhiteLabel` cuando Javier entra a Sellea desde el
  // panel maestro: `sub` = Humberto, con `impersonatedBy`.
  javierEnSellea: { id: 'u-humberto', email: 'humberto@sellea.test', role: 'SUPER_ADMIN', tenantId: null, whiteLabelId: SELLEA, impersonatedBy: 'u-javier' },
  equipoClubify: { id: 'u-equipo', email: 'equipo@clubify.test', role: 'SUPER_ADMIN', tenantId: null, whiteLabelId: null },
  afiliadoSellea: { id: 'u-afiliado-sellea', email: 'a@sellea.test', role: 'AFFILIATE_AMBASSADOR', tenantId: null, whiteLabelId: null },
  afiliadoClubify: { id: 'u-afiliado-clubify', email: 'a@clubify.test', role: 'AFFILIATE_INFLUENCER', tenantId: null, whiteLabelId: null },
  duenoSellea: { id: 'u-dueno-sellea', email: 'd@sellea.test', role: 'TENANT_OWNER', tenantId: 't-sellea', whiteLabelId: null },
};

const PROPUESTA_NUEVA = {
  title: 'Agenda por sede',
  description: 'Poder ver la agenda de cada sede por separado.',
  category: 'CLIENTS' as const,
};

/** Evalúa el `where` de Prisma que arma el Lab: igualdad, `in`, `contains`, AND y OR. */
function cumple(fila: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([campo, cond]: [string, any]) => {
    if (campo === 'AND') return cond.every((w: any) => cumple(fila, w));
    if (campo === 'OR') return cond.some((w: any) => cumple(fila, w));
    if (cond && typeof cond === 'object') {
      if (Array.isArray(cond.in)) return cond.in.includes(fila[campo]);
      if (typeof cond.contains === 'string') {
        return String(fila[campo] ?? '').toLowerCase().includes(cond.contains.toLowerCase());
      }
      return true; // `gte` de fechas: no cambia estos casos
    }
    return fila[campo] === cond;
  });
}

function montar() {
  const base = {
    category: 'CLIENTS',
    priority: 'MEDIUM',
    description: 'Una descripción suficientemente larga.',
    votesScore: 0,
    votesCount: 0,
    commentsCount: 0,
    createdAt: new Date('2026-09-01'),
    author: { id: 'autor', fullName: 'Autor', role: 'X', email: 'autor@test' },
    lastStatusChangedBy: null,
  };
  const propuestas = [
    { ...base, id: 'p-historica', title: 'Histórica sin marca', whiteLabelId: null, status: 'APPROVED', authorId: 'u-afiliado-clubify' },
    { ...base, id: 'p-clubify', title: 'Idea de Clubify', whiteLabelId: CLUBIFY, status: 'EVALUATING', authorId: 'u-afiliado-clubify' },
    { ...base, id: 'p-sellea', title: 'Idea de Sellea', whiteLabelId: SELLEA, status: 'EVALUATING', authorId: 'u-humberto' },
    { ...base, id: 'p-sellea-pendiente', title: 'Pendiente de Sellea', whiteLabelId: SELLEA, status: 'PENDING', authorId: 'u-humberto' },
  ];
  const prisma = {
    whiteLabel: {
      findFirst: vi.fn(async ({ where }: any) => MARCAS.find((m) => m.slug === where.slug) ?? null),
      findUnique: vi.fn(async ({ where }: any) => MARCAS.find((m) => m.id === where.id) ?? null),
      findMany: vi.fn(async ({ where }: any) => MARCAS.filter((m) => where.id.in.includes(m.id))),
    },
    user: {
      findUnique: vi.fn(async ({ where }: any) => USUARIOS[where.id] ?? null),
    },
    tenant: {
      findUnique: vi.fn(async ({ where }: any) => NEGOCIOS[where.id] ?? null),
    },
    labProposal: {
      findMany: vi.fn(async ({ where }: any) => propuestas.filter((p) => cumple(p, where))),
      count: vi.fn(async ({ where }: any) => propuestas.filter((p) => cumple(p, where)).length),
      findUnique: vi.fn(async ({ where }: any) => propuestas.find((p) => p.id === where.id) ?? null),
      groupBy: vi.fn(async () =>
        [...new Set(propuestas.map((p) => p.whiteLabelId))].map((whiteLabelId) => ({
          whiteLabelId,
          _count: { _all: 1 },
        })),
      ),
      create: vi.fn(async ({ data }: any) => ({ id: 'p-nueva', ...data })),
      update: vi.fn(async ({ where, data }: any) => ({
        ...propuestas.find((p) => p.id === where.id),
        ...data,
      })),
      delete: vi.fn(async () => null),
    },
    labVote: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      groupBy: vi.fn(async () => []),
      upsert: vi.fn(async () => null),
      delete: vi.fn(async () => null),
    },
    labComment: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: any) => data),
      count: vi.fn(async () => 0),
    },
  };
  const alerts = { sendTeamAlert: vi.fn(async () => ({ ok: true, sent: 1, total: 1 })) };
  const email = { send: vi.fn(async () => null) };
  const svc = new LabService(prisma as any, alerts as any, email as any);
  return { svc, prisma, alerts, email };
}

describe('la moderación de la plataforma', () => {
  it('ve las propuestas de todas las marcas; las de Sellea llevan nombre y color', async () => {
    const { svc } = montar();
    const r = await svc.listAdmin(sesion.equipoClubify);
    const etiqueta = Object.fromEntries(r.items.map((p) => [p.id, p.brand]));
    const sellea = { id: SELLEA, name: 'Sellea', primaryColor: '#ff6b57' };

    expect(Object.keys(etiqueta).sort()).toEqual([
      'p-clubify',
      'p-historica',
      'p-sellea',
      'p-sellea-pendiente',
    ]);
    expect(etiqueta['p-sellea']).toEqual(sellea);
    expect(etiqueta['p-sellea-pendiente']).toEqual(sellea);
    expect(etiqueta['p-clubify']).toBeNull();
    expect(etiqueta['p-historica']).toBeNull();
    // Opciones del filtro: las marcas blancas con propuestas, no Clubify.
    expect(r.marcas).toEqual([sellea]);
  });

  it('pendientes y top también llevan la etiqueta', async () => {
    const { svc } = montar();
    const pendientes = await svc.listAdmin(sesion.equipoClubify, { status: 'PENDING' });
    expect(pendientes.items.map((p) => [p.id, p.brand?.name ?? null])).toEqual([
      ['p-sellea-pendiente', 'Sellea'],
    ]);

    // El top es de todas las marcas, y solo con lo que ya salió a votación.
    const top = await svc.listAdmin(sesion.equipoClubify, { sortBy: 'top' });
    expect(top.items.map((p) => p.id).sort()).toEqual(['p-clubify', 'p-historica', 'p-sellea']);
    expect(top.items.find((p) => p.id === 'p-sellea')?.brand?.name).toBe('Sellea');
  });

  it('filtra por marca; «plataforma» junta Clubify y las históricas sin marca', async () => {
    const { svc } = montar();
    const sellea = await svc.listAdmin(sesion.equipoClubify, { whiteLabelId: SELLEA });
    expect(sellea.items.map((p) => p.id).sort()).toEqual(['p-sellea', 'p-sellea-pendiente']);

    const plataforma = await svc.listAdmin(sesion.equipoClubify, { whiteLabelId: FILTRO_PLATAFORMA });
    expect(plataforma.items.map((p) => p.id).sort()).toEqual(['p-clubify', 'p-historica']);
  });

  it('el detalle de una de Sellea lleva etiqueta, pero el equipo no vota ni comenta ahí', async () => {
    const { svc, prisma } = montar();
    const d = await svc.getById('p-sellea', sesion.equipoClubify);
    expect(d.brand?.name).toBe('Sellea');
    expect(d.canParticipate).toBe(false);

    await expect(svc.vote('p-sellea', sesion.equipoClubify, 'LIKE')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.comment('p-sellea', sesion.equipoClubify, 'Buena idea')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.labVote.upsert).not.toHaveBeenCalled();
    expect(prisma.labComment.create).not.toHaveBeenCalled();
  });

  it('abre el detalle de una pendiente: la moderación enlaza ahí', async () => {
    const { svc } = montar();
    const d = await svc.getById('p-sellea-pendiente', sesion.equipoClubify);
    expect(d.id).toBe('p-sellea-pendiente');
  });

  it('no fusiona propuestas de marcas distintas', async () => {
    const { svc } = montar();
    await expect(
      svc.mergeProposals('p-sellea', 'p-clubify', sesion.equipoClubify),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('el SMS al equipo dice de qué marca es la propuesta', async () => {
    const { svc, alerts } = montar();
    const notificar = (svc as any).notifyStatusChange.bind(svc);
    await notificar({ id: 'p-sellea', title: 'Idea de Sellea', whiteLabelId: SELLEA, author: null }, 'APPROVED', null);
    await notificar({ id: 'p-historica', title: 'Histórica', whiteLabelId: null, author: null }, 'REJECTED', 'Duplicada');

    expect(alerts.sendTeamAlert).toHaveBeenNthCalledWith(
      1,
      'Lab de Sellea: la propuesta "Idea de Sellea" cambió a APPROVED',
      'lab',
    );
    expect(alerts.sendTeamAlert).toHaveBeenNthCalledWith(
      2,
      'Lab de Clubify: la propuesta "Histórica" cambió a REJECTED (motivo: Duplicada)',
      'lab',
    );
  });

  it('el correo al autor solo sale para propuestas de la plataforma', async () => {
    // El de una marca blanca lleva enlace a app.soyclubify.com: fuga de marca.
    const { svc, email } = montar();
    const notificar = (svc as any).notifyStatusChange.bind(svc);
    await notificar(
      { id: 'p-sellea', title: 'Idea de Sellea', whiteLabelId: SELLEA, author: { fullName: 'Humberto', email: 'humberto@sellea.test' } },
      'APPROVED',
      null,
    );
    expect(email.send).not.toHaveBeenCalled();

    await notificar(
      { id: 'p-historica', title: 'Histórica', whiteLabelId: null, author: { fullName: 'Ana', email: 'ana@clubify.test' } },
      'APPROVED',
      null,
    );
    expect(email.send).toHaveBeenCalledTimes(1);
  });
});

describe('el administrador general de Sellea', () => {
  it('su feed es el de Sellea y nada de Clubify', async () => {
    const { svc } = montar();
    const r = await svc.listPublic(sesion.humberto, 'CLIENTS');
    expect(r.items.map((p) => p.id)).toEqual(['p-sellea']);
  });

  it('su propuesta nace con la marca Sellea', async () => {
    const { svc, prisma } = montar();
    await svc.createProposal(sesion.humberto, PROPUESTA_NUEVA);
    expect(prisma.labProposal.create.mock.calls[0][0].data.whiteLabelId).toBe(SELLEA);
  });

  it('no abre por id, ni vota, ni comenta, ni lee comentarios de propuestas de Clubify', async () => {
    const { svc, prisma } = montar();
    for (const id of ['p-clubify', 'p-historica']) {
      await expect(svc.getById(id, sesion.humberto)).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.vote(id, sesion.humberto, 'HIGH_PRIORITY')).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.removeVote(id, sesion.humberto)).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.comment(id, sesion.humberto, 'Me sirve')).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.listComments(id, sesion.humberto)).rejects.toBeInstanceOf(NotFoundException);
    }
    expect(prisma.labVote.upsert).not.toHaveBeenCalled();
    expect(prisma.labVote.delete).not.toHaveBeenCalled();
    expect(prisma.labComment.create).not.toHaveBeenCalled();
  });

  it('en su propia propuesta sí vota y la ve sin etiqueta', async () => {
    const { svc, prisma } = montar();
    const d = await svc.getById('p-sellea', sesion.humberto);
    expect(d.brand).toBeNull();
    expect(d.canParticipate).toBe(true);
    await svc.vote('p-sellea', sesion.humberto, 'NEED');
    expect(prisma.labVote.upsert).toHaveBeenCalledTimes(1);
  });

  it('entrando desde el panel maestro se lee, pero no se propone, vota ni comenta a su nombre', async () => {
    const { svc, prisma } = montar();
    const quien = sesion.javierEnSellea;

    const r = await svc.listPublic(quien, 'CLIENTS');
    expect(r.items.map((p) => p.id)).toEqual(['p-sellea']);
    expect((await svc.getById('p-sellea', quien)).canParticipate).toBe(false);
    expect((await svc.contexto(quien)).soloLectura).toBe(true);

    await expect(svc.createProposal(quien, PROPUESTA_NUEVA)).rejects.toThrow(LAB_SUPLANTACION_SOLO_LECTURA);
    await expect(svc.vote('p-sellea', quien, 'LIKE')).rejects.toThrow(LAB_SUPLANTACION_SOLO_LECTURA);
    await expect(svc.removeVote('p-sellea', quien)).rejects.toThrow(LAB_SUPLANTACION_SOLO_LECTURA);
    await expect(svc.comment('p-sellea', quien, 'Comentario')).rejects.toThrow(LAB_SUPLANTACION_SOLO_LECTURA);
    // Nada escrito con el id de Humberto: su voto real no se pisa.
    expect(prisma.labProposal.create).not.toHaveBeenCalled();
    expect(prisma.labVote.upsert).not.toHaveBeenCalled();
    expect(prisma.labVote.delete).not.toHaveBeenCalled();
    expect(prisma.labComment.create).not.toHaveBeenCalled();
  });

  it('no entra a la moderación: ni lista, ni cambia estados, ni fusiona, ni borra, ni métricas', async () => {
    const { svc, prisma } = montar();
    await expect(svc.listAdmin(sesion.humberto)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.setStatus('p-clubify', 'REJECTED', sesion.humberto, 'no')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.mergeProposals('p-sellea', 'p-sellea-pendiente', sesion.humberto)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.deleteProposal('p-clubify', sesion.humberto)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.metrics(sesion.humberto)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.labProposal.findMany).not.toHaveBeenCalled();
    expect(prisma.labProposal.update).not.toHaveBeenCalled();
    expect(prisma.labProposal.delete).not.toHaveBeenCalled();
  });

  it('el contexto le devuelve su marca, para pintar nombre y color', async () => {
    const { svc } = montar();
    const c = await svc.contexto(sesion.humberto);
    expect(c.alcance).toBe('MARCA_ADMIN');
    expect(c.soloLectura).toBe(false);
    expect(c.marca).toMatchObject({ name: 'Sellea', primaryColor: '#ff6b57' });
  });
});

describe('afiliados y negocios', () => {
  it('un afiliado de Sellea no entra al Lab por ninguna puerta', async () => {
    const { svc, prisma } = montar();
    await expect(svc.contexto(sesion.afiliadoSellea)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.listPublic(sesion.afiliadoSellea, 'CLIENTS')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.getById('p-sellea', sesion.afiliadoSellea)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.vote('p-sellea', sesion.afiliadoSellea, 'LIKE')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.createProposal(sesion.afiliadoSellea, PROPUESTA_NUEVA)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.labProposal.create).not.toHaveBeenCalled();
    expect(prisma.labVote.upsert).not.toHaveBeenCalled();
  });

  it('el dueño de un negocio de Sellea tampoco', async () => {
    const { svc } = montar();
    await expect(svc.listPublic(sesion.duenoSellea, 'CLIENTS')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.createProposal(sesion.duenoSellea, PROPUESTA_NUEVA)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('un afiliado de Clubify sigue con el Lab de Clubify (históricas incluidas) y sin ver el de Sellea', async () => {
    const { svc } = montar();
    const r = await svc.listPublic(sesion.afiliadoClubify, 'CLIENTS');
    expect(r.items.map((p) => p.id).sort()).toEqual(['p-clubify', 'p-historica']);
    await expect(svc.getById('p-sellea', sesion.afiliadoClubify)).rejects.toBeInstanceOf(NotFoundException);

    const c = await svc.contexto(sesion.afiliadoClubify);
    expect(c.alcance).toBe('PLATAFORMA_MIEMBRO');
    expect(c.marca?.name).toBe('Clubify');
  });
});
