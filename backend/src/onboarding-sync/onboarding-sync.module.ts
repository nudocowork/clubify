import { Module } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { OnboardingSyncService } from './onboarding-sync.service';
import { OnboardingTokenGuard } from './onboarding-token.guard';
import { OnboardingConnectController } from './onboarding-connect.controller';
import { OnboardingSyncController } from './onboarding-sync.controller';

// Onboarding Sync API — Fase B (token por negocio + guard + "Conectar con
// Onboarding") + Fase C (endpoints de escritura /sync/*). PrismaModule es
// @Global, no hace falta importarlo.
@Module({
  providers: [OnboardingService, OnboardingSyncService, OnboardingTokenGuard],
  controllers: [OnboardingConnectController, OnboardingSyncController],
})
export class OnboardingSyncModule {}
