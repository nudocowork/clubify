import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsBoolean, IsEnum, IsObject, IsOptional } from 'class-validator';
import { ChannelType } from '@prisma/client';
import { ChannelsService } from './channels.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class ChannelConfigBody {
  @IsEnum(ChannelType) type!: ChannelType;
  @IsObject() config!: any;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

@Controller('channels')
@Roles('TENANT_OWNER', 'SUPER_ADMIN')
export class ChannelsController {
  constructor(private svc: ChannelsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.listConfigs(user, tenantId);
  }

  @Post()
  upsert(
    @CurrentUser() user: AuthUser,
    @Body() body: ChannelConfigBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.upsertConfig(user, body, tenantId);
  }
}
