import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StageKind } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

/**
 * Stages default que se crean cuando un afiliado abre su pipeline por
 * primera vez. El orden de este array es el orden visual del kanban.
 * El user puede editarlos (nombre, color, orden) o agregar más con
 * kind=CUSTOM.
 */
const DEFAULT_STAGES: Array<{
  name: string;
  color: string;
  kind: StageKind;
}> = [
  { name: 'Contactos', color: '#94A3B8', kind: 'CONTACTS' },
  { name: 'Interesados', color: '#3B82F6', kind: 'INTERESTED' },
  { name: 'Seguimiento', color: '#F59E0B', kind: 'FOLLOWUP' },
  { name: 'Cliente', color: '#22C55E', kind: 'CLIENT' },
  { name: 'No interesado', color: '#EF4444', kind: 'NOT_INTERESTED' },
];

const COLOR_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function normalizeColor(input: string | undefined, fallback = '#94A3B8'): string {
  if (!input) return fallback;
  const v = input.trim();
  if (!COLOR_RE.test(v)) return fallback;
  return v.startsWith('#') ? v.toLowerCase() : `#${v.toLowerCase()}`;
}

@Injectable()
export class CrmService {
  constructor(private prisma: PrismaService) {}

  /**
   * Devuelve el pipeline del user actual. Si no existe (primer acceso),
   * lo crea con las 5 stages default. Es upsert idempotente — múltiples
   * llamadas devuelven siempre el mismo pipeline.
   *
   * Solo se ejecuta dentro de @Roles del controller — la validación de
   * que el user PUEDE tener pipeline (AFFILIATE_* + SUPER_ADMIN) ya
   * pasó cuando llega acá.
   */
  async ensureMyPipeline(user: AuthUser) {
    const existing = await this.prisma.pipeline.findUnique({
      where: { ownerUserId: user.id },
      include: { stages: { orderBy: { order: 'asc' } } },
    });
    if (existing) return existing;

    // Creamos pipeline + 5 stages default en una sola transacción para
    // que el frontend nunca vea un pipeline "huérfano" sin stages.
    return this.prisma.$transaction(async (tx) => {
      const pipeline = await tx.pipeline.create({
        data: { ownerUserId: user.id },
      });
      await tx.stage.createMany({
        data: DEFAULT_STAGES.map((s, idx) => ({
          pipelineId: pipeline.id,
          name: s.name,
          color: s.color,
          kind: s.kind,
          order: idx,
        })),
      });
      const stages = await tx.stage.findMany({
        where: { pipelineId: pipeline.id },
        orderBy: { order: 'asc' },
      });
      return { ...pipeline, stages };
    });
  }

  /**
   * Verifica que el stage exista y pertenezca al pipeline del user.
   * Tira ForbiddenException si el user intenta tocar un stage ajeno.
   * Returns la stage para que el caller la use sin segundo fetch.
   */
  private async loadOwnedStage(user: AuthUser, stageId: string) {
    const stage = await this.prisma.stage.findUnique({
      where: { id: stageId },
      include: { pipeline: { select: { ownerUserId: true } } },
    });
    if (!stage) throw new NotFoundException('Stage no encontrado');
    if (stage.pipeline.ownerUserId !== user.id) {
      throw new ForbiddenException('No podés modificar stages de otro user');
    }
    return stage;
  }

  /** Crea una stage nueva al final del pipeline del user. */
  async createStage(
    user: AuthUser,
    body: { name: string; color?: string },
  ) {
    if (!body.name || !body.name.trim()) {
      throw new BadRequestException('El nombre del stage es obligatorio');
    }
    const pipeline = await this.ensureMyPipeline(user);
    // Order = max+1 para que aparezca al final del kanban.
    const last = await this.prisma.stage.findFirst({
      where: { pipelineId: pipeline.id },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const nextOrder = (last?.order ?? -1) + 1;
    return this.prisma.stage.create({
      data: {
        pipelineId: pipeline.id,
        name: body.name.trim().slice(0, 60),
        color: normalizeColor(body.color),
        order: nextOrder,
        kind: 'CUSTOM',
      },
    });
  }

  async updateStage(
    user: AuthUser,
    stageId: string,
    body: { name?: string; color?: string },
  ) {
    await this.loadOwnedStage(user, stageId);
    return this.prisma.stage.update({
      where: { id: stageId },
      data: {
        name:
          body.name === undefined ? undefined : body.name.trim().slice(0, 60),
        color:
          body.color === undefined ? undefined : normalizeColor(body.color),
      },
    });
  }

  /**
   * Borra una stage. Se permite borrar incluso las default (CONTACTS,
   * INTERESTED, etc.) — el user puede armar su flow propio. La única
   * restricción: no podés quedarte sin ninguna stage en el pipeline.
   *
   * NOTA: cuando agreguemos CrmContact en C2, habrá que decidir qué
   * pasa con los contactos asociados (move a otra stage vs. delete).
   * Por ahora no hay contactos así que es seguro borrar.
   */
  async deleteStage(user: AuthUser, stageId: string) {
    const stage = await this.loadOwnedStage(user, stageId);
    const count = await this.prisma.stage.count({
      where: { pipelineId: stage.pipelineId },
    });
    if (count <= 1) {
      throw new BadRequestException(
        'No podés borrar la última stage del pipeline',
      );
    }
    await this.prisma.stage.delete({ where: { id: stageId } });
    return { ok: true };
  }

  /**
   * Reordena las stages del pipeline. Recibe un array de stage IDs en el
   * nuevo orden. Validamos que TODOS los IDs pertenezcan al pipeline del
   * user antes de aplicar (evita corrupción si el body tiene un id
   * ajeno).
   */
  async reorderStages(user: AuthUser, stageIds: string[]) {
    if (!Array.isArray(stageIds) || stageIds.length === 0) {
      throw new BadRequestException('stageIds debe ser un array no vacío');
    }
    const pipeline = await this.ensureMyPipeline(user);
    const owned = await this.prisma.stage.findMany({
      where: { pipelineId: pipeline.id },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((s) => s.id));
    for (const id of stageIds) {
      if (!ownedIds.has(id)) {
        throw new ForbiddenException(
          `Stage ${id} no pertenece a tu pipeline`,
        );
      }
    }
    if (stageIds.length !== owned.length) {
      throw new BadRequestException(
        'El array debe incluir todos los stages del pipeline',
      );
    }
    // Aplicamos en transaction para que el orden sea atómico.
    await this.prisma.$transaction(
      stageIds.map((id, idx) =>
        this.prisma.stage.update({
          where: { id },
          data: { order: idx },
        }),
      ),
    );
    return { ok: true };
  }

  /** Actualiza el nombre del pipeline del user. */
  async renamePipeline(user: AuthUser, name: string) {
    if (!name || !name.trim()) {
      throw new BadRequestException('El nombre no puede estar vacío');
    }
    const pipeline = await this.ensureMyPipeline(user);
    return this.prisma.pipeline.update({
      where: { id: pipeline.id },
      data: { name: name.trim().slice(0, 80) },
    });
  }
}
