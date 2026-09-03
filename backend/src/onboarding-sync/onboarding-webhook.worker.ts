import { Injectable, OnModuleInit } from '@nestjs/common';
import { QueueService } from '../jobs/queue.service';
import { OnboardingWebhookService } from './onboarding-webhook.service';

// Worker de la cola 'onboarding.webhook' (Fase D). Entrega durable del webhook
// business.activated con reintentos 1min/10min/1h. El rescheduling lo maneja
// OnboardingWebhookService.deliverJob (re-encola con delay al fallar).
@Injectable()
export class OnboardingWebhookWorker implements OnModuleInit {
  constructor(
    private readonly queue: QueueService,
    private readonly webhook: OnboardingWebhookService,
  ) {}

  onModuleInit() {
    this.queue.registerWorker('onboarding.webhook', (data) =>
      this.webhook.deliverJob(data as { payload: any; attempt: number }),
    );
  }
}
