import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Public } from '../common/decorators/public.decorator';
import { DeliveryService } from './delivery.service';

class ChatBody {
  @IsString() @MinLength(1) @MaxLength(1000) body!: string;
}

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

  // Chat del domicilio — lado cliente (por código de pedido).
  @Get(':code/chat')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  chatList(@Param('code') code: string) {
    return this.svc.customerChatList(code.toUpperCase());
  }

  @Post(':code/chat')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  chatPost(@Param('code') code: string, @Body() body: ChatBody) {
    return this.svc.customerChatPost(code.toUpperCase(), body.body);
  }
}
