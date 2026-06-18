import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsArray, IsBoolean, IsDateString, IsEmail, IsHexColor, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { TenantsService } from './tenants.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { TenantStatus } from '@prisma/client';
import { TenantLockGuard } from '../common/guards/tenant-lock.guard';

class CreateTenantBody {
  @IsString() brandName!: string;
  @IsEmail() email!: string;
  @IsOptional() @IsString() phone?: string;
  // #9: opcional → "Sin plan" si no se envía (permite crear sin planes configurados).
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsHexColor() primaryColor?: string;
  @IsOptional() @IsHexColor() secondaryColor?: string;
  @IsString() ownerFullName!: string;
  @IsOptional() @IsString() ownerPassword?: string;
  @IsOptional() @IsString() referredByCode?: string;
  @IsOptional() @IsString() businessCategorySlug?: string;
  @IsOptional() @IsBoolean() freeAccount?: boolean;
  @IsOptional() @IsInt() @Min(1) trialDays?: number;
  @IsOptional() @IsDateString() nextChargeDate?: string;
  @IsOptional() @IsString() hotmartSubscriberCode?: string;
  // Periodicidad del plan elegida por el admin (Mensual/Trimestral/
  // Semestral/Anual). Informativo: NO altera billing real (Hotmart manda).
  @IsOptional() @IsIn(['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'])
  planPeriodicity?: 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';
}

class BillingBody {
  @IsIn(['free', 'trial', 'paid', 'pending'])
  mode!: 'free' | 'trial' | 'paid' | 'pending';
  @IsOptional() @IsInt() @Min(1) trialDays?: number;
  @IsOptional() @IsInt() @Min(0) gracePeriodDays?: number;
  @IsOptional() @IsDateString() nextChargeDate?: string;
  @IsOptional() @IsString() hotmartSubscriberCode?: string;
}

/** Cambio de periodicidad del plan desde /admin/tenants/[id] — solo
 *  metadata interna. NO toca Hotmart (el cobro real lo dicta el provider).
 *  El admin debe cancelar la suscripción vieja y mandarle al cliente el
 *  link del plan nuevo MANUALMENTE. */
class ChangePlanPeriodBody {
  @IsIn(['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'])
  periodicity!: 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';
}

/** Ajuste de trial (suma o resta). days != 0, hasta ±3650. observation
 *  opcional (texto libre que aparece en el historial). */
class AdjustTrialBody {
  @IsInt() days!: number;
  @IsOptional() @IsString() @MaxLength(200) observation?: string;
}

class UpdateTenantBody {
  @IsOptional() @IsString() brandName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsHexColor() primaryColor?: string;
  @IsOptional() @IsHexColor() secondaryColor?: string;
  @IsOptional() @IsString() status?: TenantStatus;
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsIn(['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'])
  planPeriodicity?: 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';
  // Precio real pagado en Hotmart (base de comisiones). null limpia el
  // override y vuelve al precio canónico del bundle.
  @IsOptional() @IsNumber() @Min(0) subscriptionPriceUsd?: number | null;
  @IsOptional() @IsInt() @Min(1) maxLocationsOverride?: number;
  @IsOptional() @IsInt() @Min(0) gracePeriodDays?: number;
  // Asignar subcuenta global de Grow Business para alertas SMS de
  // reseñas. null = limpiar (volver a credenciales propias del tenant).
  @IsOptional() reviewAlertsAccountId?: string | null;
  // Asignar subcuenta global de Grow Business para SMS de billing
  // (recordatorios de pago, impago, suspensión). null = creds tenant.
  @IsOptional() billingAlertsAccountId?: string | null;
  // Asignar subcuenta global de Grow Business para SMS a empresas de
  // domicilio cuando pedidos delivery cambian de estado. null = tenant.
  @IsOptional() deliveryAlertsAccountId?: string | null;
  // #14 (2026-06-17): config de alertas SMS de domicilio movida desde
  // /app/settings (vista cliente) a super-admin /admin/tenants/[id].
  @IsOptional() @IsBoolean() deliveryAlertsEnabled?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true })
  deliveryAlertsPhones?: string[] | null;
  @IsOptional() @IsArray() @IsString({ each: true })
  deliveryAlertsEvents?: string[] | null;
  // Mensajería WhatsApp del negocio (Bloque 8 2026-06-12). Antes el
  // tenant owner editaba esto desde /app/settings — movido a admin.
  @IsOptional() @IsString() whatsappPhone?: string;
  @IsOptional() @IsString() whatsappOrdersPhone?: string;
  @IsOptional() @IsString() whatsappDeliveryPhone?: string;
  // Bloque 2 (2026-06-12): toggles per-tenant para mostrar/ocultar
  // los links de Tutoriales y Academia Clubify en los sidebars.
  @IsOptional() @IsBoolean() tutorialsEnabled?: boolean;
  @IsOptional() @IsBoolean() academyEnabled?: boolean;
  // Reservations module gate (2026-06-12).
  @IsOptional() @IsBoolean() reservationsEnabled?: boolean;
}

@Controller('tenants')
@Roles('SUPER_ADMIN', 'MARKETING')
export class TenantsController {
  constructor(
    private svc: TenantsService,
    private lockGuard: TenantLockGuard,
  ) {}

  @Get()
  list() {
    return this.svc.list();
  }

  // #11 (2026-06-16): ranking de negocios por pases emitidos. Debe ir ANTES
  // de @Get(':id') sino el router matchea "ranking" como :id.
  @Get('ranking')
  ranking(@Query('order') order?: string) {
    return this.svc.rankingByPasses(order === 'asc' ? 'asc' : 'desc');
  }

