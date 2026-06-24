import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IsArray, IsBoolean, IsEmail, IsHexColor, IsIn, IsInt, IsObject, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { ModuleKey, WhiteLabelStatus } from '@prisma/client';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { SuperAdminService } from './superadmin.service';
import { RenewalsService } from './renewals.service';
import { BrandIconService, IconPurpose } from './brand-icon.service';

class WhiteLabelBody {
  @IsString() @MaxLength(80) name!: string;
  @IsOptional() @IsString() @MaxLength(80) slug?: string;
  @IsOptional() @IsString() @MaxLength(140) domain?: string;
  @IsOptional() @IsString() @MaxLength(140) appDomain?: string;
  @IsOptional() @IsHexColor() primaryColor?: string;
  @IsOptional() @IsString() @MaxLength(2) initial?: string;
  @IsOptional() @IsEmail() adminEmail?: string;
  @IsOptional() @IsBoolean() creditsUnlimited?: boolean;
  // Identidad visual extendida (manual de marca).
  @IsOptional() @IsString() @MaxLength(500) logoUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) iconUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) faviconUrl?: string;
  @IsOptional() @IsHexColor() secondaryColor?: string;
  @IsOptional() @IsHexColor() backgroundColor?: string;
  @IsOptional() @IsHexColor() supportColor?: string;
  @IsOptional() @IsString() @MaxLength(60) instagram?: string;
  @IsOptional() @IsEmail() contactEmail?: string;
  // Teléfono al que la plataforma le manda los SMS de créditos a la marca.
  @IsOptional() @IsString() @MaxLength(30) notifyPhone?: string;
  // Google Maps API key de la marca (browser key restringida por referrer).
  @IsOptional() @IsString() @MaxLength(200) mapsApiKey?: string;
  // Periodicidades de plan que ofrece la marca (form "Nuevo negocio").
  @IsOptional() @IsArray()
  @IsIn(['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'], { each: true })
  planPeriodicities?: string[];
}

class StatusBody {
  @IsIn(['ACTIVE', 'SUSPENDED']) status!: WhiteLabelStatus;
}

class PaymentConfigBody {
  @IsOptional() @IsIn(['HOTMART', 'STRIPE', 'MANUAL']) gateway?: 'HOTMART' | 'STRIPE' | 'MANUAL';
  // Config libre por gateway: secretos se cifran server-side, no-secretos plano.
  @IsOptional() @IsObject() config?: Record<string, any>;
}

class PaymentLinkBody {
  @IsIn(['HOTMART', 'STRIPE', 'MANUAL']) gateway!: 'HOTMART' | 'STRIPE' | 'MANUAL';
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsIn(['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL', 'CUSTOM']) periodicity?: any;
  @IsNumber() @Min(0) amountUsd!: number;
  @IsOptional() @IsString() @MaxLength(600) url?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsString() @MaxLength(120) stripePriceId?: string | null;
  @IsOptional() @IsString() @MaxLength(120) stripeProductId?: string | null;
}

class AdjustCreditsBody {
  @IsString() whiteLabelId!: string;
  @IsInt() @Min(-1000000) @Max(1000000) amount!: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsIn(['PURCHASE', 'CONSUME', 'COMMIT', 'REFUND', 'ADJUSTMENT']) type?: any;
}

class HotmartLinkBody {
  @IsInt() @Min(1) credits!: number;
  @IsString() @MaxLength(120) label!: string;
  @IsString() @MaxLength(500) url!: string;
  @IsOptional() @IsNumber() @Min(0) price?: number | null;
  @IsOptional() @IsString() @IsIn(['USD', 'MXN', 'COP', 'BRL', 'ARS', 'CLP', 'PEN']) currency?: string;
  @IsOptional() @IsInt() @Min(0) position?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() @MaxLength(60) hotmartProductId?: string | null;
  @IsOptional() @IsString() @MaxLength(60) hotmartOfferCode?: string | null;
  @IsOptional() @IsString() @MaxLength(64) whiteLabelId?: string | null;
}

