import { Body, Controller, Get, Headers, HttpCode, Logger, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { HotmartService, HotmartWebhookPayload } from './hotmart.service';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../common/prisma/prisma.service';

/** Log de TODO webhook entrante (antes de validar hottok) — así vemos en logs
 *  si un evento llegó aunque sea rechazado o no matchee ningún handler. Útil
 *  para diagnosticar compras (ej. packs de créditos) que "no acreditan". */
function logIncoming(
  logger: Logger,
  route: string,
  body: HotmartWebhookPayload,
) {
  logger.log(
    `[HOTMART-WH] entrante route=${route} event=${body?.event ?? '-'} ` +
      `producto=${body?.data?.product?.id ?? '-'} ` +
      `offer=${body?.data?.purchase?.offer?.code ?? '-'} ` +
      `buyer=${body?.data?.buyer?.email ?? '-'} ` +
      `tx=${body?.data?.purchase?.transaction ?? '-'}`,
  );
}

@Controller('webhooks/hotmart')
export class HotmartWebhookController {
  private readonly logger = new Logger(HotmartWebhookController.name);
  constructor(private hotmart: HotmartService) {}

  /**
   * Webhook público que Hotmart invoca en cada evento. Devuelve siempre 200
   * para que Hotmart no reintente; cualquier error queda en logs y la decisión
   * de retry la hace nuestro lado, no Hotmart.
   *
   * V1 manda `hottok` en el body; V2.x lo manda en headers como
   * `X-Hotmart-Hottok` o `X-Hotmart-Webhook-Token`.
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Post()
  @HttpCode(200)
  async receive(
    @Body() body: HotmartWebhookPayload,
    @Headers() headers: Record<string, string>,
  ) {
    logIncoming(this.logger, '/webhooks/hotmart', body);
    const hottok =
      body.hottok ??
      headers['x-hotmart-hottok'] ??
      headers['x-hotmart-webhook-token'];
    if (!this.hotmart.verifyHottok(hottok)) {
      this.logger.warn(
        `[HOTMART-WH] hottok INVÁLIDO en /webhooks/hotmart (producto=${body?.data?.product?.id ?? '-'} ` +
          `tx=${body?.data?.purchase?.transaction ?? '-'}). Si es el producto de créditos, ` +
          `revisá que su webhook en Hotmart use el hottok correcto de esta cuenta.`,
      );
      return { ok: false, action: 'invalid_hottok' };
    }
    // Legacy = Clubify: scopeamos a la marca clubify (+ tenants sin marca,
    // histórico). Así un webhook de Clubify nunca activa un tenant de otra marca.
    const scope = await this.hotmart.clubifyScope();
    return this.hotmart.handleEvent(body, scope);
  }

  /**
   * Webhook brand-aware: cada marca con paymentGateway=HOTMART apunta su panel
   * de Hotmart a /webhooks/hotmart/<slug> y valida contra SU webhookSecret
   * cifrado (no el env). La ruta legacy /webhooks/hotmart sigue para Clubify.
   * El scoping del tenant lookup al whiteLabelId llega en Fase 5 (aislamiento).
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Post(':slug')
  @HttpCode(200)
  async receiveForBrand(
    @Param('slug') slug: string,
    @Body() body: HotmartWebhookPayload,
    @Headers() headers: Record<string, string>,
  ) {
    logIncoming(this.logger, `/webhooks/hotmart/${slug}`, body);
    const hottok =
      body.hottok ??
      headers['x-hotmart-hottok'] ??
      headers['x-hotmart-webhook-token'];
    const brand = await this.hotmart.verifyHottokForBrand(slug, hottok);
    if (!brand) {
      this.logger.warn(
        `[HOTMART-WH] hottok INVÁLIDO en /webhooks/hotmart/${slug} ` +
          `(producto=${body?.data?.product?.id ?? '-'} tx=${body?.data?.purchase?.transaction ?? '-'})`,
      );
      return { ok: false, action: 'invalid_hottok' };
    }
    // Scope estricto a la marca: el tenant lookup nunca cruza a otra marca.
    return this.hotmart.handleEvent(body, {
      whiteLabelId: brand.whiteLabelId,
      includeNull: false,
    });
  }
}

@Controller('billing/hotmart')
export class HotmartCheckoutController {
  constructor(
    private hotmart: HotmartService,
    private prisma: PrismaService,
  ) {}

  /** El frontend pregunta si Hotmart está configurado para mostrar/esconder CTAs. */
  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  @Get('config')
  config() {
    return { configured: this.hotmart.isConfigured() };
  }

  /**
   * Devuelve la URL de checkout pre-rellenada con email del owner.
   * Si no se pasa `?plan=`, usa el plan actual del tenant (siempre Elite).
   */
  @Roles('TENANT_OWNER', 'SUPER_ADMIN')
  @Get('checkout-url')
  async checkoutUrl(
    @CurrentUser() user: AuthUser,
    @Query('plan') planOverride?: string,
  ) {
    if (!this.hotmart.isConfigured()) {
      return { url: null, reason: 'not_configured' };
    }
    const u = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { email: true, tenant: { select: { plan: { select: { name: true } } } } },
    });
    const url = await this.hotmart.buildCheckoutUrl({
      email: u?.email,
      planName: planOverride || u?.tenant?.plan?.name,
    });
    return { url };
  }
}
