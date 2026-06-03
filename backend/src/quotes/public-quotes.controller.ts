import { Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { QuotesService } from './quotes.service';

/**
 * Endpoint público de la vista de cliente para una cotización compartida.
 * Separado del controller admin/quotes (SUPER_ADMIN) para mantener el
 * blast-radius del @Roles del otro chico — aquí nada está protegido más
 * allá del throttle, el token UUID es la única defensa.
 */
@Controller()
export class PublicQuotesController {
  constructor(private svc: QuotesService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get('public/quote/:token')
  byToken(@Param('token') token: string) {
    return this.svc.getPublicByToken(token);
  }

  /** Bump de CTA click — fire-and-forget desde /signup cuando aterriza
   *  con qt=<token>. Throttle alto porque cada signup hace una sola
   *  llamada; mantener bajo para evitar spam de un attacker. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('public/quote/:token/cta-click')
  ctaClick(@Param('token') token: string) {
    return this.svc.bumpCtaClick(token);
  }
}
