import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Public } from '../common/decorators/public.decorator';
import { CuponeraService } from './cuponera.service';
import { MercadoPagoService } from './mercadopago.service';

class SubscribeBody {
  @IsString() @MaxLength(80) planId!: string;
  @IsString() @MaxLength(120) fullName!: string;
  @IsString() @MaxLength(30) phone!: string;
  @IsOptional() @IsString() @MaxLength(160) email?: string;
}

/**
 * Endpoints públicos del marketplace Living Card (subdominio cuponera.*).
 * Sin auth. "Mi tarjeta" devuelve el passId para que el navegador arme los
 * botones Añadir a Apple/Google Wallet contra /api/passes/:id/apple.pkpass|google.
 */
@Controller('cuponera/public')
export class CuponeraPublicController {
  constructor(
    private svc: CuponeraService,
    private mp: MercadoPagoService,
  ) {}

  @Public()
  @Get('campaign')
  campaign() {
    return this.svc.getPublicCampaign();
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get('card/by-phone')
  cardByPhone(@Query('phone') phone: string) {
    return this.svc.findCardByPhone(phone || '');
  }

  /** Inicia el pago recurrente (MercadoPago). Devuelve initPoint para redirigir. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 15 } })
  @Post('subscribe')
  subscribe(@Body() body: SubscribeBody) {
    return this.mp.createSubscription({
      planId: body.planId,
      fullName: body.fullName,
      phone: body.phone,
      email: body.email ?? '',
    });
  }

  /** "Mi tarjeta" por teléfono O email. La ruta by-phone se mantiene para no
   *  romper links viejos. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get('card/find')
  cardFind(@Query('q') q: string) {
    return this.svc.findCard(q || '');
  }

  /** Directorio público de negocios aliados aprobados (opcional por categoría). */
  @Public()
  @Get('allies')
  allies(@Query('category') category?: string) {
    return this.svc.listPublicAllies(category);
  }

  @Public()
  @Get('allies/:slug')
  ally(@Param('slug') slug: string) {
    return this.svc.getPublicAlly(slug);
  }

  /** Marketplace de beneficios (aprobados y vigentes), opcional por categoría. */
  @Public()
  @Get('benefits')
  benefits(@Query('category') category?: string) {
    return this.svc.listPublicBenefits(category);
  }

  @Public()
  @Get('benefits/:id')
  benefit(@Param('id') id: string) {
    return this.svc.getPublicBenefit(id);
  }

  /** Progreso de sellos del miembro por teléfono (vista "Mis sellos"). */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get('stamps/by-phone')
  stampsByPhone(@Query('phone') phone: string) {
    return this.svc.stampsByPhone(phone || '');
  }
}
