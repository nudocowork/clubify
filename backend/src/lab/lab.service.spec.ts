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
  'u-humberto': { fullName: 'Humberto Ruiz', whiteLabelId: SELLEA, tenantId: null, referralCodes: [] },
  'u-equipo': { fullName: 'Equipo Clubify', whiteLabelId: null, tenantId: null, referralCodes: [] },
  'u-afiliado-sellea': { fullName: 'Afiliado Sellea', whiteLabelId: null, tenantId: null, referralCodes: [{ whiteLabelId: SELLEA }] },
  'u-afiliado-clubify': { fullName: 'Afiliado Clubify', whiteLabelId: null, tenantId: null, referralCodes: [{ whiteLabelId: CLUBIFY }] },
  'u-dueno-sellea': { fullName: 'Dueño Sellea', whiteLabelId: null, tenantId: 't-sellea', referralCodes: [] },
  'u-dueno-clubify': { fullName: 'Dueño Clubify', whiteLabelId: null, tenantId: 't-clubify', referralCodes: [] },
};

/**
 * Los avisos salen con `void` (best-effort: un SMS caído no puede tumbar la
 * creación), así que hay que dejar correr los microtasks antes de mirarlos.
 */
const esperarAvisos = () => new Promise((r) => setTimeout(r, 0));

/** Lo que multer deja en `file`: solo se miran el tipo y el tamaño. */
const archivo = (mimetype: string, size: number) =>
  ({ mimetype, size, originalname: 'adjunto', buffer: Buffer.alloc(0) }) as any;

const NEGOCIOS: Record<string, any> = {
  't-sellea': { whiteLabelId: SELLEA },
  't-clubify': { whiteLabelId: CLUBIFY },
};

const sesion: Record<string, any> = {
  humberto: { id: 'u-humberto', email: 'humberto@sellea.test', role: 'SUPER_ADMIN', tenantId: null, whiteLabelId: SELLEA },
  // Lo que firma `impersonateWhiteLabel` cuando Javier entra a Sellea desde el
  // panel maestro: `sub` = Humberto, con `impersonatedBy`.
  javierEnSellea: { id: 'u-humberto', email: 'humberto@sellea.test', role: 'SUPER_ADMIN', tenantId: null, whiteLabelId: SELLEA, impersonatedBy: 'u-javier' },
  equipoClubify: { id: 'u-equipo', email: 'equipo@clubify.test', role: 'SUPER_ADMIN', tenantId: null, whiteLabelId: null },
  afiliadoSellea: { id: 'u-afiliado-sellea', email: 'a@sellea.test', role: 'AFFILIATE_AMBASSADOR', tenantId: null, whiteLabelId: null },
  afiliadoClubify: { id: 'u-afiliado-clubify', email: 'a@clubify.test', role: 'AFFILIATE_INFLUENCER', tenantId: null, whiteLabelId: null },
  duenoSellea: { id: 'u-dueno-sellea', email: 'd@sellea.test', role: 'TENANT_OWNER', tenantId: 't-sellea', whiteLabelId: null },
  duenoClubify: { id: 'u-dueno-clubify', email: 'd@clubify.test', role: 'TENANT_OWNER', tenantId: 't-clubify', whiteLabelId: null },
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
      // `not` hay que entenderlo de verdad: cayendo al `true` de abajo, un
      // `where: { removedAt: { not: null } }` casaba con TODO y la prueba de
      // «no estaba retirada» pasaba sin mirar nada.
      if ('not' in cond) return (fila[campo] ?? null) !== cond.not;
      if (typeof cond.contains === 'string') {
        return String(fila[campo] ?? '').toLowerCase().includes(cond.contains.toLowerCase());
      }
      return true; // `gte` de fechas: no cambia estos casos
    }
    return fila[campo] === cond;
  });
}

