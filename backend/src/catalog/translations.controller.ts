import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { TranslationsAdminService } from './translations.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class ManualTranslationBody {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  text!: string;
}

/**
 * Panel admin de traducciones del menú (Fase 4 i18n). El dueño puede:
 *  - Ver todas las strings traducibles + estado por locale (auto/manual/missing/stale).
 *  - Editar manualmente un override (queda como source='manual').
 *  - Limpiar el override (next request público re-traduce).
 *  - Regenerar automática vía Claude on-demand.
 */
@Controller('catalog/translations')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
export class TranslationsController {
  constructor(private svc: TranslationsAdminService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.list(user, tenantId);
  }

  @Patch(':entityType/:entityId/:field/:locale')
  setManual(
    @CurrentUser() user: AuthUser,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Param('field') field: string,
    @Param('locale') locale: string,
    @Body() body: ManualTranslationBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.setManual(
      user,
      entityType,
      entityId,
      field,
      locale,
      body.text,
      tenantId,
    );
  }

  @Delete(':entityType/:entityId/:field/:locale')
  clear(
    @CurrentUser() user: AuthUser,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Param('field') field: string,
    @Param('locale') locale: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.clear(user, entityType, entityId, field, locale, tenantId);
  }

  @Post(':entityType/:entityId/:field/:locale/regenerate')
  regenerate(
    @CurrentUser() user: AuthUser,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Param('field') field: string,
    @Param('locale') locale: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.regenerate(
      user,
      entityType,
      entityId,
      field,
      locale,
      tenantId,
    );
  }
}
