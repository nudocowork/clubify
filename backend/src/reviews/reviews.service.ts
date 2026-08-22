import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { WhitelabelBrandService } from '../whitelabel/whitelabel-brand.service';
import {
  brandAppUrl,
  BRAND_DOMAIN_SELECT,
} from '../email/brand-email-creds.util';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { GrowBusinessService } from '../integrations/grow-business.service';
import { brandGrowCreds, BRAND_GROW_SELECT } from '../integrations/brand-sms-creds.util';
import {
  REVIEW_ALERT_DEFAULT,
  resolveBrandTemplateText,
} from '../integrations/brand-message-templates';

const DEFAULT_REVIEW_ALERT_TEMPLATE = REVIEW_ALERT_DEFAULT;

function renderTemplate(
  tpl: string,
  vars: Record<string, string>,
): string {
  return tpl.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
}

@Injectable()
export class ReviewsService {
  private readonly log = new Logger(ReviewsService.name);

  constructor(
    private brands: WhitelabelBrandService,
    private prisma: PrismaService,
    private growBusiness: GrowBusinessService,
  ) {}

  // ────────── Público (review filter) ────────── //

  /**
   * GET /api/public/r/:slug — datos para renderizar la página pública.
   * Devuelve sólo lo que el cliente final necesita ver: branding + URL
   * de Google. NUNCA devolvemos el feedback negativo histórico.
   */
  async getPublic(slug: string, targetId?: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        brandName: true,
        logoUrl: true,
        primaryColor: true,
        secondaryColor: true,
        whatsappPhone: true,
        googleReviewUrl: true,
        reviewAlertsThreshold: true,
        whatsappFeedbackEnabled: true,
        whatsappFeedbackNumber: true,
        whatsappFeedbackMessage: true,
        status: true,
      },
    });
    if (!t || t.status === 'SUSPENDED')
      throw new NotFoundException('Negocio no disponible');

    // M7.3: si vino un targetId, lo resolvemos y usamos su googleUrl +
    // threshold + nombre. Validamos que pertenezca al tenant del slug
    // para evitar que alguien pase un targetId de otro tenant.
    let target: {
      id: string;
      name: string;
      googleReviewUrl: string;
      threshold: number;
      locationName: string | null;
    } | null = null;
    if (targetId) {
      const tg = await this.prisma.reviewQrTarget.findFirst({
        where: { id: targetId, tenantId: t.id, isActive: true },
        include: { location: { select: { name: true } } },
      });
      if (tg) {
        target = {
          id: tg.id,
          name: tg.name,
          googleReviewUrl: tg.googleReviewUrl,
          threshold: tg.threshold,
          locationName: tg.location?.name ?? null,
        };
      }
    }

    // Marca del negocio para el pie de la página. La ve el CLIENTE FINAL: un
    // «Powered by Clubify» en la página de reseñas de un negocio Sellea delata
    // la plataforma delante del cliente de otro. Se resuelve desde
    // `tenant.whiteLabelId`, nunca desde una constante.
    const brand = await this.brands.resolveTenant(t.id).catch(() => null);

    return {
      ...t,
      brand,
      // Si hay target activo, sus valores ganan sobre los del tenant.
      googleReviewUrl: target?.googleReviewUrl ?? t.googleReviewUrl,
      threshold: target?.threshold ?? 4,
      target,
      // Solo exponemos el número del WhatsApp feedback si está habilitado
      // y tiene número. Sino, frontend no muestra el botón.
      whatsappFeedbackEnabled:
        !!(t.whatsappFeedbackEnabled && t.whatsappFeedbackNumber?.trim()),
    };
  }

  /**
   * POST /api/public/r/:slug/submit — guarda el feedback. Si rating ≥ 4
   * marcamos `redirectedToGoogle = true` para que el panel del dueño
   * sepa que esa "review" pasó a Google y no se quedó privada.
   */
  async submitPublic(
    slug: string,
    body: {
      rating: number;
      comment?: string;
      customerName?: string;
      customerPhone?: string;
      redirectedToGoogle?: boolean;
      reviewTargetId?: string;
    },
  ) {
    const t = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, status: true },
    });
    if (!t || t.status === 'SUSPENDED')
      throw new NotFoundException('Negocio no disponible');

    const rating = Math.max(1, Math.min(5, Math.floor(body.rating)));
    const redirected = !!body.redirectedToGoogle;

    // M7.3: validar que el target (si vino) pertenezca al tenant y siga
    // ACTIVO. Si no, lo descartamos silencioso para no romper el flujo
    // del cliente.
    //
    // HOTFIX 2026-06-05 (bug H): agregamos `isActive: true` para que el
    // POST no persista un targetId inactivo. Sin esto, el GET ya filtra
    // inactivos (cliente recibe link genérico) pero el POST sí los aceptaba
    // → SMS de alerta disparaba con threshold del target viejo que el
    // dueño ya había desactivado.
    let validTargetId: string | null = null;
    if (body.reviewTargetId) {
      const tg = await this.prisma.reviewQrTarget.findFirst({
        where: { id: body.reviewTargetId, tenantId: t.id, isActive: true },
        select: { id: true },
      });
      if (tg) validTargetId = tg.id;
    }

    const created = await this.prisma.reviewFeedback.create({
      data: {
        tenantId: t.id,
        rating,
        comment: body.comment?.trim() || null,
        customerName: body.customerName?.trim() || null,
        customerPhone: body.customerPhone?.trim() || null,
        redirectedToGoogle: redirected,
        reviewTargetId: validTargetId,
      },
      select: { id: true, createdAt: true },
    });

    // Fire-and-forget — el SMS no debe bloquear la respuesta al cliente.
    // Errores se loguean y se registran como evento review.sms_alert_failed.
    if (!redirected) {
      this.maybeNotifyReviewAlert(t.id, created.id).catch((e) => {
        this.log.warn(
          `[review-alert] notify failed feedback=${created.id} err=${e?.message}`,
        );
      });
    }

    return created;
  }

  /** Si el tenant tiene reviewAlertsEnabled y el rating cae dentro del
   *  threshold, manda un SMS via Grow Business y registra un evento.
   *  Idempotente por feedbackId: si ya hay un evento sms_alert_sent para
   *  ese feedback, no reenvía. */
  private async maybeNotifyReviewAlert(tenantId: string, feedbackId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        whiteLabelId: true,
        brandName: true,
        slug: true,
        whiteLabel: {
          select: { name: true, ...BRAND_GROW_SELECT, ...BRAND_DOMAIN_SELECT },
        },
        phone: true,
        whatsappPhone: true,
        reviewAlertsEnabled: true,
        reviewAlertsThreshold: true,
        reviewAlertsPhone: true,
        reviewAlertsTemplate: true,
        reviewAlertsAccountId: true,
        growBusinessLocationId: true,
        growBusinessApiKey: true,
        growBusinessSwitchNumber: true,
      },
    });
    if (!tenant) return;
    if (!tenant.reviewAlertsEnabled) return;

    // Prioridad de creds para SMS:
    //   1) Subcuenta global asignada (reviewAlertsAccountId) — permite
    //      que el super admin conecte una sola Grow Business y la use
    //      para alertas de varios negocios.
    //   2) Credenciales propias del tenant — comportamiento legacy.
    let creds: {
      locationId: string;
      apiKey: string;
      switchNumber: number | null;
    } | null = null;
    if (tenant.reviewAlertsAccountId) {
      const account = await this.prisma.growBusinessAccount.findFirst({
        where: { id: tenant.reviewAlertsAccountId, deletedAt: null },
        select: { locationId: true, apiKey: true, switchNumber: true },
      });
      if (account) {
        creds = {
          locationId: account.locationId,
          apiKey: account.apiKey,
          switchNumber: account.switchNumber,
        };
      }
    }
    if (!creds && tenant.growBusinessLocationId && tenant.growBusinessApiKey) {
      creds = {
        locationId: tenant.growBusinessLocationId,
        apiKey: tenant.growBusinessApiKey,
        switchNumber: tenant.growBusinessSwitchNumber,
      };
    }
    // Capa MARCA: subcuenta GHL de la marca blanca (nunca la de Clubify).
    if (!creds) creds = brandGrowCreds(tenant.whiteLabel);
    if (!creds) {
      this.log.warn(
        `[review-alert] tenant=${tenantId} enabled pero sin credenciales (ni subcuenta global ni propias ni de la marca)`,
      );
      return;
    }

    const feedback = await this.prisma.reviewFeedback.findUnique({
      where: { id: feedbackId },
      include: { reviewTarget: { include: { location: true } } },
    });
    if (!feedback) return;
    // HOTFIX 2026-06-05 (Fase 8 follow-up): si el feedback tiene
    // reviewTarget, su threshold gana sobre tenant.reviewAlertsThreshold
    // para decidir si dispara SMS. Sino el dueño puede quedarse sin
    // enterarse de ratings que el frontend marcó como negativos (porque
    // estaban abajo del threshold del target) pero arriba del threshold
    // global de alertas. Regla: si NO fue a Google (rating < target
    // threshold), el dueño quiere enterarse — eso es lo que el target
    // explícitamente filtra como "para revisar privado".
    const effectiveSmsThreshold = feedback.reviewTarget
      ? feedback.reviewTarget.threshold - 1
      : tenant.reviewAlertsThreshold;
    if (feedback.rating > effectiveSmsThreshold) return;

    // Idempotencia: si ya mandamos alerta para este feedback, no
    // reintentamos (caso reintentos del cliente).
    const existing = await this.prisma.event.findFirst({
      where: {
        tenantId,
        type: 'review.sms_alert_sent',
        payload: { path: ['feedbackId'], equals: feedbackId },
      },
      select: { id: true },
    });
    if (existing) return;

    // #3: si la reseña vino por el QR de una SEDE con administrador propio,
    // la alerta va a ESE teléfono (no al general del negocio).
    const locationAdminPhone = feedback.reviewTarget?.location?.adminPhone?.trim();
    // Resolver teléfono destino: admin de sede → override del tenant →
    // owner.phone → whatsappPhone → phone general. Si nada, abortar con log.
    let toPhone = locationAdminPhone || tenant.reviewAlertsPhone?.trim() || '';
    if (!toPhone) {
      const owner = await this.prisma.user.findFirst({
        where: { tenantId, role: 'TENANT_OWNER' },
        select: { phone: true },
      });
      toPhone =
        owner?.phone?.trim() ||
        tenant.whatsappPhone?.trim() ||
        tenant.phone?.trim() ||
        '';
    }
    if (!toPhone) {
      this.log.warn(`[review-alert] tenant=${tenantId} sin teléfono destino`);
      await this.prisma.event.create({
        data: {
          tenantId,
          type: 'review.sms_alert_failed',
          payload: {
            feedbackId,
            reason: 'no_destination_phone',
          },
        },
      });
      return;
    }

    // Precedencia: plantilla propia del negocio > override de la marca
    // (Master Admin → Automatizaciones) > default del catálogo.
    const template =
      tenant.reviewAlertsTemplate?.trim() ||
      (await resolveBrandTemplateText(
        this.prisma,
        'op_review_alert',
        tenant.whiteLabelId,
      )) ||
      DEFAULT_REVIEW_ALERT_TEMPLATE;
    // El enlace va al panel de SU marca. Estaba escrito a mano con
    // `app.soyclubify.com`: el texto decía «Revisar en Sellea» y el enlace era
    // de Clubify, y WhatsApp pinta la vista previa del dominio — al dueño de un
    // negocio Sellea le llegaba una tarjeta con el logo de Clubify.
    const feedbackUrl = `${brandAppUrl(
      tenant.whiteLabel,
      process.env.APP_URL ?? 'https://app.soyclubify.com',
    )}/app/reviews?focus=${feedback.id}`;
    const body = renderTemplate(template, {
      platform: tenant.whiteLabel?.name?.trim() || 'Clubify',
      businessName: tenant.brandName || tenant.slug,
      storeName: tenant.brandName || tenant.slug,
      customerName: feedback.customerName || 'Anónimo',
      customerPhone: feedback.customerPhone || '—',
      rating: String(feedback.rating),
      feedback: feedback.comment || '(sin comentario)',
      date: feedback.createdAt.toISOString().slice(0, 16).replace('T', ' '),
      feedbackUrl,
    });

    const result = await this.growBusiness.sendSmsWithCreds(
      creds,
      toPhone,
      body,
    );

    await this.prisma.event.create({
      data: {
        tenantId,
        type: result.ok ? 'review.sms_alert_sent' : 'review.sms_alert_failed',
        payload: {
          feedbackId,
          toPhone,
          rating: feedback.rating,
          ok: result.ok,
          response: result.ok
            ? { id: (result as any).id }
            : { status: (result as any).status, message: (result as any).message },
        },
      },
    });
  }

  // ────────── Panel del tenant ────────── //

  private tid(user: AuthUser, override?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!override) throw new ForbiddenException('tenantId required');
      return override;
    }
    if (!user.tenantId) throw new ForbiddenException();
    return user.tenantId;
  }

  /** Lista feedback recibido + KPIs del tenant. Soporta filtro por
   *  sede vía `targetId` (Bloque H 2026-06-12). Si targetId='' o no se
   *  pasa, retorna todas las sedes consolidadas. */
  async listMine(user: AuthUser, override?: string, targetId?: string) {
    const tid = this.tid(user, override);
    const items = await this.prisma.reviewFeedback.findMany({
      where: {
        tenantId: tid,
        ...(targetId ? { reviewTargetId: targetId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    let count1 = 0,
      count2 = 0,
      count3 = 0,
      count4 = 0,
      count5 = 0,
      goneToGoogle = 0,
      avgSum = 0,
      avgN = 0,
      unread = 0;
    for (const f of items) {
      if (f.rating === 1) count1++;
      else if (f.rating === 2) count2++;
      else if (f.rating === 3) count3++;
      else if (f.rating === 4) count4++;
      else if (f.rating === 5) count5++;
      if (f.redirectedToGoogle) goneToGoogle++;
      avgSum += f.rating;
      avgN++;
      if (!f.isRead && !f.redirectedToGoogle) unread++;
    }

    return {
      items,
      stats: {
        total: items.length,
        avg: avgN > 0 ? Math.round((avgSum / avgN) * 10) / 10 : null,
        unread,
        goneToGoogle,
        privateCount: items.length - goneToGoogle,
        ratings: { '1': count1, '2': count2, '3': count3, '4': count4, '5': count5 },
      },
    };
  }

  async markRead(user: AuthUser, id: string) {
    const f = await this.prisma.reviewFeedback.findUnique({ where: { id } });
    if (!f) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && f.tenantId !== user.tenantId)
      throw new ForbiddenException();
    return this.prisma.reviewFeedback.update({
      where: { id },
      data: { isRead: true },
    });
  }

  async remove(user: AuthUser, id: string) {
    const f = await this.prisma.reviewFeedback.findUnique({ where: { id } });
    if (!f) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && f.tenantId !== user.tenantId)
      throw new ForbiddenException();
    await this.prisma.reviewFeedback.delete({ where: { id } });
    return { ok: true };
  }

  // ────────── M7.3: ReviewQrTarget CRUD ────────── //

  /** Lista todos los targets del tenant con conteo de feedback recibido. */
  async listTargets(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    return this.prisma.reviewQrTarget.findMany({
      where: { tenantId: tid },
      include: {
        location: { select: { id: true, name: true } },
        _count: { select: { feedbacks: true } },
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createTarget(
    user: AuthUser,
    body: {
      name: string;
      address?: string | null;
      googleReviewUrl: string;
      locationId?: string | null;
      threshold?: number;
      isActive?: boolean;
      position?: number;
    },
    override?: string,
  ) {
    const tid = this.tid(user, override);
    // Validamos que la location (si vino) pertenezca al tenant.
    if (body.locationId) {
      const loc = await this.prisma.location.findFirst({
        where: { id: body.locationId, tenantId: tid },
        select: { id: true },
      });
      if (!loc) {
        throw new NotFoundException('Sede no encontrada para este tenant');
      }
    }
    // Límite de sedes por tenant — más de 20 es un caso real raro y
    // sin esto un script malicioso podría llenar la tabla.
    const count = await this.prisma.reviewQrTarget.count({
      where: { tenantId: tid },
    });
    if (count >= 20) {
      throw new BadRequestException(
        'Máximo 20 sedes por negocio. Desactiva alguna antes de crear nuevas.',
      );
    }
    // Si no vino position, la mandamos al final.
    let position = body.position;
    if (position === undefined) {
      const last = await this.prisma.reviewQrTarget.findFirst({
        where: { tenantId: tid },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      position = (last?.position ?? -1) + 1;
    }
    return this.prisma.reviewQrTarget.create({
      data: {
        tenantId: tid,
        name: body.name.trim(),
        address: body.address?.trim() || null,
        googleReviewUrl: body.googleReviewUrl.trim(),
        locationId: body.locationId ?? null,
        threshold: Math.max(1, Math.min(5, body.threshold ?? 4)),
        isActive: body.isActive ?? true,
        position,
      },
    });
  }

  async updateTarget(
    user: AuthUser,
    id: string,
    body: Partial<{
      name: string;
      address: string | null;
      googleReviewUrl: string;
      locationId: string | null;
      threshold: number;
      isActive: boolean;
      position: number;
    }>,
  ) {
    const tid = this.tid(user, undefined);
    const existing = await this.prisma.reviewQrTarget.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && existing.tenantId !== tid) {
      throw new ForbiddenException();
    }
    if (body.locationId) {
      const loc = await this.prisma.location.findFirst({
        where: { id: body.locationId, tenantId: existing.tenantId },
        select: { id: true },
      });
      if (!loc) {
        throw new NotFoundException('Sede no encontrada para este tenant');
      }
    }
    return this.prisma.reviewQrTarget.update({
      where: { id },
      data: {
        name: body.name?.trim() ?? undefined,
        address:
          body.address === undefined ? undefined : body.address?.trim() || null,
        googleReviewUrl: body.googleReviewUrl?.trim() ?? undefined,
        locationId: body.locationId === undefined ? undefined : body.locationId,
        threshold:
          body.threshold === undefined
            ? undefined
            : Math.max(1, Math.min(5, body.threshold)),
        isActive: body.isActive ?? undefined,
        position: body.position ?? undefined,
      },
    });
  }

  /** Reorder masivo desde drag-and-drop. Valida que TODOS los IDs
   *  pertenezcan al tenant del caller para evitar que alguien reordene
   *  targets de otro negocio. */
  async reorderTargets(
    user: AuthUser,
    items: Array<{ id: string; position: number }>,
  ) {
    if (!items.length) return { ok: true };
    const ids = items.map((i) => i.id);
    const found = await this.prisma.reviewQrTarget.findMany({
      where: { id: { in: ids } },
      select: { id: true, tenantId: true },
    });
    if (found.length !== ids.length) {
      throw new NotFoundException('Alguna sede no existe');
    }
    if (user.role !== 'SUPER_ADMIN') {
      const tid = user.tenantId;
      if (!tid) throw new ForbiddenException();
      if (found.some((f) => f.tenantId !== tid)) {
        throw new ForbiddenException();
      }
    }
    await this.prisma.$transaction(
      items.map((it) =>
        this.prisma.reviewQrTarget.update({
          where: { id: it.id },
          data: { position: it.position },
        }),
      ),
    );
    return { ok: true };
  }

  /** Lista pública para el selector multi-sede del /r/<slug>.
   *  Devuelve solo sedes activas, sin info sensible. */
  async listPublicForSlug(slug: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, status: true },
    });
    if (!t || t.status === 'SUSPENDED') {
      throw new NotFoundException('Negocio no disponible');
    }
    const items = await this.prisma.reviewQrTarget.findMany({
      where: { tenantId: t.id, isActive: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        address: true,
        googleReviewUrl: true,
        threshold: true,
      },
    });
    return items;
  }

  async deleteTarget(user: AuthUser, id: string) {
    const tid = this.tid(user, undefined);
    const existing = await this.prisma.reviewQrTarget.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && existing.tenantId !== tid) {
      throw new ForbiddenException();
    }
    await this.prisma.reviewQrTarget.delete({ where: { id } });
    return { ok: true };
  }

  /** Últimos 50 eventos review.sms_alert_* del tenant — para que el super
   *  admin audite envíos desde /admin/tenants/[id]. */
  async listReviewAlertLogs(tenantId: string) {
    const events = await this.prisma.event.findMany({
      where: {
        tenantId,
        type: { in: ['review.sms_alert_sent', 'review.sms_alert_failed'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return events;
  }
}