function montar(opciones: { extra?: any[] } = {}) {
  // Id distinto en cada alta, como la base de verdad. Con un id FIJO, un test
  // de «no repitas el aviso» pasa aunque la clave esté mal —el doble clic
  // devolvía dos veces el mismo id—: fue justo lo que escondió el bug de la
  // anti-repetición, así que el mock no puede mentir en esto.
  let secuencia = 0;
  const base = {
    category: 'CLIENTS',
    priority: 'MEDIUM',
    description: 'Una descripción suficientemente larga.',
    votesScore: 0,
    votesCount: 0,
    commentsCount: 0,
    createdAt: new Date('2026-09-01'),
    // Explícito: `{ removedAt: null }` es «no retirada», y `undefined` no
    // casa con `null`. Sin esta línea, todo lo de retirar pasaría en falso.
    removedAt: null,
    removedById: null,
    removedReason: null,
    author: { id: 'autor', fullName: 'Autor', role: 'X', email: 'autor@test' },
    lastStatusChangedBy: null,
  };
  const propuestas = [
    { ...base, id: 'p-historica', title: 'Histórica sin marca', whiteLabelId: null, status: 'APPROVED', authorId: 'u-afiliado-clubify' },
    { ...base, id: 'p-clubify', title: 'Idea de Clubify', whiteLabelId: CLUBIFY, status: 'EVALUATING', authorId: 'u-afiliado-clubify' },
    { ...base, id: 'p-sellea', title: 'Idea de Sellea', whiteLabelId: SELLEA, status: 'EVALUATING', authorId: 'u-humberto' },
    { ...base, id: 'p-sellea-pendiente', title: 'Pendiente de Sellea', whiteLabelId: SELLEA, status: 'PENDING', authorId: 'u-humberto' },
    ...(opciones.extra ?? []).map((p) => ({ ...base, ...p })),
  ];
  const prisma = {
    whiteLabel: {
      findFirst: vi.fn(async ({ where }: any) => MARCAS.find((m) => m.slug === where.slug) ?? null),
      findUnique: vi.fn(async ({ where }: any) => MARCAS.find((m) => m.id === where.id) ?? null),
      findMany: vi.fn(async ({ where }: any) => MARCAS.filter((m) => where.id.in.includes(m.id))),
    },
    user: {
      findUnique: vi.fn(async ({ where }: any) => USUARIOS[where.id] ?? null),
      // Lo usa `metrics` para poner nombre a quien más propone.
      findMany: vi.fn(async ({ where }: any) =>
        (where?.id?.in ?? [])
          .filter((id: string) => USUARIOS[id])
          .map((id: string) => ({ id, fullName: USUARIOS[id].fullName, role: 'X' })),
      ),
    },
    tenant: {
      findUnique: vi.fn(async ({ where }: any) => NEGOCIOS[where.id] ?? null),
    },
    labProposal: {
      findMany: vi.fn(async ({ where }: any) => propuestas.filter((p) => cumple(p, where))),
      count: vi.fn(async ({ where }: any) => propuestas.filter((p) => cumple(p, where)).length),
      findUnique: vi.fn(async ({ where }: any) => propuestas.find((p) => p.id === where.id) ?? null),
      // Tipado con su argumento a propósito: así `mock.calls[0][0]` es el
      // objeto de la consulta y se puede mirar el `where` sin castear.
      groupBy: vi.fn(async (_args: any) =>
        [...new Set(propuestas.map((p) => p.whiteLabelId))].map((whiteLabelId) => ({
          whiteLabelId,
          _count: { _all: 1 },
        })),
      ),
      create: vi.fn(async ({ data }: any) => ({ id: `p-${++secuencia}`, ...data })),
      update: vi.fn(async ({ where, data }: any) => ({
        ...propuestas.find((p) => p.id === where.id),
        ...data,
      })),
      // Retirar y restaurar van por `updateMany` (atómico y con la condición
      // dentro del WHERE). El doble MUTA la fila para que el segundo intento
      // vea el estado del primero: si devolviera siempre count=1, la prueba de
      // «retirar dos veces» pasaría sin probar nada.
      updateMany: vi.fn(async ({ where, data }: any) => {
        const filas = propuestas.filter((p) => cumple(p, where));
        for (const f of filas) Object.assign(f, data);
        return { count: filas.length };
      }),
      delete: vi.fn(async ({ where }: any) => {
        const i = propuestas.findIndex((p) => p.id === where.id);
        if (i >= 0) propuestas.splice(i, 1);
        return null;
      }),
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
      create: vi.fn(async ({ data }: any) => ({ id: `c-${++secuencia}`, ...data })),
      count: vi.fn(async () => 0),
    },
  };
  const alerts = {
    sendTeamAlert: vi.fn(async () => ({ ok: true, sent: 1, total: 1 })),
    // Tipado con sus dos argumentos a propósito: así `mock.calls[0]` es
    // [teléfono, texto] y las pruebas leen el SMS sin castear a `any`.
    sendInternalAlert: vi.fn(async (_telefono: string, _texto: string) => ({ ok: true })),
  };
  // El correo del Lab sale por Grow Business (BrandEmailService), no por
  // EmailService: aquel no manda nada en produccion.
  const email = {
    sendRaw: vi.fn(async (_opts: { whiteLabelId: string | null }) => ({ sent: true as const })),
  };
  const media = {
    // Tipado con su argumento: así `mock.calls[0][0]` es el objeto de la subida
    // y se puede mirar la carpeta sin castear a `any`.
    upload: vi.fn(async (_opts: { folder?: string; file: unknown }) => ({
      url: 'https://cdn.test/lab/abc.webp',
      key: 'lab/abc.webp',
      size: 1234,
      contentType: 'image/webp',
      category: 'image',
    })),
  };
  const svc = new LabService(prisma as any, alerts as any, email as any, media as any);
  return { svc, prisma, alerts, email, media };
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
    expect(email.sendRaw).not.toHaveBeenCalled();

    await notificar(
      { id: 'p-historica', title: 'Histórica', whiteLabelId: null, author: { fullName: 'Ana', email: 'ana@clubify.test' } },
      'APPROVED',
      null,
    );
    expect(email.sendRaw).toHaveBeenCalledTimes(1);
    // Por la plataforma: el filtro de arriba ya garantiza que la propuesta es suya.
    expect(email.sendRaw.mock.calls[0][0]).toMatchObject({ whiteLabelId: null });
  });
});

