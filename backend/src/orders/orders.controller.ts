import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Fulfillment, OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { Response } from 'express';
import { OrdersService } from './orders.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { toCSV } from '../common/csv';

class StatusBody {
  @IsEnum(OrderStatus) status!: OrderStatus;
}

class EditOrderItem {
  @IsString() productId!: string;
  @IsOptional() @IsString() variantId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) extraIds?: string[];
  @IsInt() @Min(1) qty!: number;
  @IsOptional() @IsString() note?: string;
}

class EditOrderBody {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => EditOrderItem)
  items!: EditOrderItem[];
}

class PatchOrderPaymentBody {
  // null = limpiar. @IsOptional deja pasar null/undefined sin validar el enum.
  @IsOptional()
  @IsIn(['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'OTRO'])
  customerPaymentMethod?: string | null;
  @IsOptional() @IsString() @MaxLength(80) customerPaymentOther?: string | null;
}

class ManualOrderItem {
  @IsString() productId!: string;
  @IsOptional() @IsString() variantId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) extraIds?: string[];
  @IsInt() @Min(1) qty!: number;
  @IsOptional() @IsString() note?: string;
}

class ManualOrderBody {
  @IsString() customerId!: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ManualOrderItem)
  items!: ManualOrderItem[];
  @IsOptional() @IsEnum(Fulfillment) fulfillment?: Fulfillment;
  @IsOptional() @IsString() tableNumber?: string;
  @IsOptional() @IsString() customerNote?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus;
  // Fix 2026-06-10: antes paymentStatus/paymentMethod eran IsString libre
  // y un valor inválido (ej. 'CASH' que no está en el enum Prisma) caía
  // a Prisma → 500. Ahora validamos contra el enum real → 400 claro.
  @IsOptional() @IsEnum(PaymentStatus) paymentStatus?: PaymentStatus;
  @IsOptional() @IsEnum(PaymentMethod) paymentMethod?: PaymentMethod;
  @IsOptional() @IsNumber() @Min(0) deliveryAmount?: number | null;
}

@Controller('orders')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'TENANT_ORDERS', 'SUPER_ADMIN')
export class OrdersController {
  constructor(private svc: OrdersService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') tenantId?: string,
    @Query('status') status?: OrderStatus,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.svc.list(user, tenantId, { status, search, from, to, locationId });
  }

  @Get('board')
  board(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') tenantId?: string,
    @Query('days') days?: string,
    @Query('locationId') locationId?: string,
  ) {
    return this.svc.board(user, tenantId, days ? Number(days) : 1, locationId);
  }

  @Get('export.csv')
  async export(
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Query('tenantId') tenantId?: string,
    @Query('status') status?: OrderStatus,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('locationId') locationId?: string,
  ) {
    const orders = await this.svc.list(user, tenantId, { status, search, from, to, locationId });
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

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: ManualOrderBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.createInternal(user, tenantId, body);
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

  /** El negocio registra/edita el método de pago que usó el cliente. */
  @Patch(':id/payment')
  setPayment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: PatchOrderPaymentBody,
  ) {
    return this.svc.updateCustomerPayment(user, id, body);
  }

  /** Editar los items de un pedido ya hecho (recalcula totales). */
  @Patch(':id')
  edit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: EditOrderBody,
  ) {
    return this.svc.updateOrder(user, id, body);
  }

  @Post(':id/accept-delivery-payment')
  acceptDeliveryPayment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.svc.acceptDeliveryPayment(user, id);
  }
}
