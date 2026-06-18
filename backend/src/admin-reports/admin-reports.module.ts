import { Module } from '@nestjs/common';
import { AdminReportsService } from './admin-reports.service';
import { AdminReportsController } from './admin-reports.controller';
import { SettingsModule } from '../settings/settings.module';
import { WhiteLabelNotificationsModule } from '../white-label-notifications/white-label-notifications.module';

@Module({
  imports: [SettingsModule, WhiteLabelNotificationsModule],
  providers: [AdminReportsService],
  controllers: [AdminReportsController],
  exports: [AdminReportsService],
})
export class AdminReportsModule {}
