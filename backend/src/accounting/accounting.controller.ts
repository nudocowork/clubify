import {
  Controller,
  Get,
  Headers,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AccountingService } from './accounting.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SoloPlataformaGuard } from '../common/guards/solo-plataforma.guard';

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
  //
  // Solo plataforma: las comisiones no tienen `tenantId`, así que el filtro
  // automático por marca no las alcanza, y el admin de una marca blanca (que
  // es SUPER_ADMIN) leía el libro de TODAS las marcas, con nombres de negocios
  // y lo que cobra Clubify. El libro y el % de socio son de la plataforma.
  @Roles('SUPER_ADMIN')
  @UseGuards(SoloPlataformaGuard)
  @Get('report')
  report(
    @CurrentUser() user: AuthUser,
    @Query('periodKey') periodKey?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.buildReport(user, { periodKey, tenantId });
  }
}
