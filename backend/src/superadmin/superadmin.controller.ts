import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsEmail, IsHexColor, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ModuleKey, WhiteLabelStatus } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { SuperAdminService } from './superadmin.service';
import { RenewalsService } from './renewals.service';

class WhiteLabelBody {
  @IsString() @MaxLength(80) name!: string;
  @IsOptional() @IsString() @MaxLength(80) slug?: string;
  @IsOptional() @IsString() @MaxLength(140) domain?: string;
  @IsOptional() @IsString() @MaxLength(140) appDomain?: string;
  @IsOptional() @IsHexColor() primaryColor?: string;
  @IsOptional() @IsString() @MaxLength(2) initial?: string;
  @IsOptional() @IsEmail() adminEmail?: string;
}

class StatusBody {
  @IsIn(['ACTIVE', 'SUSPENDED']) status!: WhiteLabelStatus;
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
  @IsOptional() @IsNumber() price?: number | null;
  @IsOptional() @IsString() @MaxLength(8) currency?: string;
  @IsOptional() @IsInt() position?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class ToggleModuleBody {
  @IsBoolean() enabled!: boolean;
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

  // -------- Hotmart Links --------

  @Get('hotmart-links')
  listHotmartLinks() {
    return this.svc.listHotmartLinks();
  }

  @Post('hotmart-links')
  createHotmartLink(@Body() body: HotmartLinkBody) {
    return this.svc.createHotmartLink(body);
  }

  @Patch('hotmart-links/:id')
  updateHotmartLink(@Param('id') id: string, @Body() body: Partial<HotmartLinkBody>) {
    return this.svc.updateHotmartLink(id, body);
  }

  @Delete('hotmart-links/:id')
  removeHotmartLink(@Param('id') id: string) {
    return this.svc.removeHotmartLink(id);
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
  updateIntegration(@Param('key') key: string, @Body() body: { config?: any; status?: string }) {
    return this.svc.updateIntegration(key, body);
  }

  @Post('integrations/:key/test')
  testIntegration(@Param('key') key: string) {
    return this.svc.testIntegration(key);
  }
}
