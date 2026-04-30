import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
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
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString()
  customDomain?: string | null;
}

@Controller('storefront')
@Roles('TENANT_OWNER', 'SUPER_ADMIN')
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
