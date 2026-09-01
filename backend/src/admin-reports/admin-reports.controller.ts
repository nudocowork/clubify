import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { AdminReportsService } from './admin-reports.service';
import { CobrosService, type CobrosBucket } from './cobros.service';

/** Mapea el chip de rango del dashboard de cobros a una ventana en días. */
function rangeToDays(range: string | undefined, bucket: CobrosBucket): number {
  switch (range) {
    case 'hoy':
    case 'today':
      return 1;
    case '7d':
      return 7;
    case '15d':
      return 15;
    case '30d':
      return 30;
    case 'este-mes':
    case 'this-month':
      return 30;
    case 'proximo-mes':
    case 'next-month':
      return 60;
    case 'todos':
    case 'all':
      // Sin recorte: ~100 años atrás. Para que la LISTA de "no procesados"
      // muestre también las suspensiones viejas y cuadre con el CONTEO de la
      // tarjeta (que nunca filtra por fecha). En próximos/procesados no se usa.
      return 36500;
    default:
      return bucket === 'no-procesados' ? 30 : 7;
  }
}

// IMPORTANT: DTOs ANTES del @Controller — sino @Body() las referencia en
// temporal dead zone y rompe el boot.
class RankingsQuery {
  @IsIn(['INFLUENCER', 'AMBASSADOR', 'VENDOR'])
  role!: 'INFLUENCER' | 'AMBASSADOR' | 'VENDOR';

  @IsIn(['sales', 'revenue', 'commissions'])
  metric!: 'sales' | 'revenue' | 'commissions';

  @IsIn(['7d', '30d', '90d', 'all'])
  range!: '7d' | '30d' | '90d' | 'all';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/**
 * Endpoints administrativos: reportes (embajadores + vendedores),
 * rankings unificados y métricas de dashboard. Todos SUPER_ADMIN-only.
 *
 * Convención de paths: `/admin/reports/*`, `/admin/rankings`,
 * `/admin/dashboard/metrics`. Mantenidos separados del AdminController
 * (que es tenant-scoped) para no mezclar guards y para tener un módulo
 * dedicado a reporting.
 */
@Controller('admin')
@Roles('SUPER_ADMIN')
export class AdminReportsController {
  constructor(
    private svc: AdminReportsService,
    private cobros: CobrosService,
  ) {}

  // ─────────── Reportes por embajador ───────────
  @Get('reports/ambassadors')
  listAmbassadors(@CurrentUser() user: AuthUser) {
    return this.svc.listAmbassadors(user);
  }

  @Get('reports/ambassadors/:id')
  ambassadorDetail(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.svc.ambassadorDetail(user, id);
  }

  // ─────────── Reportes por vendedor ───────────
  @Get('reports/vendors')
  listVendors(@CurrentUser() user: AuthUser) {
    return this.svc.listVendors(user);
  }

  @Get('reports/vendors/:id')
  vendorDetail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.vendorDetail(user, id);
  }

  // ─────────── Rankings ───────────
  @Get('rankings')
  rankings(@CurrentUser() user: AuthUser, @Query() q: RankingsQuery) {
    return this.svc.rankings(user, {
      role: q.role,
      metric: q.metric,
      range: q.range,
      limit: q.limit,
    });
  }

  // ─────────── Dashboard metrics ───────────
  @Get('dashboard/metrics')
  dashboardMetrics(@CurrentUser() user: AuthUser) {
    return this.svc.dashboardMetrics(user);
  }

  /**
   * Dashboard v2 (Fase G 2026-06-07). Acepta rango de fechas y devuelve
   * banner + 4 KPIs + estado clientes + últimos ingresos + mapa.
   */
  @Get('dashboard/metrics-v2')
  dashboardMetricsV2(
    @CurrentUser() user: AuthUser,
    @Query('range') range?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.dashboardMetricsV2(user, { range, from, to });
  }

  /**
   * Fase 5 — detalle de una tarjeta de cobros (🔴 proximos / 🟢 procesados /
   * 🟡 no-procesados). `range` mapea a una ventana de días. Mismo aislamiento
   * por marca que metrics-v2 (wlId de la sesión).
   */
  @Get('dashboard/cobros/:bucket')
  cobrosDetail(
    @CurrentUser() user: AuthUser,
    @Param('bucket') bucket: string,
    @Query('range') range?: string,
  ) {
    const valid: CobrosBucket[] = ['proximos', 'procesados', 'no-procesados'];
    const b = (valid.includes(bucket as CobrosBucket) ? bucket : 'proximos') as CobrosBucket;
    const days = rangeToDays(range, b);
    return this.cobros.detail(user.whiteLabelId ?? null, b, new Date(), { days });
  }

  /** P2 (PDF 2026-07-02): lista de empresas (y grupos) que componen el "Monto
   *  facturado" del rango — para auditar exactamente qué se contabiliza. */
  @Get('dashboard/billed-companies')
  billedCompanies(
    @CurrentUser() user: AuthUser,
    @Query('range') range?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.billedCompanies(user, { range, from, to });
  }

  // ─────────── Créditos por marca (Fase 3 · #6 / #7) ───────────
  /** Resumen de créditos de la marca del admin + links de compra +
   *  historial. 403 si el admin es global (Clubify). */
  @Get('credits')
  myCredits(@CurrentUser() user: AuthUser) {
    return this.svc.myCredits(user);
  }

  /** Negocios de la marca pendientes de activación/renovación. */
  @Get('credits/pending')
  pendingTenants(@CurrentUser() user: AuthUser) {
    return this.svc.listPendingTenants(user);
  }

  /** Activa manualmente un negocio consumiendo 1 crédito. */
  @Post('credits/activate/:tenantId')
  activateTenant(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
  ) {
    return this.svc.activateTenant(user, tenantId);
  }

  /** Reembolsa un consumo de crédito (ventana 5 días): devuelve el crédito al
   *  pool y suspende el negocio. */
  @Post('credits/refund/:transactionId')
  refundCredit(
    @CurrentUser() user: AuthUser,
    @Param('transactionId') transactionId: string,
  ) {
    return this.svc.refundCredit(user, transactionId);
  }
}
