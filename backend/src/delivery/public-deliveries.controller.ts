import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Public } from '../common/decorators/public.decorator';
import { DeliveryService } from './delivery.service';

class ChatBody {
  @IsString() @MinLength(1) @MaxLength(1000) body!: string;
  /** El teléfono del pedido. Es lo que prueba que quien escribe es el cliente
   *  y no alguien que acertó el código. Opcional en el DTO para poder devolver
   *  el 404 de siempre en vez de un error de validación, que ya delataría que
   *  el código existe. */
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
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
  // El chat pide el TELÉFONO del pedido además del código, y no es un capricho:
  // el código se le enseña al cliente y se pinta en su pantalla, así que no es
  // un secreto. Sin el teléfono, quien acertara un código podía escribir
  // haciéndose pasar por el cliente ante el negocio y leer la conversación
  // privada. Ver docs/QA-MASTER-SECURITY.md (P0-4).
  @Get(':code/chat')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  chatList(@Param('code') code: string, @Query('phone') phone?: string) {
    return this.svc.customerChatList(code.toUpperCase(), phone ?? '');
  }

  @Post(':code/chat')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  chatPost(@Param('code') code: string, @Body() body: ChatBody) {
    return this.svc.customerChatPost(code.toUpperCase(), body.body, body.phone ?? '');
  }
}
