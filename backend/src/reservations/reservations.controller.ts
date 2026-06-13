import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ReservationStatus, ReservationChannel } from '@prisma/client';
import { ReservationsService } from './reservations.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class ZoneBody {
  @IsString() @MaxLength(64) name!: string;
  @IsOptional() @IsString() @MaxLength(64) slug?: string;
  @IsOptional() @IsIn(['INDOOR', 'OUTDOOR', 'BAR', 'PRIVATE']) type?: string;
  @IsOptional() @IsInt() position?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class TableBody {
  @IsOptional() zoneId?: string | null;
  @IsString() @MaxLength(16) number!: string;
  @IsInt() @Min(1) @Max(40) seats!: number;
  @IsOptional() @IsIn(['ROUND', 'RECT', 'BAR']) shape?: string;
  @IsOptional() @IsInt() posX?: number;
  @IsOptional() @IsInt() posY?: number;
  @IsOptional() @IsInt() width?: number | null;
  @IsOptional() @IsInt() height?: number | null;
  @IsOptional() @IsBoolean() isBlocked?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class ReservationBody {
  @IsString() @MaxLength(120) customerName!: string;
  @IsString() @MaxLength(40) customerPhone!: string;
  @IsOptional() @IsEmail() customerEmail?: string;
  @IsInt() @Min(1) @Max(200) party!: number;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) time!: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() zoneId?: string | null;
  @IsOptional() tableId?: string | null;
  @IsOptional() @IsIn(['WEB', 'WHATSAPP', 'PHONE', 'QR', 'IN_PERSON']) channel?: ReservationChannel;
  @IsOptional() @IsIn(['PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']) status?: ReservationStatus;
}

@Controller('reservations')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
export class ReservationsController {
  constructor(private svc: ReservationsService) {}

  // -------- zones --------
  @Get('zones')
  listZones(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.listZones(user, tenantId);
  }
  @Post('zones')
  createZone(@CurrentUser() user: AuthUser, @Body() body: ZoneBody, @Query('tenantId') tenantId?: string) {
    return this.svc.createZone(user, body, tenantId);
  }
  @Patch('zones/:id')
  updateZone(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: Partial<ZoneBody>) {
    return this.svc.updateZone(user, id, body);
  }
  @Delete('zones/:id')
  removeZone(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.removeZone(user, id);
  }

  // -------- tables --------
  @Get('tables')
  listTables(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.listTables(user, tenantId);
  }
  @Post('tables')
  createTable(@CurrentUser() user: AuthUser, @Body() body: TableBody, @Query('tenantId') tenantId?: string) {
    return this.svc.createTable(user, body, tenantId);
  }
  @Patch('tables/:id')
  updateTable(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: Partial<TableBody>) {
    return this.svc.updateTable(user, id, body);
  }
  @Delete('tables/:id')
  removeTable(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.removeTable(user, id);
  }

  // -------- reservations --------
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('date') date?: string,
    @Query('status') status?: ReservationStatus,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.list(user, { date, status }, tenantId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: ReservationBody, @Query('tenantId') tenantId?: string) {
    return this.svc.create(user, body, tenantId);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: Partial<ReservationBody>) {
    return this.svc.update(user, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.remove(user, id);
  }
}
