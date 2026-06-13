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
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AttendeeStatus, EventStatus } from '@prisma/client';
import { EventsService } from './events.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class EventBody {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(1000) coverImageUrl?: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) startTime!: string;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) endTime!: string;
  @IsInt() @Min(1) @Max(10000) capacity!: number;
  @IsOptional() @IsNumber() price?: number | null;
  @IsOptional() @IsString() @MaxLength(8) priceCurrency?: string;
  @IsOptional() @IsIn(['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED']) status?: EventStatus;
  @IsOptional() locationId?: string | null;
}

class AttendeeBody {
  @IsString() @MaxLength(120) customerName!: string;
  @IsString() @MaxLength(40) customerPhone!: string;
  @IsOptional() @IsEmail() customerEmail?: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) party?: number;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsIn(['CONFIRMED', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW']) status?: AttendeeStatus;
}

@Controller('reservation-events')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
export class EventsController {
  constructor(private svc: EventsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: EventStatus,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('locationId') locationId?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.list(user, { status, from, to, locationId }, tenantId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.get(user, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: EventBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.create(user, body, tenantId);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: Partial<EventBody>,
  ) {
    return this.svc.update(user, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.remove(user, id);
  }

  // -------- attendees --------

  @Post(':id/attendees')
  addAttendee(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: AttendeeBody,
  ) {
    return this.svc.addAttendee(user, id, body);
  }

  @Patch('attendees/:attendeeId')
  updateAttendee(
    @CurrentUser() user: AuthUser,
    @Param('attendeeId') attendeeId: string,
    @Body() body: Partial<AttendeeBody>,
  ) {
    return this.svc.updateAttendee(user, attendeeId, body);
  }

  @Delete('attendees/:attendeeId')
  removeAttendee(
    @CurrentUser() user: AuthUser,
    @Param('attendeeId') attendeeId: string,
  ) {
    return this.svc.removeAttendee(user, attendeeId);
  }
}
