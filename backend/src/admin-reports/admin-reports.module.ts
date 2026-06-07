import { Module } from '@nestjs/common';
import { AdminReportsService } from './admin-reports.service';
import { AdminReportsController } from './admin-reports.controller';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  providers: [AdminReportsService],
  controllers: [AdminReportsController],
  exports: [AdminReportsService],
})
export class AdminReportsModule {}
