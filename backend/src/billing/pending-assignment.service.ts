import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { addPlanPeriod, normalizePlanPeriod } from '../common/plan-period';

export type PendingGateway = 'HOTMART' | 'STRIPE' | 'CROSS';

/**
 * Asigna un "pago sin activar" (Pending*Payment) a un negocio que YA existe.
 *
 * Existe por el caso MOTILART (2026-08-22): el comprador paga con un correo
 * distinto al de su cuenta (paga el contador, el socio, la empresa) o el
 * identificador guardado no coincide (código de suscriptor truncado), y el
 * pago recurrente cae como «comprador sin cuenta». La alerta interna dice
 * «nueva compra», al cliente le llega «crea tu cuenta» en su tercer mes, y el
 * ciclo del negocio no avanza. Esto va a seguir pasando: no es un caso raro.
 *
 * Qué hace al asignar: deja al negocio COMO SI el pago se hubiera reconocido
 * bien — enlaza los identificadores de la pasarela (el próximo cobro se
 * reconoce como RENOVACIÓN), avanza el ciclo por la periodicidad real del
 * plan y limpia los avisos del ciclo viejo.
 *
 * Qué NO hace, a propósito:
 *  - No envía NINGÚN mensaje al cliente: ya recibió lo que tenía que recibir
 *    (o de más); una «bienvenida» aquí sería otro mensaje equivocado.
 *  - No genera comisiones de afiliado: es una decisión de negocio aparte.
 */
