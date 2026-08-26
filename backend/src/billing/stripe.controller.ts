import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { StripeService } from './stripe.service';
import { Public } from '../common/decorators/public.decorator';

/**
 * Webhook de Stripe por marca: cada marca con paymentGateway=STRIPE apunta su
 * endpoint de Stripe a /webhooks/stripe/<slug>. Se valida la firma contra el
 * webhookSecret CIFRADO de la marca usando el RAW body (lo stashea el json()
 * de main.ts en req.rawBody).
 *
 * Un evento ACEPTADO devuelve 200 aunque no lo sepamos manejar: la idempotencia
 * y el reintento los lleva nuestro lado y no queremos que Stripe insista.
 *
 * Una firma RECHAZADA devuelve 400. Antes devolvía 200 como todo lo demás, y
 * eso escondió el problema por los dos lados a la vez durante meses (2026-08):
 * Sellea tenía guardado el secreto de un endpoint distinto al que enviaba, así
 * que cada compra llegaba, se descartaba en silencio, y Stripe mostraba «0 % de
 * error» porque nosotros le contestábamos 200. Con 400, el panel de Stripe
 * marca el endpoint como fallido y se ve el mismo día.
 *
 * Reintentar una firma inválida no arregla nada, pero el coste es que Stripe
 * insista un rato — barato comparado con no enterarse.
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
    if (!raw) throw new BadRequestException('missing_raw_body');
    const ctx = await this.stripe.constructEventForBrand(slug, raw, signature);
    if (!ctx) {
      // El detalle del porqué ya sale en el log de `constructEventForBrand`.
      // Aquí lo que importa es el código: es lo único que ve Stripe.
      throw new BadRequestException('invalid_signature');
    }
    return this.stripe.handleEvent(ctx.brand, ctx.event);
  }
}
