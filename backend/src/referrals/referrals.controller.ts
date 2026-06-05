import { Body, Controller, Delete, Get, Headers, Ip, Param, Patch, Post, Query } from '@nestjs/common';
import { IsBoolean, IsEmail, IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CommissionStatus } from '@prisma/client';
import { ReferralsService } from './referrals.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';

class CreateReferralBody {
  @IsString() fullName!: string;
  @IsEmail() email!: string;
  @IsString() whatsapp!: string;
  @IsOptional() @IsNumber() commissionPercent?: number;
  @IsOptional() @IsString() source?: string;
  // Si el aplicante tipea una password, le auto-creamos cuenta
  // AFFILIATE_INFLUENCER en el momento y puede entrar a /app/referrals
  // sin esperar aprobación admin.
  @IsOptional() @IsString() @MinLength(8) @MaxLength(64) password?: string;
}

class CommissionBody {
  @IsString() status!: CommissionStatus;
}

// HOTFIX 2026-06-05: estas clases tienen que estar declaradas ANTES de
// ReferralsController. Aunque TS compila si están abajo, en runtime
// los decoradores @Body() del controller las referencian al evaluar
// __metadata("design:paramtypes", ...) en el class declaration —
// temporal dead zone si todavía no se ejecutó la línea de class.
class VendorBody {
  @IsString() embajadorCodeId!: string;
  @IsString() fullName!: string;
  @IsEmail() email!: string;
  @IsString() whatsapp!: string;
  @IsNumber() commissionPercent!: number;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(64) password?: string;
}

class VendorPatchBody {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() whatsapp?: string;
  @IsOptional() @IsNumber() commissionPercent?: number;
}

// FASE B1: PATCH /referrals/codes/:id/vendor-config — admin togglea
// allowVendors + setea maxCommissionPercent. Hoisted arriba por el
// mismo motivo que VendorBody (decorators @Body() resuelven al class
// declaration en module init).
class VendorConfigBody {
  @IsOptional() @IsBoolean() allowVendors?: boolean;
  @IsOptional() @IsNumber() maxCommissionPercent?: number;
}

@Controller('referrals')
export class ReferralsController {
  constructor(private svc: ReferralsService) {}

  @Public()
  @Post('codes')
  create(@Body() body: CreateReferralBody) {
    return this.svc.createCode(body);
  }

  // Rutas con paths fijos primero (defense-in-depth: NestJS matchea por
  // orden de declaración cuando hay path params).
  @Roles('SUPER_ADMIN')
  @Get('summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.svc.adminSummary(user);
  }

  @Roles('SUPER_ADMIN')
  @Get('influencers')
  influencers(@CurrentUser() user: AuthUser) {
    return this.svc.listInfluencers(user);
  }

  @Roles('SUPER_ADMIN')
  @Get('ambassadors')
  ambassadors(@CurrentUser() user: AuthUser) {
    return this.svc.listAmbassadors(user);
  }

  @Roles('SUPER_ADMIN')
  @Get('clients')
  clients(@CurrentUser() user: AuthUser) {
    return this.svc.listClients(user);
  }

  @Roles('SUPER_ADMIN')
  @Get('config')
  getConfig(@CurrentUser() user: AuthUser) {
    return this.svc.getConfig(user);
  }

  @Roles('SUPER_ADMIN')
  @Patch('config')
  setConfig(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.setConfig(user, body);
  }

  @Roles('SUPER_ADMIN')
  @Get('pending-ambassadors')
  pendingAmbassadors(@CurrentUser() user: AuthUser) {
    return this.svc.listPendingAmbassadors(user);
  }

  @Roles('SUPER_ADMIN')
  @Post('ambassadors/:id/approve')
  approveAmbassador(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.approveAmbassador(user, id);
  }

  @Roles('SUPER_ADMIN')
  @Post('ambassadors/:id/reject')
  rejectAmbassador(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.rejectAmbassador(user, id);
  }

  /** Convierte un embajador en influencer. Preserva historial + referidos.
   *  Útil al crear una campaña: en vez de crear influencer de cero, puedes
   *  promover a un embajador con track record probado. */
  @Roles('SUPER_ADMIN')
  @Post('ambassadors/:id/promote-to-influencer')
  promoteAmbassadorToInfluencer(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.svc.promoteAmbassadorToInfluencer(user, id);
  }

  /** Convierte un INFLUENCER en AMBASSADOR colgándolo de otro influencer.
   *  Preserva clientes y comisiones — solo cambia role + parent. */
  @Roles('SUPER_ADMIN')
  @Post('influencers/:id/demote-to-ambassador')
  demoteInfluencerToAmbassador(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { newParentId: string },
  ) {
    return this.svc.demoteInfluencerToAmbassador(user, id, body.newParentId);
  }

