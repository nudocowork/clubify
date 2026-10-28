import { Module } from '@nestjs/common';
import { SupportIntegrationController } from './support-integration.controller';
import { SupportIntegrationService } from './support-integration.service';

@Module({
  providers: [SupportIntegrationService],
  controllers: [SupportIntegrationController],
})
export class SupportIntegrationModule {}
