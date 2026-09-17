import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { SoloPlataformaGuard } from './solo-plataforma.guard';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PayrollService, RunItemInput } from './payroll.service';
import { rangoDe } from './where-periodo';

class EmployeeBody {
  @IsString() name!: string;
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsString() payType?: string;
  @IsNumber() amountUsd!: number;
  @IsString() periodicity!: string;
  @IsOptional() @IsString() note?: string;
}
/** Todo opcional: sirve para activar/desactivar Y para editar la ficha. */
class EmployeePatchBody {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsString() payType?: string;
  @IsOptional() @IsNumber() @Min(0) amountUsd?: number;
  @IsOptional() @IsString() periodicity?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() note?: string;
}
class RunItemPatchBody {
  @IsOptional() @IsNumber() @Min(0) baseUsd?: number;
  @IsOptional() @IsNumber() @Min(0) bonusUsd?: number;
  @IsOptional() @IsNumber() @Min(0) deductionUsd?: number;
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
@UseGuards(SoloPlataformaGuard)
@Controller('admin/contabilidad/nomina')
export class PayrollController {
  constructor(private payroll: PayrollService) {}

  @Get('resumen')
  resumen(@Query('scope') scope?: string, @Query('period') period?: string) {
    return this.payroll.summary(scope !== 'all', rangoDe(period));
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
  editarEmpleado(@Param('id') id: string, @Body() body: EmployeePatchBody) {
    return this.payroll.updateEmployee(id, body);
  }

  @Delete('colaboradores/:id')
  eliminarEmpleado(@Param('id') id: string) {
    return this.payroll.deleteEmployee(id);
  }

  // ── Cortes ──
  @Get('cortes')
  cortes(@Query('scope') scope?: string, @Query('period') period?: string) {
    return this.payroll.listRuns(scope !== 'all', rangoDe(period));
  }

  @Get('cortes/:id')
  corteDetalle(@Param('id') id: string) {
    return this.payroll.runDetail(id);
  }

  @Post('cortes')
  generarCorte(@Body() body: RunBody, @CurrentUser() user: AuthUser) {
    return this.payroll.generateRun({ ...body, actorId: user?.id ?? null });
  }

  @Patch('cortes/:id/items/:itemId')
  editarItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: RunItemPatchBody,
  ) {
    return this.payroll.updateRunItem(id, itemId, body);
  }

  @Delete('cortes/:id/items/:itemId')
  quitarItem(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.payroll.deleteRunItem(id, itemId);
  }

  @Delete('cortes/:id')
  borrarCorte(@Param('id') id: string) {
    return this.payroll.deleteRun(id);
  }

  @Patch('cortes/:id/pago')
  pagarCorte(@Param('id') id: string, @Body() body: PayRunBody) {
    return this.payroll.registerRunPayment(id, body);
  }
}