  /** Cambia el parentCode de un AMBASSADOR a otro INFLUENCER. Preserva
   *  clientes y comisiones — solo cambia el parent. */
  @Roles('SUPER_ADMIN')
  @Post('ambassadors/:id/reassign-parent')
  reassignAmbassadorParent(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { newParentId: string },
  ) {
    return this.svc.reassignAmbassadorParent(user, id, body.newParentId);
  }

  @Roles('SUPER_ADMIN')
  @Post('socio')
  createOrInviteSocio(
    @CurrentUser() user: AuthUser,
    @Body() body: { fullName: string; email: string; whatsapp: string; commissionPercent?: number; customCode?: string },
  ) {
    return this.svc.createOrInviteSocio(user, body);
  }

  // "Embajador Directo Empresa" — AMBASSADOR sin influencer parent.
  // Reporta directo a la empresa, no a un influencer. Mismo % de comisión
  // que un embajador normal, pero el 5% indirecto no va a nadie.
  @Roles('SUPER_ADMIN')
  @Post('ambassadors/company-direct')
  createCompanyDirectAmbassador(
    @CurrentUser() user: AuthUser,
    @Body() body: { fullName: string; email: string; whatsapp: string; commissionPercent?: number; customCode?: string },
  ) {
    return this.svc.createCompanyDirectAmbassador(user, body);
  }

  @Roles('SUPER_ADMIN')
  @Get('leaderboard')
  leaderboard(@CurrentUser() user: AuthUser) {
    return this.svc.leaderboard(user);
  }

  /**
   * Buscador inteligente de afiliados (INFLUENCER + AMBASSADOR activos)
   * por nombre, email, whatsapp o código. Usado por
   * /admin/tenants/new para reemplazar el dropdown estático.
   * Devuelve hasta 30 resultados ordenados por role + nombre.
   */
  @Roles('SUPER_ADMIN')
  @Get('affiliates/search')
  searchAffiliates(
    @CurrentUser() user: AuthUser,
    @Query('q') q?: string,
  ) {
    return this.svc.searchAffiliates(user, q ?? '');
  }

  /**
   * Eliminación de un ReferralCode (influencer/embajador/socio).
   * Valida dependencias activas:
   *   - Tenants activos atribuidos → 409 con mensaje específico.
   *   - Embajadores activos debajo (si es INFLUENCER) → 409.
   *   - Campaign ACTIVE titularizada (si es INFLUENCER) → 409.
   * Si pasa: soft-delete si tiene historial, hard-delete si está limpio.
   */
  @Roles('SUPER_ADMIN')
  @Delete('codes/:id')
  deleteCode(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteCode(user, id);
  }

