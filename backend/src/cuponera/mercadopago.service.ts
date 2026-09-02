import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHmac } from 'crypto';
import { BenefitCampaign } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { CuponeraService } from './cuponera.service';
import { MembershipBillingService } from './membership-billing.service';
import { decryptSecret, encryptSecret } from '../common/crypto/secret-box';

const MP_API = 'https://api.mercadopago.com';

type MpCfg = { accessToken: string; publicKey?: string | null; webhookSecret?: string | null };

/**
 * MercadoPago — suscripción recurrente (preapproval) para las membresías Living
 * Card. Calcado del patrón Stripe (config cifrada por marca, webhook con dedup,
 * activación al pago). "Preparado sin credenciales": si la campaña no tiene
 * Access Token configurado (ni env), el checkout y el webhook degradan sin error.
 * Credenciales: campaign.config.mp (cifradas) con fallback a env MERCADOPAGO_*.
 */
@Injectable()
export class MercadoPagoService {
  private logger = new Logger(MercadoPagoService.name);

  constructor(
    private prisma: PrismaService,
    private cuponera: CuponeraService,
    // Mismo módulo → inyección directa, sin el ModuleRef que necesitan los
    // webhooks de Hotmart/Stripe (que viven en BillingModule).
    private membresias: MembershipBillingService,
  ) {}

  private publicBaseUrl(): string {
    return (process.env.CUPONERA_PUBLIC_URL || 'https://cuponera.soyclubify.com').replace(/\/+$/, '');
  }

  private async getMpConfig(campaign: BenefitCampaign): Promise<MpCfg | null> {
    const mp = ((campaign.config as any)?.mp || {}) as Record<string, string | null>;
    let accessToken = '';
    if (mp.accessToken) {
      try {
        accessToken = decryptSecret(mp.accessToken);
      } catch {
        accessToken = '';
      }
    }
    if (!accessToken) accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN || '';
    if (!accessToken) return null;
    let webhookSecret: string | null = null;
    if (mp.webhookSecret) {
      try {
        webhookSecret = decryptSecret(mp.webhookSecret);
      } catch {
        webhookSecret = null;
      }
    }
    if (!webhookSecret) webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET || null;
    return { accessToken, publicKey: mp.publicKey ?? null, webhookSecret };
  }

  /** Guarda (cifra) las credenciales MP en la config de la campaña.
   *
   *  `target` llega cuando la llamada viene del panel, que ya resolvió QUÉ
   *  cuponera puede tocar este usuario. Sin él cae en la primera, que es lo que
   *  hacía siempre para el Master Admin. Las credenciales viven en la config de
   *  cada campaña, así que sin esto una cuponera nueva no podía cobrar. */
  async setConfig(
    dto: { accessToken?: string; publicKey?: string; webhookSecret?: string },
    target?: BenefitCampaign,
  ) {
    const campaign = target ?? (await this.cuponera.ensureLivingCampaign());
    const cfg = ((campaign.config as any) || {}) as Record<string, any>;
    cfg.mp = cfg.mp || {};
    if (dto.accessToken !== undefined)
      cfg.mp.accessToken = dto.accessToken ? encryptSecret(dto.accessToken) : null;
    if (dto.webhookSecret !== undefined)
      cfg.mp.webhookSecret = dto.webhookSecret ? encryptSecret(dto.webhookSecret) : null;
    if (dto.publicKey !== undefined) cfg.mp.publicKey = dto.publicKey || null;
    await this.prisma.benefitCampaign.update({
      where: { id: campaign.id },
      data: { config: cfg as any },
    });
    return { ok: true, configured: !!cfg.mp.accessToken };
  }

  /** Estado de MP. `target` viene del panel, ya resuelto por permisos; sin él,
   *  la primera cuponera (el comportamiento del Master Admin de siempre). */
  async status(target?: BenefitCampaign) {
    const campaign = target ?? (await this.cuponera.ensureLivingCampaign());
    const mp = await this.getMpConfig(campaign);
    return {
      configured: !!mp,
      webhookUrl: `${(process.env.API_PUBLIC_URL || 'https://api.soyclubify.com').replace(/\/+$/, '')}/api/webhooks/mercadopago/${campaign.slug}`,
    };
  }

