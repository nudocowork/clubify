import { Controller, Get, Query } from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('messages')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
export class MessagesController {
  constructor(private svc: ChannelsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.listMessages(user, tenantId);
  }
}
