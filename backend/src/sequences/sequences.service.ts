import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SequenceEnrollmentStatus,
  SequenceMessageChannel,
  SequenceMessageType,
  SequenceStepKind,
  SequenceTriggerKind,
  SequenceWaitUnit,
} from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { GrowBusinessService } from '../integrations/grow-business.service';
import { QueueService } from '../jobs/queue.service';

// ───────────── DTOs (sin class-validator por ahora; se valida a mano) ─────────────

export interface StepInput {
  id?: string;
  order: number;
  kind: SequenceStepKind;
  messageChannel?: SequenceMessageChannel | null;
  messageType?: SequenceMessageType | null;
  messageBody?: string | null;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  waitAmount?: number | null;
  waitUnit?: SequenceWaitUnit | null;
  moveToStageId?: string | null;
  tags?: string[];
  assignToUserId?: string | null;
  nodeX?: number | null;
  nodeY?: number | null;
}

export interface TriggerInput {
  id?: string;
  kind: SequenceTriggerKind;
  config?: Record<string, any>;
  isActive?: boolean;
}

export interface CreateSequenceInput {
  name: string;
  description?: string | null;
  isActive?: boolean;
  steps?: StepInput[];
  triggers?: TriggerInput[];
}

export interface UpdateSequenceInput extends Partial<CreateSequenceInput> {}

// ───────────── Service ─────────────

@Injectable()
export class SequencesService {
  private logger = new Logger(SequencesService.name);

  constructor(
    private prisma: PrismaService,
    private growBusiness: GrowBusinessService,
    private queue: QueueService,
  ) {}

  // =============================================================
  //                         CRUD
  // =============================================================

