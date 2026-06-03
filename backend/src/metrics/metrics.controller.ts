import { Body, Controller, Get, Logger, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { MetricsService } from './metrics.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';

/** Beacon de rendimiento del form /c/[cardId]. Sin DB — emite warnings
 *  al logger cuando TTI supera el threshold. Centralizar el threshold
 *  acá facilita ajustar la sensibilidad sin tocar el frontend. */
class EnrollPerfDto {
  @IsString() @MaxLength(80) cardId!: string;
  @IsInt() @Min(0) @Max(120_000) ttiMs!: number;
  @IsOptional() @IsInt() @Min(0) @Max(120_000) loadMs?: number;
  @IsOptional() @IsString() @MaxLength(8) source?: 'cache' | 'network';
  @IsOptional() @IsString() @MaxLength(300) userAgent?: string;
}

const SLOW_ENROLL_TTI_MS = 3000;

@Controller('metrics')
export class MetricsController {
  private readonly perfLogger = new Logger('PerfMetrics');
  constructor(private svc: MetricsService) {}

  /** Beacon público del form /c/[cardId]. El browser lo manda con
   *  `keepalive: true` así que no requiere auth ni cuenta — solo
   *  throttle anti-flood (60/min/IP). Log WARN si TTI ≥ 3s para que
   *  los log shippers (Sentry/CloudWatch) alerten regresiones. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Post('enroll-perf')
  trackEnrollPerf(@Body() body: EnrollPerfDto) {
    if (body.ttiMs >= SLOW_ENROLL_TTI_MS) {
      this.perfLogger.warn(
        `SLOW_ENROLL_TTI cardId=${body.cardId} tti=${body.ttiMs}ms ` +
          `load=${body.loadMs ?? '?'}ms source=${body.source ?? '?'} ` +
          `ua="${(body.userAgent ?? '').slice(0, 120)}"`,
      );
    }
    return { ok: true };
  }

  @Get('cards/:id')
  cardMetrics(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.cardMetrics(user, id);
  }

  @Get('global')
  global(@CurrentUser() user: AuthUser) {
    return this.svc.global(user);
  }

  @Get('tenant')
  tenant(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.tenant(user, tenantId);
  }

  @Get('insights')
  insights(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.insights(user, tenantId);
  }

  @Get('activity')
  activity(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.activity(user, tenantId);
  }

  @Get('funnel/orders')
  funnelOrders(
    @CurrentUser() user: AuthUser,
    @Query('days') days?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.funnelOrders(user, days ? Number(days) : 30, tenantId);
  }

  @Get('funnel/loyalty')
  funnelLoyalty(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.funnelLoyalty(user, tenantId);
  }

  @Get('funnel/customers')
  funnelCustomers(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.funnelCustomers(user, tenantId);
  }

  @Get('timeseries/orders')
  timeseriesOrders(
    @CurrentUser() user: AuthUser,
    @Query('days') days?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.timeseriesOrders(user, days ? Number(days) : 30, tenantId);
  }

  @Get('heatmap/orders')
  heatmapOrders(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.heatmapOrders(user, tenantId);
  }

  @Get('onboarding-status')
  onboardingStatus(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.onboardingStatus(user, tenantId);
  }
}
