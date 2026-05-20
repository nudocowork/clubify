import { Module } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';
import {
  MaintenanceAdminController,
  MaintenancePublicController,
} from './maintenance.controller';

@Module({
  providers: [MaintenanceService],
  controllers: [MaintenanceAdminController, MaintenancePublicController],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
