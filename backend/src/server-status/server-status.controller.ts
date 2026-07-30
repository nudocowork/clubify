import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { IsEmail, IsInt, IsOptional, Min, ValidateIf } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { ServerStatusService } from './server-status.service';

/**
 * DTO de configuración del módulo. forbidNonWhitelisted global exige declarar
 * cada campo aceptado (memoria: campos nuevos DEBEN ir en el Body DTO).
 */
class SetServerStatusConfigDto {
  /** Capacidad del volumen de la BD en bytes (0/omitido = usar Railway/estimado). */
  @IsOptional()
  @IsInt()
  @Min(0)
  dbLimitBytes?: number;

  /** Email para alertas de capacidad. Cadena vacía = limpiar. */
  @IsOptional()
  @ValidateIf((o) => o.alertEmail !== '' && o.alertEmail != null)
  @IsEmail()
  alertEmail?: string;
}

/**
 * Estado del Servidor (/superadmin → Plataforma). Solo PLATFORM_OWNER /
 * SUPER_ADMIN. Guards globales (JwtAuthGuard + RolesGuard) → aquí solo @Roles.
 * Todo es solo-lectura salvo /config (Setting) y /snapshot (inserta una fila
 * de métricas). Nada muta datos de negocio.
 */
@Controller('admin/server-status')
@Roles('PLATFORM_OWNER', 'SUPER_ADMIN')
export class ServerStatusController {
  constructor(private readonly svc: ServerStatusService) {}

  @Get('overview')
  overview() {
    return this.svc.overview();
  }

  @Get('tables')
  tables() {
    return this.svc.tables();
  }

  @Get('brands')
  brands() {
    return this.svc.perBrand();
  }

  @Get('heavy-data')
  heavyData() {
    return this.svc.heavyData();
  }

  @Get('services')
  services() {
    return this.svc.services();
  }

  @Get('slow-queries')
  slowQueries() {
    return this.svc.slowQueries();
  }

  @Get('config')
  config() {
    return this.svc.getConfig();
  }

  @Patch('config')
  setConfig(@Body() dto: SetServerStatusConfigDto) {
    return this.svc.setConfig(dto);
  }

  @Post('snapshot')
  snapshot() {
    return this.svc.takeSnapshot('manual');
  }
}