class AssignPurchaseBody {
  @IsString() whiteLabelId!: string;
  // Override de cantidad para compras de oferta ambigua (credits=0). Opcional.
  @IsOptional() @IsInt() @Min(1) credits?: number;
}

class IntegrationUpdateBody {
  @IsOptional() @IsObject() config?: Record<string, any>;
  @IsOptional() @IsIn(['CONNECTED', 'DISCONNECTED']) status?: 'CONNECTED' | 'DISCONNECTED';
}

class ToggleModuleBody {
  @IsBoolean() enabled!: boolean;
}

class PlatformConfigBody {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsString() @MaxLength(120) tagline?: string;
  @IsOptional() @IsString() @MaxLength(500) logoUrl?: string;
  @IsOptional() @IsHexColor() primaryColor?: string;
  @IsOptional() @IsString() @MaxLength(140) consoleDomain?: string;
  @IsOptional() @IsEmail() supportEmail?: string;
}

class InviteOwnerBody {
  @IsEmail() email!: string;
  @IsString() @MaxLength(120) fullName!: string;
}

class CreateOwnerBody {
  @IsString() @MaxLength(80) firstName!: string;
  @IsOptional() @IsString() @MaxLength(80) lastName?: string;
  @IsEmail() email!: string;
  @IsString() @Length(8, 200) password!: string;
}

class ChangeOwnerPasswordBody {
  @IsString() @Length(8, 200) password!: string;
}

class ToggleOwnerBody {
  @IsBoolean() isActive!: boolean;
}

class AcceptInviteBody {
  @IsString() @Length(8, 200) password!: string;
}

class InviteWhiteLabelAdminBody {
  @IsEmail() email!: string;
  @IsString() @MaxLength(120) fullName!: string;
}

class CreateWhiteLabelAdminBody {
  @IsEmail() email!: string;
  @IsString() @MaxLength(120) fullName!: string;
  @IsString() @Length(8, 200) password!: string;
}

/**
 * Endpoints del MasterAdmin (Nivel 1 / Plataforma).
 *
 * Solo accesibles para PLATFORM_OWNER. La ruta base es /superadmin
 * y queda completamente aislada de los endpoints de Tenant (Clubify
 * y demás marcas blancas).
 */
@Controller('superadmin')
@Roles('PLATFORM_OWNER')
export class SuperAdminController {
  constructor(
    private svc: SuperAdminService,
    private renewals: RenewalsService,
  ) {}

  @Get('dashboard')
  dashboard() {
    return this.svc.dashboard();
  }

  @Get('sidebar-badges')
  sidebarBadges() {
    return this.svc.sidebarBadges();
  }

  @Get('white-labels')
  listWhiteLabels() {
    return this.svc.listWhiteLabels();
  }

  @Get('white-labels/:id')
  getWhiteLabel(@Param('id') id: string) {
    return this.svc.getWhiteLabel(id);
  }

  @Post('white-labels')
  createWhiteLabel(@Body() body: WhiteLabelBody, @CurrentUser() user: AuthUser) {
    return this.svc.createWhiteLabel(body, user.id);
  }

  @Patch('white-labels/:id')
  updateWhiteLabel(@Param('id') id: string, @Body() body: Partial<WhiteLabelBody>, @CurrentUser() user: AuthUser) {
    return this.svc.updateWhiteLabel(id, body, user.id);
  }

  @Patch('white-labels/:id/status')
  setStatus(@Param('id') id: string, @Body() body: StatusBody, @CurrentUser() user: AuthUser) {
    return this.svc.setStatus(id, body.status, user.id);
  }

  // -------- Pasarela de pago por marca --------

  @Get('white-labels/:id/payment-config')
  getPaymentConfig(@Param('id') id: string) {
    return this.svc.getPaymentConfig(id);
  }

  @Patch('white-labels/:id/payment-config')
  updatePaymentConfig(@Param('id') id: string, @Body() body: PaymentConfigBody, @CurrentUser() user: AuthUser) {
    return this.svc.updatePaymentConfig(id, body, user.id);
  }