  /**
   * Inicia una suscripción: crea la orden PENDING y el preapproval en MP.
   * Devuelve el init_point para redirigir al checkout de MercadoPago.
   */
  async createSubscription(input: {
    planId: string;
    fullName: string;
    phone: string;
    email: string;
  }) {
    const campaign = await this.cuponera.ensureLivingCampaign();
    const mp = await this.getMpConfig(campaign);
    if (!mp) throw new BadRequestException('MercadoPago no está configurado todavía.');

    const plan = await this.prisma.membershipPlan.findFirst({
      where: { id: input.planId, campaignId: campaign.id, isActive: true },
    });
    if (!plan) throw new NotFoundException('Plan no encontrado');

    const email = (input.email || '').trim().toLowerCase();
    if (!email) throw new BadRequestException('Email requerido para el pago');
    if ((input.phone || '').replace(/\D/g, '').length < 8) {
      throw new BadRequestException('Teléfono inválido');
    }

    const order = await this.prisma.membershipOrder.create({
      data: {
        campaignId: campaign.id,
        planId: plan.id,
        email,
        amountCents: plan.priceCents,
        currency: plan.currency,
        status: 'PENDING',
        provider: 'MERCADOPAGO',
        rawPayload: {
          subscriber: { fullName: input.fullName, phone: input.phone, email },
        } as any,
      },
    });

    // COP no tiene decimales → transaction_amount = pesos. Otras monedas: /100.
    const amount = plan.currency === 'COP' ? plan.priceCents : plan.priceCents / 100;
    const body = {
      reason: `${campaign.name} — ${plan.name}`,
      external_reference: order.id,
      payer_email: email,
      back_url: `${this.publicBaseUrl()}/cuponera/mi-tarjeta`,
      auto_recurring: {
        frequency: plan.interval === 'ANNUAL' ? 12 : 1,
        frequency_type: 'months',
        transaction_amount: amount,
        currency_id: plan.currency,
      },
      status: 'pending',
    };

    const res = await fetch(`${MP_API}/preapproval`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mp.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      this.logger.warn(`MP preapproval error (${res.status}): ${JSON.stringify(j)}`);
      throw new BadRequestException('No se pudo iniciar el pago con MercadoPago.');
    }

    await this.prisma.membershipOrder.update({
      where: { id: order.id },
      data: {
        providerRef: j.id ?? null,
        rawPayload: { ...(order.rawPayload as any), preapproval: j } as any,
      },
    });

    return { orderId: order.id, initPoint: j.init_point || j.sandbox_init_point || null };
  }

  /** Verifica la firma x-signature de MP (best-effort). Si no hay secret
   *  configurado, no bloquea (retorna true). */
  private verifySignature(
    secret: string | null | undefined,
    headers: Record<string, any>,
    dataId: string,
  ): boolean {
    if (!secret) return true;
    const sig = (headers['x-signature'] || headers['X-Signature'] || '') as string;
    const requestId = (headers['x-request-id'] || headers['X-Request-Id'] || '') as string;
    if (!sig) return false;
    const parts = Object.fromEntries(
      sig.split(',').map((p) => {
        const [k, v] = p.split('=');
        return [k?.trim(), v?.trim()];
      }),
    ) as Record<string, string>;
    const ts = parts['ts'];
    const v1 = parts['v1'];
    if (!ts || !v1) return false;
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const expected = createHmac('sha256', secret).update(manifest).digest('hex');
    return expected === v1;
  }

