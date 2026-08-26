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
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';
import { ConveniosService } from './convenios.service';
import { ConveniosCanjeService } from './convenios-canje.service';

class ConvenioBody {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(500) logoUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsString() @MaxLength(120) contactName?: string | null;
  @IsOptional() @IsString() @MaxLength(160) contactEmail?: string | null;
  @IsOptional() @IsString() @MaxLength(40) contactPhone?: string | null;
  @IsOptional() @IsIn(['ABIERTO', 'CODIGO', 'LISTA'])
  verificacion?: 'ABIERTO' | 'CODIGO' | 'LISTA';
  @IsOptional() @IsString() @MaxLength(40) codigo?: string | null;
  @IsOptional() @IsIn(['ACTIVE', 'PAUSED', 'FINISHED'])
  status?: 'ACTIVE' | 'PAUSED' | 'FINISHED';
  @IsOptional() @IsString() endsAt?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) sedeIds?: string[];
}

class CuponBody {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsIn(['PERCENT_OFF', 'AMOUNT_OFF', 'FREEBIE', 'TWO_FOR_ONE', 'OTHER'])
  tipo?: any;
  @IsOptional() @IsInt() @Min(0) valor?: number;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsString() @MaxLength(2000) terms?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(1) maxPorPersona?: number | null;
  @IsOptional() @IsIn(['SIEMPRE', 'DIA', 'SEMANA', 'MES', 'ANIO']) periodo?: any;
  @IsOptional() @IsInt() @Min(1) maxTotal?: number | null;
  @IsOptional() @IsInt() @Min(0) compraMinima?: number | null;
  @IsOptional() @IsInt() @Min(0) topeDescuento?: number | null;
  @IsOptional() @IsString() endsAt?: string | null;
}

class CanjeBody {
  @IsString() tarjetaId!: string;
  @IsString() cuponId!: string;
  @IsOptional() @IsString() locationId?: string | null;
  @IsOptional() @IsInt() @Min(0) compraMonto?: number | null;
}

/**
 * Panel del negocio. `tenantId` por query solo lo usa un SUPER_ADMIN que entra
 * al negocio desde el panel de admin; para todos los demás sale del token.
 */
@Controller('convenios')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
export class ConveniosController {
  constructor(
    private svc: ConveniosService,
    private canje: ConveniosCanjeService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.list(user, tenantId);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.get(user, id, tenantId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: ConvenioBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.create(user, body as any, tenantId);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: ConvenioBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.update(user, id, body as any, tenantId);
  }

  @Post(':id/cupones')
  crearCupon(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: CuponBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.crearCupon(user, id, body as any, tenantId);
  }

  /** Incluye el interruptor: `PATCH { isActive: false }` apaga el cupón. */
  @Patch('cupones/:cuponId')
  actualizarCupon(
    @CurrentUser() user: AuthUser,
    @Param('cuponId') cuponId: string,
    @Body() body: CuponBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.actualizarCupon(user, cuponId, body as any, tenantId);
  }

  @Delete('cupones/:cuponId')
  borrarCupon(
    @CurrentUser() user: AuthUser,
    @Param('cuponId') cuponId: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.borrarCupon(user, cuponId, tenantId);
  }

  // ─────────────────────────── Caja / escáner ───────────────────────────

  /** Qué mostrarle al cajero tras escanear una tarjeta de convenio. */
  @Get('caja/pase/:passId')
  resolverCaja(
    @CurrentUser() user: AuthUser,
    @Param('passId') passId: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.canje.resolverParaCaja(user, passId, locationId ?? null);
  }

  @Post('caja/canjear')
  canjear(@CurrentUser() user: AuthUser, @Body() body: CanjeBody) {
    return this.canje.canjear(user, body);
  }

  @Post('caja/anular/:canjeId')
  anular(@CurrentUser() user: AuthUser, @Param('canjeId') canjeId: string) {
    return this.canje.anular(user, canjeId);
  }
}
