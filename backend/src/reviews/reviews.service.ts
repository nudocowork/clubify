import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { GrowBusinessService } from '../integrations/grow-business.service';

const DEFAULT_REVIEW_ALERT_TEMPLATE =
  '⚠️ Nueva reseña privada en {businessName}\n\n' +
  'Cliente: {customerName}\n' +
  'Teléfono: {customerPhone}\n' +
  'Calificación: {rating}/5\n\n' +
  'Comentario:\n{feedback}\n\n' +
  'Revisar en Clubify:\n{feedbackUrl}';

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
    private prisma: PrismaService,
    private growBusiness: GrowBusinessService,
  ) {}

  // ────────── Público (review filter) ────────── //

  /**
   * GET /api/public/r/:slug — datos para renderizar la página pública.
   * Devuelve sólo lo que el cliente final necesita ver: branding + URL
   * de Google. NUNCA devolvemos el feedback negativo histórico.
   */
  async getPublic(slug: string) {
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
        status: true,
      },
    });
    if (!t || t.status === 'SUSPENDED')
      throw new NotFoundException('Negocio no disponible');
    return t;
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

    const created = await this.prisma.reviewFeedback.create({
      data: {
        tenantId: t.id,
        rating,
        comment: body.comment?.trim() || null,
        customerName: body.customerName?.trim() || null,
        customerPhone: body.customerPhone?.trim() || null,
        redirectedToGoogle: redirected,
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
        brandName: true,
        slug: true,
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
    if (!creds) {
      this.log.warn(
        `[review-alert] tenant=${tenantId} enabled pero sin credenciales (ni subcuenta global ni propias)`,
      );
      return;
    }

    const feedback = await this.prisma.reviewFeedback.findUnique({
      where: { id: feedbackId },
    });
    if (!feedback) return;
    if (feedback.rating > tenant.reviewAlertsThreshold) return;

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

    // Resolver teléfono destino: override del tenant → owner.phone →
    // whatsappPhone → phone general. Si nada, abortar con log.
    let toPhone = tenant.reviewAlertsPhone?.trim() || '';
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

    const template =
      tenant.reviewAlertsTemplate?.trim() || DEFAULT_REVIEW_ALERT_TEMPLATE;
    const feedbackUrl = `https://app.soyclubify.com/app/reviews?focus=${feedback.id}`;
    const body = renderTemplate(template, {
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

  /** Lista feedback recibido + KPIs del tenant. */
  async listMine(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    const items = await this.prisma.reviewFeedback.findMany({
      where: { tenantId: tid },
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
