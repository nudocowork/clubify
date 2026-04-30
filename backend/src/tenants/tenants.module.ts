import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { TenantMeController } from './me.controller';
import { StaffController, ChangePasswordController } from './staff.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [TenantsService],
  controllers: [
    TenantMeController,
    StaffController,
    ChangePasswordController,
    TenantsController,
  ],
  exports: [TenantsService],
})
export class TenantsModule {}
