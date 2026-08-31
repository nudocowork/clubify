import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PayrollService, RunItemInput } from './payroll.service';

class EmployeeBody {
  @IsString() name!: string;
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsString() payType?: string;
  @IsNumber() amountUsd!: number;
  @IsString() periodicity!: string;
  @IsOptional() @IsString() note?: string;
}
class EmployeeActiveBody {
  @IsBoolean() active!: boolean;
}
class RunBody {
  @IsString() periodLabel!: string;
  @IsOptional() @IsString() periodStart?: string;
  @IsOptional() @IsString() periodEnd?: string;
  @IsArray() items!: RunItemInput[];
}
class PayRunBody {
  @IsNumber() amountPaidUsd!: number;
  @IsOptional() @IsString() method?: string;
  @IsOptional() @IsString() account?: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() receiptUrl?: string;
}

/** CONTABILIDAD — Fase 3. Nómina: colaboradores + cortes + pagos parciales. */
@Roles('SUPER_ADMIN')
@Controller('admin/contabilidad/nomina')
export class PayrollController {
  constructor(private payroll: PayrollService) {}

  @Get('resumen')
  resumen(@Query('scope') scope?: string) {
    return this.payroll.summary(scope !== 'all');
  }

  // ── Colaboradores ──
  @Get('colaboradores')
  empleados(@Query('scope') scope?: string) {
    return this.payroll.listEmployees(scope !== 'all');
  }

  @Post('colaboradores')
  crearEmpleado(@Body() body: EmployeeBody) {
    return this.payroll.createEmployee(body);
  }

  @Patch('colaboradores/:id')
  empleadoActivo(@Param('id') id: string, @Body() body: EmployeeActiveBody) {
    return this.payroll.setEmployeeActive(id, body.active);
  }

  // ── Cortes ──
  @Get('cortes')
  cortes(@Query('scope') scope?: string) {
    return this.payroll.listRuns(scope !== 'all');
  }

  @Get('cortes/:id')
  corteDetalle(@Param('id') id: string) {
    return this.payroll.runDetail(id);
  }

  @Post('cortes')
  generarCorte(@Body() body: RunBody, @CurrentUser() user: AuthUser) {
    return this.payroll.generateRun({ ...body, actorId: user?.id ?? null });
  }

  @Patch('cortes/:id/pago')
  pagarCorte(@Param('id') id: string, @Body() body: PayRunBody) {
    return this.payroll.registerRunPayment(id, body);
  }
}