  async list(userId: string) {
    return this.prisma.sequence.findMany({
      where: { ownerUserId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            steps: true,
            triggers: true,
            enrollments: true,
          },
        },
      },
    });
  }

  async get(userId: string, id: string) {
    const seq = await this.prisma.sequence.findUnique({
      where: { id },
      include: {
        steps: { orderBy: { order: 'asc' } },
        triggers: true,
      },
    });
    if (!seq) throw new NotFoundException('Secuencia no encontrada');
    if (seq.ownerUserId !== userId) {
      throw new ForbiddenException('No tienes acceso a esta secuencia');
    }
    return seq;
  }

  async create(userId: string, input: CreateSequenceInput) {
    if (!input.name?.trim()) {
      throw new BadRequestException('El nombre es obligatorio');
    }
    return this.prisma.sequence.create({
      data: {
        ownerUserId: userId,
        name: input.name.trim(),
        description: input.description ?? null,
        isActive: input.isActive ?? true,
        steps: input.steps
          ? {
              create: input.steps.map((s) => this.stepCreateData(s)),
            }
          : undefined,
        triggers: input.triggers
          ? {
              create: input.triggers.map((t) => ({
                kind: t.kind,
                config: (t.config ?? {}) as Prisma.InputJsonValue,
                isActive: t.isActive ?? true,
              })),
            }
          : undefined,
      },
      include: {
        steps: { orderBy: { order: 'asc' } },
        triggers: true,
      },
    });
  }

  /**
   * Update full: reemplaza steps y triggers atomicamente. El flow
   * builder envía toda la lista cada vez que el user guarda — preserva
   * los ids de los steps existentes para que enrollments en curso no se
   * rompan (currentStepId sigue siendo válido si el step no fue
   * eliminado).
   */
  async update(userId: string, id: string, input: UpdateSequenceInput) {
    const existing = await this.get(userId, id);

    return this.prisma.$transaction(async (tx) => {
      // 1) Actualizar fields top-level
      const updated = await tx.sequence.update({
        where: { id: existing.id },
        data: {
          name: input.name?.trim() ?? undefined,
          description:
            input.description === undefined ? undefined : input.description,
          isActive: input.isActive ?? undefined,
        },
      });

      // 2) Steps: estrategia smart upsert
      if (input.steps) {
        const incomingIds = new Set(
          input.steps.filter((s) => s.id).map((s) => s.id!),
        );
        // Borrar los que no vinieron
        await tx.sequenceStep.deleteMany({
          where: {
            sequenceId: existing.id,
            id: { notIn: Array.from(incomingIds) },
          },
        });
        // Upsert el resto
        for (const s of input.steps) {
          if (s.id && incomingIds.has(s.id)) {
            await tx.sequenceStep.update({
              where: { id: s.id },
              data: this.stepCreateData(s),
            });
          } else {
            await tx.sequenceStep.create({
              data: { ...this.stepCreateData(s), sequenceId: existing.id },
            });
          }
        }
      }

      // 3) Triggers: replace all (más simple, son chicos)
      if (input.triggers) {
        await tx.sequenceTrigger.deleteMany({
          where: { sequenceId: existing.id },
        });
        if (input.triggers.length > 0) {
          await tx.sequenceTrigger.createMany({
            data: input.triggers.map((t) => ({
              sequenceId: existing.id,
              kind: t.kind,
              config: (t.config ?? {}) as Prisma.InputJsonValue,
              isActive: t.isActive ?? true,
            })),
          });
        }
      }

      return tx.sequence.findUnique({
        where: { id: updated.id },
        include: {
          steps: { orderBy: { order: 'asc' } },
          triggers: true,
        },
      });
    });
  }

  async remove(userId: string, id: string) {
    await this.get(userId, id);
    await this.prisma.sequence.delete({ where: { id } });
    return { ok: true };
  }

  async duplicate(userId: string, id: string) {
    const seq = await this.get(userId, id);
    return this.create(userId, {
      name: `${seq.name} (copia)`,
      description: seq.description,
      isActive: false, // arranca inactiva — el user la prende manual
      steps: seq.steps.map((s) => ({
        order: s.order,
        kind: s.kind,
        messageChannel: s.messageChannel,
        messageType: s.messageType,
        messageBody: s.messageBody,
        attachmentUrl: s.attachmentUrl,
        attachmentName: s.attachmentName,
        waitAmount: s.waitAmount,
        waitUnit: s.waitUnit,
        moveToStageId: s.moveToStageId,
        tags: Array.isArray(s.tags) ? (s.tags as string[]) : [],
        assignToUserId: s.assignToUserId,
        nodeX: s.nodeX,
        nodeY: s.nodeY,
      })),
      triggers: seq.triggers.map((t) => ({
        kind: t.kind,
        config: t.config as Record<string, any>,
        isActive: t.isActive,
      })),
    });
  }

  // =============================================================
  //                     ENROLLMENT
  // =============================================================

  /**
   * Inscribe un contacto en la secuencia. Crea el SequenceEnrollment
   * y encola el primer step.
   *
   * Si el contacto ya está ACTIVE en esta secuencia, devuelve el
   * enrollment existente (idempotente — evita doble enrollment desde
   * un trigger que se dispara dos veces).
   */
  async enroll(opts: {
    sequenceId: string;
    contactId: string;
    triggerKind?: SequenceTriggerKind;
    // Si pasa userId, valida ownership tanto del sequence como del contact.
    actorUserId?: string;
  }) {
    const seq = await this.prisma.sequence.findUnique({
      where: { id: opts.sequenceId },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    if (!seq) throw new NotFoundException('Secuencia no encontrada');
    if (opts.actorUserId && seq.ownerUserId !== opts.actorUserId) {
      throw new ForbiddenException('No tienes acceso a esta secuencia');
    }
    if (!seq.isActive && opts.triggerKind !== 'MANUAL') {
      // Triggers automáticos respetan el switch isActive.
      return { skipped: true, reason: 'Secuencia inactiva' as const };
    }
    if (seq.steps.length === 0) {
      throw new BadRequestException('La secuencia no tiene pasos');
    }

    const contact = await this.prisma.crmContact.findUnique({
      where: { id: opts.contactId },
    });
    if (!contact) throw new NotFoundException('Contacto no encontrado');
    if (contact.ownerUserId !== seq.ownerUserId) {
      throw new ForbiddenException(
        'El contacto no pertenece al owner de la secuencia',
      );
    }

    // Idempotencia: si ya hay un enrollment ACTIVE/PAUSED del mismo
    // contacto en la misma secuencia, devolverlo en vez de crear uno nuevo.
    const existing = await this.prisma.sequenceEnrollment.findFirst({
      where: {
        sequenceId: opts.sequenceId,
        contactId: opts.contactId,
        status: { in: ['ACTIVE', 'PAUSED'] },
      },
    });
    if (existing) return existing;

    const firstStep = seq.steps[0];

    const enrollment = await this.prisma.sequenceEnrollment.create({
      data: {
        sequenceId: opts.sequenceId,
        contactId: opts.contactId,
        triggerKind: opts.triggerKind ?? 'MANUAL',
        currentStepId: firstStep.id,
        status: 'ACTIVE',
        nextRunAt: new Date(),
      },
    });

    // attempts=1: SEND_MESSAGE no es idempotente; un retry mandaría
    // el SMS/WhatsApp 2-3 veces. Ver sequence-worker.service.ts.
    const job = await this.queue.enqueue(
      'sequence.process_step',
      { enrollmentId: enrollment.id },
      { delay: 0, attempts: 1 },
    );
    if (job?.id) {
      await this.prisma.sequenceEnrollment.update({
        where: { id: enrollment.id },
        data: { jobId: String(job.id) },
      });
    }
    return enrollment;
  }

  /**
   * Auto-enroll desde un trigger automático. Llamado por los hooks
   * del CrmService cuando ocurre un evento (createContact, moveToStage,
   * addTag, etc.). Busca todas las sequences ACTIVAS del owner del
   * contacto que tengan un trigger del kind dado y matcheen el criterio,
   * y las inscribe.
   *
   * Idempotente — si el contacto ya está enrollado ACTIVE en alguna de
   * esas sequences, enroll() devuelve el existente sin duplicar.
   *
   * Fire-and-forget desde los hooks — no bloquea la operación principal.
   * Errores se loguean pero no propagan.
   */
  async enrollMatching(
    kind: SequenceTriggerKind,
    contactId: string,
    criteria?: { stageId?: string; tag?: string },
  ): Promise<void> {
    try {
      const contact = await this.prisma.crmContact.findUnique({
        where: { id: contactId },
        select: { ownerUserId: true },
      });
      if (!contact) return;

      const triggers = await this.prisma.sequenceTrigger.findMany({
        where: {
          kind,
          isActive: true,
          sequence: {
            ownerUserId: contact.ownerUserId,
            isActive: true,
          },
        },
        include: { sequence: { select: { id: true } } },
      });

      for (const trig of triggers) {
        // Aplicar filtro de config según kind.
        const cfg = (trig.config as any) ?? {};
        if (kind === 'STAGE_CHANGED' && criteria?.stageId) {
          // Si el trigger tiene stageId, solo dispara si matchea. Si
          // no tiene, matchea cualquier cambio.
          if (cfg.stageId && cfg.stageId !== criteria.stageId) continue;
        }
        if (kind === 'TAG_ADDED' && criteria?.tag) {
          if (cfg.tag && cfg.tag !== criteria.tag) continue;
        }

        try {
          await this.enroll({
            sequenceId: trig.sequenceId,
            contactId,
            triggerKind: kind,
          });
        } catch (e) {
          this.logger.warn(
            `enrollMatching: enroll falló (seq=${trig.sequenceId}, contact=${contactId}): ${(e as Error).message}`,
          );
        }
      }
    } catch (e) {
      this.logger.warn(
        `enrollMatching(${kind}, ${contactId}) falló: ${(e as Error).message}`,
      );
    }
  }

  async listEnrollmentsForContact(userId: string, contactId: string) {
    // Auth: validar que el contacto pertenezca al user que pregunta.
    // Sino cualquier afiliado autenticado podía leer enrollments de
    // contactos ajenos pasando el contactId en la URL.
    const contact = await this.prisma.crmContact.findUnique({
      where: { id: contactId },
      select: { ownerUserId: true },
    });
    if (!contact) throw new NotFoundException('Contacto no encontrado');
    if (contact.ownerUserId !== userId) {
      throw new ForbiddenException('No tienes acceso a este contacto');
    }
    return this.prisma.sequenceEnrollment.findMany({
      where: { contactId },
      orderBy: { enrolledAt: 'desc' },
      include: {
        sequence: { select: { id: true, name: true } },
        currentStep: { select: { id: true, order: true, kind: true } },
        executions: {
          orderBy: { executedAt: 'asc' },
          // (nada extra por ahora)
        },
      },
    });
  }

  /**
   * Wrapper para super admin que quiere ver enrollments de cualquier
   * contacto sin pasar por el guard del owner. Llamado solo desde
   * el dashboard admin (no expuesto al frontend del afiliado).
   */
  async listEnrollmentsForContactAdmin(contactId: string) {
    return this.prisma.sequenceEnrollment.findMany({
      where: { contactId },
      orderBy: { enrolledAt: 'desc' },
      include: {
        sequence: { select: { id: true, name: true } },
        currentStep: { select: { id: true, order: true, kind: true } },
        executions: { orderBy: { executedAt: 'asc' } },
      },
    });
  }

  async pauseEnrollment(userId: string, enrollmentId: string) {
    const e = await this.assertEnrollmentOwnership(userId, enrollmentId);
    if (e.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Solo se pueden pausar enrollments activos',
      );
    }
    if (e.jobId) {
      await this.queue.removeJob('sequence.process_step', e.jobId);
    }
    return this.prisma.sequenceEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'PAUSED', jobId: null },
    });
  }

  async resumeEnrollment(userId: string, enrollmentId: string) {
    const e = await this.assertEnrollmentOwnership(userId, enrollmentId);
    if (e.status !== 'PAUSED') {
      throw new BadRequestException(
        'Solo se pueden reanudar enrollments pausados',
      );
    }
    if (!e.currentStepId) {
      // No hay step actual → marcamos completado (no quedó nada por hacer).
      return this.prisma.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
    }
    const job = await this.queue.enqueue(
      'sequence.process_step',
      { enrollmentId },
      { delay: 0, attempts: 1 }, // no retry — ver sequence-worker.
    );
    return this.prisma.sequenceEnrollment.update({
      where: { id: enrollmentId },
      data: {
        status: 'ACTIVE',
        nextRunAt: new Date(),
        jobId: job?.id ? String(job.id) : null,
      },
    });
  }

  async cancelEnrollment(userId: string, enrollmentId: string) {
    const e = await this.assertEnrollmentOwnership(userId, enrollmentId);
    if (e.status === 'COMPLETED' || e.status === 'CANCELED') return e;
    if (e.jobId) {
      await this.queue.removeJob('sequence.process_step', e.jobId);
    }
    return this.prisma.sequenceEnrollment.update({
      where: { id: enrollmentId },
      data: {
        status: 'CANCELED',
        jobId: null,
        completedAt: new Date(),
      },
    });
  }

  // =============================================================
  //                     ENGINE — processStep
  // =============================================================

  /**
   * Procesa el currentStep del enrollment. Llamado por el worker BullMQ.
   *
   * Flujo:
   *  1) Carga enrollment + currentStep + sequence + contact
   *  2) Si enrollment no está ACTIVE → no-op
   *  3) Ejecuta la acción del step (SEND_MESSAGE / MOVE_STAGE / etc.)
   *  4) Log execution (OK/FAILED/SKIPPED)
   *  5) Calcula siguiente step (order > current.order). Si no hay o es END,
   *     marca COMPLETED.
   *  6) Si siguiente es WAIT, encola job con delay = waitDuration.
   *     Si no, encola con delay=0.
   *  7) Update enrollment.currentStepId, nextRunAt, jobId.
   *
   * Si algo falla fatalmente (contacto sin teléfono para SMS, GB no conectado),
   * marca FAILED y para. El user puede resume después de fixearlo.
   */
  async processStep(enrollmentId: string): Promise<void> {
    const enrollment = await this.prisma.sequenceEnrollment.findUnique({
      where: { id: enrollmentId },
      include: {
        contact: true,
        currentStep: true,
        sequence: { include: { steps: { orderBy: { order: 'asc' } } } },
      },
    });
    if (!enrollment) {
      this.logger.warn(`processStep: enrollment ${enrollmentId} no existe`);
      return;
    }
    if (enrollment.status !== 'ACTIVE') {
      this.logger.log(
        `processStep: ${enrollmentId} status=${enrollment.status} — skip`,
      );
      return;
    }
    if (!enrollment.currentStep) {
      // currentStep null → completar. Optimistic lock: solo update si
      // el enrollment sigue ACTIVE (no fue pausado/cancelado mid-flight).
      await this.prisma.sequenceEnrollment.updateMany({
        where: { id: enrollmentId, status: 'ACTIVE' },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          jobId: null,
          nextRunAt: null,
        },
      });
      return;
    }

    const step = enrollment.currentStep;
    const contact = enrollment.contact;

    // Ejecutar la acción del step.
    let execStatus: 'OK' | 'FAILED' | 'SKIPPED' = 'OK';
    let execMessage: string | null = null;
    let execError: string | null = null;
    let execMetadata: any = {};

    try {
      switch (step.kind) {
        case 'WAIT': {
          // No-op: el delay ya se aplicó al programar este job.
          break;
        }
        case 'SEND_MESSAGE': {
          const res = await this.executeSendMessage(enrollment, step);
          execStatus = res.status;
          execMessage = res.message ?? null;
          execError = res.error ?? null;
          execMetadata = res.metadata ?? {};
          break;
        }
        case 'MOVE_STAGE': {
          if (!step.moveToStageId) {
            execStatus = 'SKIPPED';
            execError = 'Step sin stage destino (probablemente borrada)';
            break;
          }
          await this.prisma.crmContact.update({
            where: { id: contact.id },
            data: {
              stageId: step.moveToStageId,
              lastActivityAt: new Date(),
            },
          });
          execMetadata = { toStageId: step.moveToStageId };
          break;
        }
        case 'ADD_TAG': {
          const newTags = Array.isArray(step.tags)
            ? (step.tags as string[])
            : [];
          if (newTags.length === 0) {
            execStatus = 'SKIPPED';
            break;
          }
          const current = Array.isArray(contact.tags)
            ? (contact.tags as string[])
            : [];
          const merged = Array.from(new Set([...current, ...newTags]));
          await this.prisma.crmContact.update({
            where: { id: contact.id },
            data: {
              tags: merged as unknown as Prisma.InputJsonValue,
              lastActivityAt: new Date(),
            },
          });
          execMetadata = { added: newTags };
          break;
        }
        case 'REMOVE_TAG': {
          const removeTags = Array.isArray(step.tags)
            ? (step.tags as string[])
            : [];
          if (removeTags.length === 0) {
            execStatus = 'SKIPPED';
            break;
          }
          const current = Array.isArray(contact.tags)
            ? (contact.tags as string[])
            : [];
          const remaining = current.filter((t) => !removeTags.includes(t));
          await this.prisma.crmContact.update({
            where: { id: contact.id },
            data: {
              tags: remaining as unknown as Prisma.InputJsonValue,
              lastActivityAt: new Date(),
            },
          });
          execMetadata = { removed: removeTags };
          break;
        }
        case 'ASSIGN_USER': {
          if (!step.assignToUserId) {
            execStatus = 'SKIPPED';
            execError = 'Sin usuario destino (probablemente borrado)';
            break;
          }
          await this.prisma.crmContact.update({
            where: { id: contact.id },
            data: {
              ownerUserId: step.assignToUserId,
              lastActivityAt: new Date(),
            },
          });
          execMetadata = { newOwnerUserId: step.assignToUserId };
          break;
        }
        case 'END': {
          // Marca COMPLETED directamente.
          await this.completeEnrollment(enrollmentId);
          await this.logExecution(enrollmentId, step, 'OK', null, null, {});
          return;
        }
      }
    } catch (e: any) {
      execStatus = 'FAILED';
      execError = e?.message ?? String(e);
    }

    await this.logExecution(
      enrollmentId,
      step,
      execStatus,
      execMessage,
      execError,
      execMetadata,
    );

    if (execStatus === 'FAILED') {
      // Optimistic lock: solo marcar FAILED si seguía ACTIVE.
      await this.prisma.sequenceEnrollment.updateMany({
        where: { id: enrollmentId, status: 'ACTIVE' },
        data: {
          status: 'FAILED',
          lastError: execError,
          jobId: null,
          nextRunAt: null,
        },
      });
      return;
    }

    // Calcular siguiente step.
    const allSteps = enrollment.sequence.steps;
    const idx = allSteps.findIndex((s) => s.id === step.id);
    const next = idx >= 0 ? allSteps[idx + 1] : null;
    if (!next) {
      await this.completeEnrollment(enrollmentId);
      return;
    }

    // Si next es WAIT, calcular delay y programar el job que VA A
    // ejecutar el WAIT (que es no-op pero loguea). currentStepId apunta
    // al WAIT.
    let delayMs = 0;
    if (next.kind === 'WAIT' && next.waitAmount && next.waitUnit) {
      delayMs = waitToMs(next.waitAmount, next.waitUnit);
    }

    const nextRunAt = new Date(Date.now() + delayMs);
    const job = await this.queue.enqueue(
      'sequence.process_step',
      { enrollmentId },
      { delay: delayMs, attempts: 1 }, // no retry — ver sequence-worker.
    );

    // Optimistic lock: solo avanzar currentStep si seguía ACTIVE.
    // Si pause/cancel cambió el status, este update afecta 0 rows y
    // el siguiente step en la queue no encontrará ACTIVE → no-op.
    const advanced = await this.prisma.sequenceEnrollment.updateMany({
      where: { id: enrollmentId, status: 'ACTIVE' },
      data: {
        currentStepId: next.id,
        nextRunAt,
        jobId: job?.id ? String(job.id) : null,
      },
    });
    // Si NO se actualizó (status cambió mid-flight), removemos el job
    // encolado para evitar que se ejecute sobre un enrollment pausado.
    if (advanced.count === 0 && job?.id) {
      await this.queue
        .removeJob('sequence.process_step', String(job.id))
        .catch(() => null);
    }
  }

  // =============================================================
  //                     INTERNALS
  // =============================================================

  /**
   * Ejecuta SEND_MESSAGE: substituye variables, llama a sendSms de Grow
   * Business si el canal es SMS o WHATSAPP. WhatsApp server-side llega
   * en F6 — por ahora usa el mismo flujo de SMS (LeadConnector).
   */
  private async executeSendMessage(
    enrollment: any,
    step: any,
  ): Promise<{
    status: 'OK' | 'FAILED' | 'SKIPPED';
    message?: string;
    error?: string;
    metadata?: any;
  }> {
    const contact = enrollment.contact;
    const phone = (contact.phone ?? '').trim();
    if (!phone) {
      return {
        status: 'FAILED',
        error: 'El contacto no tiene teléfono',
      };
    }
    const body = step.messageBody ?? '';
    if (!body) {
      return {
        status: 'SKIPPED',
        error: 'Step SEND_MESSAGE sin cuerpo',
      };
    }

    const pipeline = await this.prisma.pipeline.findUnique({
      where: { ownerUserId: enrollment.sequence.ownerUserId },
      include: { stages: true },
    });
    const stageName =
      pipeline?.stages.find((s) => s.id === contact.stageId)?.name ?? '';

    const rendered = renderTemplate(body, {
      name: contact.name,
      phone: contact.phone,
      instagram: contact.instagram,
      address: contact.address,
      pipeline: stageName,
      date: new Date().toLocaleDateString('es-CO'),
    });

    // Adjuntar URL si hay attachment. LeadConnector SMS no acepta
    // binarios — el link es lo mejor que podemos hacer.
    const finalBody = step.attachmentUrl
      ? `${rendered}\n\n${step.attachmentUrl}`
      : rendered;

    const userCreds = await this.prisma.user.findUnique({
      where: { id: enrollment.sequence.ownerUserId },
      select: { crmGbLocationId: true, crmGbApiKey: true },
    });
    if (!userCreds?.crmGbLocationId || !userCreds?.crmGbApiKey) {
      return {
        status: 'FAILED',
        error:
          'Conecta Grow Business en /affiliate/crm/integrations para enviar mensajes.',
      };
    }

    // F6: SMS vs WhatsApp según el canal del step. Default a SMS si
    // no se especificó (botones legacy creados antes de F2).
    const isWhatsApp = step.messageChannel === 'WHATSAPP';
    const sendFn = isWhatsApp
      ? this.growBusiness.sendWhatsAppWithCreds.bind(this.growBusiness)
      : this.growBusiness.sendSmsWithCreds.bind(this.growBusiness);
    const result = await sendFn(
      {
        locationId: userCreds.crmGbLocationId,
        apiKey: userCreds.crmGbApiKey,
      },
      phone,
      finalBody,
    );
    if (!result.ok) {
      return {
        status: 'FAILED',
        error:
          (result as any).message ??
          `Envío ${isWhatsApp ? 'WhatsApp' : 'SMS'} falló`,
      };
    }
    // Update lastActivityAt
    await this.prisma.crmContact.update({
      where: { id: contact.id },
      data: { lastActivityAt: new Date() },
    });
    return {
      status: 'OK',
      message: rendered,
      metadata: {
        channel: step.messageChannel,
        messageType: step.messageType,
        attachmentUrl: step.attachmentUrl,
      },
    };
  }

  private async completeEnrollment(enrollmentId: string) {
    // Optimistic lock: solo COMPLETED si seguía ACTIVE. Si pause/cancel
    // cambió el status, no sobrescribimos.
    await this.prisma.sequenceEnrollment.updateMany({
      where: { id: enrollmentId, status: 'ACTIVE' },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        currentStepId: null,
        jobId: null,
        nextRunAt: null,
      },
    });
  }

  private async logExecution(
    enrollmentId: string,
    step: { id: string; kind: SequenceStepKind },
    status: 'OK' | 'FAILED' | 'SKIPPED',
    message: string | null,
    error: string | null,
    metadata: any,
  ) {
    try {
      await this.prisma.sequenceExecution.create({
        data: {
          enrollmentId,
          stepId: step.id,
          stepKind: step.kind,
          status,
          message,
          error,
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      this.logger.warn(
        `logExecution falló para ${enrollmentId}: ${(e as Error).message}`,
      );
    }
  }

  private async assertEnrollmentOwnership(userId: string, enrollmentId: string) {
    const e = await this.prisma.sequenceEnrollment.findUnique({
      where: { id: enrollmentId },
      include: { sequence: { select: { ownerUserId: true } } },
    });
    if (!e) throw new NotFoundException('Enrollment no encontrado');
    if (e.sequence.ownerUserId !== userId) {
      throw new ForbiddenException('No tienes acceso a este enrollment');
    }
    return e;
  }

  /** Sanitiza tags a string[] (filtra null/no-string). */
  private sanitizeTags(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    return input
      .filter((t) => typeof t === 'string')
      .map((t) => (t as string).trim())
      .filter(Boolean);
  }

  private stepCreateData(s: StepInput) {
    return {
      order: s.order,
      kind: s.kind,
      messageChannel: s.messageChannel ?? null,
      messageType: s.messageType ?? null,
      messageBody: s.messageBody ?? null,
      attachmentUrl: s.attachmentUrl ?? null,
      attachmentName: s.attachmentName ?? null,
      waitAmount: s.waitAmount ?? null,
      waitUnit: s.waitUnit ?? null,
      moveToStageId: s.moveToStageId ?? null,
      tags: this.sanitizeTags(s.tags) as unknown as Prisma.InputJsonValue,
      assignToUserId: s.assignToUserId ?? null,
      nodeX: s.nodeX ?? null,
      nodeY: s.nodeY ?? null,
    };
  }
}

// ───────────── Helpers ─────────────

/**
 * Convierte (amount + unit) a milliseconds. Tope a 60 días para no
 * programar jobs absurdamente lejos.
 */
function waitToMs(amount: number, unit: SequenceWaitUnit): number {
  let ms = 0;
  switch (unit) {
    case 'MINUTES':
      ms = amount * 60 * 1000;
      break;
    case 'HOURS':
      ms = amount * 60 * 60 * 1000;
      break;
    case 'DAYS':
      ms = amount * 24 * 60 * 60 * 1000;
      break;
    case 'WEEKS':
      ms = amount * 7 * 24 * 60 * 60 * 1000;
      break;
  }
  // Tope: 60 días = 5,184,000,000 ms
  const SIXTY_DAYS = 60 * 24 * 60 * 60 * 1000;
  if (ms > SIXTY_DAYS) return SIXTY_DAYS;
  if (ms < 0) return 0;
  return ms;
}

/**
 * Substituye variables en el template. Soporta tanto {var} como {{var}}
 * (el editor del frontend usa {var} pero los tokens legacy del CRM
 * usaban {{var}}). Si la variable no tiene valor, queda vacía.
 *
 * Variables disponibles:
 *   {nombre}/{name} → contact.name
 *   {telefono}/{phone} → contact.phone
 *   {instagram} → contact.instagram
 *   {direccion}/{address} → contact.address
 *   {pipeline}/{stage} → nombre de la stage actual
 *   {fecha}/{date} → fecha de hoy DD/MM/AAAA
 */
export function renderTemplate(
  template: string,
  vars: {
    name?: string | null;
    phone?: string | null;
    instagram?: string | null;
    address?: string | null;
    pipeline?: string | null;
    date?: string | null;
  },
): string {
  if (!template) return '';
  const map: Record<string, string> = {
    nombre: vars.name ?? '',
    name: vars.name ?? '',
    telefono: vars.phone ?? '',
    teléfono: vars.phone ?? '',
    phone: vars.phone ?? '',
    instagram: vars.instagram ?? '',
    direccion: vars.address ?? '',
    dirección: vars.address ?? '',
    address: vars.address ?? '',
    pipeline: vars.pipeline ?? '',
    stage: vars.pipeline ?? '',
    fecha: vars.date ?? '',
    date: vars.date ?? '',
  };
  // Reemplaza {{var}} y {var} (en ese orden para que {{x}} no quede como "{x}").
  return template
    .replace(/\{\{\s*([\wáéíóúñ]+)\s*\}\}/gi, (_, k) =>
      map[k.toLowerCase()] ?? '',
    )
    .replace(/\{\s*([\wáéíóúñ]+)\s*\}/gi, (_, k) =>
      map[k.toLowerCase()] ?? '',
    );
}
