import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { QrPosterType } from '@prisma/client';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { QrPostersService } from './qr-posters.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class UpsertDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsObject() config!: Record<string, any>;
}

class CreateDto {
  @IsEnum(QrPosterType) type!: QrPosterType;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsObject() config?: Record<string, any>;
}

class UpdateDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsObject() config?: Record<string, any>;
}

@Controller('qr-posters')
export class QrPostersController {
  constructor(private svc: QrPostersService) {}

  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  @Get()
  list(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.listMine(user, tenantId);
  }

  // ───────── nuevos endpoints por id (multi-QR) ───────── //

  @Roles('TENANT_OWNER', 'SUPER_ADMIN')
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
  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  @Get('by-type/:type')
  getByType(
    @CurrentUser() user: AuthUser,
    @Param('type') type: QrPosterType,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.getByType(user, type, tenantId);
  }

  @Roles('TENANT_OWNER', 'SUPER_ADMIN')
  @Put('by-type/:type')
  upsertByType(
    @CurrentUser() user: AuthUser,
    @Param('type') type: QrPosterType,
    @Body() body: UpsertDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.upsertByType(user, type, body, tenantId);
  }

  @Roles('TENANT_OWNER', 'SUPER_ADMIN')
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
  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  @Get(':id')
  getById(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.getById(user, id);
  }

  @Roles('TENANT_OWNER', 'SUPER_ADMIN')
  @Patch(':id')
  updateById(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateDto,
  ) {
    return this.svc.updateById(user, id, body);
  }

  @Roles('TENANT_OWNER', 'SUPER_ADMIN')
  @Delete(':id')
  removeById(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.removeById(user, id);
  }
}
