import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

// ── Carpetas de workflows de marca (árbol anidado) ──────────────────────────
// El árbol se arma en código a partir de `parentId` (sin @relation en el
// schema, a propósito: una FK con cascada borraría subárboles enteros en
// silencio al eliminar una carpeta padre). Este servicio es el ÚNICO punto que
// muta el árbol, y por eso concentra las dos invariantes que evitan pérdida de
// datos:
//   1. NUNCA se crea un ciclo (una carpeta dentro de sí misma o de una
//      descendiente): el subárbol entero desaparecería de la vista sin forma
//      de recuperarlo desde la UI.
//   2. Borrar una carpeta NUNCA borra su contenido: workflows y subcarpetas
//      SUBEN AL PADRE de la carpeta borrada (a la raíz si estaba en la raíz).
// Todo va aislado por whiteLabelId: cada consulta filtra por marca, así una
// carpeta jamás puede recibir contenido de otra marca ni colgar de ella.
@Injectable()
export class BrandWorkflowFoldersService {
  constructor(private prisma: PrismaService) {}

  private async ownFolder(whiteLabelId: string, folderId: string) {
    const f = await this.prisma.brandWorkflowFolder.findFirst({ where: { id: folderId, whiteLabelId } });
    if (!f) throw new NotFoundException('Carpeta no encontrada');
    return f;
  }

  async create(whiteLabelId: string, name: string, parentId?: string | null) {
    const parent = (parentId ?? '').trim() || null;
    // El padre tiene que ser una carpeta DE ESTA MARCA — si viene un id de otra
    // marca (o inexistente) se rechaza en vez de crear una carpeta huérfana.
    if (parent) await this.ownFolder(whiteLabelId, parent);
    const position = await this.prisma.brandWorkflowFolder.count({ where: { whiteLabelId } });
    return this.prisma.brandWorkflowFolder.create({
      data: { whiteLabelId, name: name.trim() || 'Carpeta', parentId: parent, position },
    });
  }

  async rename(whiteLabelId: string, folderId: string, name: string) {
    await this.ownFolder(whiteLabelId, folderId);
    await this.prisma.brandWorkflowFolder.update({
      where: { id: folderId },
      data: { name: name.trim() || 'Carpeta' },
    });
    return { ok: true };
  }

  // Mueve una carpeta DENTRO de otra (o a la raíz con null). Rechaza los
  // ciclos: subimos por la cadena de padres del destino y si aparece la
  // carpeta que estamos moviendo, el movimiento la colgaría de su propio
  // subárbol → todo ese subárbol quedaría desconectado de la raíz e invisible.
  async move(whiteLabelId: string, folderId: string, parentId: string | null) {
    await this.ownFolder(whiteLabelId, folderId);
    const target = (parentId ?? '').trim() || null;
    if (target === folderId) {
      throw new BadRequestException('Una carpeta no puede contenerse a sí misma.');
    }
    if (target) {
      await this.ownFolder(whiteLabelId, target);
      const all = await this.prisma.brandWorkflowFolder.findMany({
        where: { whiteLabelId },
        select: { id: true, parentId: true },
      });
      const parentOf = new Map(all.map((f) => [f.id, f.parentId]));
      // `seen` corta la subida si los datos ya traen un ciclo viejo: preferimos
      // permitir el movimiento a colgar el request en un bucle infinito.
      const seen = new Set<string>();
      let cur: string | null = target;
      while (cur && !seen.has(cur)) {
        if (cur === folderId) {
          throw new BadRequestException(
            'No puedes mover una carpeta dentro de una de sus propias subcarpetas.',
          );
        }
        seen.add(cur);
        cur = parentOf.get(cur) ?? null;
      }
    }
    await this.prisma.brandWorkflowFolder.update({ where: { id: folderId }, data: { parentId: target } });
    return { ok: true };
  }

  // Borra la carpeta pero NUNCA su contenido: workflows y subcarpetas suben al
  // padre de la carpeta borrada (raíz si estaba en la raíz). En transacción:
  // si algo falla a mitad, no queda contenido colgando de una carpeta que ya
  // no existe (= invisible en la UI).
  async remove(whiteLabelId: string, folderId: string) {
    const folder = await this.ownFolder(whiteLabelId, folderId);
    const newParent = folder.parentId ?? null;
    const [wfs, subs] = await this.prisma.$transaction([
      this.prisma.brandWorkflow.updateMany({
        where: { whiteLabelId, folderId },
        data: { folderId: newParent },
      }),
      this.prisma.brandWorkflowFolder.updateMany({
        where: { whiteLabelId, parentId: folderId },
        data: { parentId: newParent },
      }),
      this.prisma.brandWorkflowFolder.delete({ where: { id: folderId } }),
    ]);
    return { ok: true, movedWorkflows: wfs.count, movedFolders: subs.count };
  }

  // Mover VARIOS workflows a una carpeta en una sola llamada. El destino se
  // valida como carpeta de la marca, y el updateMany filtra por whiteLabelId:
  // ids de otra marca simplemente no se tocan (y el count lo delata).
  async bulkMoveWorkflows(whiteLabelId: string, ids: string[], folderId: string | null) {
    const list = [...new Set(ids)].filter(Boolean);
    if (!list.length) return { ok: true, count: 0 };
    const target = (folderId ?? '').trim() || null;
    if (target) await this.ownFolder(whiteLabelId, target);
    const res = await this.prisma.brandWorkflow.updateMany({
      where: { id: { in: list }, whiteLabelId },
      data: { folderId: target },
    });
    return { ok: true, count: res.count };
  }

  // Borrar VARIOS workflows (con sus inscripciones). Primero resolvemos qué
  // ids son realmente de la marca: las inscripciones no tienen whiteLabelId
  // propio, así que borrarlas por los ids crudos permitiría borrar
  // inscripciones ajenas.
  async bulkDeleteWorkflows(whiteLabelId: string, ids: string[]) {
    const list = [...new Set(ids)].filter(Boolean);
    if (!list.length) return { ok: true, count: 0 };
    const own = await this.prisma.brandWorkflow.findMany({
      where: { id: { in: list }, whiteLabelId },
      select: { id: true },
    });
    const ownIds = own.map((w) => w.id);
    if (!ownIds.length) return { ok: true, count: 0 };
    const [, res] = await this.prisma.$transaction([
      this.prisma.brandWorkflowEnrollment.deleteMany({ where: { workflowId: { in: ownIds } } }),
      this.prisma.brandWorkflow.deleteMany({ where: { id: { in: ownIds }, whiteLabelId } }),
    ]);
    return { ok: true, count: res.count };
  }
}
