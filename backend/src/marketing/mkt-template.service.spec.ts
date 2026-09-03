import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../common/prisma/prisma.service';
import { MktTemplateService } from './mkt-template.service';

// ── Prisma falso en memoria ─────────────────────────────────────────────────
// Cubre las tres reglas que protegen datos reales:
//   · el veto a `data:image` — la salvaguarda contra el fallo de QrPoster
//     (258 MB de imágenes incrustadas en JSON, el 77% de la base),
//   · el aislamiento por marca — una marca no ve ni toca plantillas ajenas,
//   · las de fábrica (isPreset) — visibles para todas, editables por ninguna.

type TplRow = {
  id: string;
  whiteLabelId: string;
  folderId: string | null;
  name: string;
  subject: string | null;
  blocks: unknown;
  html: string | null;
  thumbnailUrl: string | null;
  isPreset: boolean;
  createdBy: string | null;
};
type FolderRow = { id: string; whiteLabelId: string; name: string; parentId: string | null; position: number };

type Where = Record<string, unknown>;
const matches = (row: Record<string, unknown>, where: Where): boolean =>
  Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Where[]).some((w) => matches(row, w));
    if (v && typeof v === 'object' && 'contains' in (v as object)) {
      const { contains } = v as { contains: string };
      return String(row[k] ?? '').toLowerCase().includes(contains.toLowerCase());
    }
    return row[k] === v;
  });

function fakePrisma(state: { tpls: TplRow[]; folders: FolderRow[] }) {
  let seq = 0;
  return {
    mktEmailTemplate: {
      findFirst: async ({ where }: { where: Where }) => state.tpls.find((t) => matches(t, where)) ?? null,
      findMany: async ({ where }: { where: Where }) => state.tpls.filter((t) => matches(t, where)),
      create: async ({ data }: { data: Omit<TplRow, 'id'> }) => {
        const row = { id: `t${++seq}`, ...data };
        state.tpls.push(row);
        return row;
      },
      update: async ({ where, data }: { where: Where; data: Partial<TplRow> }) => {
        const row = state.tpls.find((t) => matches(t, where));
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      },
      delete: async ({ where }: { where: Where }) => {
        const i = state.tpls.findIndex((t) => matches(t, where));
        if (i < 0) throw new Error('not found');
        return state.tpls.splice(i, 1)[0];
      },
    },
    mktEmailTemplateFolder: {
      findFirst: async ({ where }: { where: Where }) => state.folders.find((f) => matches(f, where)) ?? null,
      findMany: async ({ where }: { where: Where }) => state.folders.filter((f) => matches(f, where)),
    },
  } as unknown as PrismaService;
}

const WL = 'wl_sellea';
const OTRA = 'wl_otra';

