import { Module } from '@nestjs/common';
import { IncomeRecordService } from './income-record.service';
import { FinanceController } from './finance.controller';
import { ExpenseService } from './expense.service';
import { ExpensesController } from './expenses.controller';

/**
 * CONTABILIDAD — Fase 1. Módulo de finanzas: captura del ingreso REAL por
 * transacción (IncomeRecordService, llamado por los webhooks) + endpoints de
 * Ingresos/Conciliación. PrismaModule es global; los guards de auth/roles son
 * globales (APP_GUARD). Exporta IncomeRecordService para que BillingModule lo
 * inyecte en los webhooks. Aditivo — no toca comisiones.
 */
@Module({
  providers: [IncomeRecordService, ExpenseService],
  controllers: [FinanceController, ExpensesController],
  exports: [IncomeRecordService, ExpenseService],
})
export class FinanceModule {}
