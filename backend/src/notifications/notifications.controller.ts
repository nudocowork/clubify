import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsObject, IsOptional, IsString, IsUUID } from 'class-validator';
import { NotificationsService } from './notifications.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class NotificationBody {
  @IsOptional() @IsUUID() cardId?: string;
  @IsString() title!: string;
  @IsString() body!: string;
  @IsOptional() @IsObject() segment?: Record<string, any>;
}

@Controller('notifications')
@Roles('TENANT_OWNER', 'SUPER_ADMIN')
export class NotificationsController {
  constructor(private svc: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.list(user, tenantId);
  }

  @Post()
  send(
    @CurrentUser() user: AuthUser,
    @Body() body: NotificationBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.send(user, body, tenantId);
  }
}
