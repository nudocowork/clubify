import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, UnauthorizedException } from '@nestjs/common';
import { IsArray, IsBoolean, IsDateString, IsEmail, IsHexColor, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { TenantsService } from './tenants.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
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
  // Tipo de negocio: FULL (Negocio Completo, 1 créd/mes) o INFOLINK (Solo
  // InfoLink, 0.25 créd/mes). Default FULL en el service si no se envía.
  @IsOptional() @IsIn(['FULL', 'INFOLINK']) businessType?: 'FULL' | 'INFOLINK';
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

/** Registro de un cobro hecho POR FUERA de las pasarelas (Nequi, efectivo,
 *  transferencia). El ciclo cubierto NO viene en el body: lo calcula el
 *  servicio con la periodicidad real del plan (addPlanPeriod) — el cliente
 *  no puede decidir cuánto tiempo compra. */
class RegisterManualPaymentBody {
  @IsIn(['NEQUI', 'EFECTIVO', 'TRANSFERENCIA', 'OTRO'])
  method!: 'NEQUI' | 'EFECTIVO' | 'TRANSFERENCIA' | 'OTRO';
  /** Importe cobrado. Opcional: a veces solo interesa dejar el ciclo cubierto. */
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsOptional() @IsString() @MaxLength(8) currency?: string;
  /** Número de comprobante, referencia de Nequi, etc. */
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  /** Cuándo pagó el cliente (ISO). Default: ahora. No puede ser futura. */
  @IsOptional() @IsDateString() paidAt?: string;
}

/** Marcar / desmarcar el negocio como "paga por fuera" (Tenant.manualPayment). */
class ManualPaymentModeBody {
  @IsBoolean() enabled!: boolean;
}

/** Reset de contraseña del dueño desde el panel admin (sin pedir la actual). */
class ChangeOwnerPasswordBody {
  @IsString() @MinLength(8) @MaxLength(128) newPassword!: string;
}

/** Ajuste de trial (suma o resta). days != 0, hasta ±3650. observation
 *  opcional (texto libre que aparece en el historial). */
class AdjustTrialBody {
  @IsInt() days!: number;
  @IsOptional() @IsString() @MaxLength(200) observation?: string;
}

class UpdateTenantBody {
  @IsOptional() @IsString() brandName?: string;
  // Slug del storefront (/m/<slug>). Editable desde el detalle del negocio.
  // Se normaliza y se asegura unicidad global en el service. Cambiarlo
  // actualiza todas las URLs dinámicas (storefront/QR/wallet se recomputan).
  @IsOptional() @IsString() @MaxLength(60) slug?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsHexColor() primaryColor?: string;
  @IsOptional() @IsHexColor() secondaryColor?: string;
  @IsOptional() @IsString() status?: TenantStatus;
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsIn(['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'])
  planPeriodicity?: 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';
  // Tipo de negocio (Completo / Solo InfoLink). Editable desde la ficha del
  // negocio en /admin/tenants/[id]. Cambia consumo de créditos y módulos.
  @IsOptional() @IsIn(['FULL', 'INFOLINK']) businessType?: 'FULL' | 'INFOLINK';
  // Modo de reparto de comisión del vendedor (Fase 3 overhaul comisiones).
  @IsOptional()
  @IsIn(['DISCOUNT_FROM_INFLUENCER', 'ADDITIONAL_COMPANY_COMMISSION'])
  commissionDistributionMode?:
    | 'DISCOUNT_FROM_INFLUENCER'
    | 'ADDITIONAL_COMPANY_COMMISSION';
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
  // PDF 1256 F3: notificaciones de pedido al CLIENTE por SMS (opt-in, OFF por
  // defecto). Config desde /admin/tenants/[id]. Eventos: 'created'|'confirmed'|
  // 'ready'|'on_the_way'|'delivered'.
  @IsOptional() @IsBoolean() customerOrderAlertsEnabled?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true })
  customerOrderAlertsEvents?: string[] | null;
  // Mensajería WhatsApp del negocio (Bloque 8 2026-06-12). Antes el
  // tenant owner editaba esto desde /app/settings — movido a admin.
  @IsOptional() @IsString() whatsappPhone?: string;
  @IsOptional() @IsString() whatsappOrdersPhone?: string;
  @IsOptional() @IsString() whatsappDeliveryPhone?: string;
  // Bloque 2 (2026-06-12): toggles per-tenant para mostrar/ocultar
  // los links de Tutoriales y Academia Clubify en los sidebars.
  @IsOptional() @IsBoolean() tutorialsEnabled?: boolean;
  /**
   * Varias cartas, una por sede. Se habilita NEGOCIO POR NEGOCIO: la inmensa
   * mayoria tiene un solo menu y no tiene por que ver esta complejidad.
   * Apagarlo NO borra nada: el menu principal es lo que siempre estuvo.
   */
  @IsOptional() @IsBoolean() multiMenuEnabled?: boolean;
  /** Cuantas cartas EXTRA puede crear, ademas del menu principal. */
  /** Cartas extra permitidas. `-1` = SIN TOPE (ver `menus.service`). */
  @IsOptional() @IsInt() @Min(-1) @Max(20) maxExtraMenus?: number;
  @IsOptional() @IsBoolean() academyEnabled?: boolean;
  // Reservations module gate (2026-06-12).
  @IsOptional() @IsBoolean() reservationsEnabled?: boolean;
  // Reservas de SERVICIOS (citas) gate — PDF245 P7.
  @IsOptional() @IsBoolean() serviceReservationsEnabled?: boolean;
  /**
   * ALIANZAS con empresas (convenios). Se habilita negocio por negocio, igual
   * que las cartas por sede: la mayoría no monta ninguna y no tiene por qué ver
   * la complejidad.
   *
   * Hasta ahora esta columna solo se LEÍA: no había ni un panel que la
   * escribiera, así que el módulo únicamente se podía encender por SQL directo
   * contra producción.
   */
  @IsOptional() @IsBoolean() conveniosEnabled?: boolean;
  @IsOptional() @IsBoolean() clubEnabled?: boolean;
  /** Cuántas alianzas puede tener a la vez. Por defecto 3. */
  @IsOptional() @IsInt() @Min(1) @Max(50) maxConvenios?: number;
  // Notas internas del negocio (SOLO Clubify: este controller es
  // @Roles('SUPER_ADMIN','MARKETING'), el dueño del negocio no lo ve).
  // Observaciones operativas: "pagó por Nequi", etc. null = limpiar.
  @IsOptional() @IsString() @MaxLength(5000) notes?: string | null;
}

