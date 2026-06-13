import { Module } from '@nestjs/common';
import { SuperAdminService } from './superadmin.service';
import { SuperAdminController } from './superadmin.controller';
import { RenewalsService } from './renewals.service';

@Module({
  providers: [SuperAdminService, RenewalsService],
  controllers: [SuperAdminController],
  exports: [RenewalsService],
})
export class SuperAdminModule {}
