import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { IsNumber } from 'class-validator';
import type { PaymentGateway } from '@prisma/client';
import { IncomeRecordService } from './income-record.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class ReconcileBody {
  @IsNumber() netReceivedUsd!: number;
}

/**
 * CONTABILIDAD — Fase 1. Endpoints de Ingresos + Conciliación. Solo lectura +
 * conciliación manual; NO crea ingresos (eso lo hacen los webhooks). Por
 * defecto muestra los ingresos de la PLATAFORMA (Clubify, whiteLabelId null);
 * `scope=all` incluye los de las marcas blancas.
 */
@Controller('admin/contabilidad')
export class FinanceController {
  constructor(private income: IncomeRecordService) {}

  @Roles('SUPER_ADMIN')
  @Get('ingresos')
  ingresos(
    @Query('gateway') gateway?: string,
    @Query('scope') scope?: string,
    @Query('limit') limit?: string,
  ) {
    return this.income.list({
      gateway: (gateway || undefined) as PaymentGateway | undefined,
      onlyClubify: scope !== 'all',
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Roles('SUPER_ADMIN')
  @Get('ingresos/resumen')
  resumen(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('scope') scope?: string,
  ) {
    return this.income.summary({
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      onlyClubify: scope !== 'all',
    });
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
}