  /** Historial de modificaciones de trial — audit log filtrado.
   *  IMPORTANTE: tiene que declararse antes que @Get(':id') sino el
   *  router de NestJS matchea `:id` primero con "trial-history" como
   *  id (gotcha conocido — feedback_nestjs_route_order). */
  @Get(':id/trial-history')
  @Roles('SUPER_ADMIN')
  trialHistory(
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.listTrialHistory(id, limit ? Number(limit) : 100);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.getById(id);
  }

  @Post()
  @Roles('SUPER_ADMIN')
  create(@Body() body: CreateTenantBody) {
    return this.svc.create(body);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN')
  update(@Param('id') id: string, @Body() body: UpdateTenantBody) {
    return this.svc.update(id, body);
  }

  // #14 (2026-06-17): test del SMS de alerta de domicilio para un negocio,
  // desde super-admin (la config se movió acá desde la vista del dueño).
  @Post(':id/delivery-alerts/test')
  @Roles('SUPER_ADMIN')
  testDeliveryAlert(@Param('id') id: string) {
    return this.svc.sendDeliveryAlertTest(id);
  }

  @Patch(':id/status')
  @Roles('SUPER_ADMIN')
  status(
    @Param('id') id: string,
    @Body() body: { status: TenantStatus },
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.setStatus(id, body.status, user.id);
  }

  @Post(':id/extend-trial')
  @Roles('SUPER_ADMIN')
  extendTrial(
    @Param('id') id: string,
    @Body() body: { days?: number },
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.extendTrial(id, body?.days ?? 7, user.id);
  }

  /**
   * Gestión de trial desde el modal del SuperAdmin (2026-06-07).
   * Suma o resta días al trial actual con audit log persistido. days > 0
   * extiende; days < 0 descuenta (puede llevar a SUSPENDED). El frontend
   * muestra el resultado en /admin/tenants → modal "Gestionar Trial" y
   * en /admin/tenants/[id] → sección "Historial de Trial".
   */
  @Post(':id/adjust-trial')
  @Roles('SUPER_ADMIN')
  adjustTrial(
    @Param('id') id: string,
    @Body() body: AdjustTrialBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.adjustTrial(id, {
      days: body.days,
      observation: body.observation ?? null,
      actorId: user.id,
    });
  }

  /**
   * Convierte el tenant en cliente pagante (status=ACTIVE,
   * currentPeriodEnd=now+30d, trialEndsAt=null). Dispara backfill de
   * comisión si tiene asignación a INFLUENCER/AMBASSADOR.
   * Útil cuando el cliente paga por fuera de Hotmart.
   */
  @Post(':id/convert-to-paying')
  @Roles('SUPER_ADMIN')
  convertToPaying(
    @Param('id') id: string,
    @Body() body: { periodDays?: number },
    @CurrentUser() user: AuthUser,
  ) {
    // Sin periodDays explícito → el servicio usa la periodicidad real del plan.
    return this.svc.convertToPaying(id, user.id, body?.periodDays);
  }

  @Patch(':id/billing')
  @Roles('SUPER_ADMIN')
  billing(
    @Param('id') id: string,
    @Body() body: BillingBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.updateBilling(id, body, user.id);
  }

  /** Cambia la periodicidad del plan (Mensual/Trimestral/Semestral/Anual).
   *  SOLO METADATA INTERNA: actualiza Tenant.planPeriodicity + extiende
   *  currentPeriodEnd según el nuevo período. NO toca Hotmart — el admin
   *  debe cancelar la suscripción vieja y enviarle al cliente el link del
   *  nuevo plan manualmente. Queda registrado en AuditLog. */
  @Post(':id/change-plan-period')
  @Roles('SUPER_ADMIN')
  changePlanPeriod(
    @Param('id') id: string,
    @Body() body: ChangePlanPeriodBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.changePlanPeriod(id, body.periodicity, user.id);
  }

  /** M5 (2026-06-04): MARKETING también puede entrar al panel del tenant
   *  como implementador (configurar menú, branding, tarjetas, etc). El
   *  rol MARKETING ya tenía cross-tenant read; ahora también puede
   *  abrir el tenant y hacer cambios sin tener que pedirle al dueño
   *  ni cerrar su propia sesión. La impersonación queda auditada. */
  @Post(':id/impersonate')
  @Roles('SUPER_ADMIN', 'MARKETING')
  impersonate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.impersonate(id, user.id);
  }

  /** Toggle demo lock. Body: { locked: boolean, reason?: string }.
   *  Cuando locked=true, no-SUPER_ADMIN no puede modificar nada en
   *  ese tenant — pensado para cuentas demo que los embajadores muestran
   *  a prospects sin riesgo. Invalida cache del guard al toque. */
  @Patch(':id/lock')
  @Roles('SUPER_ADMIN')
  async setLock(
    @Param('id') id: string,
    @Body() body: { locked: boolean; reason?: string | null },
    @CurrentUser() user: AuthUser,
  ) {
    const result = await this.svc.setLock(id, {
      locked: !!body?.locked,
      reason: body?.reason ?? null,
      actorId: user.id,
    });
    this.lockGuard.invalidate(id);
    return result;
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN')
  remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body?: { keepHistory?: boolean },
  ) {
    // Bloque 5 (2026-06-12): default keepHistory=true (seguro). Si el
    // admin quiere hard-delete tiene que pasar `keepHistory: false`
    // explícito desde el modal de confirmación.
    return this.svc.remove(id, user.id, {
      keepHistory: body?.keepHistory !== false,
    });
  }
}
