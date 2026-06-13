import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { RecurringNotificationsService } from './recurring-notifications.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class RecurringBody {
  @IsOptional() @IsUUID() cardId?: string | null;
  @IsString() @MaxLength(120) title!: string;
  @IsString() @MaxLength(500) body!: string;
  @IsOptional() @IsObject() segment?: Record<string, any>;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7)
  @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true })
  daysOfWeek!: number[];
  // Validado con regex + service double-check para evitar payloads como "25:99".
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'timeOfDay debe ser HH:MM 24h' })
  timeOfDay!: string;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class PatchRecurringBody {
  @IsOptional() cardId?: string | null;
  @IsOptional() @IsString() @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MaxLength(500) body?: string;
  @IsOptional() @IsObject() segment?: Record<string, any>;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7)
  @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true })
  daysOfWeek?: number[];
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) timeOfDay?: string;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller('notifications/recurring')
@Roles('TENANT_OWNER', 'SUPER_ADMIN')
export class RecurringNotificationsController {
  constructor(private svc: RecurringNotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.list(user, tenantId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: RecurringBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.create(user, body, tenantId);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: PatchRecurringBody,
  ) {
    return this.svc.update(user, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.remove(user, id);
  }
}
