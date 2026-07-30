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
import { IsISO8601, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';
import { NotificationsService } from './notifications.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class NotificationBody {
  @IsOptional() @IsUUID() cardId?: string;
  @IsString() title!: string;
  @IsString() body!: string;
  @IsOptional() @IsObject() segment?: Record<string, any>;
  @IsOptional() @IsISO8601() scheduledAt?: string;
}

class UpdateScheduledBody {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsISO8601() scheduledAt?: string;
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

  // Editar un envío programado (fecha única) que aún no se ha enviado.
  // Rutas de 1 segmento: no chocan con /notifications/recurring/:id (2 segmentos).
  @Patch(':id')
  updateScheduled(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateScheduledBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.updateScheduled(user, id, body, tenantId);
  }

  // Cancelar un envío programado (fecha única) que aún no se ha enviado.
  @Delete(':id')
  cancelScheduled(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.cancelScheduled(user, id, tenantId);
  }
}
