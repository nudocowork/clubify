import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ArrayMinSize, ArrayUnique, IsArray, IsEmail, IsOptional, IsString } from 'class-validator';
import { Response } from 'express';
import { CustomersService } from './customers.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { toCSV } from '../common/csv';

class CustomerBody {
  @IsString() fullName!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() birthday?: string;
  @IsOptional() @IsString() externalId?: string;
  @IsOptional() @IsArray() tags?: string[];
  @IsOptional() @IsString() notes?: string;
}

class MergeBody {
  @IsString() keepId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsString({ each: true })
  mergeIds!: string[];
}

@Controller('customers')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
export class CustomersController {
  constructor(private svc: CustomersService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('search') search?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.list(user, search, tenantId);
  }

  @Get('duplicates')
  duplicates(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.findDuplicates(user, tenantId);
  }

  @Post('merge')
  merge(@CurrentUser() user: AuthUser, @Body() body: MergeBody) {
    return this.svc.merge(user, body.keepId, body.mergeIds);
  }

  @Get('export.csv')
  async export(
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Query('search') search?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    const list = await this.svc.list(user, search, tenantId);
    const csv = toCSV(list as any[], [
      { key: 'fullName', label: 'Nombre' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Teléfono' },
      {
        key: 'birthday',
        label: 'Cumpleaños',
        format: (v) => (v ? new Date(v).toISOString().slice(0, 10) : ''),
      },
      { key: 'totalOrdersCount', label: 'Pedidos' },
      {
        key: 'totalOrdersAmount',
        label: 'Facturado',
        format: (v) => Number(v).toFixed(0),
      },
      {
        key: 'firstOrderAt',
        label: 'Primer pedido',
        format: (v) => (v ? new Date(v).toISOString() : ''),
      },
      {
        key: 'lastOrderAt',
        label: 'Último pedido',
        format: (v) => (v ? new Date(v).toISOString() : ''),
      },
      { key: 'tags', label: 'Tags', format: (v) => (v ?? []).join('|') },
      { key: 'marketingOptIn', label: 'Marketing OK' },
      {
        key: '_count',
        label: 'Pases',
        format: (c: any) => c?.passes ?? 0,
      },
      {
        key: 'createdAt',
        label: 'Cliente desde',
        format: (v) => new Date(v).toISOString(),
      },
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="clientes-${stamp}.csv"`,
    );
    res.send(csv);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.get(user, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: CustomerBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.create(user, body, tenantId);
  }

  @Post('import')
  bulkImport(
    @CurrentUser() user: AuthUser,
    @Body() body: { rows: any[] },
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.bulkImport(user, body.rows ?? [], tenantId);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: Partial<CustomerBody>) {
    return this.svc.update(user, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.remove(user, id);
  }
}
