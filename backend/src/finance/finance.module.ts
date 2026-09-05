import { Module } from '@nestjs/common';
import { AdminReportsModule } from '../admin-reports/admin-reports.module';
import { IncomeRecordService } from './income-record.service';
import { FinanceController } from './finance.controller';
import { ExpenseService } from './expense.service';
import { ExpensesController } from './expenses.controller';
import { PayrollService } from './payroll.service';
import { PayrollController } from './payroll.controller';
import { MovementsService } from './movements.service';
import { MovementsController } from './movements.controller';
import { FinanceReportService } from './finance-report.service';

/**
 * CONTABILIDAD — Fase 1. Módulo de finanzas: captura del ingreso REAL por
 * transacción (IncomeRecordService, llamado por los webhooks) + endpoints de
 * Ingresos/Conciliación. PrismaModule es global; los guards de auth/roles son
 * globales (APP_GUARD). Exporta IncomeRecordService para que BillingModule lo
 * inyecte en los webhooks. Aditivo — no toca comisiones.
 */
@Module({
  // Contabilidad LEE el módulo de cobros en vez de recalcular las renovaciones:
  // `CobrosService` ya clasifica con la misma regla que suspende negocios, y dos
  // implementaciones de "qué se cobra pronto" acabarían discrepando.
  imports: [AdminReportsModule],
  providers: [IncomeRecordService, ExpenseService, PayrollService, MovementsService, FinanceReportService],
  controllers: [FinanceController, ExpensesController, PayrollController, MovementsController],
  exports: [IncomeRecordService, ExpenseService, PayrollService],
})
export class FinanceModule {}
