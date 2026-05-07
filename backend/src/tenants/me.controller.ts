import { Body, Controller, ForbiddenException, Get, Patch, Res } from '@nestjs/common';
import { Response } from 'express';
import { IsHexColor, IsOptional, IsString } from 'class-validator';
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
}

@Controller('tenants/me')
@Roles('TENANT_OWNER', 'TENANT_STAFF')
export class TenantMeController {
  constructor(
    private svc: TenantsService,
    private prisma: PrismaService,
  ) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException();
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
