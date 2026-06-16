import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
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
  // M3: popup global del Menú Libro (/book/<slug>). Aparece después de
  // bookPopupDelaySeconds desde que se carga el book viewer. Misma
  // shape que MenuBookSection/Page popups para consistencia.
  @IsOptional() @IsBoolean() bookPopupEnabled?: boolean;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(120)
  bookPopupTitle?: string | null;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(2000)
  bookPopupDescription?: string | null;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(500)
  bookPopupImageUrl?: string | null;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(40)
  bookPopupButtonText?: string | null;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(500)
  bookPopupButtonUrl?: string | null;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(40)
  bookPopupButtonColor?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(120) bookPopupDelaySeconds?: number;
  // M9: tipo del popup global del libro y payload alternativo (CARD/IMAGE).
  // NULL = EXTERNAL_LINK por back compat.
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsIn(['EXTERNAL_LINK', 'CARD', 'IMAGE'])
  bookPopupType?: string | null;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(64)
  bookPopupCardId?: string | null;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(40)
  bookPopupCardCtaLabel?: string | null;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(200)
  bookPopupImageCaption?: string | null;
  @IsOptional() @IsBoolean() whatsappButtonEnabled?: boolean;
  // Color CSS válido (#hex, rgb(), nombre). null = usar default del layout.
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(40)
  pageBackgroundColor?: string | null;
  // Tipo de fondo de la página pública. 'SOLID' | 'GRADIENT' | 'IMAGE' o
  // null (default SOLID).
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(16)
  pageBackgroundType?: string | null;
  // CSS gradient completo. Hasta 300 caracteres por seguridad — los
  // gradients reales tienen <100.
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(300)
  pageBackgroundGradient?: string | null;
  // URL R2 de la imagen de fondo. null = sin imagen.
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(500)
  pageBackgroundImageUrl?: string | null;
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
  // #29: orientación del menú libro.
  @IsOptional() @IsIn(['HORIZONTAL', 'VERTICAL']) bookMenuDirection?: string;
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
