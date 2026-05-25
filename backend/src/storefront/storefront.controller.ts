import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { MenuLayout } from '@prisma/client';
import { StorefrontService } from './storefront.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';

class StorefrontBody {
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() heroImageUrl?: string;
  @IsOptional() @IsObject() theme?: any;
  @IsOptional() @IsArray() blocks?: any[];
  @IsOptional() @IsBoolean() isPublished?: boolean;
  @IsOptional() @IsBoolean() ordersEnabled?: boolean;
  @IsOptional() @IsBoolean() ordersDeliveryEnabled?: boolean;
  @IsOptional() @IsBoolean() popupEnabled?: boolean;
  @IsOptional() @IsString() popupImageUrl?: string | null;
  @IsOptional() @IsString() popupCardId?: string | null;
  // Segundos antes de que aparezca el popup. Min 1s, max 120s (2min).
  @IsOptional() @IsInt() @Min(1) @Max(120) popupDelaySeconds?: number;
  @IsOptional() @IsBoolean() whatsappButtonEnabled?: boolean;
  // Color CSS válido (#hex, rgb(), nombre). null = usar default del layout.
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(40)
  pageBackgroundColor?: string | null;
  // Color de fondo del contenedor del logo (#hex, rgb(), "transparent"...).
  // null = blanco (default histórico).
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(40)
  logoBgColor?: string | null;
  // Color del título del header. null = default por layout.
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(40)
  titleColor?: string | null;
  // Color de la descripción del header. null = default por layout.
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(40)
  descriptionColor?: string | null;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsObject()
  backButtonConfig?: Record<string, any> | null;
  // Cover de la sección virtual "Recomendados". null = limpiar.
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(200)
  recommendedTagline?: string | null;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsObject()
  recommendedCoverConfig?: Record<string, any> | null;
  @IsOptional() @IsEnum(MenuLayout) menuLayout?: MenuLayout;
  @IsOptional() @IsBoolean() digitalMenuEnabled?: boolean;
  @IsOptional() @IsBoolean() bookMenuEnabled?: boolean;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString()
  customDomain?: string | null;
}

@Controller('storefront')
@Roles('TENANT_OWNER', 'SUPER_ADMIN', 'MARKETING')
export class StorefrontController {
  constructor(private svc: StorefrontService) {}

  @Get()
  get(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.get(user, tenantId);
  }

  @Patch()
  update(
    @CurrentUser() user: AuthUser,
    @Body() body: StorefrontBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.update(user, body, tenantId);
  }
}

@Controller('public/storefront')
export class PublicStorefrontController {
  constructor(private svc: StorefrontService) {}

  /**
   * Resuelve qué tenant servir basado en el header Host.
   * Usado por el middleware del frontend para tener dominios custom.
   * Devuelve null si el dominio no está vinculado.
   */
  @Public()
  @Get('resolve-host')
  async resolveHost(@Query('host') host: string) {
    if (!host) return { slug: null };
    const r = await this.svc.resolveHost(host);
    return r ?? { slug: null };
  }
}
