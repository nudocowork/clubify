import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
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
  // Geometría explícita del recuadro de zona en el plano. null = volver a
  // "auto" (recuadro derivado de las mesas). number = posición/tamaño fijo.
  @IsOptional() @IsInt() posX?: number | null;
  @IsOptional() @IsInt() posY?: number | null;
  @IsOptional() @IsInt() width?: number | null;
  @IsOptional() @IsInt() height?: number | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() locationId?: string | null;
}

class TableBody {
  @IsOptional() zoneId?: string | null;
  @IsOptional() locationId?: string | null;
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
  @IsOptional() locationId?: string | null;
  @IsOptional() @IsIn(['WEB', 'WHATSAPP', 'PHONE', 'QR', 'IN_PERSON']) channel?: ReservationChannel;
  @IsOptional() @IsIn(['PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']) status?: ReservationStatus;
}

@Controller('reservations')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
export class ReservationsController {
  constructor(private svc: ReservationsService) {}

  // -------- zones --------
  @Get('zones')
  listZones(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') tenantId?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.svc.listZones(user, tenantId, locationId);
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
  listTables(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') tenantId?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.svc.listTables(user, tenantId, locationId);
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
    @Query('locationId') locationId?: string,
  ) {
    return this.svc.list(user, { date, status, locationId }, tenantId);
  }

  /** Devuelve los slots de reservas configurados del tenant (con
   *  fallback al default si no configuró). */
  @Get('config/slots')
  async getSlots(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') tenantId?: string,
  ) {
    const tid = user.role === 'SUPER_ADMIN' ? tenantId : user.tenantId;
    if (!tid) throw new BadRequestException('tenantId requerido');
    const slots = await this.svc.getTenantSlots(tid);
    return { slots };
  }

  /** Guarda los slots del tenant. Acepta array vacío para volver al
   *  default. Valida formato HH:MM 24h. */
  @Patch('config/slots')
  async setSlots(
    @CurrentUser() user: AuthUser,
    @Body() body: { slots: string[] },
    @Query('tenantId') tenantId?: string,
  ) {
    const tid = user.role === 'SUPER_ADMIN' ? tenantId : user.tenantId;
    if (!tid) throw new BadRequestException('tenantId requerido');
    if (!Array.isArray(body?.slots)) {
      throw new BadRequestException('slots[] requerido');
    }
    const re = /^([01]\d|2[0-3]):[0-5]\d$/;
    for (const s of body.slots) {
      if (typeof s !== 'string' || !re.test(s)) {
        throw new BadRequestException(`Slot inválido: ${s} (formato HH:MM 24h)`);
      }
    }
    const unique = Array.from(new Set(body.slots)).sort();
    await this.svc.setTenantSlots(tid, unique);
    return { slots: unique };
  }

  /** Reglas de reserva del tenant: días habilitados (0=Dom..6=Sáb; vacío =
   *  todos) + observaciones/términos que ve el cliente antes de reservar. */
  @Get('config/booking')
  async getBookingRules(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') tenantId?: string,
  ) {
    const tid = user.role === 'SUPER_ADMIN' ? tenantId : user.tenantId;
    if (!tid) throw new BadRequestException('tenantId requerido');
    return this.svc.getBookingRules(tid);
  }

  /** Guarda días habilitados y/o observaciones. Patch parcial: solo se
   *  actualizan los campos presentes en el body. */
  @Patch('config/booking')
  async setBookingRules(
    @CurrentUser() user: AuthUser,
    @Body() body: { days?: number[]; terms?: string | null },
    @Query('tenantId') tenantId?: string,
  ) {
    const tid = user.role === 'SUPER_ADMIN' ? tenantId : user.tenantId;
    if (!tid) throw new BadRequestException('tenantId requerido');
    const patch: { days?: number[]; terms?: string | null } = {};
    if (body?.days !== undefined) {
      if (
        !Array.isArray(body.days) ||
        body.days.some((n) => !Number.isInteger(n) || n < 0 || n > 6)
      ) {
        throw new BadRequestException('days[] debe ser enteros 0..6 (0=Dom..6=Sáb)');
      }
      patch.days = Array.from(new Set(body.days)).sort((a, b) => a - b);
    }
    if (body?.terms !== undefined) {
      if (body.terms !== null && typeof body.terms !== 'string') {
        throw new BadRequestException('terms debe ser texto o null');
      }
      const trimmed = typeof body.terms === 'string' ? body.terms.trim() : null;
      if (trimmed && trimmed.length > 2000) {
        throw new BadRequestException('terms máximo 2000 caracteres');
      }
      patch.terms = trimmed || null;
    }
    await this.svc.setBookingRules(tid, patch);
    return this.svc.getBookingRules(tid);
  }

  /** KPIs del día (Agenda header): reservas + comparación vs ayer,
   *  pax esperados, % ocupación + peak hour, no-show count + %. */
  @Get('daily-kpis')
  dailyKpis(
    @CurrentUser() user: AuthUser,
    @Query('date') date: string,
    @Query('locationId') locationId?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.dailyKpis(user, { date, locationId, tenantId });
  }

  /** Métricas agregadas para el dashboard de /app/reservations. Default:
   *  últimos 30 días + próximos 7. */
  @Get('stats')
  stats(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.stats(user, { from, to, tenantId });
  }

  /** PDF 2026-06-30: envía una notificación de PRUEBA al número receptor de
   *  reservas configurado, para validar la config desde /app/settings#reservas. */
  @Post('test-notification')
  testNotification(@CurrentUser() user: AuthUser) {
    return this.svc.sendTestNotification(user);
  }

  /** Disponibilidad por slot — útil para el admin antes de crear una
   *  reserva manual. zoneId / locationId opcionales. */
  @Get('availability')
  async availability(
    @CurrentUser() user: AuthUser,
    @Query('date') date: string,
    @Query('party', new DefaultValuePipe(2)) party: string,
    @Query('zoneId') zoneId?: string,
    @Query('locationId') locationId?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('date YYYY-MM-DD requerido');
    }
    const tid = user.role === 'SUPER_ADMIN' ? tenantId : user.tenantId;
    if (!tid) throw new BadRequestException('tenantId requerido');
    const partyNum = Math.max(1, parseInt(party, 10) || 2);
    const slots = await this.svc.getAvailability(
      tid,
      date,
      partyNum,
      zoneId ?? null,
      locationId ?? null,
    );
    return {
      date,
      party: partyNum,
      zoneId: zoneId ?? null,
      locationId: locationId ?? null,
      slots,
    };
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: ReservationBody,
    @Query('tenantId') tenantId?: string,
    @Query('force') force?: string,
  ) {
    return this.svc.create(user, body, tenantId, { force: force === 'true' });
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
