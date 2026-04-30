import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Query,
  Res,
} from '@nestjs/common';
import { IsEnum } from 'class-validator';
import { OrderStatus } from '@prisma/client';
import { Response } from 'express';
import { OrdersService } from './orders.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { toCSV } from '../common/csv';

class StatusBody {
  @IsEnum(OrderStatus) status!: OrderStatus;
}

@Controller('orders')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
export class OrdersController {
  constructor(private svc: OrdersService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') tenantId?: string,
    @Query('status') status?: OrderStatus,
  ) {
    return this.svc.list(user, tenantId, status);
  }

  @Get('board')
  board(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.board(user, tenantId);
  }

  @Get('export.csv')
  async export(
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Query('tenantId') tenantId?: string,
    @Query('status') status?: OrderStatus,
  ) {
    const orders = await this.svc.list(user, tenantId, status);
    const csv = toCSV(orders as any[], [
      { key: 'code', label: 'Código' },
      { key: 'createdAt', label: 'Fecha', format: (v) => new Date(v).toISOString() },
      { key: 'status', label: 'Estado' },
      { key: 'fulfillment', label: 'Tipo' },
      { key: 'tableNumber', label: 'Mesa' },
      {
        key: 'customer',
        label: 'Cliente',
        format: (c: any) => c?.fullName ?? '',
      },
      { key: 'customer', label: 'Teléfono', format: (c: any) => c?.phone ?? '' },
      { key: 'customer', label: 'Email', format: (c: any) => c?.email ?? '' },
      { key: 'subtotal', label: 'Subtotal', format: (v) => Number(v).toFixed(0) },
      { key: 'discount', label: 'Descuento', format: (v) => Number(v).toFixed(0) },
      { key: 'total', label: 'Total', format: (v) => Number(v).toFixed(0) },
      { key: 'paymentStatus', label: 'Pago' },
      { key: 'paymentMethod', label: 'Método pago' },
      { key: 'paidAt', label: 'Pagado en', format: (v) => (v ? new Date(v).toISOString() : '') },
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="pedidos-${stamp}.csv"`,
    );
    res.send(csv);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.get(user, id);
  }

  @Patch(':id/status')
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: StatusBody,
  ) {
    return this.svc.setStatus(user, id, body.status);
  }
}
