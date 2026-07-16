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

  @Put('loyalty-card')
  loyaltyCard(@OnboardingTenantId() tid: string, @Body() body: any) {
    return this.sync.syncLoyaltyCard(tid, body || {});
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

  @Post('activate')
  activate(@OnboardingTenantId() tid: string) {
    return this.sync.activate(tid);
  }
}
