import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { OnboardingTokenGuard } from './onboarding-token.guard';
import { OnboardingTenantId } from './onboarding-tenant.decorator';
import { OnboardingSyncService } from './onboarding-sync.service';

// Superficie autenticada con el TOKEN DEL NEGOCIO (Fase B). @Public salta el
// JwtAuthGuard global; OnboardingTokenGuard resuelve el negocio dueño del token
// y lo deja en @OnboardingTenantId. TODOS los endpoints escriben SOLO sobre ese
// negocio (Fase C). Upsert no destructivo (excepto /hours, set completo).
@Public()
@UseGuards(OnboardingTokenGuard)
@Controller('sync')
export class OnboardingSyncController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: OnboardingSyncService,
  ) {}

  /** Verifica el token y devuelve a qué negocio pertenece. */
  @Get('whoami')
  async whoami(@OnboardingTenantId() tenantId: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        brandName: true,
        slug: true,
        status: true,
      },
    });
    return {
      business_id: tenantId,
      name: t?.name ?? null,
      brandName: t?.brandName ?? null,
      slug: t?.slug ?? null,
      status: t?.status ?? null,
    };
  }

  @Patch('business')
  business(@OnboardingTenantId() tid: string, @Body() body: any) {
    return this.sync.syncBusiness(tid, body || {});
  }

  @Patch('branding')
  branding(@OnboardingTenantId() tid: string, @Body() body: any) {
    return this.sync.syncBranding(tid, body || {});
  }

  @Patch('contact')
  contact(@OnboardingTenantId() tid: string, @Body() body: any) {
    return this.sync.syncContact(tid, body || {});
  }

  @Patch('reviews')
  reviews(@OnboardingTenantId() tid: string, @Body() body: any) {
    return this.sync.syncReviews(tid, body || {});
  }

  @Put('location')
  location(@OnboardingTenantId() tid: string, @Body() body: any) {
    return this.sync.syncLocation(tid, body || {});
  }

  // Varias sedes (Onboarding multisede). Arreglo directo o { items: [...] }.
  // Upsert por NOMBRE y no borra ninguna: una sede lleva pedidos, sellos y
  // tarjetas colgando, y un formulario al que alguien le quito una linea no
  // puede llevarselos por delante. Ver syncLocations.
  @Put('locations')
  locations(@OnboardingTenantId() tid: string, @Body() body: any) {
    return this.sync.syncLocations(tid, body?.items ?? body);
  }

  @Put('loyalty-card')
  loyaltyCard(@OnboardingTenantId() tid: string, @Body() body: any) {
    return this.sync.syncLoyaltyCard(tid, body || {});
  }

  // VARIAS tarjetas de sellos. El singular de arriba pisa siempre la primera,
  // asi que mandar la segunda borraba la primera. Upsert por NOMBRE y no borra
  // las que no vengan: una tarjeta tiene sellos y clientes colgando.
  // Arreglo directo o { items: [...] }.
  @Put('loyalty-cards')
  loyaltyCards(@OnboardingTenantId() tid: string, @Body() body: any) {
    return this.sync.upsertLoyaltyCards(tid, body?.items ?? body);
  }

  // Plan de CLUB: la membresia de cupo mensual («10 cafes al mes»). Upsert por
  // nombre. Delega en ClubService, que es quien valida tramos y topes.
  @Put('club-plan')
  clubPlan(@OnboardingTenantId() tid: string, @Body() body: any) {
    return this.sync.syncClubPlan(tid, body || {});
  }

  // CONVENIO (alianza con una empresa). Upsert por nombre de la empresa.
  // Los cupones solo se crean al CREAR el convenio: en uno que ya existe
  // llevan canjes y topes consumidos colgando.
  @Put('convenio')
  convenio(@OnboardingTenantId() tid: string, @Body() body: any) {
    return this.sync.syncConvenio(tid, body || {});
  }

  // Acepta un arreglo directo o { items: [...] }.
  @Put('hours')
  hours(@OnboardingTenantId() tid: string, @Body() body: any) {
    return this.sync.syncHours(tid, body?.items ?? body);
  }

  @Patch('modules')
  modules(@OnboardingTenantId() tid: string, @Body() body: any) {
    return this.sync.syncModules(tid, body || {});
  }

  @Post('categories')
  categories(@OnboardingTenantId() tid: string, @Body() body: any) {
    return this.sync.upsertCategories(tid, body?.items ?? body);
  }

  @Post('products')
  products(@OnboardingTenantId() tid: string, @Body() body: any) {
    return this.sync.upsertProducts(tid, body?.items ?? body);
  }

  @Post('coupons')
  coupons(@OnboardingTenantId() tid: string, @Body() body: any) {
    return this.sync.upsertCoupons(tid, body?.items ?? body);
  }

  // Link-in-bio (upsert; reemplaza la lista de botones completa).
  @Put('infolink')
  infolink(@OnboardingTenantId() tid: string, @Body() body: any) {
    return this.sync.syncInfolink(tid, body || {});
  }

  // Push automáticas por evento (welcome/birthday/stamp/reward/inactivity).
  @Put('automations')
  automations(@OnboardingTenantId() tid: string, @Body() body: any) {
    return this.sync.syncAutomations(tid, body || {});
  }

  @Post('activate')
  activate(@OnboardingTenantId() tid: string) {
    return this.sync.activate(tid);
  }
}
