import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { GrowBusinessService } from '../integrations/grow-business.service';
import { BillingService } from '../billing/billing.service';
import {
  IsBoolean,
  IsHexColor,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TenantsService } from './tenants.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../common/prisma/prisma.service';

class UpdateMyBody {
  @IsOptional() @IsString() brandName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() whatsappPhone?: string;
  @IsOptional() @IsString() whatsappOrdersPhone?: string;
  @IsOptional() @IsString() whatsappDeliveryPhone?: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsHexColor() primaryColor?: string;
  @IsOptional() @IsHexColor() secondaryColor?: string;
  @IsOptional() @IsString() instagramUrl?: string;
  @IsOptional() @IsString() facebookUrl?: string;
  @IsOptional() @IsString() mapsUrl?: string;
  @IsOptional() @IsString() googleReviewUrl?: string;
  @IsOptional() @IsString() walletLogoUrl?: string;
  @IsOptional() @IsString() pushLogoUrl?: string;
  // null → fallback a categoría; "" → reset; max 24 chars al persistir.
  @IsOptional() @IsString() mainSectionLabelOverride?: string | null;
  // Alertas SMS por reseñas negativas (Grow Business).
  @IsOptional() @IsBoolean() reviewAlertsEnabled?: boolean;
  // Threshold inclusive. Solo permitimos 1-3 — arriba de 3 no tiene
  // sentido (4-5 va a Google y no hay feedback privado).
  @IsOptional() @IsInt() @Min(1) @Max(3) reviewAlertsThreshold?: number;
  @IsOptional() @IsString() reviewAlertsPhone?: string | null;
  @IsOptional() @IsString() reviewAlertsTemplate?: string | null;
  // Alertas SMS administrativas (recordatorios de pago / impago /
  // suspensión). Default true en DB para preservar comportamiento legacy.
  @IsOptional() @IsBoolean() billingAlertsEnabled?: boolean;
  @IsOptional() @IsString() billingAlertsPhone?: string | null;
  // Alertas SMS a empresas de domicilio cuando pedidos delivery cambian
  // de estado. Default off (opt-in).
  @IsOptional() @IsBoolean() deliveryAlertsEnabled?: boolean;
  // Array de teléfonos destino — JSON libre, frontend valida formato.
  @IsOptional() deliveryAlertsPhones?: string[] | null;
  // Array de eventos suscritos: 'created' | 'confirmed' | 'ready' | 'delivered'.
  @IsOptional() deliveryAlertsEvents?: string[] | null;
  // WhatsApp opcional al cierre del feedback negativo (/r/:slug).
  @IsOptional() @IsBoolean() whatsappFeedbackEnabled?: boolean;
  @IsOptional() @IsString() whatsappFeedbackNumber?: string | null;
  @IsOptional() @IsString() whatsappFeedbackMessage?: string | null;
  // Moneda de los precios mostrados en el storefront público. ISO 4217
  // (3 letras, ej: COP, USD, MXN, ARS, CLP, PEN, BRL). M1.5 2026-06-04.
  // HOTFIX 2026-06-05 (bug G): formato estricto para que strings basura
  // ("", "asdf", "USDOLLAR") no rompan el formateo en storefront público.
  @IsOptional() @IsString() @Length(3, 3) @Matches(/^[A-Z]{3}$/)
  currency?: string;
  // Override opcional del símbolo monetario. null o "" → símbolo automático
  // de Intl según `currency`. Útil para Bs, Ref., Pts, símbolos custom.
  @IsOptional() @IsString() @MaxLength(8)
  currencySymbol?: string | null;
  // País del negocio (ISO 3166-1 alpha-2, 2 letras). Default "CO".
  @IsOptional() @IsString() @Length(2, 2) @Matches(/^[A-Z]{2}$/)
  country?: string;
  // M4: máximo de sellos/visitas que un mismo pass puede recibir en 24h.
  // null = 1 (default histórico). Rango razonable 1-10 para evitar abuso.
  @IsOptional() @IsInt() @Min(1) @Max(20) maxStampsPerDay?: number;
}

@Controller('tenants/me')
@Roles('TENANT_OWNER', 'TENANT_STAFF')
export class TenantMeController {
  constructor(
    private svc: TenantsService,
    private prisma: PrismaService,
    private growBusiness: GrowBusinessService,
    private billing: BillingService,
  ) {}

