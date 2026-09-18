import { Body, Controller, ForbiddenException, Get, Patch, Post } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { BillingService } from './billing.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { describirVentana } from './ventana-de-envio';

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

  /** Fase 3 — envío de PRUEBA de las alertas de cobro a los 3 números. */
  @Roles('SUPER_ADMIN', 'PLATFORM_OWNER')
  @Post('billing-alerts/test')
  async testBillingAlerts() {
    return this.svc.testBillingTeamAlert();
  }
}
