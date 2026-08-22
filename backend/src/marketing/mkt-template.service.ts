import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

// ── Plantillas de correo (editor visual por bloques) ────────────────────────
// CRUD brand-scoped. Las plantillas de fábrica (`isPreset`) se listan para
// TODAS las marcas pero son de solo lectura: usarlas pasa por duplicarlas en
// la marca. Así una marca nunca puede romperle la plantilla de fábrica a las
// demás, y el seed puede actualizarlas sin pisar trabajo de nadie.

/**
 * Detecta imágenes incrustadas (`data:image...;base64,...`) en cualquier campo.
 * Existe por un fallo concreto que NO vamos a repetir: el editor de carteles QR
 * incrusta las imágenes como data:image dentro de su JSON y por eso `QrPoster`
 * llegó a pesar 258 MB de una base de 337 (el 77%) con solo 293 filas. Aquí las
 * imágenes van a S3 (`POST /api/media/upload`) y en la base solo entra su URL.
 */
const DATA_IMAGE_RE = /data:\s*image/i;

/**
 * Tope de tamaño por campo de contenido (caracteres ya serializados). Una
 * plantilla legítima de texto+URLs no se acerca; algo que lo supere trae
 * binarios disfrazados u otro desastre, y es mejor rechazarlo que guardarlo.
 */
const MAX_CONTENT_CHARS = 500_000;

const EMBEDDED_IMAGE_MSG =
  'La plantilla contiene imágenes incrustadas (data:image) y no se puede guardar así. ' +
  'Sube cada imagen con POST /api/media/upload y usa la URL que devuelve.';

