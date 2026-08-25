import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { BrandWorkflowFoldersService } from './brand-workflow-folders.service';

// ── Prisma falso en memoria ─────────────────────────────────────────────────
// Estos tests cubren las dos operaciones donde un bug deja datos
// irrecuperables desde la UI:
//   · mover una carpeta creando un ciclo → el subárbol entero desaparece de la
//     vista (nada cuelga de la raíz), y
//   · borrar una carpeta con contenido → workflows/subcarpetas colgando de un
//     id inexistente = invisibles para siempre.
// No necesitan base de datos: replicamos solo las llamadas que hace el servicio.

type FolderRow = { id: string; whiteLabelId: string; name: string; parentId: string | null; position: number };
type WfRow = { id: string; whiteLabelId: string; name: string; folderId: string | null };
type EnrollRow = { id: string; workflowId: string };

type Where = Record<string, unknown>;
const matches = (row: Record<string, unknown>, where: Where) =>
  Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && 'in' in (v as object)) return ((v as { in: unknown[] }).in ?? []).includes(row[k]);
    return row[k] === v;
  });

function fakePrisma(state: { folders: FolderRow[]; wfs: WfRow[]; enrolls: EnrollRow[] }) {
  return {
    brandWorkflowFolder: {
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
    brandWorkflow: {
      findMany: async ({ where }: { where: Where }) => state.wfs.filter((w) => matches(w, where)),
      updateMany: async ({ where, data }: { where: Where; data: Partial<WfRow> }) => {
        const rows = state.wfs.filter((w) => matches(w, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
      deleteMany: async ({ where }: { where: Where }) => {
        const doomed = state.wfs.filter((w) => matches(w, where));
        state.wfs = state.wfs.filter((w) => !doomed.includes(w));
        return { count: doomed.length };
      },
    },
    brandWorkflowEnrollment: {
      deleteMany: async ({ where }: { where: Where }) => {
        const doomed = state.enrolls.filter((e) => matches(e, where));
        state.enrolls = state.enrolls.filter((e) => !doomed.includes(e));
        return { count: doomed.length };
      },
    },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  } as unknown as PrismaService;
}

const WL = 'wl_sellea';
const OTRA = 'wl_otra';

describe('BrandWorkflowFoldersService — mover carpeta (ciclos)', () => {
  let state: { folders: FolderRow[]; wfs: WfRow[]; enrolls: EnrollRow[] };
  let svc: BrandWorkflowFoldersService;

  beforeEach(() => {
    // Árbol: A > B > C, y D suelta en la raíz.
    state = {
      folders: [
        { id: 'A', whiteLabelId: WL, name: 'A', parentId: null, position: 0 },
        { id: 'B', whiteLabelId: WL, name: 'B', parentId: 'A', position: 1 },
        { id: 'C', whiteLabelId: WL, name: 'C', parentId: 'B', position: 2 },
        { id: 'D', whiteLabelId: WL, name: 'D', parentId: null, position: 3 },
        { id: 'X', whiteLabelId: OTRA, name: 'X (otra marca)', parentId: null, position: 0 },
      ],
      wfs: [],
      enrolls: [],
    };
    svc = new BrandWorkflowFoldersService(fakePrisma(state));
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

  it('mover B dentro de C (su propia hija) también se rechaza', async () => {
    await expect(svc.move(WL, 'B', 'C')).rejects.toBeInstanceOf(BadRequestException);
    expect(state.folders.find((f) => f.id === 'B')!.parentId).toBe('A');
  });

  it('rechaza mover hacia una carpeta de OTRA marca (aislamiento)', async () => {
    await expect(svc.move(WL, 'D', 'X')).rejects.toBeInstanceOf(NotFoundException);
    expect(state.folders.find((f) => f.id === 'D')!.parentId).toBeNull();
  });

  it('rechaza mover una carpeta de OTRA marca aunque el destino sea válido', async () => {
    await expect(svc.move(WL, 'X', 'A')).rejects.toBeInstanceOf(NotFoundException);
    expect(state.folders.find((f) => f.id === 'X')!.parentId).toBeNull();
  });

  it('no se cuelga si los datos ya traen un ciclo corrupto en la cadena de padres', async () => {
    // E ↔ F ya están en ciclo (dato corrupto). Mover D dentro de E debe
    // TERMINAR (no bucle infinito) y no puede ser un ciclo nuevo con D.
    state.folders.push(
      { id: 'E', whiteLabelId: WL, name: 'E', parentId: 'F', position: 4 },
      { id: 'F', whiteLabelId: WL, name: 'F', parentId: 'E', position: 5 },
    );
    await svc.move(WL, 'D', 'E');
    expect(state.folders.find((f) => f.id === 'D')!.parentId).toBe('E');
  });
});

describe('BrandWorkflowFoldersService — borrar carpeta con contenido', () => {
  let state: { folders: FolderRow[]; wfs: WfRow[]; enrolls: EnrollRow[] };
  let svc: BrandWorkflowFoldersService;

  beforeEach(() => {
    // A (raíz) > B > C; workflows en B y en C.
    state = {
      folders: [
        { id: 'A', whiteLabelId: WL, name: 'A', parentId: null, position: 0 },
        { id: 'B', whiteLabelId: WL, name: 'B', parentId: 'A', position: 1 },
        { id: 'C', whiteLabelId: WL, name: 'C', parentId: 'B', position: 2 },
      ],
      wfs: [
        { id: 'w1', whiteLabelId: WL, name: 'En B', folderId: 'B' },
        { id: 'w2', whiteLabelId: WL, name: 'En C', folderId: 'C' },
        { id: 'w3', whiteLabelId: WL, name: 'En raíz', folderId: null },
      ],
      enrolls: [],
    };
    svc = new BrandWorkflowFoldersService(fakePrisma(state));
  });

  it('el contenido sube al PADRE de la carpeta borrada — nada se borra ni se pierde', async () => {
    const r = await svc.remove(WL, 'B');
    expect(r).toEqual({ ok: true, movedWorkflows: 1, movedFolders: 1 });
    // La carpeta B ya no existe; C subió a A; el workflow de B subió a A.
    expect(state.folders.some((f) => f.id === 'B')).toBe(false);
    expect(state.folders.find((f) => f.id === 'C')!.parentId).toBe('A');
    expect(state.wfs.find((w) => w.id === 'w1')!.folderId).toBe('A');
    // El workflow que estaba en C no se toca (C sigue existiendo).
    expect(state.wfs.find((w) => w.id === 'w2')!.folderId).toBe('C');
    expect(state.wfs).toHaveLength(3);
  });

  it('borrar una carpeta de la RAÍZ sube su contenido a la raíz (null)', async () => {
    const r = await svc.remove(WL, 'A');
    expect(r.ok).toBe(true);
    expect(state.folders.find((f) => f.id === 'B')!.parentId).toBeNull();
    expect(state.wfs).toHaveLength(3);
  });

  it('nunca queda contenido apuntando a la carpeta borrada (huérfanos invisibles)', async () => {
    await svc.remove(WL, 'B');
    expect(state.folders.some((f) => f.parentId === 'B')).toBe(false);
    expect(state.wfs.some((w) => w.folderId === 'B')).toBe(false);
  });

  it('rechaza borrar una carpeta de otra marca', async () => {
    state.folders.push({ id: 'X', whiteLabelId: OTRA, name: 'X', parentId: null, position: 0 });
    await expect(svc.remove(WL, 'X')).rejects.toBeInstanceOf(NotFoundException);
    expect(state.folders.some((f) => f.id === 'X')).toBe(true);
  });
});

describe('BrandWorkflowFoldersService — crear con padre y acciones en lote', () => {
  let state: { folders: FolderRow[]; wfs: WfRow[]; enrolls: EnrollRow[] };
  let svc: BrandWorkflowFoldersService;

  beforeEach(() => {
    state = {
      folders: [
        { id: 'A', whiteLabelId: WL, name: 'A', parentId: null, position: 0 },
        { id: 'X', whiteLabelId: OTRA, name: 'X', parentId: null, position: 0 },
      ],
      wfs: [
        { id: 'w1', whiteLabelId: WL, name: 'Uno', folderId: null },
        { id: 'w2', whiteLabelId: WL, name: 'Dos', folderId: null },
        { id: 'ajeno', whiteLabelId: OTRA, name: 'De otra marca', folderId: null },
      ],
      enrolls: [
        { id: 'e1', workflowId: 'w1' },
        { id: 'e2', workflowId: 'ajeno' },
      ],
    };
    svc = new BrandWorkflowFoldersService(fakePrisma(state));
  });

  it('crea una carpeta DENTRO de otra', async () => {
    const f = await svc.create(WL, 'Hija', 'A');
    expect(f.parentId).toBe('A');
    expect(f.whiteLabelId).toBe(WL);
  });

  it('rechaza crear bajo una carpeta de otra marca', async () => {
    await expect(svc.create(WL, 'Hija', 'X')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('mueve varios workflows de una vez y NO toca los de otra marca', async () => {
    const r = await svc.bulkMoveWorkflows(WL, ['w1', 'w2', 'ajeno'], 'A');
    expect(r.count).toBe(2);
    expect(state.wfs.find((w) => w.id === 'w1')!.folderId).toBe('A');
    expect(state.wfs.find((w) => w.id === 'w2')!.folderId).toBe('A');
    expect(state.wfs.find((w) => w.id === 'ajeno')!.folderId).toBeNull();
  });

  it('rechaza mover en lote hacia una carpeta de otra marca', async () => {
    await expect(svc.bulkMoveWorkflows(WL, ['w1'], 'X')).rejects.toBeInstanceOf(NotFoundException);
    expect(state.wfs.find((w) => w.id === 'w1')!.folderId).toBeNull();
  });

  it('borra en lote solo los workflows propios, con sus inscripciones', async () => {
    const r = await svc.bulkDeleteWorkflows(WL, ['w1', 'ajeno']);
    expect(r.count).toBe(1);
    expect(state.wfs.some((w) => w.id === 'w1')).toBe(false);
    expect(state.wfs.some((w) => w.id === 'ajeno')).toBe(true);
    // La inscripción del propio se fue; la del ajeno queda intacta.
    expect(state.enrolls.some((e) => e.workflowId === 'w1')).toBe(false);
    expect(state.enrolls.some((e) => e.workflowId === 'ajeno')).toBe(true);
  });
});