  /** Test del SMS de delivery — manda un mensaje al primer teléfono
   *  configurado en deliveryAlertsPhones (o whatsappDeliveryPhone si
   *  el array está vacío). Útil para validar antes de recibir un
   *  pedido real. */
  @Post('delivery-alerts/test')
  async testDeliveryAlert(@CurrentUser() user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException();
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: {
        id: true,
        brandName: true,
        whatsappDeliveryPhone: true,
        deliveryAlertsPhones: true,
        deliveryAlertsAccountId: true,
        growBusinessLocationId: true,
        growBusinessApiKey: true,
        growBusinessSwitchNumber: true,
      },
    });
    if (!tenant) throw new ForbiddenException();

    const phones: string[] = Array.isArray(tenant.deliveryAlertsPhones)
      ? (tenant.deliveryAlertsPhones as string[]).filter(
          (p) => typeof p === 'string' && p.trim().length >= 6,
        )
      : [];
    if (phones.length === 0 && tenant.whatsappDeliveryPhone) {
      phones.push(tenant.whatsappDeliveryPhone);
    }
    if (phones.length === 0) {
      throw new BadRequestException(
        'Sin teléfonos destino — agrega al menos uno antes de probar.',
      );
    }

    let creds: {
      locationId: string;
      apiKey: string;
      switchNumber: number | null;
    } | null = null;
    if (tenant.deliveryAlertsAccountId) {
      const acc = await this.prisma.growBusinessAccount.findFirst({
        where: { id: tenant.deliveryAlertsAccountId, deletedAt: null },
        select: { locationId: true, apiKey: true, switchNumber: true },
      });
      if (acc) {
        creds = {
          locationId: acc.locationId,
          apiKey: acc.apiKey,
          switchNumber: acc.switchNumber,
        };
      }
    }
    if (!creds && tenant.growBusinessLocationId && tenant.growBusinessApiKey) {
      creds = {
        locationId: tenant.growBusinessLocationId,
        apiKey: tenant.growBusinessApiKey,
        switchNumber: tenant.growBusinessSwitchNumber,
      };
    }
    if (!creds) {
      throw new BadRequestException(
        'Sin credenciales — asigná una subcuenta o conecta Grow Business para el negocio.',
      );
    }

    const body =
      '🧪 Test de alerta de domicilio\n\n' +
      `Negocio: ${tenant.brandName}\n` +
      'Si recibiste este SMS, las alertas de pedidos delivery están listas.';
    const results = await Promise.all(
      phones.map(async (p) => {
        const r = await this.growBusiness
          .sendSmsWithCreds(creds!, p, body)
          .catch((e) => ({ ok: false as const, message: e?.message }));
        return { phone: p, ok: r.ok, message: !r.ok ? (r as any).message : null };
      }),
    );
    const okCount = results.filter((r) => r.ok).length;
    return { ok: okCount > 0, total: phones.length, okCount, results };
  }

  /** Test del SMS de billing — manda un mensaje genérico al teléfono de
   *  billing configurado por el owner. Útil para validar la cadena
   *  subcuenta global > creds tenant + teléfono override antes de
   *  esperar un cron o un webhook real. */
  @Post('billing-alerts/test')
  async testBillingAlert(@CurrentUser() user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException();
    const target = await this.billing.resolveBillingTarget(user.tenantId);
    if (!target) {
      throw new BadRequestException(
        'No hay credenciales / teléfono configurado para alertas de pago. ' +
          'Revisa que la subcuenta esté asignada (o que tu negocio tenga ' +
          'su propia conexión Grow Business) y que las alertas estén activadas.',
      );
    }
    const t = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { brandName: true },
    });
    const body =
      '🧪 Test de alertas de pago\n\n' +
      `Negocio: ${t?.brandName ?? '—'}\n` +
      'Si recibís este SMS, los recordatorios de pago de Clubify están listos.';
    const result = await this.growBusiness.sendSmsWithCreds(
      target.creds,
      target.phone,
      body,
    );
    return {
      ok: result.ok,
      toPhone: target.phone,
      response: result,
    };
  }

  /** Test del SMS de alerta de reseña — manda un mensaje real con data
   *  ficticia al teléfono configurado. Sirve para que el owner valide
   *  end-to-end (credenciales + número destino) antes de confiar en una
   *  reseña real. Requiere reviewAlertsEnabled + Grow Business conectado. */
  @Post('review-alerts/test')
  async testReviewAlert(@CurrentUser() user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException();
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: {
        id: true,
        brandName: true,
        slug: true,
        phone: true,
        whatsappPhone: true,
        reviewAlertsEnabled: true,
        reviewAlertsPhone: true,
        reviewAlertsTemplate: true,
        reviewAlertsAccountId: true,
        growBusinessLocationId: true,
        growBusinessApiKey: true,
        growBusinessSwitchNumber: true,
      },
    });
    if (!tenant) throw new ForbiddenException();

    // Mismo orden que reviews.service: subcuenta global > creds tenant.
    let creds: {
      locationId: string;
      apiKey: string;
      switchNumber: number | null;
    } | null = null;
    if (tenant.reviewAlertsAccountId) {
      const account = await this.prisma.growBusinessAccount.findFirst({
        where: { id: tenant.reviewAlertsAccountId, deletedAt: null },
        select: { locationId: true, apiKey: true, switchNumber: true },
      });
      if (account) {
        creds = {
          locationId: account.locationId,
          apiKey: account.apiKey,
          switchNumber: account.switchNumber,
        };
      }
    }
    if (!creds && tenant.growBusinessLocationId && tenant.growBusinessApiKey) {
      creds = {
        locationId: tenant.growBusinessLocationId,
        apiKey: tenant.growBusinessApiKey,
        switchNumber: tenant.growBusinessSwitchNumber,
      };
    }
    if (!creds) {
      throw new BadRequestException(
        'No hay subcuenta Grow Business asignada ni credenciales propias para este negocio.',
      );
    }

    let toPhone = tenant.reviewAlertsPhone?.trim() || '';
    if (!toPhone) {
      const owner = await this.prisma.user.findFirst({
        where: { tenantId: tenant.id, role: 'TENANT_OWNER' },
        select: { phone: true },
      });
      toPhone =
        owner?.phone?.trim() ||
        tenant.whatsappPhone?.trim() ||
        tenant.phone?.trim() ||
        '';
    }
    if (!toPhone) {
      throw new BadRequestException(
        'Sin teléfono destino configurado (ni override ni owner ni whatsappPhone).',
      );
    }
    const body =
      '🧪 Test de alerta de reseñas\n\n' +
      `Negocio: ${tenant.brandName}\n` +
      'Si recibís este SMS, la conexión está lista. Activala con el toggle.';
    const result = await this.growBusiness.sendSmsWithCreds(
      creds,
      toPhone,
      body,
    );
    return {
      ok: result.ok,
      toPhone,
      response: result,
    };
  }

  /**
   * Devuelve los datos del tenant del user actual. SUPER_ADMIN y MARKETING
   * acceden también — retornan null silenciosamente porque NO tienen
   * tenantId. Esto evita el 403 espurio que ensuciaba consola del panel
   * admin (useMainSectionLabel lo llama incondicionalmente). El frontend
   * trata null como "sin tenant context" y cae al default.
   */
  @Get()
  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN', 'MARKETING')
  get(@CurrentUser() user: AuthUser) {
    if (!user.tenantId) return null;
    return this.svc.getMine(user.tenantId);
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() body: UpdateMyBody) {
    if (!user.tenantId) throw new ForbiddenException();
    return this.svc.updateMine(user.tenantId, body);
  }

  /**
   * Export completo de la data del tenant en JSON. Cliente, productos,
   * categorías, pedidos, tarjetas, pases, automatizaciones. Sin contraseñas
   * ni secrets internos. Mejor usar este endpoint para "right to data
   * portability" (GDPR-style).
   */
  @Get('export')
  @Roles('TENANT_OWNER')
  async exportData(@CurrentUser() user: AuthUser, @Res() res: Response) {
    if (!user.tenantId) throw new ForbiddenException();
    const tid = user.tenantId;

    const [tenant, customers, categories, products, orders, cards, passes, automations] =
      await Promise.all([
        this.prisma.tenant.findUnique({
          where: { id: tid },
          select: {
            id: true,
            name: true,
            brandName: true,
            slug: true,
            email: true,
            phone: true,
            whatsappPhone: true,
            logoUrl: true,
            primaryColor: true,
            secondaryColor: true,
            currency: true,
            timezone: true,
            instagramUrl: true,
            facebookUrl: true,
            mapsUrl: true,
            createdAt: true,
          },
        }),
        this.prisma.customer.findMany({ where: { tenantId: tid } }),
        this.prisma.category.findMany({ where: { tenantId: tid } }),
        this.prisma.product.findMany({
          where: { tenantId: tid },
          include: { variants: true, extras: true },
        }),
        this.prisma.order.findMany({
          where: { tenantId: tid },
          orderBy: { createdAt: 'desc' },
          take: 5000,
        }),
        this.prisma.card.findMany({ where: { tenantId: tid } }),
        this.prisma.pass.findMany({
          where: { tenantId: tid },
          select: {
            id: true,
            cardId: true,
            customerId: true,
            serialNumber: true,
            stampsCount: true,
            pointsBalance: true,
            status: true,
            issuedAt: true,
            lastActivityAt: true,
          },
        }),
        this.prisma.automationRule.findMany({ where: { tenantId: tid } }),
      ]);

    const payload = {
      meta: {
        exportedAt: new Date().toISOString(),
        version: '1.0',
        tenantId: tid,
      },
      tenant,
      customers,
      categories,
      products,
      orders,
      cards,
      passes,
      automations,
    };

    const fname = `clubify-export-${tenant?.slug ?? tid}-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(JSON.stringify(payload, null, 2));
  }
}