@Controller('tenants')
@Roles('SUPER_ADMIN', 'MARKETING')
export class TenantsController {
  constructor(
    private svc: TenantsService,
    private lockGuard: TenantLockGuard,
  ) {}

  // PDF Soft(9) A4: magic-link "entrar al negocio" para TeamClubify.
  // Declarados ANTES de las rutas :id. @Public() salta RolesGuard; la auth es
  // el x-api-key (link) / el token firmado (exchange).
  @Public()
  @Get('integration/enter-link')
  enterLink(
    @Headers('x-api-key') apiKey: string,
    @Query('tenantId') tenantId?: string,
  ) {
    const expected = process.env.TEAM_INTEGRATION_KEY;
    if (!expected || apiKey !== expected) throw new UnauthorizedException();
    if (!tenantId) throw new UnauthorizedException('tenantId requerido');
    return this.svc.mintEnterLink(tenantId);
  }

  @Public()
  @Post('enter-exchange')
  enterExchange(@Body() body: { token?: string }) {
    if (!body?.token) throw new UnauthorizedException('token requerido');
    return this.svc.enterExchange(body.token);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.svc.list(user);
  }

  // #11 (2026-06-16): ranking de negocios por pases emitidos. Debe ir ANTES
  // de @Get(':id') sino el router matchea "ranking" como :id.
  @Get('ranking')
  ranking(
    @Query('order') order?: string,
    @CurrentUser() user?: AuthUser,
    @Query('criterio') criterio?: string,
    @Query('dias') dias?: string,
    @Query('metric') metric?: string,
  ) {
    // `dias` acota el conteo al período; sin él, el histórico completo.
    const n = Number(dias);
    const desde =
      Number.isFinite(n) && n > 0
        ? new Date(Date.now() - n * 24 * 60 * 60 * 1000)
        : null;
    return this.svc.rankingByPasses(
      order === 'asc' ? 'asc' : 'desc',
      user,
      criterio === 'antiguedad' ? 'antiguedad' : 'pases',
      desde,
      metric === 'pedidos' ? 'pedidos' : 'pases',
    );
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

  /** Historial de pagos unificado (Hotmart + Stripe + cobro por fuera +
   *  crédito): responde si el negocio está pagando o no. Declarado ANTES de
   *  @Get(':id') o el router matchea "payment-history" como :id
   *  (feedback_nestjs_route_order). */
  @Get(':id/payment-history')
  @Roles('SUPER_ADMIN')
  paymentHistory(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.svc.listPaymentHistory(id, limit ? Number(limit) : 100);
  }

  /** Lista de revisión de cobranza manual: negocios "paga por fuera" con el
   *  ciclo vencido y sin pago manual que lo cubra. Declarada ANTES de
   *  @Get(':id') por el orden de rutas de NestJS (feedback_nestjs_route_order). */
  @Get('manual-payments/review')
  @Roles('SUPER_ADMIN')
  manualPaymentReview() {
    return this.svc.listManualPaymentReview();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.getById(id);
  }

  @Post()
  @Roles('SUPER_ADMIN')
  create(@Body() body: CreateTenantBody, @CurrentUser() user: AuthUser) {
    return this.svc.create(body, user);
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
   * Convierte el tenant en cliente pagante (status=ACTIVE, currentPeriodEnd
   * según la periodicidad real del plan, trialEndsAt=null). Dispara backfill
   * de comisión si tiene asignación a INFLUENCER/AMBASSADOR.
   * Útil cuando el cliente paga por fuera de Hotmart.
   *
   * FIX 2026-08-20: ya NO acepta `periodDays`. El frontend lo mandaba
   * SIEMPRE en 30, así que marcar pagado a un trimestral/anual le daba 30
   * días. La periodicidad del plan manda (1/3/6/12 meses) — si algún día se
   * necesita un override real, que sea una acción explícita y auditada.
   */
  @Post(':id/convert-to-paying')
  @Roles('SUPER_ADMIN')
  convertToPaying(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.convertToPaying(id, user.id);
  }

  /** Registra un pago manual (Nequi/efectivo/transferencia): crea la fila
   *  ManualPayment, activa el negocio y avanza su ciclo según la
   *  periodicidad del plan. Devuelve { payment, tenant }. */
  @Post(':id/manual-payments')
  @Roles('SUPER_ADMIN')
  registerManualPayment(
    @Param('id') id: string,
    @Body() body: RegisterManualPaymentBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.registerManualPayment(id, body, user.id);
  }

  /** Historial de pagos manuales del negocio + contexto del modal (importe
   *  sugerido según periodicidad, ciclo vigente, flag manualPayment). */
  @Get(':id/manual-payments')
  @Roles('SUPER_ADMIN')
  listManualPayments(@Param('id') id: string) {
    return this.svc.listManualPayments(id);
  }

  /** Marca / desmarca "paga por fuera": con el flag activo el cron de mora
   *  no lo suspende solo (los recordatorios sí siguen saliendo). */
  @Patch(':id/manual-payment-mode')
  @Roles('SUPER_ADMIN')
  setManualPaymentMode(
    @Param('id') id: string,
    @Body() body: ManualPaymentModeBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.setManualPaymentMode(id, body.enabled, user.id);
  }

  @Patch(':id/billing')
  @Roles('SUPER_ADMIN')
  billing(
    @Param('id') id: string,
    @Body() body: BillingBody,
    @CurrentUser() user: AuthUser,
  ) {
    // Pasamos el whiteLabelId del actor: un admin de MARCA BLANCA no puede fijar
    // una fecha de cobro arbitraria (se ancla a la activación). Solo plataforma.
    return this.svc.updateBilling(id, body, user.id, user.whiteLabelId ?? null);
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

  /**
   * Soporte: quién es el dueño al que le vas a cambiar la contraseña.
   *
   * Sin esto el admin escribía la contraseña a ciegas y solo veía a QUÉ correo
   * se la puso en el aviso posterior, que se va solo. Costó 11 intentos de
   * login fallidos con Limorada (2026-08-23): la cuenta era `@gmail` y se
   * intentaba entrar con `@hotmail`. El login no lo puede decir —revelaría qué
   * correos existen—, pero el panel de soporte sí.
   */
  @Get(':id/owner')
  @Roles('SUPER_ADMIN')
  owner(@Param('id') id: string) {
    return this.svc.ownerOfTenant(id);
  }

  /** Soporte: cambiar la contraseña del dueño del negocio SIN saber la actual.
   *  Solo SUPER_ADMIN. Queda auditado; invalida los tokens viejos del dueño. */
  @Patch(':id/owner-password')
  @Roles('SUPER_ADMIN')
  changeOwnerPassword(
    @Param('id') id: string,
    @Body() body: ChangeOwnerPasswordBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.changeOwnerPasswordAdmin(id, body.newPassword, user.id);
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