describe('el administrador general de Sellea', () => {
  it('su feed es el de Sellea y nada de Clubify', async () => {
    const { svc } = montar();
    const r = await svc.listPublic(sesion.humberto, 'CLIENTS');
    // La pendiente entra porque manda en la marca (y además es suya): es lo
    // que tiene que revisar. Ninguna de Clubify se cuela.
    expect(r.items.map((p) => p.id)).toEqual(['p-sellea', 'p-sellea-pendiente']);
  });

  it('ve las que están esperando revisión, que antes no aparecían', async () => {
    const { svc } = montar();
    const r = await svc.listPublic(sesion.humberto, 'CLIENTS');
    expect(r.items.map((p) => p.status)).toContain('PENDING');
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
    // Lee lo mismo que el administrador de la marca, pendientes incluidas.
    expect(r.items.map((p) => p.id)).toEqual(['p-sellea', 'p-sellea-pendiente']);
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
    await expect(svc.removeProposal('p-clubify', sesion.humberto)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.restoreProposal('p-clubify', sesion.humberto)).rejects.toBeInstanceOf(ForbiddenException);
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

describe('el aviso a Clubify cuando escribe una marca blanca', () => {
  it('Humberto crea una propuesta: SMS a la línea del equipo con marca, autor, título y enlace', async () => {
    const { svc, alerts } = montar();
    await svc.createProposal(sesion.humberto, PROPUESTA_NUEVA);
    await esperarAvisos();

    expect(alerts.sendInternalAlert).toHaveBeenCalledTimes(1);
    const [telefono, texto] = alerts.sendInternalAlert.mock.calls[0];
    expect(telefono).toBe('+573248088401');
    expect(texto).toContain('Lab de Sellea');
    expect(texto).toContain('Humberto Ruiz');
    expect(texto).toContain('«Agenda por sede»');
    // El enlace lleva a la MODERACIÓN, que es donde Javier la trabaja.
    expect(texto).toContain('/admin/lab/p-1');
  });

  it('Humberto comenta: también avisa, que es donde acaba de precisar lo que pide', async () => {
    const { svc, alerts } = montar();
    await svc.comment('p-sellea', sesion.humberto, 'Mejor por sede y por día.');
    await esperarAvisos();

    expect(alerts.sendInternalAlert).toHaveBeenCalledTimes(1);
    const [, texto] = alerts.sendInternalAlert.mock.calls[0];
    expect(texto).toContain('Lab de Sellea: Humberto Ruiz comentó en «Idea de Sellea»');
  });

  it('NO avisa por lo de la plataforma: ni propuestas ni comentarios de Clubify', async () => {
    const { svc, alerts } = montar();
    await svc.createProposal(sesion.afiliadoClubify, PROPUESTA_NUEVA);
    await svc.comment('p-clubify', sesion.afiliadoClubify, 'Me sirve mucho.');
    await svc.comment('p-historica', sesion.afiliadoClubify, 'Y a mí también.');
    await esperarAvisos();

    expect(alerts.sendInternalAlert).not.toHaveBeenCalled();
  });

  it('el doble clic en «Crear» deja dos filas, pero un solo SMS', async () => {
    const { svc, alerts, prisma } = montar();
    await svc.createProposal(sesion.humberto, PROPUESTA_NUEVA);
    await svc.createProposal(sesion.humberto, PROPUESTA_NUEVA);
    await esperarAvisos();

    expect(prisma.labProposal.create).toHaveBeenCalledTimes(2);
    expect(alerts.sendInternalAlert).toHaveBeenCalledTimes(1);
  });

  it('dos propuestas DISTINTAS avisan las dos: cada una es algo que revisar', async () => {
    const { svc, alerts } = montar();
    await svc.createProposal(sesion.humberto, PROPUESTA_NUEVA);
    await svc.createProposal(sesion.humberto, {
      ...PROPUESTA_NUEVA,
      title: 'Otra idea muy distinta',
    });
    await esperarAvisos();

    expect(alerts.sendInternalAlert).toHaveBeenCalledTimes(2);
  });

  it('cinco comentarios seguidos en la misma propuesta son UN solo SMS', async () => {
    // La clave era el id del comentario —nuevo en cada uno—, así que no cortaba
    // nada: quince comentarios en cinco minutos eran quince SMS a Javier.
    const { svc, alerts, prisma } = montar();
    for (let i = 0; i < 5; i++) {
      await svc.comment('p-sellea', sesion.humberto, `Comentario número ${i}.`);
    }
    await esperarAvisos();

    expect(prisma.labComment.create).toHaveBeenCalledTimes(5);
    expect(alerts.sendInternalAlert).toHaveBeenCalledTimes(1);
  });

  it('comentar en OTRA propuesta sí vuelve a avisar: es otra conversación', async () => {
    const { svc, alerts } = montar();
    await svc.comment('p-sellea', sesion.humberto, 'Un comentario.');
    await svc.comment('p-sellea-pendiente', sesion.humberto, 'Otro comentario.');
    await esperarAvisos();

    expect(alerts.sendInternalAlert).toHaveBeenCalledTimes(2);
  });

  it('un SMS que no sale deja aviso en el log y no tumba la propuesta', async () => {
    // `sendInternalAlert` NO lanza: captura sus errores y devuelve ok:false
    // (sin subcuenta de Grow Business, por ejemplo). Sin el warn, un SMS que no
    // sale no deja rastro en ningún sitio y nadie se entera.
    const { svc, alerts, prisma } = montar();
    alerts.sendInternalAlert.mockResolvedValue({ ok: false });
    const avisado = vi
      .spyOn((svc as any).logger, 'warn')
      .mockImplementation(() => undefined);

    const creada = await svc.createProposal(sesion.humberto, PROPUESTA_NUEVA);
    await esperarAvisos();

    expect(creada.id).toBe('p-1');
    expect(prisma.labProposal.create).toHaveBeenCalledTimes(1);
    expect(avisado).toHaveBeenCalledTimes(1);
    expect(String(avisado.mock.calls[0][0])).toContain('no salió');
  });

  it('si algo revienta dentro del aviso, la propuesta y el comentario quedan guardados', async () => {
    // `whiteLabel.findUnique` solo se usa DENTRO del aviso (al resolver el
    // nombre de la marca): así se prueba que el try/catch protege de verdad la
    // escritura, y no un camino que en producción no ocurre.
    const { svc, prisma } = montar();
    prisma.whiteLabel.findUnique.mockRejectedValue(new Error('base caída'));
    vi.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);

    const creada = await svc.createProposal(sesion.humberto, PROPUESTA_NUEVA);
    const comentario = await svc.comment('p-sellea', sesion.humberto, 'Un comentario.');
    await esperarAvisos();

    expect(creada.id).toBe('p-1');
    expect(comentario.id).toBeTruthy();
    expect(prisma.labProposal.create).toHaveBeenCalledTimes(1);
    expect(prisma.labComment.create).toHaveBeenCalledTimes(1);
  });
});

describe('adjuntar una imagen o un video a la propuesta', () => {
  it('sube al bucket, en la carpeta del Lab, y devuelve la URL', async () => {
    const { svc, media } = montar();
    const r = await svc.subirAdjunto(sesion.humberto, archivo('image/png', 2 * 1024 * 1024));

    expect(media.upload).toHaveBeenCalledTimes(1);
    expect(media.upload.mock.calls[0][0].folder).toBe('lab');
    expect(r).toMatchObject({ url: 'https://cdn.test/lab/abc.webp', kind: 'image' });
  });

  it('un tipo o un tamaño que no toca ni llega al bucket', async () => {
    const { svc, media } = montar();
    // PDF y audio no: el Lab acepta menos que `/media/upload`.
    await expect(
      svc.subirAdjunto(sesion.humberto, archivo('application/pdf', 1024)),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.subirAdjunto(sesion.humberto, archivo('image/png', 40 * 1024 * 1024)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(media.upload).not.toHaveBeenCalled();
  });

  it('un video corto sí pasa: es lo que pidió Javier para enseñar la pantalla', async () => {
    const { svc, media } = montar();
    await svc.subirAdjunto(sesion.humberto, archivo('video/mp4', 40 * 1024 * 1024));
    expect(media.upload).toHaveBeenCalledTimes(1);
  });

  it('un negocio de Clubify NO sube archivos: 403 y nada llega al bucket', async () => {
    // Javier (2026-09-16): el adjunto es para las marcas blancas. Lo que no
    // puede pasar es que cualquiera de los negocios de Clubify meta 100 MB.
    const { svc, media } = montar();
    await expect(
      svc.subirAdjunto(sesion.duenoClubify, archivo('image/png', 1024)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      svc.subirAdjunto(sesion.afiliadoClubify, archivo('video/mp4', 90 * 1024 * 1024)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(media.upload).not.toHaveBeenCalled();
  });

  it('pero ese mismo negocio sigue creando su propuesta con un enlace, como hasta hoy', async () => {
    // El candado es la SUBIDA, no el adjunto: quitarle también el enlace sería
    // quitarle algo que ya tenía.
    const { svc, prisma } = montar();
    await svc.createProposal(sesion.afiliadoClubify, {
      ...PROPUESTA_NUEVA,
      attachmentUrl: 'https://cdn.test/captura.png',
    });
    expect(prisma.labProposal.create.mock.calls[0][0].data.attachmentUrl).toBe(
      'https://cdn.test/captura.png',
    );
  });

  it('el equipo de la plataforma sí puede: es de casa', async () => {
    const { svc, media } = montar();
    await svc.subirAdjunto(sesion.equipoClubify, archivo('image/png', 1024));
    expect(media.upload).toHaveBeenCalledTimes(1);
  });

  it('una sesión suplantada no sube nada a nombre del administrador de la marca', async () => {
    const { svc, media } = montar();
    await expect(
      svc.subirAdjunto(sesion.javierEnSellea, archivo('image/png', 1024)),
    ).rejects.toThrow(LAB_SUPLANTACION_SOLO_LECTURA);
    expect(media.upload).not.toHaveBeenCalled();
  });

  it('un afiliado de Sellea tampoco: el Lab de su marca no es suyo', async () => {
    const { svc, media } = montar();
    await expect(
      svc.subirAdjunto(sesion.afiliadoSellea, archivo('image/png', 1024)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(media.upload).not.toHaveBeenCalled();
  });

  it('en la propuesta se guarda la URL y el tipo, nunca el archivo', async () => {
    const { svc, prisma } = montar();
    await svc.createProposal(sesion.humberto, {
      ...PROPUESTA_NUEVA,
      attachmentUrl: 'https://cdn.test/lab/abc.mp4',
    });
    const data = prisma.labProposal.create.mock.calls[0][0].data;
    expect(data.attachmentUrl).toBe('https://cdn.test/lab/abc.mp4');
    expect(data.attachmentKind).toBe('video');
  });

  it('un enlace que no es http(s) no se guarda: se pinta como <img> y sería un XSS', async () => {
    const { svc, prisma } = montar();
    await expect(
      svc.createProposal(sesion.humberto, {
        ...PROPUESTA_NUEVA,
        attachmentUrl: 'javascript:alert(1)',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.labProposal.create).not.toHaveBeenCalled();
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

  it('la etiqueta de marca no se filtra a quien no es la plataforma', async () => {
    // El naranja de la moderación se pinta desde `brand`: si viajara en el feed
    // de una marca, su administrador vería cómo lo etiqueta Clubify.
    const { svc } = montar();
    for (const quien of [sesion.humberto, sesion.afiliadoClubify]) {
      const feed = await svc.listPublic(quien, 'CLIENTS');
      expect(feed.items.length).toBeGreaterThan(0);
      for (const p of feed.items) expect('brand' in p).toBe(false);
    }
    expect((await svc.getById('p-sellea', sesion.humberto)).brand).toBeNull();
    expect((await svc.getById('p-clubify', sesion.afiliadoClubify)).brand).toBeNull();
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

describe('lo que aún no pasó revisión', () => {
  // En una marca blanca el Lab es solo de su administrador general, así que
  // esto se prueba en el de Clubify, donde sí participan afiliados y dueños.
  it('un participante NO ve la pendiente de otro', async () => {
    const { svc } = montar({
      extra: [
        {
          id: 'p-clubify-pendiente',
          title: 'Pendiente de otro',
          whiteLabelId: CLUBIFY,
          status: 'PENDING',
          authorId: 'u-afiliado-clubify',
        },
      ],
    });
    const r = await svc.listPublic(sesion.duenoClubify, 'CLIENTS');
    expect(r.items.map((p) => p.id)).not.toContain('p-clubify-pendiente');
  });

  it('pero SÍ ve la suya, para saber que se envió', async () => {
    const { svc } = montar({
      extra: [
        {
          id: 'p-mia',
          title: 'La mía, recién enviada',
          whiteLabelId: CLUBIFY,
          status: 'PENDING',
          authorId: 'u-dueno-clubify',
        },
      ],
    });
    const r = await svc.listPublic(sesion.duenoClubify, 'CLIENTS');
    expect(r.items.map((p) => p.id)).toContain('p-mia');
  });
});

describe('retirar del panel (la plataforma) y borrar (el autor)', () => {
  it('RETIRAR NO BORRA: la fila se queda y guarda quién, cuándo y por qué', async () => {
    const { svc, prisma } = montar();
    await svc.removeProposal('p-sellea', sesion.equipoClubify, '  Duplicada  ');
    expect(prisma.labProposal.delete).not.toHaveBeenCalled();
    const [{ data, where }] = prisma.labProposal.updateMany.mock.calls[0];
    expect(data.removedById).toBe('u-equipo');
    expect(data.removedAt).toBeInstanceOf(Date);
    // Se recorta: un motivo con espacios sueltos se lee mal en la lápida.
    expect(data.removedReason).toBe('Duplicada');
    // La condición viaja DENTRO del where: retirar dos veces desde dos
    // pestañas pisaría la fecha y el autor del primero.
    expect(where.removedAt).toBeNull();
  });

  it('un motivo vacío queda en null, no en cadena vacía', async () => {
    const { svc, prisma } = montar();
    await svc.removeProposal('p-sellea', sesion.equipoClubify, '   ');
    expect(prisma.labProposal.updateMany.mock.calls[0][0].data.removedReason).toBeNull();
  });

  it('retirar dos veces avisa en vez de mentir', async () => {
    const { svc } = montar();
    await svc.removeProposal('p-sellea', sesion.equipoClubify);
    await expect(
      svc.removeProposal('p-sellea', sesion.equipoClubify),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('una retirada se sigue VIENDO, pero no se vota ni se comenta', async () => {
    const { svc } = montar();
    await svc.removeProposal('p-sellea', sesion.equipoClubify);
    // Humberto la ve —queda su lápida con el motivo— y sabe qué pasó.
    const r = await svc.listPublic(sesion.humberto, 'CLIENTS');
    const suya = r.items.find((p: any) => p.id === 'p-sellea');
    expect(suya).toBeTruthy();
    expect((suya as any).removedAt).toBeInstanceOf(Date);
    // Pero es una lápida, no un hilo abierto.
    await expect(svc.vote('p-sellea', sesion.humberto, 'LIKE')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.comment('p-sellea', sesion.humberto, 'Hola')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('una retirada no cambia de estado ni se fusiona', async () => {
    const { svc } = montar();
    await svc.removeProposal('p-sellea', sesion.equipoClubify);
    await expect(
      svc.setStatus('p-sellea', 'APPROVED', sesion.equipoClubify),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.mergeProposals('p-sellea', 'p-sellea-pendiente', sesion.equipoClubify),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('se puede deshacer: restaurar la devuelve al panel', async () => {
    const { svc, prisma } = montar();
    await svc.removeProposal('p-sellea', sesion.equipoClubify, 'Duplicada');
    await svc.restoreProposal('p-sellea', sesion.equipoClubify);
    const [{ data }] = prisma.labProposal.updateMany.mock.calls[1];
    expect(data).toEqual({ removedAt: null, removedById: null, removedReason: null });
    // Y ya vuelve a admitir votos.
    await expect(svc.vote('p-sellea', sesion.humberto, 'LIKE')).resolves.toBeDefined();
  });

  it('restaurar algo que no estaba retirado avisa', async () => {
    const { svc } = montar();
    await expect(
      svc.restoreProposal('p-sellea', sesion.equipoClubify),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('EL AUTOR BORRA LO SUYO DE VERDAD, y se lleva votos y comentarios', async () => {
    const { svc, prisma } = montar();
    await svc.deleteOwnProposal('p-sellea', sesion.humberto);
    expect(prisma.labProposal.delete).toHaveBeenCalledWith({ where: { id: 'p-sellea' } });
    // Y desaparece de su lista: no queda lápida, porque no hay nada que
    // explicarle a quien la borró.
    const r = await svc.listPublic(sesion.humberto, 'CLIENTS');
    expect(r.items.map((p: any) => p.id)).not.toContain('p-sellea');
  });

  it('nadie borra una propuesta AJENA, y recibe 404 y no 403', async () => {
    const { svc, prisma } = montar();
    // De otro autor de su misma marca.
    await expect(
      svc.deleteOwnProposal('p-sellea', { ...sesion.humberto, id: 'u-otro' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    // Y de otra marca: 404 para no confirmar que el id es bueno.
    await expect(
      svc.deleteOwnProposal('p-clubify', sesion.humberto),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.labProposal.delete).not.toHaveBeenCalled();
  });

  it('una sesión SUPLANTADA no borra a nombre del administrador real', async () => {
    const { svc, prisma } = montar();
    await expect(
      svc.deleteOwnProposal('p-sellea', sesion.javierEnSellea),
    ).rejects.toThrow(LAB_SUPLANTACION_SOLO_LECTURA);
    expect(prisma.labProposal.delete).not.toHaveBeenCalled();
  });

  it('las RETIRADAS no cuentan en las métricas', async () => {
    const { svc, prisma } = montar();
    await svc.metrics(sesion.equipoClubify);
    for (const [args] of prisma.labProposal.groupBy.mock.calls) {
      expect(args.where).toEqual({ removedAt: null });
    }
  });

  it('LA PRUEBA SABE PONERSE EN ROJO: sin el filtro, la retirada seguiría viva', async () => {
    // El criterio equivocado sería `update` a secas: sin `removedAt: null` en
    // el where, retirar dos veces pisa la fecha del primero en silencio.
    const { svc, prisma } = montar();
    await svc.removeProposal('p-sellea', sesion.equipoClubify);
    const where = prisma.labProposal.updateMany.mock.calls[0][0].where;
    expect(Object.keys(where).sort()).toEqual(['id', 'removedAt']);
  });
});