  /**
   * Webhook de MercadoPago. Idempotente (MercadopagoWebhookEvent.eventId único).
   * Al confirmar un preapproval 'authorized', marca la orden PAID y da de alta
   * al miembro (emite su tarjeta).
   */
  async handleWebhook(
    slug: string,
    rawBody: Buffer | undefined,
    headers: Record<string, any>,
    query: Record<string, any>,
  ) {
    const campaign =
      (await this.prisma.benefitCampaign.findUnique({ where: { slug } })) ??
      (await this.cuponera.ensureLivingCampaign());
    const mp = await this.getMpConfig(campaign);
    if (!mp) return { ok: true, action: 'not_configured' };

    let body: any = {};
    try {
      body = rawBody && rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {};
    } catch {
      body = {};
    }

    const type = String(body.type || query.type || query.topic || '');
    const dataId = String(body?.data?.id || query['data.id'] || query.id || '');
    if (!dataId) return { ok: true, action: 'no_data_id' };

    if (!this.verifySignature(mp.webhookSecret, headers, dataId)) {
      this.logger.warn(`MP webhook: firma inválida (data.id=${dataId})`);
      // No configurado estricto → registramos pero seguimos; con secret real,
      // se puede endurecer a return { ok:false }.
    }

    // Dedup + auditoría.
    const eventId = `${type || 'unknown'}:${dataId}`;
    try {
      await this.prisma.mercadopagoWebhookEvent.create({
        data: {
          eventId,
          eventType: type || 'unknown',
          campaignId: campaign.id,
          payload: body as any,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') return { ok: true, action: 'duplicate' };
    }

    // Cobro recurrente de una suscripción ya activa (spec §25: "renovación").
    // Antes caía en 'ignored': la membresía se activaba al primer pago y después
    // vencía sin que ningún webhook corriera la fecha, aunque el socio siguiera
    // pagando todos los meses.
    if (type.includes('subscription_authorized_payment')) {
      const r = await fetch(`${MP_API}/authorized_payments/${dataId}`, {
        headers: { Authorization: `Bearer ${mp.accessToken}` },
      });
      const ap: any = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: true, action: 'fetch_failed' };
      const preapprovalId = ap.preapproval_id ? String(ap.preapproval_id) : null;
      const estado = String(ap.status || ap.payment?.status || '');
      if (estado === 'approved' || estado === 'processed') {
        return {
          ok: true,
          action: await this.membresias.renew({
            provider: 'MERCADOPAGO',
            ref: preapprovalId,
            until: ap.next_payment_date ? new Date(ap.next_payment_date) : null,
            transactionRef: String(ap.payment?.id ?? dataId),
          }),
        };
      }
      return {
        ok: true,
        action: await this.membresias.paymentFailed({
          provider: 'MERCADOPAGO',
          ref: preapprovalId,
          reason: `mp_${estado || 'rejected'}`,
        }),
      };
    }

    if (!type.includes('preapproval')) return { ok: true, action: 'ignored' };

    // Confirmamos el estado real consultando el preapproval.
    const res = await fetch(`${MP_API}/preapproval/${dataId}`, {
      headers: { Authorization: `Bearer ${mp.accessToken}` },
    });
    const pre: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: true, action: 'fetch_failed' };

    // Baja: cancelada por el socio o pausada por falta de pago (spec §25).
    // Antes solo se miraba 'authorized', así que una cancelación en MercadoPago
    // no cortaba absolutamente nada y la tarjeta seguía canjeando.
    if (pre.status === 'cancelled' || pre.status === 'paused') {
      return {
        ok: true,
        action: await this.membresias.deactivate({
          provider: 'MERCADOPAGO',
          ref: dataId,
          reason: `mp_${pre.status}`,
        }),
      };
    }
    if (pre.status !== 'authorized') return { ok: true, action: `status_${pre.status}` };

    // Reautorización de una membresía que ya existe → renovar, no dar de alta.
    const yaEs = await this.prisma.livingMembership.findFirst({
      where: { providerRef: dataId },
      select: { id: true },
    });
    if (yaEs) {
      return {
        ok: true,
        action: await this.membresias.renew({
          provider: 'MERCADOPAGO',
          ref: dataId,
          until: pre.next_payment_date ? new Date(pre.next_payment_date) : null,
        }),
      };
    }

    const orderId = pre.external_reference as string | undefined;
    const order = orderId
      ? await this.prisma.membershipOrder.findUnique({ where: { id: orderId } })
      : null;
    if (!order) return { ok: true, action: 'order_not_found' };

    const sub = ((order.rawPayload as any)?.subscriber || {}) as {
      fullName?: string;
      phone?: string;
    };

    await this.prisma.membershipOrder.update({
      where: { id: order.id },
      data: { status: 'PAID', providerRef: dataId },
    });

    await this.cuponera.enrollMember({
      campaignId: order.campaignId,
      fullName: sub.fullName || order.email,
      phone: sub.phone || '',
      email: order.email,
      planId: order.planId,
      source: 'MERCADOPAGO',
      provider: 'MERCADOPAGO',
      providerRef: dataId,
      mp: {
        preapprovalId: dataId,
        payerId: pre.payer_id != null ? String(pre.payer_id) : undefined,
        expiresAt: pre.next_payment_date,
      },
    });

    return { ok: true, action: 'activated' };
  }
}