  @Get('white-labels/:id/payment-links')
  listPaymentLinks(@Param('id') id: string) {
    return this.svc.listPaymentLinks(id);
  }

  @Post('white-labels/:id/payment-links')
  createPaymentLink(@Param('id') id: string, @Body() body: PaymentLinkBody, @CurrentUser() user: AuthUser) {
    return this.svc.createPaymentLink(id, body, user.id);
  }

  @Patch('white-labels/:id/payment-links/:linkId')
  updatePaymentLink(
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @Body() body: Partial<PaymentLinkBody>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.updatePaymentLink(id, linkId, body, user.id);
  }

  @Delete('white-labels/:id/payment-links/:linkId')
  removePaymentLink(@Param('id') id: string, @Param('linkId') linkId: string, @CurrentUser() user: AuthUser) {
    return this.svc.removePaymentLink(id, linkId, user.id);
  }

  /** PLATFORM_OWNER entra al panel de la marca como su SUPER_ADMIN. */
  @Post('white-labels/:id/impersonate')
  impersonate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.impersonateWhiteLabel(id, user.id);
  }

  // -------- Historial --------

  @Get('history')
  history() {
    return this.svc.history({});
  }

  // -------- Centro de Créditos --------

  @Get('credits')
  creditsCenter() {
    return this.svc.creditsCenter();
  }

  @Post('credits/adjust')
  adjust(@Body() body: AdjustCreditsBody, @CurrentUser() user: AuthUser) {
    return this.svc.adjustCredits(body, user.id);
  }

  /** Recalcula `creditsCommitted` por marca en base a los tenants ACTIVE
   *  que vencen dentro de 30 días. Se corre solo en el cron diario; este
   *  endpoint permite forzar el refresh desde el panel. */
  @Post('credits/refresh-committed')
  refreshCommitted() {
    return this.renewals.refreshCommittedCredits();
  }

  // -------- Hotmart Links --------

  @Get('hotmart-links')
  listHotmartLinks(@Query('whiteLabelId') whiteLabelId?: string) {
    return this.svc.listHotmartLinks(whiteLabelId);
  }

  @Post('hotmart-links')
  createHotmartLink(@Body() body: HotmartLinkBody, @CurrentUser() user: AuthUser) {
    return this.svc.createHotmartLink(body, user.id);
  }

  @Patch('hotmart-links/:id')
  updateHotmartLink(
    @Param('id') id: string,
    @Body() body: Partial<HotmartLinkBody>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.updateHotmartLink(id, body, user.id);
  }

  @Delete('hotmart-links/:id')
  removeHotmartLink(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.removeHotmartLink(id, user.id);
  }

  // -------- Hotmart Credit Purchases --------

  @Get('hotmart-purchases')
  listAllPurchases() {
    return this.svc.listAllCreditPurchases();
  }

  @Get('hotmart-purchases/unassigned')
  listUnassignedPurchases() {
    return this.svc.listUnassignedCreditPurchases();
  }

  @Post('hotmart-purchases/:id/assign')
  assignPurchase(
    @Param('id') id: string,
    @Body() body: AssignPurchaseBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.assignCreditPurchase(id, body.whiteLabelId, user.id, body.credits);
  }

  // -------- Módulos --------

  @Get('modules')
  modulesMatrix() {
    return this.svc.modulesMatrix();
  }

  @Patch('modules/:whiteLabelId/:module')
  toggleModule(
    @Param('whiteLabelId') whiteLabelId: string,
    @Param('module') module: ModuleKey,
    @Body() body: ToggleModuleBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.toggleModule(whiteLabelId, module, body.enabled, user.id);
  }

  // -------- Centro de Cobros --------

  @Get('billing')
  billingCenter() {
    return this.svc.billingCenter();
  }

  /** Dry-run del cron de renovaciones — sin escribir. Útil para previsualizar
   *  qué pasará cuando corra el cron. */
  @Get('renewals/preview')
  previewRenewals() {
    return this.renewals.run({ dryRun: true });
  }

  /** Trigger manual del cron — corre la lógica real. Para uso del
   *  PLATFORM_OWNER cuando quiere forzar el barrido. */
  @Post('renewals/run')
  runRenewals() {
    return this.renewals.run({ dryRun: false });
  }

  // -------- Integraciones --------

  @Get('integrations')
  listIntegrations() {
    return this.svc.listIntegrations();
  }

  @Patch('integrations/:key')
  updateIntegration(
    @Param('key') key: string,
    @Body() body: IntegrationUpdateBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.updateIntegration(key, body, user.id);
  }

  @Post('integrations/:key/test')
  testIntegration(@Param('key') key: string, @CurrentUser() user: AuthUser) {
    return this.svc.testIntegration(key, user.id);
  }

  // -------- Configuración de plataforma --------

  @Get('config')
  getConfig() {
    return this.svc.getPlatformConfig();
  }

  @Patch('config')
  updateConfig(@Body() body: PlatformConfigBody, @CurrentUser() user: AuthUser) {
    return this.svc.updatePlatformConfig(body, user.id);
  }

  // -------- Platform Owners --------

  @Get('owners')
  listOwners() {
    return this.svc.listPlatformOwners();
  }

  @Get('owner-invites')
  listInvites() {
    return this.svc.listOwnerInvites();
  }

  /** Creación directa de un administrador de plataforma (sin invitación). */
  @Post('owners')
  createOwner(@Body() body: CreateOwnerBody, @CurrentUser() user: AuthUser) {
    return this.svc.createPlatformOwner(body, user.id);
  }

  @Post('owner-invites')
  createInvite(@Body() body: InviteOwnerBody, @CurrentUser() user: AuthUser) {
    return this.svc.createOwnerInvite(body, user.id);
  }

  @Delete('owner-invites/:id')
  revokeInvite(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.revokeOwnerInvite(id, user.id);
  }

  /** Cambia la contraseña de un administrador de plataforma de inmediato. */
  @Patch('owners/:id/password')
  changeOwnerPassword(
    @Param('id') id: string,
    @Body() body: ChangeOwnerPasswordBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.changeOwnerPassword(id, body.password, user.id);
  }

  @Patch('owners/:id')
  toggleOwner(@Param('id') id: string, @Body() body: ToggleOwnerBody, @CurrentUser() user: AuthUser) {
    return this.svc.toggleOwnerActive(id, body.isActive, user.id);
  }

  // -------- Admins dedicados de una marca --------

  @Get('white-labels/:id/admin-invites')
  listWhiteLabelAdminInvites(@Param('id') id: string) {
    return this.svc.listWhiteLabelAdminInvites(id);
  }

  @Post('white-labels/:id/admin-invites')
  inviteWhiteLabelAdmin(
    @Param('id') id: string,
    @Body() body: InviteWhiteLabelAdminBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.inviteWhiteLabelAdmin(id, body, user.id);
  }

  /** Creación DIRECTA de un admin de marca (sin invitación): el usuario queda
   *  creado con su contraseña cifrada y listo para ingresar de inmediato. */
  @Post('white-labels/:id/admins')
  createWhiteLabelAdmin(
    @Param('id') id: string,
    @Body() body: CreateWhiteLabelAdminBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.createWhiteLabelAdmin(id, body, user.id);
  }

  @Delete('white-label-admin-invites/:inviteId')
  revokeWhiteLabelAdminInvite(@Param('inviteId') inviteId: string, @CurrentUser() user: AuthUser) {
    return this.svc.revokeWhiteLabelAdminInvite(inviteId, user.id);
  }

  @Patch('white-label-admins/:userId')
  toggleWhiteLabelAdmin(
    @Param('userId') userId: string,
    @Body() body: ToggleOwnerBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.toggleWhiteLabelAdminActive(userId, body.isActive, user.id);
  }
}