@Injectable()
export class PendingAssignmentService {
  private readonly logger = new Logger(PendingAssignmentService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /**
   * Buscador liviano de negocios para el modal de asignación. Busca por
   * marca, nombre, slug, correo del tenant Y correo del dueño (el caso que
   * origina todo es justamente que el correo del pago no es el de la cuenta,
   * así que el admin puede buscar por cualquiera de los dos).
   */
  async searchTenants(q: string) {
    const query = (q ?? '').trim();
    if (query.length < 2) return [];
    const contains = { contains: query, mode: 'insensitive' as const };
    const tenants = await this.prisma.tenant.findMany({
      where: {
        deletedAt: null,
        isCampaignHost: false,
        OR: [
          { brandName: contains },
          { name: contains },
          { slug: contains },
          { email: contains },
          { users: { some: { role: 'TENANT_OWNER', email: contains } } },
        ],
      },
      select: {
        id: true,
        brandName: true,
        name: true,
        slug: true,
        email: true,
        status: true,
        planPeriodicity: true,
        currentPeriodEnd: true,
        lastChargeAt: true,
        whiteLabel: { select: { slug: true, name: true } },
        users: {
          where: { role: 'TENANT_OWNER' },
          select: { email: true },
          take: 1,
        },
      },
      orderBy: { brandName: 'asc' },
      take: 20,
    });
    return tenants.map((t) => ({
      id: t.id,
      brandName: t.brandName,
      name: t.name,
      slug: t.slug,
      status: t.status,
      planPeriodicity: normalizePlanPeriod(t.planPeriodicity),
      currentPeriodEnd: t.currentPeriodEnd,
      lastChargeAt: t.lastChargeAt,
      whiteLabelName: t.whiteLabel?.name ?? null,
      // El correo "de la cuenta" es el del dueño (con el que se logea); el
      // del tenant es el de contacto. Para el contraste del modal manda el
      // del dueño y caemos al de contacto si no hay owner.
      email: t.users[0]?.email ?? t.email,
    }));
  }

  /** Vista previa: qué quedaría después de asignar, sin escribir nada. */
  async preview(gateway: PendingGateway, pendingId: string, tenantId: string) {
    const r = await this.resolve(gateway, pendingId, tenantId);
    return {
      gateway,
      paymentEmail: r.paymentEmail,
      /** Cuántos pagos sin consumir del mismo comprador se aplicarán juntos
       *  (MOTILART tenía TRES: jun, jul, ago — dejar dos sueltos seguiría
       *  disparando avisos de «comprador sin cuenta»). */
      paymentsToApply: r.pendingIds.length,
      paidAt: r.lastChargeAt.toISOString(),
      nextChargeAt: r.nextChargeAt.toISOString(),
      tenant: {
        id: r.tenant.id,
        brandName: r.tenant.brandName,
        name: r.tenant.name,
        email: r.tenantEmail,
        status: r.tenant.status,
        planPeriodicity: normalizePlanPeriod(r.tenant.planPeriodicity),
        currentPeriodEnd: r.tenant.currentPeriodEnd,
      },
      emailsDiffer:
        r.paymentEmail.toLowerCase() !== r.tenantEmail.toLowerCase(),
      brandMismatch: r.brandMismatch,
    };
  }

  /**
   * Asigna el pago pendiente al negocio. Todo lo que escribe va en UNA
   * transacción: o el negocio queda entero (identificadores + ciclo + avisos
   * limpios + pendientes consumidos) o no queda nada a medias.
   */
  async assign(args: {
    gateway: PendingGateway;
    pendingId: string;
    tenantId: string;
    actorId: string | null;
  }) {
    const { gateway, pendingId, tenantId, actorId } = args;
    const r = await this.resolve(gateway, pendingId, tenantId);
    const now = new Date();

    // Snapshot ANTES de escribir: esto mueve dinero y fechas de cobro, el
    // audit log tiene que permitir reconstruir qué había.
    const before = {
      status: r.tenant.status,
      currentPeriodEnd: r.tenant.currentPeriodEnd,
      lastChargeAt: r.tenant.lastChargeAt,
      hotmartSubscriberCode: r.tenant.hotmartSubscriberCode,
      hotmartTransactionId: r.tenant.hotmartTransactionId,
      stripeCustomerId: r.tenant.stripeCustomerId,
      stripeSubscriptionId: r.tenant.stripeSubscriptionId,
    };

    await this.prisma.$transaction(async (tx) => {
      // Consumir primero y con guarda de carrera: si otro proceso (el signup
      // de /activar, o dos admins a la vez) ya consumió el pago elegido,
      // abortamos ANTES de tocar el negocio.
      const pendingDelegate =
        gateway === 'HOTMART'
          ? tx.pendingHotmartPayment
          : gateway === 'STRIPE'
            ? tx.pendingStripePayment
            : tx.pendingCrossPayment;
      const consumed = await (pendingDelegate as any).updateMany({
        where: { id: { in: r.pendingIds }, consumedAt: null },
        data: { consumedAt: now },
      });
      if (consumed.count === 0) {
        throw new BadRequestException(
          'Este pago ya fue aplicado por otro proceso. Actualiza la lista.',
        );
      }

      await tx.tenant.update({
        where: { id: r.tenant.id },
        data: {
          // Identificadores de la pasarela: son los que hacen que el
          // PRÓXIMO cobro del webhook matchee como RENOVACIÓN y no vuelva
          // a caer en «comprador sin cuenta».
          ...r.identifiers,
          status: 'ACTIVE',
          failedPaymentCount: 0,
          lastChargeAt: r.lastChargeAt,
          currentPeriodEnd: r.nextChargeAt,
          // Limpiar los avisos del ciclo viejo. Sin esto el negocio NO
          // recibe ningún recordatorio del ciclo siguiente (los crons
          // comparan estas marcas contra currentPeriodEnd y creen que ya
          // avisaron) — es el fallo mudo más probable de esta función.
          preReminder7dSentFor: null,
          preReminder3dSentFor: null,
          preReminderTodaySentFor: null,
          paymentReminderSentFor: null,
          paymentFailureNoticeSentAt: null,
          pausePendingNoticeSentAt: null,
        },
      });

      // Cross no guarda identificador de suscripción en Tenant: las
      // renovaciones se resuelven por CrossTransaction.tenantId o por el
      // email del dueño. Enlazar la transacción es lo único persistible.
      if (gateway === 'CROSS' && r.crossProviderRef) {
        await tx.crossTransaction.updateMany({
          where: { providerRef: r.crossProviderRef },
          data: { tenantId: r.tenant.id },
        });
      }
    });

    // Fuera de la transacción: AuditService es best-effort y no debe poder
    // revertir una asignación que ya se aplicó.
    await this.audit.log({
      actorId,
      tenantId: r.tenant.id,
      action: 'pending_payment.assigned_to_tenant',
      resource: `pending_${gateway.toLowerCase()}_payment:${pendingId}`,
      metadata: {
        gateway,
        pendingIds: r.pendingIds,
        paymentEmail: r.paymentEmail,
        tenantEmail: r.tenantEmail,
        before,
        after: {
          status: 'ACTIVE',
          lastChargeAt: r.lastChargeAt,
          currentPeriodEnd: r.nextChargeAt,
          ...r.identifiers,
        },
      },
    });
    this.logger.log(
      `Pago pendiente ${gateway}:${pendingId} asignado a ${r.tenant.brandName} ` +
        `(${r.tenant.id}); próximo cobro ${r.nextChargeAt.toISOString()}`,
    );

    return {
      ok: true,
      tenantId: r.tenant.id,
      brandName: r.tenant.brandName,
      statusBefore: before.status,
      lastChargeAt: r.lastChargeAt,
      currentPeriodEnd: r.nextChargeAt,
      consumedPendingIds: r.pendingIds,
      gateway,
    };
  }

  // ── Resolución compartida (preview y assign calculan EXACTAMENTE igual) ──

  private async resolve(
    gateway: PendingGateway,
    pendingId: string,
    tenantId: string,
  ) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      select: {
        id: true,
        brandName: true,
        name: true,
        email: true,
        status: true,
        planPeriodicity: true,
        currentPeriodEnd: true,
        lastChargeAt: true,
        whiteLabelId: true,
        hotmartSubscriberCode: true,
        hotmartTransactionId: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        users: {
          where: { role: 'TENANT_OWNER' },
          select: { email: true },
          take: 1,
        },
      },
    });
    if (!tenant) throw new NotFoundException('Negocio no encontrado');

    if (gateway === 'HOTMART') return this.resolveHotmart(pendingId, tenant);
    if (gateway === 'STRIPE') return this.resolveStripe(pendingId, tenant);
    return this.resolveCross(pendingId, tenant);
  }

  private async resolveHotmart(pendingId: string, tenant: TenantSnapshot) {
    const chosen = await this.prisma.pendingHotmartPayment.findUnique({
      where: { id: pendingId },
    });
    if (!chosen) throw new NotFoundException('Pago pendiente no encontrado');
    if (chosen.consumedAt) {
      throw new BadRequestException('Este pago ya fue aplicado.');
    }
    // Todos los pendientes del MISMO comprador (mismo código de suscriptor o
    // mismo correo): MOTILART acumuló tres meses de pagos sin aplicar; si
    // solo se consumiera la fila elegida, las otras seguirían generando
    // avisos de «comprador sin cuenta» y recordatorios al equipo.
    const siblings = await this.prisma.pendingHotmartPayment.findMany({
      where: {
        consumedAt: null,
        OR: [
          { email: chosen.email },
          ...(chosen.subscriberCode
            ? [{ subscriberCode: chosen.subscriberCode }]
            : []),
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    const paidAtOf = (p: (typeof siblings)[number]) => {
      const approved = (p.rawPayload as any)?.data?.purchase?.approved_date;
      return typeof approved === 'number' ? new Date(approved) : p.createdAt;
    };
    const newest = siblings.reduce((a, b) =>
      paidAtOf(b) > paidAtOf(a) ? b : a,
    );
    const lastChargeAt = paidAtOf(newest);
    // El código puede venir null en algún evento: usar el primero que exista
    // y NUNCA pisar el guardado con null.
    const subscriberCode =
      newest.subscriberCode ??
      siblings.find((s) => s.subscriberCode)?.subscriberCode ??
      undefined;
    return this.buildResolution({
      tenant,
      paymentEmail: chosen.email,
      pendingIds: siblings.map((s) => s.id),
      lastChargeAt,
      identifiers: {
        ...(subscriberCode ? { hotmartSubscriberCode: subscriberCode } : {}),
        ...(newest.transactionId
          ? { hotmartTransactionId: newest.transactionId }
          : {}),
      },
      brandMismatch: false,
    });
  }

  private async resolveStripe(pendingId: string, tenant: TenantSnapshot) {
    const chosen = await this.prisma.pendingStripePayment.findUnique({
      where: { id: pendingId },
    });
    if (!chosen) throw new NotFoundException('Pago pendiente no encontrado');
    if (chosen.consumedAt) {
      throw new BadRequestException('Este pago ya fue aplicado.');
    }
    const siblings = await this.prisma.pendingStripePayment.findMany({
      where: {
        consumedAt: null,
        OR: [
          { email: chosen.email },
          ...(chosen.stripeSubscriptionId
            ? [{ stripeSubscriptionId: chosen.stripeSubscriptionId }]
            : []),
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    const paidAtOf = (p: (typeof siblings)[number]) => {
      const created = (p.rawPayload as any)?.created;
      return typeof created === 'number' ? new Date(created * 1000) : p.createdAt;
    };
    const newest = siblings.reduce((a, b) =>
      paidAtOf(b) > paidAtOf(a) ? b : a,
    );
    const stripeCustomerId =
      newest.stripeCustomerId ??
      siblings.find((s) => s.stripeCustomerId)?.stripeCustomerId ??
      undefined;
    const stripeSubscriptionId =
      newest.stripeSubscriptionId ??
      siblings.find((s) => s.stripeSubscriptionId)?.stripeSubscriptionId ??
      undefined;
    return this.buildResolution({
      tenant,
      paymentEmail: chosen.email,
      pendingIds: siblings.map((s) => s.id),
      lastChargeAt: paidAtOf(newest),
      identifiers: {
        ...(stripeCustomerId ? { stripeCustomerId } : {}),
        ...(stripeSubscriptionId ? { stripeSubscriptionId } : {}),
      },
      brandMismatch:
        !!chosen.whiteLabelId &&
        !!tenant.whiteLabelId &&
        chosen.whiteLabelId !== tenant.whiteLabelId,
    });
  }

  private async resolveCross(pendingId: string, tenant: TenantSnapshot) {
    const chosen = await this.prisma.pendingCrossPayment.findUnique({
      where: { id: pendingId },
    });
    if (!chosen) throw new NotFoundException('Pago pendiente no encontrado');
    if (chosen.consumedAt) {
      throw new BadRequestException('Este pago ya fue aplicado.');
    }
    // Cross no tiene identificador de suscripción: agrupar por correo dentro
    // de la misma marca (las tablas Cross están aisladas por whiteLabelId).
    const siblings = await this.prisma.pendingCrossPayment.findMany({
      where: {
        consumedAt: null,
        email: chosen.email,
        whiteLabelId: chosen.whiteLabelId,
      },
      orderBy: { createdAt: 'asc' },
    });
    const newest = siblings.reduce((a, b) =>
      b.createdAt > a.createdAt ? b : a,
    );
    return this.buildResolution({
      tenant,
      paymentEmail: chosen.email,
      pendingIds: siblings.map((s) => s.id),
      lastChargeAt: newest.createdAt,
      identifiers: {},
      crossProviderRef: newest.providerRef ?? null,
      brandMismatch:
        !!chosen.whiteLabelId &&
        !!tenant.whiteLabelId &&
        chosen.whiteLabelId !== tenant.whiteLabelId,
    });
  }

  private buildResolution(args: {
    tenant: TenantSnapshot;
    paymentEmail: string;
    pendingIds: string[];
    lastChargeAt: Date;
    identifiers: Record<string, string>;
    crossProviderRef?: string | null;
    brandMismatch: boolean;
  }) {
    return {
      tenant: args.tenant,
      tenantEmail: args.tenant.users[0]?.email ?? args.tenant.email,
      paymentEmail: args.paymentEmail,
      pendingIds: args.pendingIds,
      lastChargeAt: args.lastChargeAt,
      // Periodicidad REAL del plan (1/3/6/12 meses de calendario, fin de mes
      // acotado) — jamás 30 días fijos: un anual con +30 se suspendería con
      // once meses ya pagados.
      nextChargeAt: addPlanPeriod(args.lastChargeAt, args.tenant.planPeriodicity),
      identifiers: args.identifiers,
      crossProviderRef: args.crossProviderRef ?? null,
      brandMismatch: args.brandMismatch,
    };
  }
}

type TenantSnapshot = {
  id: string;
  brandName: string;
  name: string;
  email: string;
  status: string;
  planPeriodicity: string | null;
  currentPeriodEnd: Date | null;
  lastChargeAt: Date | null;
  whiteLabelId: string | null;
  hotmartSubscriberCode: string | null;
  hotmartTransactionId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  users: { email: string }[];
};
