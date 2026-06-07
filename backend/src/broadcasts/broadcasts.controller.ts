import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  BroadcastAudience,
  BroadcastKind,
} from '@prisma/client';
import {
  BroadcastsService,
  CreateBroadcastDto,
  ListBroadcastFilters,
  UpdateBroadcastDto,
} from './broadcasts.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('admin/broadcasts')
@Roles('SUPER_ADMIN')
export class BroadcastsAdminController {
  constructor(private svc: BroadcastsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('kind') kind?: string,
    @Query('audience') audience?: string,
    @Query('isActive') isActive?: string,
  ) {
    const filters: ListBroadcastFilters = {};
    if (kind === 'BANNER' || kind === 'LOGIN_POPUP') {
      filters.kind = kind as BroadcastKind;
    }
    if (
      audience === 'ALL' ||
      audience === 'INFLUENCERS' ||
      audience === 'AMBASSADORS' ||
      audience === 'VENDORS'
    ) {
      filters.audience = audience as BroadcastAudience;
    }
    if (isActive === 'true') filters.isActive = true;
    if (isActive === 'false') filters.isActive = false;
    return this.svc.list(user, filters);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.get(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateBroadcastDto) {
    return this.svc.create(user, body);
  }

  @Patch(':id/disable')
  disable(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.disable(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateBroadcastDto,
  ) {
    return this.svc.update(user, id, body);
  }

  @Get(':id/metrics')
  metrics(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.metricsFor(user, id);
  }
}

@Controller('broadcasts')
@Roles(
  'SUPER_ADMIN',
  'MARKETING',
  'TENANT_OWNER',
  'TENANT_STAFF',
  'AFFILIATE_INFLUENCER',
  'AFFILIATE_AMBASSADOR',
  'AFFILIATE_VENDOR',
  'AFFILIATE_SOCIO',
)
export class BroadcastsPublicController {
  constructor(private svc: BroadcastsService) {}

  @Get('banner')
  banner(@CurrentUser() user: AuthUser) {
    return this.svc.getActiveBannerForUser(user);
  }

  @Get('login-popup')
  loginPopup(@CurrentUser() user: AuthUser) {
    return this.svc.getPendingLoginPopupForUser(user);
  }

  @Post(':id/read')
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.markRead(id, user);
  }
}
