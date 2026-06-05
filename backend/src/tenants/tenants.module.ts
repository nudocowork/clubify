import { Module, forwardRef } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { TenantMeController } from './me.controller';
import { StaffController, ChangePasswordController, UserMeController } from './staff.controller';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { BillingModule } from '../billing/billing.module';
import { ReferralsModule } from '../referrals/referrals.module';

@Module({
  imports: [
    AuthModule,
    AuditModule,
    IntegrationsModule,
    BillingModule,
    // forwardRef por posible ciclo: ReferralsModule podría depender de
    // tenants en el futuro. Por ahora es one-way pero el forwardRef
    // protege a futuro.
    forwardRef(() => ReferralsModule),
  ],
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
