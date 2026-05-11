import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { QrPosterType } from '@prisma/client';
import {
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

@Controller('qr-posters')
export class QrPostersController {
  constructor(private svc: QrPostersService) {}

  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  @Get()
  list(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.listMine(user, tenantId);
  }

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
}
