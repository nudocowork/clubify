import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { BadgesService, BadgeDto } from './badges.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('badges')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
export class BadgesController {
  constructor(private svc: BadgesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.list(user, tenantId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.get(user, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: BadgeDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.create(user, body, tenantId);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: Partial<BadgeDto>,
  ) {
    return this.svc.update(user, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.remove(user, id);
  }

  @Post(':id/award/:customerId')
  award(
    @CurrentUser() user: AuthUser,
    @Param('id') badgeId: string,
    @Param('customerId') customerId: string,
  ) {
    return this.svc.award(user, badgeId, customerId);
  }
}
