import { BadRequestException, Body, Controller, ForbiddenException, Get, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { SettingsService } from './settings.service';
import { SoloPlataformaGuard } from '../common/guards/solo-plataforma.guard';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { resolveBrandScope } from '../common/white-label/brand-scope.util';
import { TIPOS_DE_AVISO } from '../auth/prereg-alerts.service';
import {
  CLAVE_AVISOS_AL_EQUIPO,
  leerAvisosAlEquipo,
  validarAvisosAlEquipo,
} from './avisos-al-equipo';

class BrandingDto {
  @IsOptional() @IsString() appLogoUrl?: string | null;
  @IsOptional() @IsString() landingLogoUrl?: string | null;
  @IsOptional() @IsString() faviconUrl?: string | null;
  @IsOptional() @IsString() supportWhatsapp?: string | null;
  @IsOptional() @IsString() welcomePopupImageUrl?: string | null;
  @IsOptional() @IsBoolean() welcomePopupEnabled?: boolean;
  @IsOptional() @IsString() scannerStaffPin?: string | null;
  @IsOptional() @IsString() salesWhatsapp?: string | null;
  @IsOptional() @IsString() salesEmail?: string | null;
  @IsOptional() @IsString() salesInstagram?: string | null;
  @IsOptional() @IsString() @MaxLength(40) landingStatBusinesses?: string | null;
  @IsOptional() @IsString() @MaxLength(40) landingStatWalletCustomers?: string | null;
  @IsOptional() @IsString() @MaxLength(40) landingStatOrders?: string | null;
  @IsOptional() @IsString() @MaxLength(40) landingStatRating?: string | null;
  @IsOptional() @IsString() @MaxLength(600) trialCheckoutUrl?: string | null;
}

class PricingDto {
  @IsOptional() @IsNumber() @Min(0) eliteCost?: number;
  @IsOptional() @IsNumber() @Min(0) proCost?: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
}

/** Body para PATCH /admin/landing-plans. Cada plan es opcional — el
 *  founder edita solo los que quiere actualizar desde /admin/branding. */
class LandingPlanItemDto {
  @IsOptional() @IsNumber() @Min(0) price?: number;
  @IsOptional() @IsString() @MaxLength(500) checkoutUrl?: string | null;
}
class LandingPlansDto {
  @IsOptional() mensual?: LandingPlanItemDto;
  @IsOptional() trimestral?: LandingPlanItemDto;
  @IsOptional() semestral?: LandingPlanItemDto;
  @IsOptional() anual?: LandingPlanItemDto;
}

class HotmartCouponDto {
  // null/string vacío para limpiar. Si no es string ni null, ValidationPipe
  // rechaza con 400 antes de llegar al service (sin esta clase el endpoint
  // aceptaba { foo: 'bar' } y crasheaba en .trim()).
  @IsOptional() @IsString() @MaxLength(200) couponCode?: string | null;
}

class TrialPolicyDto {
  // Tope de días de trial cuando la marca blanca no tiene créditos (0 = bloquear).
  @IsInt() @Min(0) @Max(365) maxTrialDaysNoCredits!: number;
}

// Mensaje pre-llenado del popup de bienvenida. La marca ({brand}) se resuelve
// del negocio (Sellea/Clubify) para no filtrar "Clubify" a marcas blancas.
const welcomePopupMessage = (brand: string) =>
  `Hola acabo de adquirir ${brand}, quiero agendar una sesión personalizada para mayor entendimiento de la plataforma.`;

@Controller()
export class SettingsController {
  constructor(
    private svc: SettingsService,
    private prisma: PrismaService,
  ) {}

  /** Público — el frontend del panel y landing leen branding desde aquí. */
  @Public()
  @Get('branding')
  getBranding() {
    return this.svc.getBranding();
  }

  // De aquí en adelante, todo lo que lleva `admin/` son ajustes GLOBALES de la
  // plataforma: el logo y el WhatsApp de Clubify, sus precios, sus enlaces de
  // pago, su cupón y su política de prueba. Una marca blanca tiene los suyos en
  // su ficha de `WhiteLabel`, no aquí.
  //
  // `@Roles('SUPER_ADMIN')` no bastaba: el admin de una marca blanca ES un
  // SUPER_ADMIN con `whiteLabelId` (auditoría del 2026-09-24). Podía cambiarle
  // el logo y el WhatsApp de soporte a Clubify, y LEER el PIN del escáner, que
  // es uno solo para los 136 negocios.
  //
  // Si alguna pantalla de una marca empieza a dar 403 por esto, la pantalla es
  // la que sobra: estaba enseñando datos de la plataforma.

  /** Lectura admin del branding global. SUPER_ADMIN ve TODO (incluyendo
   *  el PIN sensible del escáner). MARKETING solo ve los campos de diseño
   *  — el PIN se filtra para no exponerlo al rol de marketing. */
  @Get('admin/branding')
  @Roles('SUPER_ADMIN', 'MARKETING')
  @UseGuards(SoloPlataformaGuard)
  getBrandingAdmin(@CurrentUser() user: AuthUser) {
    if (user.role === 'MARKETING') {
      return this.svc.getBranding();
    }
    return this.svc.getBrandingAdmin();
  }

  /** SUPER_ADMIN y MARKETING pueden cambiar el branding global. MARKETING
   *  NO puede setear el scannerStaffPin — se descarta del body si lo manda. */
  @Patch('admin/branding')
  @Roles('SUPER_ADMIN', 'MARKETING')
  @UseGuards(SoloPlataformaGuard)
  setBranding(@CurrentUser() user: AuthUser, @Body() body: BrandingDto) {
    if (user.role === 'MARKETING') {
      const { scannerStaffPin: _omit, ...safe } = body;
      void _omit;
      return this.svc.setBranding(safe);
    }
    return this.svc.setBranding(body);
  }

  /** Precios globales Elite/Pro usados por el módulo Cotizaciones.
   * Lectura: super admin (el módulo público no necesita esto todavía,
   * si más adelante se quiere exponer en landing se cambia a @Public). */
  @Get('admin/pricing')
  @Roles('SUPER_ADMIN')
  @UseGuards(SoloPlataformaGuard)
  getPricing() {
    return this.svc.getPricing();
  }

  @Patch('admin/pricing')
  @Roles('SUPER_ADMIN')
  @UseGuards(SoloPlataformaGuard)
  setPricing(@Body() body: PricingDto) {
    return this.svc.setPricing(body);
  }

  /** Planes de la landing pública (Mensual/Trimestral/Semestral/Anual)
   *  con precio USD + checkoutUrl. Lectura pública — la landing los
   *  renderiza en el toggle. Si un checkoutUrl falta, el botón del
   *  plan correspondiente queda como placeholder visual. */
  @Public()
  @Get('landing-plans')
  getLandingPlans() {
    return this.svc.getLandingPlans();
  }

  /**
   * Todos los enlaces de venta (planes + pago parcial + prueba), ya listos para
   * compartir. Lectura pública: la usa el panel del afiliado, que les mete su
   * código. Ver `enlaces-de-venta.ts`.
   */
  @Public()
  @Get('enlaces-de-venta')
  getEnlacesDeVenta() {
    return this.svc.getEnlacesDeVenta();
  }

  /** Los enlaces AÑADIDOS a mano, para editarlos desde /admin/branding. */
  @Get('admin/enlaces-de-venta')
  @Roles('SUPER_ADMIN', 'MARKETING')
  @UseGuards(SoloPlataformaGuard)
  getEnlacesExtra() {
    return this.svc.getEnlacesExtra();
  }

  /** Reemplaza la lista entera. El saneado (nombre, URL http(s), tope, ids
   *  repetidos) vive en `normalizarEnlaces`, no en un DTO: la lista llega del
   *  panel como viene y lo que no sirve se descarta en vez de romper el guardado. */
  @Patch('admin/enlaces-de-venta')
  @Roles('SUPER_ADMIN', 'MARKETING')
  @UseGuards(SoloPlataformaGuard)
  setEnlacesExtra(@Body() body: { enlaces?: unknown }) {
    return this.svc.setEnlacesExtra(body?.enlaces ?? []);
  }

  @Patch('admin/landing-plans')
  @Roles('SUPER_ADMIN', 'MARKETING')
  @UseGuards(SoloPlataformaGuard)
  setLandingPlans(@Body() body: LandingPlansDto) {
    return this.svc.setLandingPlans(body);
  }

  /** Nombres de negocios ACTIVOS de Clubify — alimenta el marquee "Negocios
   *  LATAM creciendo con Clubify" de la landing. Lectura pública. */
  @Public()
  @Get('landing-active-businesses')
  getLandingActiveBusinesses() {
    return this.svc.getLandingActiveBusinesses();
  }

  /** Cupón Hotmart global — se preponne al checkout URL como
   *  ?couponCode=X para que Hotmart aplique el descuento. String vacío
   *  o null = sin cupón. */
  @Get('admin/billing/hotmart-coupon')
  @Roles('SUPER_ADMIN')
  @UseGuards(SoloPlataformaGuard)
  getHotmartCoupon() {
    return this.svc.getHotmartCoupon();
  }

  @Patch('admin/billing/hotmart-coupon')
  @Roles('SUPER_ADMIN')
  @UseGuards(SoloPlataformaGuard)
  setHotmartCoupon(@Body() body: HotmartCouponDto) {
    return this.svc.setHotmartCoupon(body.couponCode ?? null);
  }

  @Get('admin/trial-policy')
  @Roles('SUPER_ADMIN')
  @UseGuards(SoloPlataformaGuard)
  getTrialPolicy() {
    return this.svc.getTrialPolicy();
  }

  @Patch('admin/trial-policy')
  @Roles('SUPER_ADMIN')
  @UseGuards(SoloPlataformaGuard)
  setTrialPolicy(@Body() body: TrialPolicyDto) {
    return this.svc.setTrialPolicy(body.maxTrialDaysNoCredits);
  }

  /**
   * Indica al frontend del panel si debe mostrar el popup de bienvenida.
   * Combina la config global (super admin) + estado del tenant actual
   * (no se mostró todavía, status ACTIVE).
   */
  @Get('welcome-popup/me')
  @Roles('TENANT_OWNER')
  async getWelcomePopup(@CurrentUser() user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException();
    const [branding, t] = await Promise.all([
      this.svc.getBranding(),
      this.prisma.tenant.findUnique({
        where: { id: user.tenantId },
        select: {
          status: true,
          welcomePopupSeenAt: true,
          whiteLabel: { select: { name: true } },
        },
      }),
    ]);
    const shouldShow =
      branding.welcomePopupEnabled &&
      !!branding.welcomePopupImageUrl &&
      !!t &&
      t.status === 'ACTIVE' &&
      !t.welcomePopupSeenAt;
    return {
      shouldShow,
      imageUrl: branding.welcomePopupImageUrl,
      supportPhone: branding.supportWhatsapp,
      message: welcomePopupMessage(t?.whiteLabel?.name?.trim() || 'Clubify'),
    };
  }

  /**
   * «Avisos al equipo» (Integraciones SMS): quién recibe qué SMS interno.
   *
   * Solo la PLATAFORMA. Un admin de marca blanca también es SUPER_ADMIN (con
   * `whiteLabelId`), y estos teléfonos son los del equipo de Clubify: el de
   * Sellea no puede verlos ni cambiarlos. Mismo criterio que las subcuentas
   * de Grow Business.
   */
  private async soloPlataforma(user: AuthUser): Promise<void> {
    if (!user?.whiteLabelId) return;
    const scope = await resolveBrandScope(this.prisma, user.whiteLabelId);
    if (!scope.isClubify) {
      throw new ForbiddenException('Los avisos al equipo son de la plataforma.');
    }
  }

  @Get('admin/avisos-al-equipo')
  @Roles('SUPER_ADMIN')
  async getAvisosAlEquipo(@CurrentUser() user: AuthUser) {
    await this.soloPlataforma(user);
    const fila = await this.prisma.setting.findUnique({
      where: { key: CLAVE_AVISOS_AL_EQUIPO },
    });
    const personas = leerAvisosAlEquipo(fila?.value);
    return {
      personas,
      tipos: TIPOS_DE_AVISO,
      // Sin fila —o con una fila vacía o rota—, el servicio usa los teléfonos
      // de fábrica: la pantalla lo dice.
      deFabrica: !fila || personas.length === 0,
    };
  }

  @Put('admin/avisos-al-equipo')
  @Roles('SUPER_ADMIN')
  async setAvisosAlEquipo(
    @CurrentUser() user: AuthUser,
    @Body() body: { personas?: unknown },
  ) {
    await this.soloPlataforma(user);
    const r = validarAvisosAlEquipo(body?.personas);
    if (!r.ok) throw new BadRequestException(r.error);
    const value = JSON.stringify(r.personas);
    await this.prisma.setting.upsert({
      where: { key: CLAVE_AVISOS_AL_EQUIPO },
      create: { key: CLAVE_AVISOS_AL_EQUIPO, value },
      update: { value },
    });
    return { personas: r.personas, tipos: TIPOS_DE_AVISO, deFabrica: false };
  }

  @Post('welcome-popup/dismiss')
  @Roles('TENANT_OWNER')
  async dismissWelcomePopup(@CurrentUser() user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException();
    await this.prisma.tenant.update({
      where: { id: user.tenantId },
      data: { welcomePopupSeenAt: new Date() },
    });
    return { ok: true };
  }
}
