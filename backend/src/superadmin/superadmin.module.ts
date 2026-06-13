import { Module, forwardRef } from '@nestjs/common';
import { SuperAdminService } from './superadmin.service';
import { SuperAdminController } from './superadmin.controller';
import { RenewalsService } from './renewals.service';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuditModule, forwardRef(() => AuthModule)],
  providers: [SuperAdminService, RenewalsService],
  controllers: [SuperAdminController],
  exports: [RenewalsService],
})
export class SuperAdminModule {}
