import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import type { PaymentGateway } from '@prisma/client';
import { IncomeRecordService } from './income-record.service';
import { FinanceReportService } from './finance-report.service';
import { rangoDe } from './where-periodo';
import { CobrosService } from '../admin-reports/cobros.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class ReconcileBody {
  @IsNumber() netReceivedUsd!: number;
}

class CerrarMesBody {
  @IsString() period!: string; // "YYYY-MM"
  @IsOptional() @IsString() scope?: string; // "clubify" | "all"
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/**
 * CONTABILIDAD — Fase 1. Endpoints de Ingresos + Conciliación. Solo lectura +
 * conciliación manual; NO crea ingresos (eso lo hacen los webhooks). Por
 * defecto muestra los ingresos de la PLATAFORMA (Clubify, whiteLabelId null);
 * `scope=all` incluye los de las marcas blancas.
 */
@Controller('admin/contabilidad')
export class FinanceController {
  constructor(
    private income: IncomeRecordService,
    private report: FinanceReportService,
    private cobros: CobrosService,
  ) {}

  @Roles('SUPER_ADMIN')
  @Get('ingresos')
  ingresos(
    @Query('gateway') gateway?: string,
    @Query('scope') scope?: string,
    @Query('limit') limit?: string,
    @Query('period') period?: string,
  ) {
    const r = rangoDe(period);
    return this.income.list({
      gateway: (gateway || undefined) as PaymentGateway | undefined,
      onlyClubify: scope !== 'all',
      limit: limit ? Number(limit) : undefined,
      ...r,
    });
  }

  @Roles('SUPER_ADMIN')
  @Get('ingresos/resumen')
  resumen(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('scope') scope?: string,
    @Query('period') period?: string,
  ) {
    // `period` manda; `from`/`to` siguen aceptándose para rangos a medida.
    const r = period
      ? rangoDe(period)
      : {
          from: from ? new Date(from) : undefined,
          to: to ? new Date(to) : undefined,
        };
    return this.income.summary({ ...r, onlyClubify: scope !== 'all' });
  }

  @Roles('SUPER_ADMIN')
  @Patch('ingresos/:id/conciliar')
  conciliar(
    @Param('id') id: string,
    @Body() body: ReconcileBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.income.reconcile(id, body.netReceivedUsd, user?.id ?? null);
  }

  // ── Fase 6 — Reportes (cascada de utilidad + serie mensual) ────────────────
  @Roles('SUPER_ADMIN')
  @Get('reporte')
  async reporte(
    @Query('scope') scope?: string,
    @Query('period') period?: string,
  ) {
    const onlyClubify = scope !== 'all';
    const { from, to } = rangoDe(period);
    const [summary, series] = await Promise.all([
      this.report.summary(onlyClubify, from, to),
      this.report.monthlySeries(onlyClubify, 6),
    ]);
    return { period: period ?? 'all', summary, series };
  }

  // ── Fase 2 — Panorama del período (lo primero que se ve al abrirlo) ───────
  @Roles('SUPER_ADMIN')
  @Get('panorama')
  panorama(@Query('scope') scope?: string, @Query('period') period?: string) {
    return this.report.panorama(scope !== 'all', period || 'todo');
  }

  // ── Fase 3 — Comisiones del período ───────────────────────────────────────
  @Roles('SUPER_ADMIN')
  @Get('comisiones')
  comisiones(@Query('period') period?: string) {
    return this.report.comisionesDelPeriodo(period || 'todo');
  }

  /**
   * ── Fase 3 — Próximos cobros ──────────────────────────────────────────────
   * Lo que se espera cobrar de aquí a `dias`. NO es del período contable: es
   * plata que todavía no entró, y mezclarla con lo cobrado sería justo lo que
   * el módulo evita. Sale de `CobrosService`, la misma fuente del dashboard.
   */
  @Roles('SUPER_ADMIN')
  @Get('proximos-cobros')
  async proximosCobros(@Query('dias') dias?: string) {
    const n = Number(dias);
    const ventana = Number.isFinite(n) && n > 0 && n <= 180 ? Math.round(n) : 30;
    const ahora = new Date();
    const [resumen, filas] = await Promise.all([
      this.cobros.summary(null, ahora),
      this.cobros.detail(null, 'proximos', ahora, { days: ventana }),
    ]);
    return { dias: ventana, resumen, filas };
  }

  // ── Fase 5 — Cierres contables ─────────────────────────────────────────────
  @Roles('SUPER_ADMIN')
  @Get('cierres')
  cierres(@Query('scope') scope?: string) {
    return this.report.listCloses(scope === 'all' ? 'all' : 'clubify');
  }

  @Roles('SUPER_ADMIN')
  @Post('cierres')
  cerrarMes(@Body() body: CerrarMesBody, @CurrentUser() user: AuthUser) {
    return this.report.closePeriod(
      user?.id ?? null,
      body.period,
      body.scope === 'all' ? 'all' : 'clubify',
      body.note,
    );
  }

  @Roles('SUPER_ADMIN')
  @Delete('cierres/:id')
  reabrirMes(@Param('id') id: string) {
    return this.report.reopen(id);
  }
}
