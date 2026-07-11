import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  OnboardingTokenGuard,
  OnboardingRequest,
} from './onboarding-token.guard';

// Superficie autenticada con el TOKEN DEL NEGOCIO (Fase B). @Public salta el
// JwtAuthGuard global; OnboardingTokenGuard resuelve el negocio dueño del token.
// Los endpoints de escritura (Fase C) vivirán aquí, todos scoped a
// req.onboardingTenantId (nunca al body).
@Controller('sync')
export class OnboardingSyncController {
  constructor(private readonly prisma: PrismaService) {}

  /** Verifica el token y devuelve a qué negocio pertenece. El onboarding lo
   *  usa para confirmar que conectó con el negocio correcto. */
  @Public()
  @UseGuards(OnboardingTokenGuard)
  @Get('whoami')
  async whoami(@Req() req: OnboardingRequest) {
    const tenantId = req.onboardingTenantId as string;
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
}
