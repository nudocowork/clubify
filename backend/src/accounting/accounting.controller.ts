import {
  Controller,
  Get,
  Headers,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { AccountingService } from './accounting.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';

@Controller('admin/accounting')
export class AccountingController {
  constructor(private svc: AccountingService) {}

  // PDF Soft(9) A: Contabilidad para TeamClubify (mismo x-api-key que el feed de
  // comisiones). Solo lectura, server-to-server.
  @Public()
  @Get('integration/report')
  integrationReport(
    @Headers('x-api-key') apiKey: string,
    @Query('periodKey') periodKey?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    const expected = process.env.TEAM_INTEGRATION_KEY;
    if (!expected || apiKey !== expected) throw new UnauthorizedException();
    return this.svc.buildReport({ role: 'SUPER_ADMIN' } as AuthUser, {
      periodKey,
      tenantId,
    });
  }

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
