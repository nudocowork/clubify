import { Module } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { OnboardingTokenGuard } from './onboarding-token.guard';
import { OnboardingConnectController } from './onboarding-connect.controller';
import { OnboardingSyncController } from './onboarding-sync.controller';

// Onboarding Sync API — Fase B (token por negocio + guard + "Conectar con
// Onboarding"). PrismaModule es @Global, no hace falta importarlo.
@Module({
  providers: [OnboardingService, OnboardingTokenGuard],
  controllers: [OnboardingConnectController, OnboardingSyncController],
})
export class OnboardingSyncModule {}