const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('MktTemplateService — veto a imágenes incrustadas (data:image)', () => {
  let state: { tpls: TplRow[]; folders: FolderRow[] };
  let svc: MktTemplateService;

  beforeEach(() => {
    state = { tpls: [], folders: [] };
    svc = new MktTemplateService(fakePrisma(state));
  });

  it('rechaza crear con data:image dentro de blocks (aunque esté anidado)', async () => {
    const blocks = [{ type: 'image', props: { nested: { src: PIXEL } } }];
    await expect(svc.create(WL, { name: 'Mala', blocks })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create(WL, { name: 'Mala', blocks })).rejects.toThrow(/media\/upload/);
    expect(state.tpls).toHaveLength(0);
  });

  it('rechaza crear con data:image en el html', async () => {
    await expect(
      svc.create(WL, { name: 'Mala', html: `<img src="${PIXEL}">` }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(state.tpls).toHaveLength(0);
  });

  it('rechaza data:image en la miniatura (update)', async () => {
    const t = await svc.create(WL, { name: 'Buena' });
    await expect(svc.update(WL, t.id, { thumbnailUrl: PIXEL })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rechaza el update que intenta meter data:image en una plantilla sana', async () => {
    const t = await svc.create(WL, { name: 'Buena', html: '<p>hola</p>' });
    await expect(svc.update(WL, t.id, { html: `<img src="${PIXEL}">` })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(state.tpls[0].html).toBe('<p>hola</p>');
  });

  it('caza el data:image también en el documento del editor ({ version, settings, rows })', async () => {
    // El editor no guarda un array: guarda un doc con filas y columnas. El
    // veto tiene que encontrar la imagen incrustada a cualquier profundidad.
    const doc = {
      version: 1,
      settings: { backgroundColor: '#fff' },
      rows: [{ columns: [{ widthPct: 100, blocks: [{ type: 'image', props: { url: PIXEL } }] }] }],
    };
    await expect(svc.create(WL, { name: 'Mala', blocks: doc })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(state.tpls).toHaveLength(0);
  });

  it('acepta el documento del editor cuando las imágenes van por URL', async () => {
    const doc = {
      version: 1,
      settings: { backgroundColor: '#fff' },
      rows: [
        {
          columns: [
            { widthPct: 100, blocks: [{ type: 'image', props: { url: 'https://cdn.ejemplo.com/foto.jpg' } }] },
          ],
        },
      ],
    };
    const t = await svc.create(WL, { name: 'Buena', blocks: doc });
    expect(t.id).toBeTruthy();
  });

  it('acepta imágenes por URL normal (https)', async () => {
    const t = await svc.create(WL, {
      name: 'Buena',
      blocks: [{ type: 'image', props: { src: 'https://cdn.ejemplo.com/logo.png' } }],
      html: '<img src="https://cdn.ejemplo.com/logo.png">',
    });
    expect(t.id).toBeTruthy();
    expect(state.tpls).toHaveLength(1);
  });

  it('rechaza contenido desmesurado aunque no sea data:image', async () => {
    await expect(
      svc.create(WL, { name: 'Gorda', html: 'x'.repeat(500_001) }),
    ).rejects.toThrow(/demasiado grande/);
  });
});

describe('MktTemplateService — aislamiento por marca', () => {
  let state: { tpls: TplRow[]; folders: FolderRow[] };
  let svc: MktTemplateService;

  beforeEach(() => {
    state = {
      tpls: [
        {
          id: 'ajena',
          whiteLabelId: OTRA,
          folderId: null,
          name: 'De otra marca',
          subject: null,
          blocks: [],
          html: '<p>x</p>',
          thumbnailUrl: null,
          isPreset: false,
          createdBy: null,
        },
      ],
      folders: [{ id: 'cf', whiteLabelId: OTRA, name: 'Carpeta ajena', parentId: null, position: 0 }],
    };
    svc = new MktTemplateService(fakePrisma(state));
  });

  it('no deja leer, editar ni borrar una plantilla de otra marca', async () => {
    await expect(svc.getOne(WL, 'ajena')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.update(WL, 'ajena', { name: 'Pirateada' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(svc.remove(WL, 'ajena')).rejects.toBeInstanceOf(NotFoundException);
    expect(state.tpls).toHaveLength(1);
  });

  it('no deja colgar una plantilla de una carpeta de otra marca', async () => {
    await expect(svc.create(WL, { name: 'Nueva', folderId: 'cf' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('el listado solo trae lo propio (más las de fábrica)', async () => {
    state.tpls.push({
      id: 'mia',
      whiteLabelId: WL,
      folderId: null,
      name: 'Mía',
      subject: null,
      blocks: [],
      html: null,
      thumbnailUrl: null,
      isPreset: false,
      createdBy: null,
    });
    const { templates } = await svc.list(WL, {});
    expect(templates.map((t: { id: string }) => t.id)).toEqual(['mia']);
  });
});

describe('MktTemplateService — plantillas de fábrica (isPreset)', () => {
  let state: { tpls: TplRow[]; folders: FolderRow[] };
  let svc: MktTemplateService;

  beforeEach(() => {
    state = {
      tpls: [
        {
          id: 'preset',
          whiteLabelId: 'wl_clubify',
          folderId: null,
          name: 'Bienvenida',
          subject: 'Te damos la bienvenida',
          blocks: [{ type: 'text' }],
          html: '<p>Hola</p>',
          thumbnailUrl: null,
          isPreset: true,
          createdBy: null,
        },
      ],
      folders: [],
    };
    svc = new MktTemplateService(fakePrisma(state));
  });

  it('cualquier marca la ve y la lee', async () => {
    const { templates } = await svc.list(WL, {});
    expect(templates.map((t: { id: string }) => t.id)).toContain('preset');
    const t = await svc.getOne(WL, 'preset');
    expect(t.name).toBe('Bienvenida');
  });

  it('no se puede editar: el error dice que hay que duplicarla', async () => {
    await expect(svc.update(WL, 'preset', { name: 'Otra' })).rejects.toThrow(/[Dd]upl/);
    expect(state.tpls[0].name).toBe('Bienvenida');
  });

  it('no se puede borrar', async () => {
    await expect(svc.remove(WL, 'preset')).rejects.toBeInstanceOf(BadRequestException);
    expect(state.tpls).toHaveLength(1);
  });

  it('duplicarla crea una copia PROPIA de la marca, editable', async () => {
    const copy = await svc.duplicate(WL, 'preset', 'user1');
    expect(copy.whiteLabelId).toBe(WL);
    expect(copy.isPreset).toBe(false);
    expect(copy.name).toBe('Bienvenida (copia)');
    expect(copy.html).toBe('<p>Hola</p>');
    await svc.update(WL, copy.id, { name: 'Mi bienvenida' });
    expect(state.tpls.find((t) => t.id === copy.id)!.name).toBe('Mi bienvenida');
  });
});
