import { Controller, Get, Query } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@Controller('metrics')
export class MetricsController {
  constructor(private svc: MetricsService) {}

  @Get('global')
  global(@CurrentUser() user: AuthUser) {
    return this.svc.global(user);
  }

  @Get('tenant')
  tenant(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.tenant(user, tenantId);
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
}
