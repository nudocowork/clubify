import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { TenantMeController } from './me.controller';
import { StaffController, ChangePasswordController, UserMeController } from './staff.controller';
import { AuthModule } from '../auth/auth.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [AuthModule, IntegrationsModule, BillingModule],
  providers: [TenantsService],
  controllers: [
    TenantMeController,
    StaffController,
    ChangePasswordController,
    UserMeController,
    TenantsController,
  ],
  exports: [TenantsService],
})
export class TenantsModule {}
