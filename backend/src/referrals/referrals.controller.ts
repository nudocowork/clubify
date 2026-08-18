import { Body, Controller, Delete, Get, Headers, Ip, Param, Patch, Post, Query, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsEmail, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CommissionStatus } from '@prisma/client';
import { ReferralsService } from './referrals.service';
import { CutoffService } from './cutoff.service';
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
  // #4 (2026-06-16): al rechazar (REJECTED) una comisión, cascada a las
  // hermanas de la MISMA venta (mismo referralUse + periodKey →
  // influencer/embajador/vendedor del mismo cobro). Default true porque en
  // el panel principal rechazar = "esta venta se cae" (reembolso/atribución
  // errónea). Solo aplica cuando status === REJECTED.
  @IsOptional() @IsBoolean() cascade?: boolean;
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

// FASE self-register: el embajador setea el % por defecto que se aplica
// cuando un vendedor se autoregistra. Hoisted arriba por la temporal
// dead zone de los @Body() decorators.
class DefaultVendorCommissionBody {
  // null para resetear al fallback (10%). Number > 0 para fijar.
  @IsOptional() @IsNumber() defaultVendorCommissionPercent?: number | null;
}

// Body del autoregistro público (sin auth). Todo viene del form en
// /seller/register/<ambassadorCode>.
class SelfRegisterVendorBody {
  @IsString() @MinLength(3) @MaxLength(40) ambassadorCode!: string;
  @IsString() @MinLength(2) @MaxLength(80) fullName!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(6) @MaxLength(20) phone!: string;
  @IsString() @MinLength(8) @MaxLength(64) password!: string;
}

class SelfRegisterAmbassadorBody {
  @IsString() @MinLength(3) @MaxLength(40) influencerCode!: string;
  @IsString() @MinLength(2) @MaxLength(80) fullName!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(6) @MaxLength(20) phone!: string;
  @IsString() @MinLength(8) @MaxLength(64) password!: string;
}

// Autorregistro de afiliados top-level (Influencer / Embajador).
// Habilitado vía Settings desde /admin/affiliate-registration.
class SelfRegisterAffiliateBody {
  @IsIn(['INFLUENCER', 'AMBASSADOR']) role!: 'INFLUENCER' | 'AMBASSADOR';
  @IsString() @MinLength(2) @MaxLength(80) fullName!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(6) @MaxLength(20) phone!: string;
  @IsString() @MinLength(8) @MaxLength(64) password!: string;
  @IsOptional() @IsString() @MaxLength(2) country?: string;
}

// #12 (2026-06-16): admin setea/resetea la contraseña de un afiliado.
class SetAffiliatePasswordBody {
  @IsString() @MinLength(8) @MaxLength(64) password!: string;
}

class UpdatePublicAffiliateRegConfigBody {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() allowInfluencer?: boolean;
  @IsOptional() @IsBoolean() allowAmbassador?: boolean;
  @IsOptional() @IsNumber() @Min(0) @Max(100) influencerCommissionPct?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) ambassadorCommissionPct?: number;
}

// FASE B2: marcado de pago en /admin/commissions. Mismo razón de
// hoisting arriba que los DTOs anteriores.
class PayCommissionBody {
  @IsNumber() amount!: number;
  @IsOptional() @IsString() note?: string;
}

class PayoutByPersonBody {
  @IsString() codeId!: string;
  @IsOptional() @IsString() note?: string;
  // Brief PASO 6: pagar exige un LOTE DE CORTE. batchId de un PayoutBatch
  // existente, o los datos para crearlo al vuelo (cutoffDate/paymentDate).
  @IsOptional() @IsString() batchId?: string;
  @IsOptional() @IsString() cutoffDate?: string;
  @IsOptional() @IsString() paymentDate?: string;
}

class CreatePayoutBatchBody {
  // cutoffDate = hasta cuándo acumuló · paymentDate = fecha real de la
  // transferencia (YYYY-MM-DD). code opcional (se deriva de cutoffDate).
  // Sin paymentDate el corte nace ABIERTO (todavía no salió plata).
  @IsString() cutoffDate!: string;
  @IsOptional() @IsString() paymentDate?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() kind?: string;
  @IsOptional() @IsString() notes?: string;
}

