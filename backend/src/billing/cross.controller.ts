import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { IsEmail, IsOptional, IsString } from 'class-validator';
import { CrossService } from './cross.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class CheckoutBody {
  @IsString() brandSlug!: string;
  @IsEmail() email!: string;
  /** id de un WhiteLabelPaymentLink (gateway CROSS). Si falta, usa el 1º activo. */
  @IsOptional() @IsString() planId?: string;
  @IsOptional() @IsString() redirectUrl?: string;
}

class TestChargeBody {
  @IsString() brandSlug!: string;
  @IsEmail() email!: string;
  @IsOptional() @IsString() redirectUrl?: string;
}

/**
 * Webhook de Cross por marca: cada marca con paymentGateway=CROSS registra en
 * Cross su endpoint /webhooks/cross/<slug>. Se valida la firma HMAC-SHA256
 * contra el webhookSecret CIFRADO de la marca usando el RAW body (lo stashea el
 * json() de main.ts en req.rawBody). Siempre 200 para que Cross no reintente en
 * loop (idempotencia/retry los maneja nuestro lado).
 */
@Controller('webhooks/cross')
export class CrossWebhookController {
  constructor(private cross: CrossService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Post(':slug')
  @HttpCode(200)
  async receive(
    @Param('slug') slug: string,
    @Req() req: Request & { rawBody?: Buffer },
    @Headers() headers: Record<string, string | undefined>,
  ) {
    const startedAt = Date.now();
    const raw = req.rawBody;
    if (!raw) return { ok: false, action: 'no_raw_body' };
    const evt = await this.cross.verifyAndParseWebhook(slug, raw, headers);
    if (!evt) return { ok: false, action: 'invalid_signature' };
    const brand = await this.cross.brandForSlug(slug);
    if (!brand) return { ok: false, action: 'brand_not_found' };
    return this.cross.handleEvent(brand, evt, startedAt);
  }
}

/**
 * Checkout server-side de Cross (crear cargo → devolver link de pago). A
 * diferencia de Stripe/Hotmart (link pegado), Cross es API-driven.
 */
@Controller('billing/cross')
export class CrossCheckoutController {
  constructor(
    private cross: CrossService,
    private prisma: PrismaService,
  ) {}

  /** Público: inicia el pago. El monto se resuelve SERVER-SIDE desde el
   *  PaymentLink de la marca (nunca del cliente) para evitar montos arbitrarios. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('checkout')
  async checkout(@Body() body: CheckoutBody) {
    const amountUsd = await this.resolveAmount(body.brandSlug, body.planId);
    if (amountUsd == null) {
      throw new BadRequestException('No hay un plan de pago Cross configurado para esta marca.');
    }
    const result = await this.cross.createCheckout({
      brandSlug: body.brandSlug,
      email: body.email,
      amountUsd,
      description: 'Suscripción',
      redirectUrl: body.redirectUrl,
    });
    if (!result) {
      throw new BadRequestException('No se pudo iniciar el pago con Cross. Revisá la configuración.');
    }
    return { ok: true, link: result.redirectUrl, providerRef: result.providerRef };
  }

  /** SUPER_ADMIN: cargo de prueba de 1 USD para validar el flujo en sandbox. */
  @Roles('SUPER_ADMIN')
  @Post('test-charge')
  async testCharge(@Body() body: TestChargeBody) {
    const result = await this.cross.createCheckout({
      brandSlug: body.brandSlug,
      email: body.email,
      amountUsd: 1,
      description: 'Prueba Cross (1 USD)',
      reference: `clbf_test_${Date.now()}`,
      redirectUrl: body.redirectUrl,
    });
    if (!result) {
      throw new BadRequestException(
        'No se pudo crear el cargo de prueba. Revisá credenciales/ambiente Cross de la marca.',
      );
    }
    return { ok: true, link: result.redirectUrl, providerRef: result.providerRef };
  }

  /** Monto (USD) del PaymentLink CROSS de la marca (por id o el 1º activo). */
  private async resolveAmount(brandSlug: string, planId?: string): Promise<number | null> {
    const wl = await this.prisma.whiteLabel.findFirst({
      where: { slug: (brandSlug ?? '').trim().toLowerCase() },
      select: { id: true },
    });
    if (!wl) return null;
    const link = await this.prisma.whiteLabelPaymentLink.findFirst({
      where: {
        whiteLabelId: wl.id,
        gateway: 'CROSS',
        active: true,
        ...(planId ? { id: planId } : {}),
      },
      orderBy: { sortOrder: 'asc' },
      select: { amountUsd: true },
    });
    if (!link) return null;
    return Number(link.amountUsd);
  }
}
