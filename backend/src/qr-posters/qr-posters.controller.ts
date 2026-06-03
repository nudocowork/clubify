import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Ip,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Redirect,
} from '@nestjs/common';
import { QrPosterType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { QrPostersService } from './qr-posters.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';

class UpsertDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsObject() config!: Record<string, any>;
}

class CreateDto {
  @IsEnum(QrPosterType) type!: QrPosterType;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsObject() config?: Record<string, any>;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(500)
  targetUrl?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class UpdateDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsObject() config?: Record<string, any>;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(500)
  targetUrl?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class LogExportDto {
  @IsString() @MaxLength(8) format!: string;
  @IsOptional() sizeBytes?: number;
}

@Controller('qr-posters')
export class QrPostersController {
  constructor(private svc: QrPostersService) {}

  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN', 'MARKETING')
  @Get()
  list(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.listMine(user, tenantId);
  }

  // ───────── nuevos endpoints por id (multi-QR) ───────── //

  @Roles('TENANT_OWNER', 'SUPER_ADMIN', 'MARKETING')
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.create(user, body, tenantId);
  }

  // OJO con el orden: este Get(:id) DEBE ir DESPUÉS de los Get específicos
  // (by-type/:type) sino captura sus URLs como id literal "by-type". El
  // Patch/Delete por id no chocan porque /by-type/:type usa Put/Delete.
  // Ver feedback_nestjs_route_order.md para el patrón.
  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN', 'MARKETING')
  @Get('by-type/:type')
  getByType(
    @CurrentUser() user: AuthUser,
    @Param('type') type: QrPosterType,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.getByType(user, type, tenantId);
  }

  @Roles('TENANT_OWNER', 'SUPER_ADMIN', 'MARKETING')
  @Put('by-type/:type')
  upsertByType(
    @CurrentUser() user: AuthUser,
    @Param('type') type: QrPosterType,
    @Body() body: UpsertDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.upsertByType(user, type, body, tenantId);
  }

  @Roles('TENANT_OWNER', 'SUPER_ADMIN', 'MARKETING')
  @Delete('by-type/:type')
  removeByType(
    @CurrentUser() user: AuthUser,
    @Param('type') type: QrPosterType,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.removeByType(user, type, tenantId);
  }

  // Endpoints por id — declarados DESPUÉS de los by-type para que el
  // route matching no se confunda.
  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN', 'MARKETING')
  @Get(':id')
  getById(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.getById(user, id);
  }

  @Roles('TENANT_OWNER', 'SUPER_ADMIN', 'MARKETING')
  @Patch(':id')
  updateById(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateDto,
  ) {
    return this.svc.updateById(user, id, body);
  }

  @Roles('TENANT_OWNER', 'SUPER_ADMIN', 'MARKETING')
  @Delete(':id')
  removeById(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.removeById(user, id);
  }

  /** El frontend dispara esto cuando el dueño descarga el cartel
   *  (PNG/PDF/SVG). Loguea el evento para mostrar "descargado N veces"
   *  en el card del poster. */
  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN', 'MARKETING')
  @Post(':id/export-log')
  logExport(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: LogExportDto,
  ) {
    return this.svc.logExport(user, id, body);
  }
}

/**
 * Controller PÚBLICO separado para el redirect dinámico `/q/<id>`.
 * El QR impreso codifica esta URL — al escanear, el usuario llega aquí,
 * el servicio loguea la visita y retorna un 302 al targetUrl resuelto
 * (override o default por tipo).
 *
 * Si el poster no existe o está inactivo, devuelve 404 limpio (sin
 * leak del tenant). NO requiere auth.
 */
@Controller('q')
export class QrPosterPublicRedirectController {
  constructor(private svc: QrPostersService) {}

  @Public()
  @Get(':id')
  @Redirect()
  async redirect(
    @Param('id') id: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('referer') referer?: string,
    @Headers('cf-ipcountry') country?: string,
    @Ip() ip?: string,
  ) {
    const appUrl = process.env.APP_URL ?? 'https://soyclubify.com';
    const target = await this.svc.resolvePublicUrl(id, appUrl, {
      ip,
      userAgent,
      country,
      referer,
    });
    if (!target) throw new NotFoundException('QR no disponible');
    return { url: target, statusCode: 302 };
  }
}
