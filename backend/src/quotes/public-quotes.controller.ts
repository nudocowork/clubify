import { Controller, Get, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { QuotesService } from './quotes.service';

/**
 * Endpoint público de la vista de cliente para una cotización compartida.
 * Separado del controller admin/quotes (SUPER_ADMIN) para mantener el
 * blast-radius del @Roles del otro chico — acá nada está protegido más
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
}
