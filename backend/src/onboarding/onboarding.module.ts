import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [OnboardingController],
})
export class OnboardingModule {}
