import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ReminderRecurrence } from '@prisma/client';
import { RemindersService } from './reminders.service';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

class CreateReminderBody {
  @IsOptional() @IsString() employeeId?: string;
  @IsString() @MinLength(1) @MaxLength(120) employeeName!: string;
  @IsString() @MinLength(5) @MaxLength(30) employeePhone!: string;
  @IsIn(['DAILY', 'WEEKLY', 'MONTHLY']) recurrence!: ReminderRecurrence;
  @IsOptional() @IsInt() @Min(0) @Max(6) dayOfWeek?: number;
  @IsOptional() @IsInt() @Min(1) @Max(28) dayOfMonth?: number;
  @IsString() @MinLength(4) @MaxLength(5) timeOfDay!: string;
  @IsString() @MinLength(1) @MaxLength(800) message!: string;
}

class UpdateReminderBody {
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @IsString() @MaxLength(120) employeeName?: string;
  @IsOptional() @IsString() @MaxLength(30) employeePhone?: string;
  @IsOptional() @IsIn(['DAILY', 'WEEKLY', 'MONTHLY']) recurrence?: ReminderRecurrence;
  @IsOptional() @IsInt() @Min(0) @Max(6) dayOfWeek?: number;
  @IsOptional() @IsInt() @Min(1) @Max(28) dayOfMonth?: number;
  @IsOptional() @IsString() @MaxLength(5) timeOfDay?: string;
  @IsOptional() @IsString() @MaxLength(800) message?: string;
  @IsOptional() isActive?: boolean;
}

class SendOneOffBody {
  @IsString() @MinLength(5) phone!: string;
  @IsString() @MinLength(1) @MaxLength(800) message!: string;
}

@Controller('admin/reminders')
@Roles('TENANT_OWNER', 'TENANT_STAFF')
export class RemindersController {
  constructor(private svc: RemindersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException();
    return this.svc.list(user.tenantId);
  }

  @Post()
  @Roles('TENANT_OWNER')
  create(@CurrentUser() user: AuthUser, @Body() body: CreateReminderBody) {
    if (!user.tenantId) throw new ForbiddenException();
    return this.svc.create(user.tenantId, body);
  }

  @Patch(':id')
  @Roles('TENANT_OWNER')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateReminderBody,
  ) {
    if (!user.tenantId) throw new ForbiddenException();
    return this.svc.update(user.tenantId, id, body);
  }

  @Delete(':id')
  @Roles('TENANT_OWNER')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    if (!user.tenantId) throw new ForbiddenException();
    return this.svc.remove(user.tenantId, id);
  }

  @Post('send')
  @Roles('TENANT_OWNER')
  sendOneOff(@CurrentUser() user: AuthUser, @Body() body: SendOneOffBody) {
    if (!user.tenantId) throw new ForbiddenException();
    return this.svc.sendOneOff(user.tenantId, body);
  }
}
