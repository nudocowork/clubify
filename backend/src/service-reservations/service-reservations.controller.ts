import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { ServiceReservationsService } from './service-reservations.service';

class ServiceBody {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsInt() @Min(5) @Max(720) durationMin!: number;
  @IsOptional() @IsInt() @Min(0) priceCents?: number | null;
}
class ServiceUpdateBody {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsInt() @Min(5) @Max(720) durationMin?: number;
  @IsOptional() @IsInt() @Min(0) priceCents?: number | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}
class AvailabilityRow {
  @IsInt() @Min(0) @Max(6) weekday!: number;
  @IsInt() @Min(0) @Max(1440) startMin!: number;
  @IsInt() @Min(0) @Max(1440) endMin!: number;
}
class AvailabilityBody {
  @IsArray() rows!: AvailabilityRow[];
  // Profesional dueño del horario (Fase 5). Ausente/null = nivel negocio.
  @IsOptional() @IsString() @MaxLength(40) providerId?: string | null;
}
class ProviderBody {
  @IsString() @MaxLength(80) name!: string;
}
class ProviderUpdateBody {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsArray() serviceIds?: string[];
}
class ExceptionBody {
  @IsString() date!: string; // YYYY-MM-DD
  @IsBoolean() closed!: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(1440) startMin?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1440) endMin?: number;
}
class AppointmentBody {
  @IsString() serviceId!: string;
  @IsString() startAt!: string; // ISO UTC
  @IsString() @MaxLength(120) customerName!: string;
  @IsString() @MaxLength(40) customerPhone!: string;
  @IsOptional() @IsString() @MaxLength(40) providerId?: string | null;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
class StatusBody {
  @IsString() status!: string;
}

/**
 * Panel del NEGOCIO para reservas de servicios (citas). PDF245 P7.
 * @Roles TENANT_OWNER/TENANT_STAFF; SUPER_ADMIN puede operar con ?tenantId=.
 */
@Controller('service-reservations')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
export class ServiceReservationsController {
  constructor(private svc: ServiceReservationsService) {}

  @Get('config')
  config(@CurrentUser() user: AuthUser, @Query('tenantId') t?: string) {
    return this.svc.getConfig(user, t);
  }

  // ─── Servicios ───
  @Get('services')
  listServices(@CurrentUser() user: AuthUser, @Query('tenantId') t?: string) {
    return this.svc.listServices(user, t);
  }
  @Post('services')
  createService(
    @CurrentUser() user: AuthUser,
    @Body() body: ServiceBody,
    @Query('tenantId') t?: string,
  ) {
    return this.svc.createService(user, body, t);
  }
  @Patch('services/:id')
  updateService(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: ServiceUpdateBody,
  ) {
    return this.svc.updateService(user, id, body);
  }
  @Delete('services/:id')
  removeService(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.removeService(user, id);
  }

  // ─── Profesionales (Fase 5) ───
  @Get('providers')
  listProviders(@CurrentUser() user: AuthUser, @Query('tenantId') t?: string) {
    return this.svc.listProviders(user, t);
  }
  @Post('providers')
  createProvider(
    @CurrentUser() user: AuthUser,
    @Body() body: ProviderBody,
    @Query('tenantId') t?: string,
  ) {
    return this.svc.createProvider(user, body.name, t);
  }
  @Patch('providers/:id')
  updateProvider(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: ProviderUpdateBody,
  ) {
    return this.svc.updateProvider(user, id, body);
  }
  @Delete('providers/:id')
  removeProvider(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.removeProvider(user, id);
  }

  // ─── Disponibilidad (por negocio o por profesional) ───
  @Put('availability')
  setAvailability(
    @CurrentUser() user: AuthUser,
    @Body() body: AvailabilityBody,
    @Query('tenantId') t?: string,
  ) {
    return this.svc.setAvailability(user, body.rows, body.providerId ?? null, t);
  }

  // ─── Excepciones ───
  @Get('exceptions')
  listExceptions(@CurrentUser() user: AuthUser, @Query('tenantId') t?: string) {
    return this.svc.listExceptions(user, t);
  }
  @Post('exceptions')
  upsertException(
    @CurrentUser() user: AuthUser,
    @Body() body: ExceptionBody,
    @Query('tenantId') t?: string,
  ) {
    return this.svc.upsertException(user, body, t);
  }
  @Delete('exceptions/:id')
  removeException(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.removeException(user, id);
  }

  // ─── Slots + citas ───
  @Get('slots')
  slots(
    @CurrentUser() user: AuthUser,
    @Query('serviceId') serviceId: string,
    @Query('date') date: string,
    @Query('providerId') providerId?: string,
    @Query('tenantId') t?: string,
  ) {
    return this.svc.slotsForUser(user, serviceId, date, providerId, t);
  }

  @Get('appointments')
  appointments(
    @CurrentUser() user: AuthUser,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('tenantId') t?: string,
  ) {
    return this.svc.listAppointments(user, from, to, t);
  }

  @Post('appointments')
  createAppointment(
    @CurrentUser() user: AuthUser,
    @Body() body: AppointmentBody,
    @Query('tenantId') t?: string,
  ) {
    return this.svc.createAppointmentFromPanel(user, body, t);
  }

  @Patch('appointments/:id/status')
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: StatusBody,
  ) {
    return this.svc.setAppointmentStatus(user, id, body.status as any);
  }
}
