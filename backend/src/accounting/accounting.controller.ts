import { Controller, Get, Query } from '@nestjs/common';
import { AccountingService } from './accounting.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('admin/accounting')
export class AccountingController {
  constructor(private svc: AccountingService) {}

  // Reporte contable del período: resumen + balance de comprobación + libro
  // de asientos (doble partida, derivado de las comisiones reales).
  @Roles('SUPER_ADMIN')
  @Get('report')
  report(
    @CurrentUser() user: AuthUser,
    @Query('periodKey') periodKey?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.buildReport(user, { periodKey, tenantId });
  }
}
