import { Controller, Headers, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { StripeService } from './stripe.service';
import { Public } from '../common/decorators/public.decorator';

/**
 * Webhook de Stripe por marca: cada marca con paymentGateway=STRIPE apunta su
 * endpoint de Stripe a /webhooks/stripe/<slug>. Se valida la firma contra el
 * webhookSecret CIFRADO de la marca usando el RAW body (lo stashea el json()
 * de main.ts en req.rawBody). Devuelve siempre 200 para que Stripe no reintente
 * en loop (la idempotencia y el retry los maneja nuestro lado).
 */
@Controller('webhooks/stripe')
export class StripeWebhookController {
  constructor(private stripe: StripeService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Post(':slug')
  @HttpCode(200)
  async receive(
    @Param('slug') slug: string,
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('stripe-signature') signature?: string,
  ) {
    const raw = req.rawBody;
    if (!raw) return { ok: false, action: 'no_raw_body' };
    const ctx = await this.stripe.constructEventForBrand(slug, raw, signature);
    if (!ctx) return { ok: false, action: 'invalid_signature' };
    return this.stripe.handleEvent(ctx.brand, ctx.event);
  }
}
