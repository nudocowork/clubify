import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { MercadoPagoService } from './mercadopago.service';

/**
 * Callback del OAuth de MercadoPago («Conectar con MercadoPago»).
 *
 * Público porque llega por la redirección del navegador del vendedor, sin
 * sesión nuestra de por medio; la autenticidad la da el `state` firmado
 * (mp-oauth-state.ts). Pase lo que pase se responde con una redirección al
 * panel: quien está del otro lado es una persona en un navegador, no una API.
 */
@Controller('cuponera/mp')
export class MercadoPagoOauthController {
  constructor(private mp: MercadoPagoService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Get('oauth/callback')
  async callback(@Query() query: Record<string, any>, @Res() res: Response) {
    res.redirect(302, await this.mp.handleOauthCallback(query));
  }
}
