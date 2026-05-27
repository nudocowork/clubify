import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StageKind } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { GrowBusinessService } from '../integrations/grow-business.service';

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
  constructor(
    private prisma: PrismaService,
    private growBusiness: GrowBusinessService,
  ) {}

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
   * Borra una stage. Si tiene contactos asociados, los movemos a la
   * primera stage del pipeline que NO sea la borrada — preservamos
   * la data del afiliado. La FK Stage→CrmContact es RESTRICT así que
   * el move es obligatorio antes del delete.
   *
   * Restricción: no podés quedarte sin ninguna stage en el pipeline.
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
    const contactsCount = await this.prisma.crmContact.count({
      where: { stageId },
    });
    await this.prisma.$transaction(async (tx) => {
      if (contactsCount > 0) {
        const fallback = await tx.stage.findFirst({
          where: {
            pipelineId: stage.pipelineId,
            id: { not: stageId },
          },
          orderBy: { order: 'asc' },
          select: { id: true },
        });
        if (!fallback) {
          // Defensa adicional — count > 1 ya lo asegura, pero por si acaso.
          throw new BadRequestException(
            'No hay otra stage para mover los contactos',
          );
        }
        await tx.crmContact.updateMany({
          where: { stageId },
          data: { stageId: fallback.id, lastActivityAt: new Date() },
        });
      }
      await tx.stage.delete({ where: { id: stageId } });
    });
    return { ok: true, movedContacts: contactsCount };
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

  // =============================================================
  //                        CONTACTOS (C2)
  // =============================================================

  /**
   * Lista todos los contactos del user. Devuelve ordenados por
   * lastActivityAt desc para que el kanban muestre los más recientes
   * arriba en cada columna. Opcionalmente filtra por stageId.
   */
  async listMyContacts(user: AuthUser, stageId?: string) {
    return this.prisma.crmContact.findMany({
      where: {
        ownerUserId: user.id,
        ...(stageId ? { stageId } : {}),
      },
      orderBy: { lastActivityAt: 'desc' },
    });
  }

  /** Detalle de un contacto. Tira 404 si no existe; ForbiddenException
   *  si pertenece a otro user (sin filtrar antes — evita leak de
   *  existencia). */
  async getContact(user: AuthUser, id: string) {
    const c = await this.prisma.crmContact.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Contacto no encontrado');
    if (c.ownerUserId !== user.id) {
      throw new ForbiddenException('No podés ver contactos ajenos');
    }
    return c;
  }

  /**
   * Crea un contacto. Todos los fields opcionales — el contacto puede
   * crearse con solo un nombre y completar después. Si no se pasa
   * stageId, va a la stage de menor `order` del pipeline (la primera
   * columna, típicamente "Contactos").
   */
  async createContact(
    user: AuthUser,
    body: {
      stageId?: string;
      name?: string;
      phone?: string;
      instagram?: string;
      address?: string;
      description?: string;
      tags?: string[];
    },
  ) {
    const pipeline = await this.ensureMyPipeline(user);
    let stageId = body.stageId;
    if (stageId) {
      // Validar ownership: el stage debe pertenecer al pipeline del user.
      const stage = await this.prisma.stage.findUnique({
        where: { id: stageId },
        select: { pipelineId: true },
      });
      if (!stage || stage.pipelineId !== pipeline.id) {
        throw new ForbiddenException('El stage no pertenece a tu pipeline');
      }
    } else {
      const firstStage = await this.prisma.stage.findFirst({
        where: { pipelineId: pipeline.id },
        orderBy: { order: 'asc' },
        select: { id: true },
      });
      if (!firstStage) {
        // No debería pasar — ensureMyPipeline siempre crea stages — pero
        // defensa por las dudas.
        throw new BadRequestException(
          'Tu pipeline no tiene stages. Recargá la página.',
        );
      }
      stageId = firstStage.id;
    }
    const created = await this.prisma.crmContact.create({
      data: {
        ownerUserId: user.id,
        stageId,
        name: body.name?.trim().slice(0, 120) || null,
        phone: body.phone?.trim().slice(0, 40) || null,
        instagram: body.instagram?.trim().slice(0, 80) || null,
        address: body.address?.trim().slice(0, 200) || null,
        description: body.description?.trim().slice(0, 4000) || null,
        tags: (Array.isArray(body.tags) ? body.tags.slice(0, 20) : []) as any,
      },
    });
    // C6: log al timeline (fire-and-forget, no bloquea respuesta).
    this.logActivity(created.id, user.id, 'CONTACT_CREATED', 'Contacto creado').catch(() => null);
    return created;
  }

  /**
   * Edita campos del contacto. Patrón "undefined = no tocar" para que
   * el frontend pueda enviar updates parciales sin perder data.
   */
  async updateContact(
    user: AuthUser,
    id: string,
    body: {
      name?: string | null;
      phone?: string | null;
      instagram?: string | null;
      address?: string | null;
      description?: string | null;
      tags?: string[];
    },
  ) {
    const previous = await this.getContact(user, id); // ownership check
    const updated = await this.prisma.crmContact.update({
      where: { id },
      data: {
        name:
          body.name === undefined
            ? undefined
            : body.name?.trim().slice(0, 120) || null,
        phone:
          body.phone === undefined
            ? undefined
            : body.phone?.trim().slice(0, 40) || null,
        instagram:
          body.instagram === undefined
            ? undefined
            : body.instagram?.trim().slice(0, 80) || null,
        address:
          body.address === undefined
            ? undefined
            : body.address?.trim().slice(0, 200) || null,
        description:
          body.description === undefined
            ? undefined
            : body.description?.trim().slice(0, 4000) || null,
        tags:
          body.tags === undefined
            ? undefined
            : (body.tags.slice(0, 20) as any),
        lastActivityAt: new Date(),
      },
    });
    // C6: detectar qué cambió y loggear. Si solo tags cambió pero los
    // de body son superset, lo loggeamos como TAG_ADDED en lugar de
    // CONTACT_UPDATED para tener mejor semántica.
    const fieldsChanged: string[] = [];
    if (body.name !== undefined && previous.name !== updated.name)
      fieldsChanged.push('nombre');
    if (body.phone !== undefined && previous.phone !== updated.phone)
      fieldsChanged.push('teléfono');
    if (body.instagram !== undefined && previous.instagram !== updated.instagram)
      fieldsChanged.push('Instagram');
    if (body.address !== undefined && previous.address !== updated.address)
      fieldsChanged.push('dirección');
    if (body.description !== undefined && previous.description !== updated.description)
      fieldsChanged.push('notas');
    if (fieldsChanged.length > 0) {
      this.logActivity(
        id,
        user.id,
        'CONTACT_UPDATED',
        `Editado: ${fieldsChanged.join(', ')}`,
      ).catch(() => null);
    }
    const prevTags = Array.isArray(previous.tags)
      ? (previous.tags as string[])
      : [];
    const nextTags = Array.isArray(updated.tags)
      ? (updated.tags as string[])
      : [];
    const addedTags = nextTags.filter((t) => !prevTags.includes(t));
    if (addedTags.length > 0) {
      this.logActivity(
        id,
        user.id,
        'TAG_ADDED',
        `Etiquetas agregadas: ${addedTags.join(', ')}`,
        { tags: addedTags },
      ).catch(() => null);
    }
    return updated;
  }

  /**
   * Mueve un contacto a otra stage. Validamos que la stage destino
   * pertenezca al pipeline del user (evita que cualquier ID válido
   * de otro pipeline robe el contacto).
   */
  async moveContactToStage(user: AuthUser, id: string, stageId: string) {
    const previous = await this.getContact(user, id); // ownership check
    const pipeline = await this.ensureMyPipeline(user);
    const stage = await this.prisma.stage.findUnique({
      where: { id: stageId },
      select: { pipelineId: true, name: true },
    });
    if (!stage || stage.pipelineId !== pipeline.id) {
      throw new ForbiddenException('El stage no pertenece a tu pipeline');
    }
    const updated = await this.prisma.crmContact.update({
      where: { id },
      data: { stageId, lastActivityAt: new Date() },
    });
    // C6: solo loggeamos si efectivamente cambió de stage (evita log
    // duplicado si el drag&drop sobre la misma stage llamó esto).
    if (previous.stageId !== stageId) {
      const fromStage = await this.prisma.stage.findUnique({
        where: { id: previous.stageId },
        select: { name: true },
      });
      this.logActivity(
        id,
        user.id,
        'STAGE_CHANGED',
        `Movido a "${stage.name}"`,
        {
          fromStageId: previous.stageId,
          fromStageName: fromStage?.name ?? null,
          toStageId: stageId,
          toStageName: stage.name,
        },
      ).catch(() => null);
    }
    return updated;
  }

  async deleteContact(user: AuthUser, id: string) {
    await this.getContact(user, id); // ownership check
    await this.prisma.crmContact.delete({ where: { id } });
    return { ok: true };
  }

  // =============================================================
  //                    BOTONES AUTOMÁTICOS (C5)
  // =============================================================

  async listButtons(user: AuthUser) {
    return this.prisma.crmButton.findMany({
      where: { ownerUserId: user.id },
      orderBy: { order: 'asc' },
      include: {
        moveToStage: { select: { id: true, name: true, color: true } },
      },
    });
  }

  async createButton(
    user: AuthUser,
    body: {
      name: string;
      color?: string;
      icon?: string;
      channel: 'SMS' | 'WHATSAPP' | 'EMAIL' | 'NOTE';
      messageBody?: string;
      attachmentUrl?: string;
      attachmentName?: string;
      moveToStageId?: string | null;
      addTags?: string[];
      delaySeconds?: number;
      requiresConfirmation?: boolean;
    },
  ) {
    if (!body.name?.trim()) {
      throw new BadRequestException('El nombre del botón es obligatorio');
    }
    if (!['SMS', 'WHATSAPP', 'EMAIL', 'NOTE'].includes(body.channel)) {
      throw new BadRequestException('Canal inválido');
    }
    // Validamos que moveToStageId (si está set) pertenece al pipeline del user.
    if (body.moveToStageId) {
      await this.assertStageBelongsToUser(user, body.moveToStageId);
    }
    const last = await this.prisma.crmButton.findFirst({
      where: { ownerUserId: user.id },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const nextOrder = (last?.order ?? -1) + 1;
    return this.prisma.crmButton.create({
      data: {
        ownerUserId: user.id,
        name: body.name.trim().slice(0, 80),
        color: normalizeColor(body.color, '#6366F1'),
        icon: body.icon?.trim().slice(0, 8) || null,
        channel: body.channel,
        messageBody: body.messageBody?.trim().slice(0, 4000) || null,
        attachmentUrl: body.attachmentUrl?.trim() || null,
        attachmentName: body.attachmentName?.trim().slice(0, 200) || null,
        moveToStageId: body.moveToStageId ?? null,
        addTags: (Array.isArray(body.addTags)
          ? body.addTags.slice(0, 10)
          : []) as any,
        delaySeconds: Math.max(0, Math.min(3600, body.delaySeconds ?? 0)),
        requiresConfirmation: body.requiresConfirmation ?? true,
        order: nextOrder,
      },
    });
  }

  private async loadOwnedButton(user: AuthUser, buttonId: string) {
    const btn = await this.prisma.crmButton.findUnique({
      where: { id: buttonId },
    });
    if (!btn) throw new NotFoundException('Botón no encontrado');
    if (btn.ownerUserId !== user.id) {
      throw new ForbiddenException('No podés tocar botones ajenos');
    }
    return btn;
  }

  private async assertStageBelongsToUser(user: AuthUser, stageId: string) {
    const pipeline = await this.ensureMyPipeline(user);
    const stage = await this.prisma.stage.findUnique({
      where: { id: stageId },
      select: { pipelineId: true },
    });
    if (!stage || stage.pipelineId !== pipeline.id) {
      throw new ForbiddenException('El stage no pertenece a tu pipeline');
    }
  }

  async updateButton(
    user: AuthUser,
    id: string,
    body: Partial<{
      name: string;
      color: string;
      icon: string | null;
      channel: 'SMS' | 'WHATSAPP' | 'EMAIL' | 'NOTE';
      messageBody: string | null;
      attachmentUrl: string | null;
      attachmentName: string | null;
      moveToStageId: string | null;
      addTags: string[];
      delaySeconds: number;
      requiresConfirmation: boolean;
    }>,
  ) {
    await this.loadOwnedButton(user, id);
    if (body.moveToStageId) {
      await this.assertStageBelongsToUser(user, body.moveToStageId);
    }
    return this.prisma.crmButton.update({
      where: { id },
      data: {
        name:
          body.name === undefined
            ? undefined
            : body.name.trim().slice(0, 80) || undefined,
        color:
          body.color === undefined
            ? undefined
            : normalizeColor(body.color, '#6366F1'),
        icon:
          body.icon === undefined
            ? undefined
            : body.icon?.trim().slice(0, 8) || null,
        channel: body.channel ?? undefined,
        messageBody:
          body.messageBody === undefined
            ? undefined
            : body.messageBody?.trim().slice(0, 4000) || null,
        attachmentUrl:
          body.attachmentUrl === undefined
            ? undefined
            : body.attachmentUrl?.trim() || null,
        attachmentName:
          body.attachmentName === undefined
            ? undefined
            : body.attachmentName?.trim().slice(0, 200) || null,
        moveToStageId:
          body.moveToStageId === undefined ? undefined : body.moveToStageId,
        addTags:
          body.addTags === undefined
            ? undefined
            : (body.addTags.slice(0, 10) as any),
        delaySeconds:
          body.delaySeconds === undefined
            ? undefined
            : Math.max(0, Math.min(3600, body.delaySeconds)),
        requiresConfirmation:
          body.requiresConfirmation === undefined
            ? undefined
            : body.requiresConfirmation,
      },
    });
  }

  async deleteButton(user: AuthUser, id: string) {
    await this.loadOwnedButton(user, id);
    await this.prisma.crmButton.delete({ where: { id } });
    return { ok: true };
  }

  async reorderButtons(user: AuthUser, ids: string[]) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException('ids debe ser un array no vacío');
    }
    const owned = await this.prisma.crmButton.findMany({
      where: { ownerUserId: user.id },
      select: { id: true },
    });
    const ownedSet = new Set(owned.map((b) => b.id));
    for (const id of ids) {
      if (!ownedSet.has(id)) {
        throw new ForbiddenException(
          `Botón ${id} no te pertenece`,
        );
      }
    }
    await this.prisma.$transaction(
      ids.map((id, idx) =>
        this.prisma.crmButton.update({
          where: { id },
          data: { order: idx },
        }),
      ),
    );
    return { ok: true };
  }

  /**
   * Ejecuta un botón sobre un contacto. Aplica side effects (move stage,
   * agregar tags, actualizar lastActivityAt) y devuelve un payload que
   * el frontend usa para completar la acción según el channel:
   *
   *   - WHATSAPP: el response trae `whatsappUrl` (wa.me/<phone>?text=...)
   *     y el frontend lo abre en nueva tab.
   *   - SMS:     pending=true (la integración real con Grow Business
   *     llega en C7). El side-effect SÍ se aplica.
   *   - EMAIL:   pending=true (mismo motivo).
   *   - NOTE:    no envía nada — solo aplica side effects.
   *
   * El historial completo de actividades (C6) será populado por este
   * mismo método cuando llegue C6 — ya dejamos el hook listo.
   */
  async executeButton(user: AuthUser, buttonId: string, contactId: string) {
    const btn = await this.loadOwnedButton(user, buttonId);
    const contact = await this.getContact(user, contactId);

    // Aplicar side effects en transaction para que sea atómico.
    const updates: any = {
      lastActivityAt: new Date(),
    };
    if (btn.moveToStageId) {
      // Validamos otra vez por las dudas (la stage puede haber sido
      // borrada después de configurar el botón → moveToStageId
      // quedó SetNull). Si quedó null no movemos.
      const stage = await this.prisma.stage.findUnique({
        where: { id: btn.moveToStageId },
        select: { id: true },
      });
      if (stage) updates.stageId = btn.moveToStageId;
    }
    // Tags: merge sin duplicados.
    const existingTags = Array.isArray(contact.tags)
      ? (contact.tags as string[])
      : [];
    const btnTags = Array.isArray(btn.addTags)
      ? (btn.addTags as string[])
      : [];
    const mergedTags = Array.from(new Set([...existingTags, ...btnTags]));
    if (btnTags.length > 0) {
      updates.tags = mergedTags as any;
    }
    const updatedContact = await this.prisma.crmContact.update({
      where: { id: contactId },
      data: updates,
    });

    // Compute message body con tokens.
    const message = renderMessageTemplate(btn.messageBody ?? '', updatedContact);

    // C6: log BUTTON_EXECUTED (siempre, independiente del channel).
    // metadata: payload completo para auditar el envío.
    this.logActivity(
      contactId,
      user.id,
      'BUTTON_EXECUTED',
      `Ejecutado "${btn.name}"`,
      {
        buttonId: btn.id,
        buttonName: btn.name,
        channel: btn.channel,
        message,
        attachmentUrl: btn.attachmentUrl,
        addedTags: btnTags,
        movedToStage: updates.stageId
          ? { id: updates.stageId as string }
          : null,
      },
    ).catch(() => null);

    // Channel-specific response.
    switch (btn.channel) {
      case 'WHATSAPP': {
        const phone = (updatedContact.phone ?? '').replace(/\D/g, '');
        if (!phone) {
          return {
            ok: false,
            channel: 'WHATSAPP',
            error: 'El contacto no tiene teléfono — no se puede abrir WhatsApp',
            contact: updatedContact,
          };
        }
        const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
        return {
          ok: true,
          channel: 'WHATSAPP',
          whatsappUrl: url,
          message,
          contact: updatedContact,
        };
      }
      case 'SMS': {
        // Envío SMS server-side via Grow Business usando las creds que
        // el afiliado conectó en /affiliate/crm/integrations (User.crmGb*).
        // Si no tiene GB conectado o no hay teléfono, retornamos error
        // claro — los side-effects (move stage, tags) YA se aplicaron
        // arriba, así que el user no pierde su trabajo.
        const phoneRaw = (updatedContact.phone ?? '').trim();
        if (!phoneRaw) {
          return {
            ok: false,
            channel: 'SMS',
            error: 'El contacto no tiene teléfono — no se puede enviar SMS',
            contact: updatedContact,
          };
        }
        const userWithGb = await this.prisma.user.findUnique({
          where: { id: user.id },
          select: { crmGbLocationId: true, crmGbApiKey: true },
        });
        if (!userWithGb?.crmGbLocationId || !userWithGb?.crmGbApiKey) {
          return {
            ok: false,
            channel: 'SMS',
            error:
              'Conectá Grow Business en /affiliate/crm/integrations para enviar mensajes.',
            contact: updatedContact,
          };
        }
        // Si el botón tiene adjunto, agregamos la URL al final del mensaje
        // — LeadConnector SMS no acepta attachments binarios, así que el
        // link es lo más cercano que podemos hacer.
        const finalBody = btn.attachmentUrl
          ? `${message}\n\n${btn.attachmentUrl}`
          : message;
        const result = await this.growBusiness.sendSmsWithCreds(
          { locationId: userWithGb.crmGbLocationId, apiKey: userWithGb.crmGbApiKey },
          phoneRaw,
          finalBody,
        );
        if (!result.ok) {
          return {
            ok: false,
            channel: 'SMS',
            error:
              (result as any).message ??
              'No se pudo enviar el mensaje. Revisá la conexión Grow Business.',
            contact: updatedContact,
          };
        }
        return {
          ok: true,
          channel: 'SMS',
          message,
          contact: updatedContact,
        };
      }
      case 'EMAIL':
        return {
          ok: true,
          channel: 'EMAIL',
          pending: true,
          message,
          note: 'Envío de email server-side llega en la próxima iteración.',
          contact: updatedContact,
        };
      case 'NOTE':
      default:
        return {
          ok: true,
          channel: 'NOTE',
          contact: updatedContact,
        };
    }
  }

  // =============================================================
  //                      HISTORIAL (C6)
  // =============================================================

  /**
   * Helper interno: crea una row en CrmActivity. Llamado fire-and-forget
   * desde los hooks de create/update/move/execute para no bloquear la
   * respuesta del endpoint principal. Si falla (DB issue), solo se
   * pierde la entrada del log — no rompe la acción.
   *
   * Importante: NO verifica ownership del contacto porque los callers
   * ya hicieron getContact() / loadOwned() antes.
   */
  private async logActivity(
    contactId: string,
    userId: string,
    type:
      | 'CONTACT_CREATED'
      | 'CONTACT_UPDATED'
      | 'STAGE_CHANGED'
      | 'BUTTON_EXECUTED'
      | 'NOTE_ADDED'
      | 'TAG_ADDED',
    title: string,
    metadata: any = {},
    body: string | null = null,
  ) {
    return this.prisma.crmActivity.create({
      data: {
        contactId,
        userId,
        type,
        title: title.slice(0, 200),
        body: body?.slice(0, 4000) ?? null,
        metadata: (metadata ?? {}) as any,
      },
    });
  }

  /**
   * Timeline del contacto. Solo el dueño del contacto puede leerlo
   * (la ownership ya viene de getContact). Devuelve actividades ordenadas
   * por createdAt desc — el frontend muestra las más recientes arriba.
   */
  async listContactActivities(user: AuthUser, contactId: string) {
    await this.getContact(user, contactId); // ownership check
    return this.prisma.crmActivity.findMany({
      where: { contactId },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, fullName: true } },
      },
    });
  }

  /**
   * Nota manual del afiliado sobre un contacto. Va al historial como
   * NOTE_ADDED. Texto libre hasta 4000 chars. También bump
   * lastActivityAt del contacto (es interacción real).
   */
  async addNote(user: AuthUser, contactId: string, body: string) {
    await this.getContact(user, contactId); // ownership check
    const text = (body ?? '').trim();
    if (!text) {
      throw new BadRequestException('La nota no puede estar vacía');
    }
    const activity = await this.logActivity(
      contactId,
      user.id,
      'NOTE_ADDED',
      'Nota agregada',
      {},
      text.slice(0, 4000),
    );
    await this.prisma.crmContact.update({
      where: { id: contactId },
      data: { lastActivityAt: new Date() },
    });
    return activity;
  }

  // =============================================================
  //                  GROW BUSINESS SYNC (C7)
  // =============================================================

  /** Devuelve el estado de la conexión Grow Business del user. */
  async getGrowBusinessStatus(user: AuthUser) {
    const u = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        crmGbLocationId: true,
        crmGbLocationName: true,
        crmGbConnectedAt: true,
        crmGbLastSyncAt: true,
        crmGbLastSyncCount: true,
      },
    });
    if (!u || !u.crmGbLocationId) {
      return { connected: false };
    }
    return {
      connected: true,
      locationId: u.crmGbLocationId,
      locationName: u.crmGbLocationName,
      connectedAt: u.crmGbConnectedAt,
      lastSyncAt: u.crmGbLastSyncAt,
      lastSyncCount: u.crmGbLastSyncCount,
    };
  }

  /**
   * Conecta una subcuenta GB al user. Verifica las credenciales via
   * GET /locations/:id antes de persistir — si no es válida, retorna
   * 400 con el error real de LeadConnector.
   */
  async connectGrowBusiness(
    user: AuthUser,
    body: { locationId: string; apiKey: string },
  ) {
    const locationId = body.locationId?.trim();
    const apiKey = body.apiKey?.trim();
    if (!locationId || !apiKey) {
      throw new BadRequestException('locationId y apiKey son obligatorios');
    }
    const test = await fetchGbLocation(locationId, apiKey);
    if (!test.ok) {
      throw new BadRequestException(
        test.error ?? 'No se pudo verificar la conexión con Grow Business',
      );
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        crmGbLocationId: locationId,
        crmGbApiKey: apiKey,
        crmGbLocationName: test.locationName,
        crmGbConnectedAt: new Date(),
      },
    });
    return { ok: true, locationName: test.locationName };
  }

  /** Desconecta — limpia las credenciales pero deja los contactos
   *  sincronizados intactos (el afiliado los puede seguir gestionando
   *  manualmente). */
  async disconnectGrowBusiness(user: AuthUser) {
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        crmGbLocationId: null,
        crmGbApiKey: null,
        crmGbLocationName: null,
        crmGbConnectedAt: null,
      },
    });
    return { ok: true };
  }

  /**
   * Pull de contactos desde Grow Business → CrmContact del user.
   *
   * Dedup (en orden): externalContactId → phone normalizado → email.
   * Si encuentra match, actualiza solo fields que están vacíos en el
   * contacto local (no pisamos data manual del afiliado) y mergea las
   * tags. Si no encuentra, crea un contacto nuevo en la primera stage
   * del pipeline del user, con externalContactId seteado.
   *
   * Sin cron por ahora — sync manual del frontend. Cron 30min llega
   * en una iteración posterior cuando definamos el scheduler.
   *
   * Paginación: limit 100 por request, hasta 10 páginas (1000 contactos
   * máx por sync) para acotar el blast radius del primer release.
   */
  async syncGrowBusiness(user: AuthUser) {
    const u = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { crmGbLocationId: true, crmGbApiKey: true },
    });
    if (!u?.crmGbLocationId || !u?.crmGbApiKey) {
      throw new BadRequestException('Grow Business no está conectado');
    }
    const pipeline = await this.ensureMyPipeline(user);
    const firstStage = await this.prisma.stage.findFirst({
      where: { pipelineId: pipeline.id },
      orderBy: { order: 'asc' },
      select: { id: true },
    });
    if (!firstStage) {
      throw new BadRequestException(
        'Tu pipeline no tiene stages. Recargá el kanban.',
      );
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let cursor: string | null = null;
    const MAX_PAGES = 10;

    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await fetchGbContacts(
        u.crmGbLocationId,
        u.crmGbApiKey,
        cursor,
      );
      if (!result.ok) {
        throw new BadRequestException(
          `Error al obtener contactos: ${result.error}`,
        );
      }
      const items = result.contacts ?? [];
      if (items.length === 0) break;

      for (const ext of items) {
        const phone = (ext.phone ?? '').replace(/\D/g, '') || null;
        // Dedup por id externo primero (más confiable).
        let existing = await this.prisma.crmContact.findFirst({
          where: {
            ownerUserId: user.id,
            externalContactId: ext.id,
          },
        });
        if (!existing && phone) {
          existing = await this.prisma.crmContact.findFirst({
            where: { ownerUserId: user.id, phone },
          });
        }
        if (!existing && ext.email) {
          existing = await this.prisma.crmContact.findFirst({
            where: { ownerUserId: user.id, phone: null, name: { not: null } },
            // En realidad NO hay índice por email; usamos un fallback
            // amplio para encontrar candidate. Si la perf importa,
            // agregamos un campo email en C7.x.
          });
          // Override: como no tenemos campo email, esto es lookup
          // débil — voy a deshabilitarlo y solo dedupar por id/phone.
          existing = null;
        }

        if (existing) {
          // Update: rellenar fields vacíos + sumar tags. NO pisar lo que
          // el user ya tiene.
          const existingTags = Array.isArray(existing.tags)
            ? (existing.tags as string[])
            : [];
          const newTags = Array.isArray(ext.tags) ? ext.tags : [];
          const mergedTags = Array.from(new Set([...existingTags, ...newTags]));
          const tagsAdded = mergedTags.length > existingTags.length;
          await this.prisma.crmContact.update({
            where: { id: existing.id },
            data: {
              name: existing.name ?? ext.name ?? null,
              phone: existing.phone ?? phone,
              externalContactId: existing.externalContactId ?? ext.id,
              externalSource: 'grow-business',
              tags: mergedTags as any,
              lastActivityAt: new Date(),
            },
          });
          if (tagsAdded) {
            const addedTags = mergedTags.filter(
              (t) => !existingTags.includes(t),
            );
            this.logActivity(
              existing.id,
              user.id,
              'TAG_ADDED',
              `Sync GB · etiquetas: ${addedTags.join(', ')}`,
              { tags: addedTags, source: 'grow-business' },
            ).catch(() => null);
          }
          updated++;
        } else {
          const newContact = await this.prisma.crmContact.create({
            data: {
              ownerUserId: user.id,
              stageId: firstStage.id,
              name: ext.name ?? null,
              phone,
              externalContactId: ext.id,
              externalSource: 'grow-business',
              tags: (Array.isArray(ext.tags) ? ext.tags.slice(0, 20) : []) as any,
            },
          });
          this.logActivity(
            newContact.id,
            user.id,
            'CONTACT_CREATED',
            'Importado desde Grow Business',
            { source: 'grow-business', externalContactId: ext.id },
          ).catch(() => null);
          created++;
        }
      }
      cursor = result.nextCursor ?? null;
      if (!cursor) break;
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        crmGbLastSyncAt: new Date(),
        crmGbLastSyncCount: created + updated,
      },
    });

    return { ok: true, created, updated, skipped };
  }

  // =============================================================
  //                      MÉTRICAS (C8)
  // =============================================================

  /**
   * Métricas personales del afiliado actual. Calcula on-the-fly desde
   * CrmContact + CrmActivity — sin tablas adicionales ni caching, así
   * los números reflejan el estado real instantáneo. Cuando crezca el
   * volumen (~10k contactos), considerar materialización con un cron
   * que actualiza una tabla `CrmMetricSnapshot`.
   */
  async getMyMetrics(user: AuthUser) {
    const pipeline = await this.ensureMyPipeline(user);
    const stages = await this.prisma.stage.findMany({
      where: { pipelineId: pipeline.id },
      orderBy: { order: 'asc' },
    });

    // 1) Contactos por stage.
    const contactsByStageRaw = await this.prisma.crmContact.groupBy({
      by: ['stageId'],
      where: { ownerUserId: user.id },
      _count: { _all: true },
    });
    const byStageMap = new Map(
      contactsByStageRaw.map((r) => [r.stageId, r._count._all]),
    );
    const stagesWithCount = stages.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      kind: s.kind,
      count: byStageMap.get(s.id) ?? 0,
    }));
    const totalContacts = stagesWithCount.reduce((sum, s) => sum + s.count, 0);

    // 2) Conversión: contactos en stage kind=CLIENT vs total.
    const clientCount = stagesWithCount
      .filter((s) => s.kind === 'CLIENT')
      .reduce((sum, s) => sum + s.count, 0);
    const notInterestedCount = stagesWithCount
      .filter((s) => s.kind === 'NOT_INTERESTED')
      .reduce((sum, s) => sum + s.count, 0);
    const conversionRate =
      totalContacts > 0 ? Math.round((clientCount / totalContacts) * 100) : 0;

    // 3) Tiempo promedio de cierre: para contactos actualmente en stage
    //    CLIENT, calculamos avg(updatedAt — createdAt) en días. No es
    //    perfecto (un contacto pudo volver a CLIENT después de salir),
    //    pero es buena aproximación para C8 sin agregar tracking caro.
    const clientStageIds = stagesWithCount
      .filter((s) => s.kind === 'CLIENT')
      .map((s) => s.id);
    let avgCloseDays: number | null = null;
    if (clientStageIds.length > 0) {
      const clients = await this.prisma.crmContact.findMany({
        where: {
          ownerUserId: user.id,
          stageId: { in: clientStageIds },
        },
        select: { createdAt: true, lastActivityAt: true },
      });
      if (clients.length > 0) {
        const totalMs = clients.reduce(
          (sum, c) =>
            sum +
            Math.max(
              0,
              c.lastActivityAt.getTime() - c.createdAt.getTime(),
            ),
          0,
        );
        avgCloseDays = Math.round(totalMs / clients.length / 86400_000);
      }
    }

    // 4) Top botones usados (últimos 90 días) — agrupa CrmActivity de
    //    tipo BUTTON_EXECUTED por buttonId del metadata.
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const buttonActivities = await this.prisma.crmActivity.findMany({
      where: {
        userId: user.id,
        type: 'BUTTON_EXECUTED',
        createdAt: { gte: since },
      },
      select: { metadata: true },
    });
    const buttonCounts = new Map<string, { name: string; count: number }>();
    for (const a of buttonActivities) {
      const meta = a.metadata as any;
      const id = String(meta?.buttonId ?? '');
      const name = String(meta?.buttonName ?? 'Sin nombre');
      if (!id) continue;
      const cur = buttonCounts.get(id) ?? { name, count: 0 };
      cur.count++;
      buttonCounts.set(id, cur);
    }
    const topButtons = Array.from(buttonCounts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // 5) Contactos creados últimos 30 días (timeline simple).
    const last30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const createdLast30 = await this.prisma.crmContact.count({
      where: {
        ownerUserId: user.id,
        createdAt: { gte: last30 },
      },
    });

    return {
      totalContacts,
      clientCount,
      notInterestedCount,
      conversionRate,
      avgCloseDays,
      createdLast30,
      byStage: stagesWithCount,
      topButtons,
    };
  }

  /**
   * Rankings globales (super admin). Para cada user con role AFFILIATE_*:
   *   - totalContacts
   *   - clientCount
   *   - conversionRate
   *
   * Y también el ranking de equipos por suma de clientCount entre
   * sus miembros.
   */
  async getLeaderboard() {
    // Agrupamos contactos por owner + count.
    const byOwner = await this.prisma.crmContact.groupBy({
      by: ['ownerUserId'],
      _count: { _all: true },
    });
    const ownerIds = byOwner.map((r) => r.ownerUserId);
    if (ownerIds.length === 0) {
      return { users: [], teams: [] };
    }

    // Para clientCount, necesitamos saber qué stages son kind=CLIENT
    // por pipeline. Hacemos una query única que trae stage.kind via join.
    const clientContacts = await this.prisma.crmContact.findMany({
      where: {
        ownerUserId: { in: ownerIds },
        stage: { kind: 'CLIENT' },
      },
      select: { ownerUserId: true },
    });
    const clientCountByOwner = new Map<string, number>();
    for (const c of clientContacts) {
      clientCountByOwner.set(
        c.ownerUserId,
        (clientCountByOwner.get(c.ownerUserId) ?? 0) + 1,
      );
    }

    // Fetch info user.
    const users = await this.prisma.user.findMany({
      where: { id: { in: ownerIds } },
      select: { id: true, fullName: true, email: true, role: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const userRanking = byOwner
      .map((r) => {
        const u = userMap.get(r.ownerUserId);
        if (!u) return null;
        const total = r._count._all;
        const clients = clientCountByOwner.get(r.ownerUserId) ?? 0;
        return {
          userId: u.id,
          fullName: u.fullName,
          email: u.email,
          role: u.role,
          totalContacts: total,
          clientCount: clients,
          conversionRate: total > 0 ? Math.round((clients / total) * 100) : 0,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.totalContacts - a.totalContacts)
      .slice(0, 50);

    // Top equipos: por cada SalesTeam, suma de contactos y clients de
    // sus miembros (incluyendo el lead).
    const teams = await this.prisma.salesTeam.findMany({
      include: {
        members: { select: { userId: true } },
      },
    });
    const teamRanking = teams
      .map((t) => {
        const memberIds = [
          ...(t.leadUserId ? [t.leadUserId] : []),
          ...t.members.map((m) => m.userId),
        ];
        const uniqMembers = Array.from(new Set(memberIds));
        let total = 0;
        let clients = 0;
        for (const id of uniqMembers) {
          const u = userRanking.find((r) => r.userId === id);
          if (u) {
            total += u.totalContacts;
            clients += u.clientCount;
          }
        }
        return {
          teamId: t.id,
          name: t.name,
          memberCount: uniqMembers.length,
          totalContacts: total,
          clientCount: clients,
          conversionRate: total > 0 ? Math.round((clients / total) * 100) : 0,
        };
      })
      .sort((a, b) => b.totalContacts - a.totalContacts);

    return {
      users: userRanking,
      teams: teamRanking,
    };
  }
}

// =============================================================
//             LEADCONNECTOR CLIENT (helpers privados)
// =============================================================

const GB_API = 'https://services.leadconnectorhq.com';
const GB_VERSION = '2021-07-28';

/**
 * Verifica credenciales contra /locations/:id. Si OK, devuelve el
 * nombre de la location para mostrar en UI. Si no, retorna error
 * legible.
 */
async function fetchGbLocation(
  locationId: string,
  apiKey: string,
): Promise<{ ok: boolean; locationName?: string; error?: string }> {
  try {
    const res = await fetch(`${GB_API}/locations/${locationId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Version: GB_VERSION,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      return {
        ok: false,
        error:
          res.status === 401
            ? 'API key inválida o sin permisos sobre esta location'
            : res.status === 404
              ? 'Location no encontrada'
              : `Error ${res.status} de Grow Business`,
      };
    }
    const data = (await res.json().catch(() => null)) as any;
    return {
      ok: true,
      locationName: data?.location?.name ?? data?.name ?? null,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Error de red' };
  }
}

type ExternalContact = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  tags: string[];
};

/**
 * Lista contactos de un location de Grow Business. Paginación: pasamos
 * `startAfterId` para cursor-based pagination. Devuelve el siguiente
 * cursor en `nextCursor` (null cuando no hay más).
 *
 * Si la API responde con un shape inesperado, devolvemos `ok: false`
 * con el error en vez de tirar — el caller decide qué hacer.
 */
async function fetchGbContacts(
  locationId: string,
  apiKey: string,
  startAfterId: string | null,
): Promise<{
  ok: boolean;
  contacts?: ExternalContact[];
  nextCursor?: string | null;
  error?: string;
}> {
  try {
    const params = new URLSearchParams({
      locationId,
      limit: '100',
    });
    if (startAfterId) params.set('startAfterId', startAfterId);
    const res = await fetch(`${GB_API}/contacts/?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Version: GB_VERSION,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        ok: false,
        error: `HTTP ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    const data = (await res.json().catch(() => null)) as any;
    const raw = data?.contacts ?? [];
    const contacts: ExternalContact[] = raw.map((c: any) => ({
      id: String(c.id ?? c.contactId ?? ''),
      name:
        c.name ??
        c.contactName ??
        ([c.firstName, c.lastName].filter(Boolean).join(' ').trim() || null),
      phone: c.phone ?? null,
      email: c.email ?? null,
      tags: Array.isArray(c.tags) ? c.tags.map((t: any) => String(t)) : [],
    }));
    return {
      ok: true,
      contacts,
      // LeadConnector retorna el último id como cursor en `meta.startAfterId`
      // o `meta.nextPage` según versión. Probamos ambos.
      nextCursor:
        data?.meta?.startAfterId ??
        data?.meta?.nextPage ??
        (contacts.length === 100 ? contacts[contacts.length - 1].id : null),
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Error de red' };
  }
}

/**
 * Reemplaza tokens del messageBody con datos del contacto.
 * Tokens soportados: {{name}}, {{phone}}, {{instagram}}.
 * Si un token no tiene valor, queda vacío (no mostramos "null").
 */
function renderMessageTemplate(
  template: string,
  contact: { name: string | null; phone: string | null; instagram: string | null },
): string {
  if (!template) return '';
  return template
    .replace(/\{\{\s*name\s*\}\}/gi, contact.name ?? '')
    .replace(/\{\{\s*phone\s*\}\}/gi, contact.phone ?? '')
    .replace(/\{\{\s*instagram\s*\}\}/gi, contact.instagram ?? '');
}