  // SUPER_ADMIN entra al panel /affiliate del influencer/embajador como si
  // fuera el dueño del código. JWT lleva `impersonatedBy` para auditoría.
  @Roles('SUPER_ADMIN')
  @Post('codes/:id/impersonate')
  impersonateAffiliate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.impersonateAffiliate(id, user.id);
  }

  // Visit summary: visitas + clicks únicos por slug (últimos N días).
  // Útil para que el admin vea cuáles links están corriendo y cuáles no.
  @Roles('SUPER_ADMIN')
  @Get('visits-summary')
  visitsSummary(
    @CurrentUser() user: AuthUser,
    @Query('days') days?: string,
  ) {
    const n = Math.max(1, Math.min(90, Number(days ?? '30') || 30));
    return this.svc.visitsSummary(user, n);
  }

  @Roles('SUPER_ADMIN')
  @Get('payouts')
  payouts(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('q') q?: string,
  ) {
    return this.svc.payouts(user, {
      status: status as any,
      dateFrom,
      dateTo,
      q,
    });
  }

  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  @Get('me')
  listMine(@CurrentUser() user: AuthUser) {
    return this.svc.listMine(user);
  }

  @Public()
  @Get('codes/:code')
  getByCode(@Param('code') code: string) {
    return this.svc.getByCode(code);
  }

  // Resolución pública de `slug` → ReferralCode. Usado por la route
  // Next `/ref/<slug>`. Loguea visita en ReferralVisit con UTM + referer.
  @Public()
  @Get('by-slug/:slug')
  resolveSlug(
    @Param('slug') slug: string,
    @Query('utm_source') utmSource?: string,
    @Query('utm_medium') utmMedium?: string,
    @Query('utm_campaign') utmCampaign?: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('referer') referer?: string,
    @Headers('cf-ipcountry') country?: string,
    @Ip() ip?: string,
  ) {
    return this.svc.resolveBySlug(slug, {
      utmSource,
      utmMedium,
      utmCampaign,
      userAgent,
      referer,
      country,
      ip,
    });
  }

  @Roles('SUPER_ADMIN')
  @Patch('codes/:id/slug')
  setSlug(
    @Param('id') id: string,
    @Body() body: { slug: string | null },
  ) {
    return this.svc.setSlug(id, body.slug);
  }

  @Roles('SUPER_ADMIN')
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.svc.list(user);
  }

  @Roles('SUPER_ADMIN')
  @Post('uses/:id/commission')
  createCommission(@Param('id') id: string, @Body() body: { amount: number }) {
    return this.svc.createCommission(id, body.amount);
  }

  @Roles('SUPER_ADMIN')
  @Patch('commissions/:id')
  setStatus(@Param('id') id: string, @Body() body: CommissionBody) {
    return this.svc.setCommissionStatus(id, body.status);
  }

  @Roles('SUPER_ADMIN')
  @Patch('commissions/:id/notes')
  setNotes(
    @Param('id') id: string,
    @Body() body: { notes?: string | null; markContacted?: boolean },
  ) {
    return this.svc.setCommissionNotes(id, body);
  }

  /**
   * Asignación manual de un tenant existente a un ReferralCode
   * (influencer/embajador). El super admin lo usa desde la página del
   * tenant para conectar negocios que se crearon SIN venir de un link
   * `/ref/<slug>` pero deben atribuirse a alguien.
   *
   * GET devuelve el ReferralUse actual del tenant (con role + code +
   * campaign) o null.
   * PATCH con `{ referralCodeId: null }` desasigna; con un id, crea o
   * actualiza el ReferralUse del tenant. La asignación es 1:1 (solo
   * tenemos el último ReferralUse activo del tenant).
   */
  @Roles('SUPER_ADMIN')
  @Get('tenants/:tenantId/assignment')
  getTenantAssignment(@Param('tenantId') tenantId: string) {
    return this.svc.getTenantAssignment(tenantId);
  }

  @Roles('SUPER_ADMIN')
  @Patch('tenants/:tenantId/assignment')
  setTenantAssignment(
    @Param('tenantId') tenantId: string,
    @Body() body: { referralCodeId: string | null },
  ) {
    return this.svc.setTenantAssignment(tenantId, body.referralCodeId ?? null);
  }

  /**
   * Fuerza la generación de comisión retroactiva para la asignación
   * actual del tenant. Útil cuando se asignó antes del fix y la
   * comisión nunca se generó (no llegó un pago Hotmart después).
   * Idempotente: no-op si ya hay commission reciente (<25 días).
   *
   * `?force=true` saltea el chequeo de currentPeriodEnd — útil para
   * tenants creados manualmente sin ciclo de billing tracking.
   * SUPER_ADMIN responsable de saber que el tenant efectivamente paga.
   */
  @Roles('SUPER_ADMIN')
  @Post('tenants/:tenantId/backfill-commission')
  backfillCommission(
    @Param('tenantId') tenantId: string,
    @Query('force') force?: string,
  ) {
    return this.svc.backfillCommissionForCurrentAssignment(
      tenantId,
      force === 'true' || force === '1',
    );
  }

  // ============================================================
  // VENDOR ENDPOINTS — FASE FOUNDATION
  // ============================================================

  /**
   * SUPER_ADMIN: togglea el módulo de vendedores de un embajador y
   * setea la comisión máxima que puede repartir. UI: tab Embajadores
   * del admin de referrals.
   */
  @Roles('SUPER_ADMIN')
  @Patch('codes/:id/vendor-config')
  setVendorConfig(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: VendorConfigBody,
  ) {
    return this.svc.setEmbajadorVendorConfig(user, id, body);
  }

  @Roles('SUPER_ADMIN', 'AFFILIATE_AMBASSADOR')
  @Post('vendors')
  createVendor(
    @CurrentUser() user: AuthUser,
    @Body() body: VendorBody,
  ) {
    return this.svc.createVendor(user, body);
  }

  @Roles('SUPER_ADMIN', 'AFFILIATE_AMBASSADOR')
  @Get('vendors/by-embajador/:embajadorCodeId')
  listVendors(
    @CurrentUser() user: AuthUser,
    @Param('embajadorCodeId') embajadorCodeId: string,
  ) {
    return this.svc.listVendorsForEmbajador(user, embajadorCodeId);
  }

  @Roles('SUPER_ADMIN', 'AFFILIATE_AMBASSADOR')
  @Patch('vendors/:id')
  updateVendor(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: VendorPatchBody,
  ) {
    return this.svc.updateVendor(user, id, body);
  }

  @Roles('SUPER_ADMIN', 'AFFILIATE_AMBASSADOR')
  @Post('vendors/:id/deactivate')
  deactivateVendor(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.svc.deactivateVendor(user, id);
  }

  @Roles('SUPER_ADMIN', 'AFFILIATE_AMBASSADOR')
  @Post('vendors/:id/reactivate')
  reactivateVendor(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.svc.reactivateVendor(user, id);
  }

  @Roles('SUPER_ADMIN', 'AFFILIATE_AMBASSADOR')
  @Delete('vendors/:id')
  deleteVendor(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.svc.deleteVendor(user, id);
  }
}
