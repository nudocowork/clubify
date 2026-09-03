import {
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { MercadoPagoService } from './mercadopago.service';

/**
 * Webhook de MercadoPago por campaña: /api/webhooks/mercadopago/:campaign
 * (patrón de Stripe: /api/webhooks/stripe/:slug). Siempre responde 200 para que
 * MP no reintente en loop; la idempotencia la garantiza MercadopagoWebhookEvent.
 */
@Controller('webhooks/mercadopago')
export class MercadoPagoController {
  constructor(private mp: MercadoPagoService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 240 } })
  @Post(':campaign')
  @HttpCode(200)
  async receive(
    @Param('campaign') campaign: string,
    @Req() req: Request & { rawBody?: Buffer },
    @Headers() headers: Record<string, any>,
    @Query() query: Record<string, any>,
  ) {
    try {
      return await this.mp.handleWebhook(campaign, req.rawBody, headers, query);
    } catch (e: any) {
      // Nunca 500 al webhook: log y 200 para evitar reintentos infinitos.
      return { ok: false, action: 'error', message: e?.message ?? 'error' };
    }
  }
}