/**
 * Endpoints públicos para que un invitado active su cuenta. Quedan
 * fuera del controller @Roles('PLATFORM_OWNER') para no requerir auth.
 */
@Controller('superadmin-public')
export class SuperAdminPublicController {
  constructor(
    private svc: SuperAdminService,
    private brandIcons: BrandIconService,
  ) {}

  @Public()
  @Get('owner-invites/:token')
  lookup(@Param('token') token: string) {
    return this.svc.lookupOwnerInvite(token);
  }

  @Public()
  @Post('owner-invites/:token/accept')
  accept(@Param('token') token: string, @Body() body: AcceptInviteBody) {
    return this.svc.acceptOwnerInvite(token, body.password);
  }

  @Public()
  @Get('white-label-admin-invites/:token')
  lookupWhiteLabel(@Param('token') token: string) {
    return this.svc.lookupWhiteLabelAdminInvite(token);
  }

  @Public()
  @Post('white-label-admin-invites/:token/accept')
  acceptWhiteLabel(@Param('token') token: string, @Body() body: AcceptInviteBody) {
    return this.svc.acceptWhiteLabelAdminInvite(token, body.password);
  }

  // Resolución de dominio propio → marca blanca. El middleware Next lo usa
  // para servir el panel /admin cuando entran por el dominio de la marca
  // (ej. app.selleala.com). Devuelve { slug } o { slug: null }.
  @Public()
  @Get('white-labels/resolve-host')
  resolveHost(@Query('host') host: string) {
    return this.svc.resolveWhiteLabelByHost(host);
  }

