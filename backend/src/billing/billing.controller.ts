import { Body, Controller, ForbiddenException, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min } from 'class-validator';
import { BillingService } from './billing.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { describirVentana } from './ventana-de-envio';
import { SoloPlataformaGuard } from '../common/guards/solo-plataforma.guard';
import { MAX_MENSAJE, MAX_URL } from './datos-de-pago-manual';

class CancelDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

class GraceDto {
  @IsInt() @Min(1) @Max(30) graceDays!: number;
}

class VentanaDto {
  @IsOptional() @IsInt() @Min(0) @Max(23) desde?: number;
  @IsOptional() @IsInt() @Min(1) @Max(24) hasta?: number;
  @IsOptional() @IsString() zona?: string;
}

/** Lo que se edita en /admin/pagos-manuales. Todo opcional: se mezcla con lo guardado. */
class DatosDePagoDto {
  @IsOptional() @IsBoolean() activo?: boolean;
  // Se valida aquí además de en el saneado para que el admin VEA el error: el
  // saneado, por diseño, cae en silencio a la imagen de fábrica.
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'La imagen debe ser un enlace https://' })
  @MaxLength(MAX_URL)
  imagenUrl?: string;
  @IsOptional() @IsString() @MaxLength(MAX_MENSAJE) mensaje?: string;
}

@Controller('billing')
export class BillingController {
  constructor(private svc: BillingService) {}

  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  @Get('status')
  async status(@CurrentUser() user: AuthUser) {
    if (!user.tenantId) {
      return { status: 'EXPIRED', isActiveAccess: false, daysLeftInTrial: null };
    }
    return this.svc.getStatus(user.tenantId);
  }

  @Roles('TENANT_OWNER')
  @Post('cancel')
  async cancel(@CurrentUser() user: AuthUser, @Body() dto: CancelDto) {
    if (!user.tenantId) throw new ForbiddenException();
    return this.svc.cancelSubscription(user.tenantId, dto.reason);
  }

  @Roles('TENANT_OWNER')
  @Post('reactivate')
  async reactivate(@CurrentUser() user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException();
    return this.svc.reactivate(user.tenantId);
  }

  /** Endpoint admin para correr el check manualmente. Útil mientras no hay cron. */
  @Roles('SUPER_ADMIN')
  @Post('run-daily-check')
  async runCheck() {
    return this.svc.runDailyCheck();
  }

  /** PDF 1256 §2/§7: período de gracia (días de mora antes de pausar) configurable. */
  @Roles('SUPER_ADMIN', 'PLATFORM_OWNER')
  @Get('grace-days')
  async getGrace() {
    return { graceDays: await this.svc.getGraceDays() };
  }

  @Roles('SUPER_ADMIN', 'PLATFORM_OWNER')
  @Patch('grace-days')
  async setGrace(@Body() dto: GraceDto) {
    return { graceDays: await this.svc.setGraceDays(dto.graceDays) };
  }

  /**
   * La franja horaria en la que sale el ciclo de cobro.
   *
   * Existe porque hasta el 2026-09-18 la hora era una constante del decorador
   * del cron —en UTC— y a los negocios les llegaban los recordatorios a las
   * 10 de la noche sin forma de cambiarlo. Ver `ventana-de-envio.ts`.
   */
  @Roles('SUPER_ADMIN', 'PLATFORM_OWNER')
  @Get('ventana-de-envio')
  async getVentana() {
    const ventana = await this.svc.getVentanaDeEnvio();
    return { ventana, descripcion: describirVentana(ventana) };
  }

  @Roles('SUPER_ADMIN', 'PLATFORM_OWNER')
  @Patch('ventana-de-envio')
  async setVentana(@Body() dto: VentanaDto) {
    // Devuelve lo que QUEDÓ guardado, no lo que se mandó: el saneado puede
    // corregirlo, y el panel tiene que pintar lo de verdad y no lo pedido.
    const ventana = await this.svc.setVentanaDeEnvio(dto);
    return { ventana, descripcion: describirVentana(ventana) };
  }

  /**
   * Imagen + texto que reciben los negocios de PAGO MANUAL justo después de
   * cada aviso de cobro (ver `datos-de-pago-manual.ts`).
   *
   * `SoloPlataformaGuard` además de `@Roles`: el admin de una marca blanca es
   * un SUPER_ADMIN, y estos son los datos bancarios de Clubify. Una marca no
   * puede leerlos ni —sobre todo— cambiarlos por los suyos.
   */
  @Roles('SUPER_ADMIN')
  @UseGuards(SoloPlataformaGuard)
  @Get('datos-de-pago-manual')
  async getDatosDePago() {
    return { datos: await this.svc.getDatosDePagoManual() };
  }

  @Roles('SUPER_ADMIN')
  @UseGuards(SoloPlataformaGuard)
  @Patch('datos-de-pago-manual')
  async setDatosDePago(@Body() dto: DatosDePagoDto) {
    // Devuelve lo que QUEDÓ guardado (el saneado puede recortar el texto).
    return { datos: await this.svc.setDatosDePagoManual(dto) };
  }

  /** Fase 3 — envío de PRUEBA de las alertas de cobro a los 3 números. */
  @Roles('SUPER_ADMIN', 'PLATFORM_OWNER')
  @Post('billing-alerts/test')
  async testBillingAlerts() {
    return this.svc.testBillingTeamAlert();
  }
}
