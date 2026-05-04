import { Body, Controller, ForbiddenException, Get, Post } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { BillingService } from './billing.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class CancelDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

@Controller('billing')
export class BillingController {
  constructor(private svc: BillingService) {}

  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  @Get('status')
  async status(@CurrentUser() user: AuthUser) {
    if (!user.tenantId) {
      return { status: 'EXPIRED', isActiveAccess: false, daysLeftInTrial: null };
    }
    return this.svc.getStatus(user.tenantId);
  }

  @Roles('TENANT_OWNER')
  @Post('cancel')
  async cancel(@CurrentUser() user: AuthUser, @Body() dto: CancelDto) {
    if (!user.tenantId) throw new ForbiddenException();
    return this.svc.cancelSubscription(user.tenantId, dto.reason);
  }

  @Roles('TENANT_OWNER')
  @Post('reactivate')
  async reactivate(@CurrentUser() user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException();
    return this.svc.reactivate(user.tenantId);
  }

  /** Endpoint admin para correr el check manualmente. Útil mientras no hay cron. */
  @Roles('SUPER_ADMIN')
  @Post('run-daily-check')
  async runCheck() {
    return this.svc.runDailyCheck();
  }
}
