import { Controller, Get, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { DeliveryService } from './delivery.service';

/**
 * Seguimiento público del cliente (Fase 3A). Sin login: el cliente consulta
 * "mis pedidos" por su teléfono dentro del storefront de un negocio (slug).
 * Throttle ligero — es el widget del storefront.
 */
@Controller('public/deliveries')
export class PublicDeliveriesController {
  constructor(private svc: DeliveryService) {}

  @Get('by-phone/:slug')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  byPhone(@Param('slug') slug: string, @Query('phone') phone: string) {
    return this.svc.listPublicByPhone(slug, phone ?? '');
  }
}
