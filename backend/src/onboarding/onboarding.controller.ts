import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
} from '@nestjs/common';
import {
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';
import {
  BUSINESS_CATEGORIES,
  isValidCategorySlug,
} from '../common/business-categories';

const WELCOME_POPUP_MESSAGE =
  'Hola acabo de adquirir Clubify, quiero agendar una sesión personalizada para mayor entendimiento de la plataforma.';

class AddressBody {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsString() @MinLength(3) @MaxLength(300) address!: string;
  @IsLatitude() latitude!: number;
  @IsLongitude() longitude!: number;
}

class CategoryBody {
  @IsString() slug!: string;
}

class SkipBody {
  @IsOptional() @IsString() step?: 'address' | 'category';
}

/**
 * Onboarding del dueño del negocio. Pasos en cadena (todos opcionales,
 * cada uno se puede saltar):
 *   1. welcome — popup de "agendar sesión personalizada"
 *   2. address — mapa + dirección del negocio (crea Location para push wallet)
 *   3. category — rubro del negocio (de BUSINESS_CATEGORIES)
 *
 * El frontend pide /onboarding/state al cargar el panel y muestra el
 * primer paso pendiente. Cada paso se completa con su POST específico.
 */
@Controller('onboarding')
@Roles('TENANT_OWNER')
export class OnboardingController {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  @Get('state')
  async state(@CurrentUser() user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException();
    const [branding, t, locationCount] = await Promise.all([
      this.settings.getBranding(),
      this.prisma.tenant.findUnique({
        where: { id: user.tenantId },
        select: {
          status: true,
          welcomePopupSeenAt: true,
          businessAddressOnboardedAt: true,
          businessCategoryOnboardedAt: true,
          businessCategorySlug: true,
        },
      }),
      this.prisma.location.count({ where: { tenantId: user.tenantId } }),
    ]);

    if (!t) throw new ForbiddenException();

    // Welcome popup solo aplica si tenant ACTIVE + super admin lo habilitó
    // + hay imagen configurada
    const welcomePending =
      t.status === 'ACTIVE' &&
      branding.welcomePopupEnabled &&
      !!branding.welcomePopupImageUrl &&
      !t.welcomePopupSeenAt;

    // Address step: solo si no lo completó Y no tiene ya una location
    // (caso: dueño que ya creó ubicaciones por otro lado)
    const addressPending = !t.businessAddressOnboardedAt && locationCount === 0;

    // Category step: si no lo completó (independiente del slug actual,
    // que al crear el tenant se setea por default)
    const categoryPending = !t.businessCategoryOnboardedAt;

    let step: 'welcome' | 'address' | 'category' | 'done' = 'done';
    if (welcomePending) step = 'welcome';
    else if (addressPending) step = 'address';
    else if (categoryPending) step = 'category';

    return {
      step,
      // datos del welcome
      welcomeImageUrl: branding.welcomePopupImageUrl,
      welcomeSupportPhone: branding.supportWhatsapp,
      welcomeMessage: WELCOME_POPUP_MESSAGE,
      // datos del category
      categories: BUSINESS_CATEGORIES.map((c) => ({
        slug: c.slug,
        name: c.name,
        emoji: c.emoji,
        description: c.description,
      })),
      currentCategorySlug: t.businessCategorySlug ?? null,
    };
  }

  // Welcome: ya teníamos /welcome-popup/dismiss. Lo replicamos aquí para
  // tener todos los pasos en /onboarding/* (back-compat: el endpoint
  // viejo sigue activo).
  @Post('welcome/done')
  async doneWelcome(@CurrentUser() user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException();
    await this.prisma.tenant.update({
      where: { id: user.tenantId },
      data: { welcomePopupSeenAt: new Date() },
    });
    return { ok: true };
  }

  @Post('address')
  async doAddress(@CurrentUser() user: AuthUser, @Body() body: AddressBody) {
    if (!user.tenantId) throw new ForbiddenException();
    // Crea Location + marca el paso. Ambas operaciones en una transacción
    // para no quedar inconsistentes si una falla.
    await this.prisma.$transaction([
      this.prisma.location.create({
        data: {
          tenantId: user.tenantId,
          name: body.name.trim(),
          address: body.address.trim(),
          latitude: body.latitude,
          longitude: body.longitude,
          radiusMeters: 300,
        },
      }),
      this.prisma.tenant.update({
        where: { id: user.tenantId },
        data: { businessAddressOnboardedAt: new Date() },
      }),
    ]);
    return { ok: true };
  }

  @Post('address/skip')
  async skipAddress(@CurrentUser() user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException();
    await this.prisma.tenant.update({
      where: { id: user.tenantId },
      data: { businessAddressOnboardedAt: new Date() },
    });
    return { ok: true };
  }

  @Post('category')
  async doCategory(@CurrentUser() user: AuthUser, @Body() body: CategoryBody) {
    if (!user.tenantId) throw new ForbiddenException();
    if (!isValidCategorySlug(body.slug)) {
      throw new ForbiddenException('Categoría inválida');
    }
    await this.prisma.tenant.update({
      where: { id: user.tenantId },
      data: {
        businessCategorySlug: body.slug,
        businessCategoryOnboardedAt: new Date(),
      },
    });
    return { ok: true };
  }

  @Post('category/skip')
  async skipCategory(@CurrentUser() user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException();
    await this.prisma.tenant.update({
      where: { id: user.tenantId },
      data: { businessCategoryOnboardedAt: new Date() },
    });
    return { ok: true };
  }
}
