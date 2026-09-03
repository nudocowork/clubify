import { Module } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { OnboardingSyncService } from './onboarding-sync.service';
import { OnboardingWebhookService } from './onboarding-webhook.service';
import { OnboardingWebhookWorker } from './onboarding-webhook.worker';
import { OnboardingTokenGuard } from './onboarding-token.guard';
import { OnboardingConnectAdminController } from './onboarding-connect-admin.controller';
import { OnboardingSyncController } from './onboarding-sync.controller';
import { OnboardingWebhookAdminController } from './onboarding-webhook-admin.controller';

// Onboarding Sync API — Fase B (token por negocio + guard + "Conectar con
// Onboarding") + Fase C (endpoints de escritura /sync/*) + Fase D (webhook
// saliente business.activated). PrismaModule es @Global. Exportamos el
// WebhookService para que TenantsService dispare el webhook al activar por panel.
@Module({
  providers: [
    OnboardingService,
    OnboardingSyncService,
    OnboardingWebhookService,
    OnboardingWebhookWorker,
    OnboardingTokenGuard,
  ],
  controllers: [
    OnboardingConnectAdminController,
    OnboardingSyncController,
    OnboardingWebhookAdminController,
  ],
  exports: [OnboardingWebhookService],
})
export class OnboardingSyncModule {}
