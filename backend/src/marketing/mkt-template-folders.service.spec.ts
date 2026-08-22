import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../common/prisma/prisma.service';
import { MktTemplateFoldersService } from './mkt-template-folders.service';

// ── Prisma falso en memoria ─────────────────────────────────────────────────
// Mismas invariantes que en brand-workflow-folders: los dos bugs que dejan
// datos irrecuperables desde la UI son
//   · mover una carpeta creando un ciclo → el subárbol entero se desconecta de
//     la raíz y desaparece de la vista, y
//   · borrar una carpeta con contenido → plantillas/subcarpetas colgando de un
//     id inexistente = invisibles para siempre.

type FolderRow = { id: string; whiteLabelId: string; name: string; parentId: string | null; position: number };
type TplRow = { id: string; whiteLabelId: string; name: string; folderId: string | null };

type Where = Record<string, unknown>;
const matches = (row: Record<string, unknown>, where: Where) =>
  Object.entries(where).every(([k, v]) => row[k] === v);

function fakePrisma(state: { folders: FolderRow[]; tpls: TplRow[] }) {
  return {
    mktEmailTemplateFolder: {
      findFirst: async ({ where }: { where: Where }) => state.folders.find((f) => matches(f, where)) ?? null,
      findMany: async ({ where }: { where: Where }) => state.folders.filter((f) => matches(f, where)),
      count: async ({ where }: { where: Where }) => state.folders.filter((f) => matches(f, where)).length,
      create: async ({ data }: { data: Omit<FolderRow, 'id'> }) => {
        const row = { id: `f${state.folders.length + 1}`, ...data };
        state.folders.push(row);
        return row;
      },
      update: async ({ where, data }: { where: Where; data: Partial<FolderRow> }) => {
        const row = state.folders.find((f) => matches(f, where));
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: { where: Where; data: Partial<FolderRow> }) => {
        const rows = state.folders.filter((f) => matches(f, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
      delete: async ({ where }: { where: Where }) => {
        const i = state.folders.findIndex((f) => matches(f, where));
        if (i < 0) throw new Error('not found');
        return state.folders.splice(i, 1)[0];
      },
    },
    mktEmailTemplate: {
      updateMany: async ({ where, data }: { where: Where; data: Partial<TplRow> }) => {
        const rows = state.tpls.filter((t) => matches(t, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  } as unknown as PrismaService;
}

const WL = 'wl_sellea';
const OTRA = 'wl_otra';

describe('MktTemplateFoldersService — mover carpeta (ciclos)', () => {
  let state: { folders: FolderRow[]; tpls: TplRow[] };
  let svc: MktTemplateFoldersService;

  beforeEach(() => {
    // Árbol: A > B > C, y D suelta en la raíz. X es de otra marca.
    state = {
      folders: [
        { id: 'A', whiteLabelId: WL, name: 'A', parentId: null, position: 0 },
        { id: 'B', whiteLabelId: WL, name: 'B', parentId: 'A', position: 1 },
        { id: 'C', whiteLabelId: WL, name: 'C', parentId: 'B', position: 2 },
        { id: 'D', whiteLabelId: WL, name: 'D', parentId: null, position: 3 },
        { id: 'X', whiteLabelId: OTRA, name: 'X (otra marca)', parentId: null, position: 0 },
      ],
      tpls: [],
    };
    svc = new MktTemplateFoldersService(fakePrisma(state));
  });

  it('rechaza mover una carpeta dentro de sí misma', async () => {
    await expect(svc.move(WL, 'A', 'A')).rejects.toBeInstanceOf(BadRequestException);
    expect(state.folders.find((f) => f.id === 'A')!.parentId).toBeNull();
  });

  it('rechaza mover una carpeta dentro de su hija directa', async () => {
    await expect(svc.move(WL, 'A', 'B')).rejects.toBeInstanceOf(BadRequestException);
    expect(state.folders.find((f) => f.id === 'A')!.parentId).toBeNull();
  });

  it('rechaza mover una carpeta dentro de una descendiente profunda (nieta)', async () => {
    await expect(svc.move(WL, 'A', 'C')).rejects.toThrow(/subcarpetas/);
    expect(state.folders.find((f) => f.id === 'A')!.parentId).toBeNull();
  });

  it('permite mover a una rama no relacionada y a la raíz', async () => {
    await svc.move(WL, 'C', 'D');
    expect(state.folders.find((f) => f.id === 'C')!.parentId).toBe('D');
    await svc.move(WL, 'C', null);
    expect(state.folders.find((f) => f.id === 'C')!.parentId).toBeNull();
  });

  it('no acepta como destino una carpeta de otra marca', async () => {
    await expect(svc.move(WL, 'A', 'X')).rejects.toBeInstanceOf(NotFoundException);
    expect(state.folders.find((f) => f.id === 'A')!.parentId).toBeNull();
  });

  it('no deja crear una carpeta bajo un padre de otra marca', async () => {
    await expect(svc.create(WL, 'Nueva', 'X')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('MktTemplateFoldersService — borrar carpeta sube el contenido', () => {
  let state: { folders: FolderRow[]; tpls: TplRow[] };
  let svc: MktTemplateFoldersService;

  beforeEach(() => {
    // A > B, con la plantilla t1 en B y la subcarpeta C dentro de B.
    state = {
      folders: [
        { id: 'A', whiteLabelId: WL, name: 'A', parentId: null, position: 0 },
        { id: 'B', whiteLabelId: WL, name: 'B', parentId: 'A', position: 1 },
        { id: 'C', whiteLabelId: WL, name: 'C', parentId: 'B', position: 2 },
      ],
      tpls: [{ id: 't1', whiteLabelId: WL, name: 'Promo', folderId: 'B' }],
    };
    svc = new MktTemplateFoldersService(fakePrisma(state));
  });

  it('al borrar B, la plantilla y la subcarpeta suben a A (nada se pierde)', async () => {
    const res = await svc.remove(WL, 'B');
    expect(res).toMatchObject({ ok: true, movedTemplates: 1, movedFolders: 1 });
    expect(state.folders.find((f) => f.id === 'B')).toBeUndefined();
    expect(state.tpls[0].folderId).toBe('A');
    expect(state.folders.find((f) => f.id === 'C')!.parentId).toBe('A');
  });

  it('al borrar una carpeta raíz, su contenido queda en la raíz', async () => {
    await svc.remove(WL, 'B'); // t1 y C quedan en A
    const res = await svc.remove(WL, 'A');
    expect(res.ok).toBe(true);
    expect(state.tpls[0].folderId).toBeNull();
    expect(state.folders.find((f) => f.id === 'C')!.parentId).toBeNull();
  });

  it('no deja borrar carpetas de otra marca', async () => {
    state.folders.push({ id: 'X', whiteLabelId: OTRA, name: 'X', parentId: null, position: 0 });
    await expect(svc.remove(WL, 'X')).rejects.toBeInstanceOf(NotFoundException);
    expect(state.folders.find((f) => f.id === 'X')).toBeDefined();
  });
});
