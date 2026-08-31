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
import { CommissionRecalcModule } from '../referrals/commission-recalc.module';
import { OnboardingSyncModule } from '../onboarding-sync/onboarding-sync.module';
import { FinanceModule } from '../finance/finance.module';

@Module({
  imports: [
    AuthModule,
    AuditModule,
    IntegrationsModule,
    BillingModule,
    // CONTABILIDAD Fase 1: TenantsService registra el ingreso del pago manual.
    // FinanceModule es hoja (solo Prisma) → sin ciclo.
    FinanceModule,
    // Fase D: TenantsService dispara el webhook business.activated (one-way,
    // OnboardingSyncModule no importa TenantsModule → sin ciclo).
    OnboardingSyncModule,
    // forwardRef por posible ciclo: ReferralsModule podría depender de
    // tenants en el futuro. Por ahora es one-way pero el forwardRef
    // protege a futuro.
    forwardRef(() => ReferralsModule),
    CommissionRecalcModule,
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
