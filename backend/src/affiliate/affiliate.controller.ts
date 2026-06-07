import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { AffiliateService } from './affiliate.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('affiliate')
@Roles(
  'AFFILIATE_INFLUENCER',
  'AFFILIATE_AMBASSADOR',
  'AFFILIATE_SOCIO',
  'AFFILIATE_VENDOR',
)
export class AffiliateController {
  constructor(private svc: AffiliateService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.svc.me(user);
  }

  // Dashboard con KPIs agregados, timeline 30d, ranking embajadores
  // (cuando aplica) y atribución por fuente (UTM). Reemplaza el "Resumen"
  // genérico con vista granular tipo CRM premium.
  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthUser) {
    return this.svc.dashboard(user);
  }

  @Get('clients')
  clients(@CurrentUser() user: AuthUser) {
    return this.svc.clients(user);
  }

  @Get('commissions')
  commissions(@CurrentUser() user: AuthUser) {
    return this.svc.commissions(user);
  }

  @Patch('me')
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body() body: { fullName?: string; phone?: string },
  ) {
    return this.svc.updateProfile(user, body);
  }

  @Post('ambassadors')
  createAmbassador(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      fullName: string;
      email: string;
      whatsapp: string;
      commissionPercent?: number;
      password?: string;
    },
  ) {
    return this.svc.createAmbassadorAsInfluencer(user, body);
  }

  /**
   * Proyección de próximas renovaciones — calcula sobre la base de los
   * tenants ACTIVE con currentPeriodEnd próximo. NO crea Commission rows
   * (solo cálculo). Disclaimer en la respuesta: "Proyección, no contractual".
   */
  @Get('projected-renewals')
  projectedRenewals(@CurrentUser() user: AuthUser) {
    return this.svc.projectedRenewals(user);
  }

  /**
   * Vista del equipo del embajador: lista de sus vendedores con métricas.
   * Solo accesible a AFFILIATE_AMBASSADOR (o SUPER_ADMIN impersonando).
   */
  @Get('team')
  team(@CurrentUser() user: AuthUser) {
    return this.svc.teamForEmbajador(user);
  }

  /**
   * Drill-down read-only de un vendedor del equipo (el embajador puede
   * ver clientes + comisiones de un vendor específico).
   */
  @Get('team/vendors/:vendorCodeId')
  teamVendorDetail(
    @CurrentUser() user: AuthUser,
    @Param('vendorCodeId') vendorCodeId: string,
  ) {
    return this.svc.teamVendorDetail(user, vendorCodeId);
  }

  /**
   * INFLUENCER drill-down: vendedores de UN embajador específico, con
   * métricas (referrals/conversions/revenue). El backend valida que el
   * embajador sea hijo del influencer logueado. Item Fase C 2026-06-07.
   */
  @Get('ambassadors/:codeId/vendors')
  ambassadorVendors(
    @CurrentUser() user: AuthUser,
    @Param('codeId') codeId: string,
  ) {
    return this.svc.ambassadorVendorsForInfluencer(user, codeId);
  }

  /**
   * Métricas + detalle de trials atribuidos al afiliado logueado (item 4
   * — 2026-06-05). Scopeado a SU código (resolveAffiliateScope):
   *   - INFLUENCER ve trials de su code + de sus embajadores + de sus
   *     vendors (cadena completa).
   *   - AMBASSADOR ve trials de su code + de sus vendors.
   *   - VENDOR ve solo trials de su propio code.
   * Devuelve KPIs (generados, activos, vencidos, convertidos, tasa) y
   * tabla detalle de tenants con estado del trial, vencimiento y plan.
   */
  @Get('trial-stats')
  trialStats(@CurrentUser() user: AuthUser) {
    return this.svc.trialStats(user);
  }
}