  // Branding (nombre + color) de una marca por slug, para pintar el panel
  // /admin/<slug> en login directo sin pila de impersonación.
  @Public()
  @Get('white-labels/branding')
  branding(@Query('slug') slug: string) {
    return this.svc.getWhiteLabelBrandingBySlug(slug);
  }

  // Branding por dominio propio → lo usan las pantallas de auth servidas en el
  // host de la marca (login/recuperar/registro) para heredar logo + colores.
  @Public()
  @Get('white-labels/branding-by-host')
  brandingByHost(@Query('host') host: string) {
    return this.svc.getWhiteLabelBrandingByHost(host);
  }

  // Links de pago ACTIVOS por dominio propio → la landing de la marca pinta
  // sus planes/precios sin hardcodear. Devuelve { gateway, links } o null.
  @Public()
  @Get('white-labels/payment-links-by-host')
  paymentLinksByHost(@Query('host') host: string) {
    return this.svc.getPaymentLinksByHost(host);
  }

  // Icono de marca GENERADO al vuelo en cualquier tamaño/propósito desde la
  // imagen que la marca ya subió (favicon/icon/logo). Lo consumen el manifest
  // PWA, los <link icon>/apple-touch del <head> y el redirect de /favicon.ico.
  // `purpose`: any (transparente) | maskable (zona segura) | apple (180 opaco).
  // Cache immutable: la URL trae ?v=<brandingVersion>, así un cambio de branding
  // invalida todos los iconos cacheados sin tocar nada manual.
  @Public()
  @Get('white-labels/icon')
  async icon(
    @Res() res: Response,
    @Query('slug') slug?: string,
    @Query('host') host?: string,
    @Query('size') size?: string,
    @Query('purpose') purpose?: string,
  ) {
    const p: IconPurpose =
      purpose === 'maskable' || purpose === 'apple' ? purpose : 'any';
    const n = Math.max(16, Math.min(1024, parseInt(size ?? '192', 10) || 192));
    const out = await this.brandIcons.generate({
      slug: slug || undefined,
      host: host || undefined,
      size: n,
      purpose: p,
    });
    if (!out) {
      // Marca no resuelta → 404 para que el caller caiga a su fallback local.
      res.status(404).end();
      return;
    }
    // Cache immutable: la URL trae ?v=<brandingVersion>; un cambio de branding
    // sube la versión y los clientes piden la URL nueva (cache-bust automático).
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Type', out.contentType);
    res.end(out.buffer);
  }
}