// ── CORTES AUTOMÁTICOS (2026-08-15) ─────────────────────────────────────────
// Mismo hoisting que los DTOs de arriba (temporal dead zone de los @Body()).

class GenerateCutoffBody {
  // Fecha del corte a generar (YYYY-MM-DD, tiene que ser 15 o último del mes).
  // Sin valor = ayer, que es lo que haría el cron.
  @IsOptional() @IsString() ymd?: string;
}

class CloseBatchBody {
  // Fecha REAL en que salió la transferencia. Puede diferir de la del corte.
  @IsString() paymentDate!: string;
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class ReopenBatchBody {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

class PayBulkBody {
  @IsString({ each: true }) commissionIds!: string[];
  @IsString() paymentDate!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
}

class UnpayBulkBody {
  @IsString({ each: true }) commissionIds!: string[];
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
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

  // #3 (2026-06-16): vendedores para el selector de asignación a negocio.
  @Roles('SUPER_ADMIN')
  @Get('vendors')
  vendors(@CurrentUser() user: AuthUser) {
    return this.svc.listVendors(user);
  }

  // #11 (2026-06-16): auditoría avanzada de comisiones (read-only).
  // Recalcula el split esperado desde la fuente original y reporta
  // montos incorrectos / duplicados / fantasmas para influencer/embajador/vendedor.
  @Roles('SUPER_ADMIN')
  @Get('audit/commissions')
  auditCommissions(@CurrentUser() user: AuthUser) {
    return this.svc.auditCommissions(user);
  }

  // PDF 752 #2.2 (2026-06-26): corrige UNA comisión al monto esperado del
  // arqueo (acción individual y explícita por fila, nunca automática).
  @Roles('SUPER_ADMIN')
  @Post('audit/commissions/:id/recalc')
  recalcCommission(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.svc.recalcCommissionToExpected(user, id);
  }

  // #12 (2026-06-16): modificar/resetear la contraseña de un afiliado existente.
  @Roles('SUPER_ADMIN')
  @Patch('affiliates/:codeId/password')
  setAffiliatePassword(
    @CurrentUser() user: AuthUser,
    @Param('codeId') codeId: string,
    @Body() body: SetAffiliatePasswordBody,
  ) {
    return this.svc.setAffiliatePassword(user, codeId, body.password);
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

  /** Reasignación de un CLIENTE (ReferralUse) a otro código de afiliado
   *  (Bloque 4 2026-06-12). Atómica + audita en AuditLog. */
  @Roles('SUPER_ADMIN')
  @Post('uses/:id/reassign')
  reassignReferralUse(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    body: {
      newReferralCodeId: string;
      deleteFuturePending?: boolean;
      reason?: string;
    },
  ) {
    return this.svc.reassignReferralUseToCode(user, id, {
      newReferralCodeId: body.newReferralCodeId,
      deleteFuturePending: !!body.deleteFuturePending,
      reason: body.reason,
    });
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
    @Body() body: { fullName: string; email: string; whatsapp: string; commissionPercent?: number; customCode?: string; password?: string; country?: string },
  ) {
    return this.svc.createCompanyDirectAmbassador(user, body);
  }

  // #36 (2026-06-16): crear un INFLUENCER directo desde la empresa (reemplaza
  // la creación vía Campaña, ahora eliminada).
  @Roles('SUPER_ADMIN')
  @Post('influencers')
  createInfluencer(
    @CurrentUser() user: AuthUser,
    @Body() body: { fullName: string; email: string; whatsapp: string; commissionPercent?: number; customCode?: string; password?: string; country?: string },
  ) {
    return this.svc.createInfluencer(user, body);
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
  deleteCode(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    // ?voidCommissions=true → para cuentas atribuidas por error: anula las
    // comisiones no pagadas y desactiva el código aunque tenga tenants activos.
    @Query('voidCommissions') voidCommissions?: string,
  ) {
    return this.svc.deleteCode(user, id, {
      voidCommissions: voidCommissions === 'true',
    });
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
    return this.svc.setCommissionStatus(id, body.status, {
      cascade: body.cascade !== false,
    });
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

  // #5 (2026-06-16): implementación pagada — genera comisiones sobre un monto
  // libre usando el mismo split (influencer/embajador/vendedor) que una venta.
  @Roles('SUPER_ADMIN')
  @Post('tenants/:tenantId/implementation-commission')
  implementationCommission(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Body() body: { amountUsd: number },
  ) {
    return this.svc.generateImplementationCommission(user, tenantId, body.amountUsd);
  }

  // ============================================================
  // VENDOR ENDPOINTS — FASE FOUNDATION
  // ============================================================

  /**
   * SUPER_ADMIN: togglea el módulo de vendedores de un embajador y
   * setea la comisión máxima que puede repartir. UI: tab Embajadores
   * del admin de referrals.
   */
  @Roles('SUPER_ADMIN', 'AFFILIATE_AMBASSADOR', 'AFFILIATE_INFLUENCER')
  @Patch('codes/:id/vendor-config')
  setVendorConfig(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: VendorConfigBody,
  ) {
    return this.svc.setEmbajadorVendorConfig(user, id, body);
  }

  /**
   * El embajador configura el % por defecto que se aplica cuando un
   * vendedor se autoregistra desde `/seller/register/<su-code>`.
   * Auth: SUPER_ADMIN o el embajador dueño del code.
   */
  @Roles('SUPER_ADMIN', 'AFFILIATE_AMBASSADOR', 'AFFILIATE_INFLUENCER')
  @Patch('codes/:id/default-vendor-commission')
  setDefaultVendorCommission(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: DefaultVendorCommissionBody,
  ) {
    const pct =
      body.defaultVendorCommissionPercent === undefined
        ? null
        : body.defaultVendorCommissionPercent;
    return this.svc.setEmbajadorDefaultVendorCommission(user, id, pct);
  }

  @Roles('SUPER_ADMIN', 'AFFILIATE_AMBASSADOR', 'AFFILIATE_INFLUENCER')
  @Post('vendors')
  createVendor(
    @CurrentUser() user: AuthUser,
    @Body() body: VendorBody,
  ) {
    return this.svc.createVendor(user, body);
  }

  @Roles('SUPER_ADMIN', 'AFFILIATE_AMBASSADOR', 'AFFILIATE_INFLUENCER')
  @Get('vendors/by-embajador/:embajadorCodeId')
  listVendors(
    @CurrentUser() user: AuthUser,
    @Param('embajadorCodeId') embajadorCodeId: string,
  ) {
    return this.svc.listVendorsForEmbajador(user, embajadorCodeId);
  }

  @Roles('SUPER_ADMIN', 'AFFILIATE_AMBASSADOR', 'AFFILIATE_INFLUENCER')
  @Patch('vendors/:id')
  updateVendor(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: VendorPatchBody,
  ) {
    return this.svc.updateVendor(user, id, body);
  }

  @Roles('SUPER_ADMIN', 'AFFILIATE_AMBASSADOR', 'AFFILIATE_INFLUENCER')
  @Post('vendors/:id/deactivate')
  deactivateVendor(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.svc.deactivateVendor(user, id);
  }

  @Roles('SUPER_ADMIN', 'AFFILIATE_AMBASSADOR', 'AFFILIATE_INFLUENCER')
  @Post('vendors/:id/reactivate')
  reactivateVendor(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.svc.reactivateVendor(user, id);
  }

  @Roles('SUPER_ADMIN', 'AFFILIATE_AMBASSADOR', 'AFFILIATE_INFLUENCER')
  @Delete('vendors/:id')
  deleteVendor(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('voidCommissions') voidCommissions?: string,
  ) {
    return this.svc.deleteVendor(user, id, {
      voidCommissions: voidCommissions === 'true',
    });
  }
}

// ============================================================
// ADMIN COMMISSIONS CONTROLLER — FASE B2
// ============================================================
// Endpoints super admin para gestión avanzada de comisiones.
// Montado en /admin/commissions/* (NO /referrals) para separar
// claramente el dominio de "panel admin contable" del de "afiliados".
@Controller('admin/commissions')
export class AdminCommissionsController {
  constructor(
    private svc: ReferralsService,
    private cutoff: CutoffService,
  ) {}

  // ── Integración Team Clubify (lectura) ──────────────────────────────────────
  // Endpoint server-to-server protegido por API key (header x-api-key ==
  // TEAM_INTEGRATION_KEY). Devuelve el mismo dataset de comisiones que ve el
  // panel admin, para reflejarlo en team.soyclubify.com. Solo lectura.
  @Public()
  @Get('integration/feed')
  integrationFeed(
    @Headers('x-api-key') apiKey: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('dateType') dateType?: string,
    @Query('batchCode') batchCode?: string,
    @Query('status') status?: string,
    @Query('bucket') bucket?: string,
    @Query('role') role?: string,
    @Query('tenantId') tenantId?: string,
    @Query('codeId') codeId?: string,
  ) {
    const expected = process.env.TEAM_INTEGRATION_KEY;
    if (!expected || apiKey !== expected) throw new UnauthorizedException();
    return this.svc.listAdminCommissions({ role: 'SUPER_ADMIN' } as AuthUser, {
      dateFrom,
      dateTo,
      dateType: dateType as any,
      batchCode,
      status: status as any,
      bucket: bucket as any,
      role: role as any,
      tenantId,
      codeId,
    });
  }

  // PDF Soft(9) A: Reporte por empresa para TeamClubify (mismo x-api-key que el
  // feed). Filtros: periodicidad del plan + rango de fecha de registro.
  @Public()
  @Get('integration/company-report')
  integrationCompanyReport(
    @Headers('x-api-key') apiKey: string,
    @Query('periodicity') periodicity?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
  ) {
    const expected = process.env.TEAM_INTEGRATION_KEY;
    if (!expected || apiKey !== expected) throw new UnauthorizedException();
    return this.svc.companyAccountingReport(
      { role: 'SUPER_ADMIN' } as AuthUser,
      { periodicity, from, to, status },
    );
  }

  // PDF Soft(9) A3: historial de pagos de un negocio para TeamClubify.
  @Public()
  @Get('integration/payment-history')
  integrationPaymentHistory(
    @Headers('x-api-key') apiKey: string,
    @Query('tenantId') tenantId?: string,
  ) {
    const expected = process.env.TEAM_INTEGRATION_KEY;
    if (!expected || apiKey !== expected) throw new UnauthorizedException();
    if (!tenantId) return { tenant: null, count: 0, payments: [] };
    return this.svc.tenantPaymentHistory(tenantId);
  }

  @Roles('SUPER_ADMIN')
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('dateType') dateType?: string,
    @Query('batchCode') batchCode?: string,
    @Query('status') status?: string,
    @Query('bucket') bucket?: string,
    @Query('role') role?: string,
    @Query('tenantId') tenantId?: string,
    @Query('codeId') codeId?: string,
  ) {
    return this.svc.listAdminCommissions(user, {
      dateFrom,
      dateTo,
      dateType: dateType as any,
      batchCode,
      status: status as any,
      bucket: bucket as any,
      role: role as any,
      tenantId,
      codeId,
    });
  }

  // Reporte contable por empresa: pago · comisiones devengadas · 10% socio ·
  // neto a la empresa (aprox) + reconciliación vs comisiones registradas.
  @Roles('SUPER_ADMIN')
  @Get('company-report')
  companyReport(
    @CurrentUser() user: AuthUser,
    @Query('periodicity') periodicity?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
  ) {
    return this.svc.companyAccountingReport(user, {
      periodicity,
      from,
      to,
      status,
    });
  }

  // PDF Soft(9) C5: lista completa de negocios con comisiones para el filtro
  // "Negocio" (typeahead). Debe ir ANTES de cualquier @Get(':id').
  @Roles('SUPER_ADMIN')
  @Get('businesses')
  businesses(@CurrentUser() user: AuthUser) {
    return this.svc.listCommissionBusinesses(user);
  }

  // PDF Soft(9): negocios que pagan pero SIN afiliado (para asignación manual).
  @Roles('SUPER_ADMIN')
  @Get('unattributed')
  unattributed(@CurrentUser() user: AuthUser) {
    return this.svc.listUnattributedBusinesses(user);
  }

  @Roles('SUPER_ADMIN')
  @Post(':tenantId/assign-affiliate')
  assignAffiliate(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Body() body: { codeId: string },
  ) {
    return this.svc.assignAffiliate(user, tenantId, body.codeId);
  }

  // Habilitar manual: adelanta el desbloqueo de una comisión en hold
  // (PENDING → APPROVED). Body opcional { reason }.
  @Roles('SUPER_ADMIN')
  @Patch(':id/enable')
  enable(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.svc.enableCommission(user, id, body?.reason);
  }

  @Roles('SUPER_ADMIN')
  @Patch(':id/pay')
  pay(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: PayCommissionBody,
  ) {
    return this.svc.payCommission(user, id, body);
  }

  // Edición MANUAL de la FECHA de negocio (columna FECHA). La fuente de verdad de
  // la compra es externa (capturas del dueño), así que el super admin puede
  // fijar/corregir businessDate por comisión. businessDate = 'YYYY-MM-DD' o null
  // (revierte a la heurística). Vive acá (era /referrals/...) para que la ruta sea
  // /admin/commissions/:id/business-date, que es la que llama el panel.
  @Roles('SUPER_ADMIN')
  @Patch(':id/business-date')
  setBusinessDate(
    @Param('id') id: string,
    @Body() body: { businessDate?: string | null },
  ) {
    return this.svc.setCommissionBusinessDate(id, body.businessDate ?? null);
  }

  @Roles('SUPER_ADMIN')
  @Get('payouts/pending')
  pendingPayouts(@CurrentUser() user: AuthUser) {
    return this.svc.listPendingPayouts(user);
  }

  @Roles('SUPER_ADMIN')
  @Post('payouts/by-person')
  bulkPayPerson(
    @CurrentUser() user: AuthUser,
    @Body() body: PayoutByPersonBody,
  ) {
    return this.svc.payAllForPerson(user, body.codeId, body.note, {
      batchId: body.batchId,
      cutoffDate: body.cutoffDate,
      paymentDate: body.paymentDate,
    });
  }

  // ── LOTES DE CORTE (PayoutBatch) — brief PASO 3/5/6 ──────────────────────
  @Roles('SUPER_ADMIN')
  @Get('payout-batches')
  listPayoutBatches(@CurrentUser() user: AuthUser) {
    return this.svc.listPayoutBatches(user);
  }

  @Roles('SUPER_ADMIN')
  @Post('payout-batches')
  createPayoutBatch(
    @CurrentUser() user: AuthUser,
    @Body() body: CreatePayoutBatchBody,
  ) {
    return this.svc.createPayoutBatch(user, body);
  }

  // ── CORTES AUTOMÁTICOS ────────────────────────────────────────────────────
  // El cron abre el corte el 15 y el último día de cada mes; estos endpoints
  // son para verlo, cerrarlo (confirmar la transferencia) y revertir.

  /** Todo lo que necesita la pestaña "Corte actual", sin filtros. */
  @Roles('SUPER_ADMIN')
  @Get('current-cutoff')
  currentCutoff(@CurrentUser() user: AuthUser) {
    return this.cutoff.currentCutoff(user);
  }

  /** Disparo manual del generador (normalmente lo hace el cron). */
  @Roles('SUPER_ADMIN')
  @Post('cutoffs/generate')
  generateCutoff(
    @CurrentUser() user: AuthUser,
    @Body() body: GenerateCutoffBody,
  ) {
    return this.cutoff.generateCutoffManual(user, body?.ymd);
  }

  /** Detalle de un corte (drill-in del historial + export CSV). */
  @Roles('SUPER_ADMIN')
  @Get('payout-batches/:id')
  batchDetail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cutoff.batchDetail(user, id);
  }

  /** Cerrar = confirmar que la transferencia salió. Lo hace una PERSONA. */
  @Roles('SUPER_ADMIN')
  @Post('payout-batches/:id/close')
  closeBatch(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: CloseBatchBody,
  ) {
    return this.cutoff.closeBatch(user, id, body);
  }

  /** Deshacer el cierre (la transferencia no salió / fecha mal registrada). */
  @Roles('SUPER_ADMIN')
  @Post('payout-batches/:id/reopen')
  reopenBatch(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: ReopenBatchBody,
  ) {
    return this.cutoff.reopenBatch(user, id, body);
  }

  /** Marcar varias comisiones como pagadas en una sola acción. */
  @Roles('SUPER_ADMIN')
  @Post('pay-bulk')
  payBulk(@CurrentUser() user: AuthUser, @Body() body: PayBulkBody) {
    return this.cutoff.payBulk(user, body);
  }

  /** Deshacer un marcado en bloque. */
  @Roles('SUPER_ADMIN')
  @Post('unpay-bulk')
  unpayBulk(@CurrentUser() user: AuthUser, @Body() body: UnpayBulkBody) {
    return this.cutoff.unpayBulk(user, body);
  }
}

// ============================================================
// SELLER SELF-REGISTER CONTROLLER (PÚBLICO)
// ============================================================
// Endpoints públicos para que vendedores se autoregistren via
// `/seller/register/<ambassadorCode>` del frontend. Montado en
// `/seller/*` (NO `/referrals`) para tener un endpoint público
// estable y con un throttle propio (5/min por IP).
@Controller('seller')
export class SellerRegistrationController {
  constructor(private svc: ReferralsService) {}

  /**
   * Lookup público: ¿existe el embajador y tiene allowVendors=true?
   * Lo usa la página del frontend para mostrar el form o el bloqueo.
   * Throttled menos agresivo porque es un GET barato.
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get('register/lookup/:code')
  lookup(@Param('code') code: string) {
    return this.svc.lookupSelfRegisterAmbassador(code);
  }

  /**
   * Autoregistro del vendedor. Crea ReferralCode role=VENDOR + User
   * AFFILIATE_VENDOR y devuelve tokens para auto-login. Rate-limit
   * estricto (5/min por IP) para bloquear creación masiva.
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('register')
  register(
    @Body() body: SelfRegisterVendorBody,
    @Ip() ip: string,
  ) {
    return this.svc.selfRegisterVendor(body, ip);
  }
}

/**
 * Autorregistro público de EMBAJADORES bajo un influencer desde
 * `/ambassador/register/<influencerCode>`. Espejo del de vendedores.
 */
@Controller('ambassador')
export class AmbassadorRegistrationController {
  constructor(private svc: ReferralsService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get('register/lookup/:code')
  lookup(@Param('code') code: string) {
    return this.svc.lookupSelfRegisterInfluencer(code);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('register')
  register(@Body() body: SelfRegisterAmbassadorBody, @Ip() ip: string) {
    return this.svc.selfRegisterAmbassador(body, ip);
  }
}

/**
 * Endpoints públicos para autorregistro de afiliados top-level
 * (Influencer / Embajador). Habilitado vía Settings desde el panel admin.
 * Distinto al flujo de vendedor (que requiere ambassadorCode).
 */
@Controller('public/affiliate-signup')
export class PublicAffiliateSignupController {
  constructor(private svc: ReferralsService) {}

  /** Config pública: feature on/off + qué roles están habilitados +
   *  % de comisión. La página de registro lo consume para mostrar el
   *  picker de rol y el % al usuario. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Get('config')
  config() {
    return this.svc.getPublicAffiliateRegistrationConfig();
  }

  /** Crea User AFFILIATE_INFLUENCER o AFFILIATE_AMBASSADOR + ReferralCode
   *  top-level + auto-login. Throttled estricto 5/min por IP. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('register')
  register(@Body() body: SelfRegisterAffiliateBody, @Ip() ip: string) {
    return this.svc.selfRegisterAffiliate(body, ip);
  }
}

/**
 * Configuración admin del registro público de afiliados. Solo
 * SUPER_ADMIN / MARKETING editan.
 */
@Controller('admin/affiliate-registration')
@Roles('SUPER_ADMIN', 'MARKETING')
export class AdminAffiliateRegistrationController {
  constructor(private svc: ReferralsService) {}

  @Get()
  get() {
    return this.svc.getPublicAffiliateRegistrationConfig();
  }

  @Post()
  update(@Body() body: UpdatePublicAffiliateRegConfigBody) {
    return this.svc.updatePublicAffiliateRegistrationConfig(body);
  }
}