/** Campos que devuelve el listado — sin `blocks` ni `html`, que pueden pesar. */
const LIST_SELECT = {
  id: true,
  whiteLabelId: true,
  folderId: true,
  name: true,
  subject: true,
  thumbnailUrl: true,
  isPreset: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type TemplateInput = {
  name?: string;
  subject?: string | null;
  folderId?: string | null;
  /** Documento del editor ({ version, settings, rows }); guardados viejos traen []. */
  blocks?: unknown;
  html?: string | null;
  thumbnailUrl?: string | null;
};

@Injectable()
export class MktTemplateService {
  constructor(private prisma: PrismaService) {}

  /**
   * LA validación que protege la base: rechaza el guardado si bloques, HTML o
   * miniatura traen una imagen incrustada, o si el contenido pesa de más.
   * Se aplica en create y update — no hay camino de escritura que la esquive.
   */
  assertStorableContent(input: Pick<TemplateInput, 'blocks' | 'html' | 'thumbnailUrl'>) {
    const serializedBlocks = input.blocks !== undefined ? JSON.stringify(input.blocks) : '';
    for (const field of [serializedBlocks, input.html ?? '', input.thumbnailUrl ?? '']) {
      if (DATA_IMAGE_RE.test(field)) throw new BadRequestException(EMBEDDED_IMAGE_MSG);
    }
    if (serializedBlocks.length > MAX_CONTENT_CHARS || (input.html ?? '').length > MAX_CONTENT_CHARS) {
      throw new BadRequestException(
        'La plantilla es demasiado grande para guardarse. Revisa que no tenga contenido binario embebido; las imágenes van por URL.',
      );
    }
  }

  /** Carpeta de la marca o 404 — un folderId ajeno no cuelga nada aquí. */
  private async ownFolder(whiteLabelId: string, folderId: string) {
    const f = await this.prisma.mktEmailTemplateFolder.findFirst({
      where: { id: folderId, whiteLabelId },
    });
    if (!f) throw new NotFoundException('Carpeta no encontrada');
    return f;
  }

  /** Plantilla visible para la marca: propia o de fábrica. */
  private async visible(whiteLabelId: string, id: string) {
    const t = await this.prisma.mktEmailTemplate.findFirst({
      where: { id, OR: [{ whiteLabelId }, { isPreset: true }] },
    });
    if (!t) throw new NotFoundException('Plantilla no encontrada');
    return t;
  }

  /**
   * Listado para la galería: todas las carpetas de la marca (el árbol se arma
   * en el frontend con `parentId`) + plantillas. Sin `folderId` van todas las
   * de la marca más las de fábrica; con `folderId` solo las de esa carpeta
   * (las de fábrica viven fuera de las carpetas de la marca). `q` busca por
   * nombre. El listado NO trae `blocks` ni `html`: eso lo da GET :id.
   */
  async list(whiteLabelId: string, opts: { folderId?: string; q?: string }) {
    const folderId = (opts.folderId ?? '').trim();
    const q = (opts.q ?? '').trim();
    const nameFilter = q ? { name: { contains: q, mode: 'insensitive' as const } } : {};
    const where = folderId
      ? { whiteLabelId, folderId, ...nameFilter }
      : { OR: [{ whiteLabelId }, { isPreset: true }], ...nameFilter };
    const [folders, templates] = await Promise.all([
      this.prisma.mktEmailTemplateFolder.findMany({
        where: { whiteLabelId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.mktEmailTemplate.findMany({
        where,
        select: LIST_SELECT,
        // De fábrica primero (son el escaparate), luego lo propio más reciente.
        orderBy: [{ isPreset: 'desc' }, { updatedAt: 'desc' }],
      }),
    ]);
    return { folders, templates };
  }

  async getOne(whiteLabelId: string, id: string) {
    return this.visible(whiteLabelId, id);
  }

  async create(whiteLabelId: string, input: TemplateInput, createdBy?: string) {
    const name = (input.name ?? '').trim();
    if (!name) throw new BadRequestException('La plantilla necesita un nombre.');
    this.assertStorableContent(input);
    const folderId = (input.folderId ?? '').trim() || null;
    if (folderId) await this.ownFolder(whiteLabelId, folderId);
    return this.prisma.mktEmailTemplate.create({
      data: {
        whiteLabelId,
        folderId,
        name,
        subject: input.subject?.trim() || null,
        blocks: (input.blocks ?? []) as Prisma.InputJsonValue,
        html: input.html ?? null,
        thumbnailUrl: input.thumbnailUrl?.trim() || null,
        // Las de fábrica solo nacen del seed: por la API siempre isPreset=false.
        isPreset: false,
        createdBy: createdBy ?? null,
      },
    });
  }

  async update(whiteLabelId: string, id: string, input: TemplateInput) {
    const t = await this.visible(whiteLabelId, id);
    if (t.isPreset) {
      throw new BadRequestException(
        'Las plantillas de fábrica no se pueden editar. Duplícala para crear una copia tuya y edita esa.',
      );
    }
    // `visible` también devuelve presets ajenos; lo propio se re-verifica aquí.
    if (t.whiteLabelId !== whiteLabelId) throw new NotFoundException('Plantilla no encontrada');
    this.assertStorableContent(input);
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('La plantilla necesita un nombre.');
      data.name = name;
    }
    if (input.subject !== undefined) data.subject = input.subject?.trim() || null;
    if (input.folderId !== undefined) {
      const folderId = (input.folderId ?? '').trim() || null;
      if (folderId) await this.ownFolder(whiteLabelId, folderId);
      data.folderId = folderId;
    }
    if (input.blocks !== undefined) data.blocks = input.blocks as Prisma.InputJsonValue;
    if (input.html !== undefined) data.html = input.html;
    if (input.thumbnailUrl !== undefined) data.thumbnailUrl = input.thumbnailUrl?.trim() || null;
    return this.prisma.mktEmailTemplate.update({ where: { id }, data });
  }

  /**
   * Duplica una plantilla EN la marca del que llama. Es el único camino para
   * "editar" una de fábrica: la copia nace propia (isPreset=false) y editable.
   * Una de fábrica cae a la raíz (su folderId no es de esta marca).
   */
  async duplicate(whiteLabelId: string, id: string, createdBy?: string) {
    const t = await this.visible(whiteLabelId, id);
    const keepFolder = !t.isPreset && t.whiteLabelId === whiteLabelId ? t.folderId : null;
    return this.prisma.mktEmailTemplate.create({
      data: {
        whiteLabelId,
        folderId: keepFolder,
        name: `${t.name} (copia)`,
        subject: t.subject,
        blocks: t.blocks as Prisma.InputJsonValue,
        html: t.html,
        thumbnailUrl: t.thumbnailUrl,
        isPreset: false,
        createdBy: createdBy ?? null,
      },
    });
  }

  async remove(whiteLabelId: string, id: string) {
    const t = await this.visible(whiteLabelId, id);
    if (t.isPreset) {
      throw new BadRequestException(
        'Las plantillas de fábrica no se pueden borrar: están disponibles para todas las marcas. Si no la quieres ver, simplemente no la uses.',
      );
    }
    if (t.whiteLabelId !== whiteLabelId) throw new NotFoundException('Plantilla no encontrada');
    await this.prisma.mktEmailTemplate.delete({ where: { id } });
    return { ok: true };
  }
}
