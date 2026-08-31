import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ExpenseService } from './expense.service';

class CreateExpenseBody {
  @IsString() concept!: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() supplier?: string;
  @IsOptional() @IsNumber() amountUsd?: number;
  @IsOptional() @IsNumber() pctRate?: number;
  @IsOptional() @IsNumber() pctBase?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() method?: string;
  @IsOptional() @IsString() account?: string;
  @IsOptional() @IsString() status?: 'PENDING' | 'REVIEW' | 'PARTIAL' | 'PAID';
  @IsOptional() @IsString() receiptUrl?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() expenseDate?: string;
}
class PayExpenseBody {
  @IsNumber() amountPaidUsd!: number;
  @IsOptional() @IsString() method?: string;
  @IsOptional() @IsString() account?: string;
  @IsOptional() @IsString() receiptUrl?: string;
}
class StatusBody {
  @IsString() status!: 'PENDING' | 'REVIEW' | 'PARTIAL' | 'PAID';
}
class CategoryBody {
  @IsString() name!: string;
  @IsOptional() @IsString() color?: string;
}
class CategoryActiveBody {
  @IsBoolean() active!: boolean;
}
class RecurringBody {
  @IsString() concept!: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() supplier?: string;
  @IsNumber() amountUsd!: number;
  @IsString() periodicity!: string;
  @IsOptional() @IsString() method?: string;
  @IsOptional() @IsString() account?: string;
  @IsOptional() @IsString() note?: string;
}

/**
 * CONTABILIDAD — Fase 2. Egresos + categorías + gastos recurrentes.
 * Solo Clubify por defecto (whiteLabelId null); `scope=all` incluye marcas.
 */
@Roles('SUPER_ADMIN')
@Controller('admin/contabilidad')
export class ExpensesController {
  constructor(private expenses: ExpenseService) {}

  // ── Egresos ──
  @Get('egresos')
  list(@Query('scope') scope?: string, @Query('categoryId') categoryId?: string, @Query('status') status?: string) {
    return this.expenses.list({ onlyClubify: scope !== 'all', categoryId, status });
  }

  @Get('egresos/resumen')
  resumen(@Query('scope') scope?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.expenses.summary({
      onlyClubify: scope !== 'all',
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }

  @Post('egresos')
  create(@Body() body: CreateExpenseBody, @CurrentUser() user: AuthUser) {
    return this.expenses.create({ ...body, actorId: user?.id ?? null });
  }

  @Patch('egresos/:id/pago')
  pay(@Param('id') id: string, @Body() body: PayExpenseBody) {
    return this.expenses.registerPayment(id, body);
  }

  @Patch('egresos/:id/estado')
  estado(@Param('id') id: string, @Body() body: StatusBody) {
    return this.expenses.setStatus(id, body.status);
  }

  // ── Categorías ──
  @Get('categorias')
  categorias() {
    return this.expenses.listCategories();
  }

  @Post('categorias')
  crearCategoria(@Body() body: CategoryBody) {
    return this.expenses.createCategory(body.name, body.color ?? null);
  }

  @Patch('categorias/:id')
  categoriaActiva(@Param('id') id: string, @Body() body: CategoryActiveBody) {
    return this.expenses.setCategoryActive(id, body.active);
  }

  // ── Gastos recurrentes ──
  @Get('gastos-recurrentes')
  recurrentes(@Query('scope') scope?: string) {
    return this.expenses.listRecurring({ onlyClubify: scope !== 'all' });
  }

  @Post('gastos-recurrentes')
  crearRecurrente(@Body() body: RecurringBody) {
    return this.expenses.createRecurring(body);
  }

  @Patch('gastos-recurrentes/:id')
  recurrenteActivo(@Param('id') id: string, @Body() body: CategoryActiveBody) {
    return this.expenses.setRecurringActive(id, body.active);
  }
}
