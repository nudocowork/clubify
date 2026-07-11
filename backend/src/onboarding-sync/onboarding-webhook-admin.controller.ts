import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { OnboardingWebhookService } from './onboarding-webhook.service';

// Config del webhook de Onboarding (Fase D) — Master Admin (PLATFORM_OWNER).
// Path top-level para no chocar con rutas paramétricas de superadmin.
@Controller('onboarding-webhook')
@Roles('PLATFORM_OWNER')
export class OnboardingWebhookAdminController {
  constructor(private readonly webhook: OnboardingWebhookService) {}

  @Get()
  get() {
    return this.webhook.getConfig();
  }

  @Put()
  set(@Body() body: any) {
    return this.webhook.setConfig(body || {});
  }

  @Post('test')
  test() {
    return this.webhook.test();
  }
}
