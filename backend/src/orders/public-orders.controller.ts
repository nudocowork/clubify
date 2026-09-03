import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Fulfillment } from '@prisma/client';
import { OrdersService } from './orders.service';
import { Public } from '../common/decorators/public.decorator';

class PublicCustomer {
  @IsString() fullName!: string;
  @IsString() phone!: string;
  @IsOptional() @IsEmail() email?: string;
}

class PublicOrderItem {
  @IsString() productId!: string;
  @IsOptional() @IsString() variantId?: string;
  @IsOptional() @IsArray() extraIds?: string[];
  @IsInt() @Min(1) qty!: number;
  @IsOptional() @IsString() note?: string;
}

class PublicOrderBody {
  @IsString() tenantSlug!: string;
  @ValidateNested() @Type(() => PublicCustomer) customer!: PublicCustomer;
  @IsArray() @ValidateNested({ each: true }) @Type(() => PublicOrderItem) items!: PublicOrderItem[];
  @IsEnum(Fulfillment) fulfillment!: Fulfillment;
  @IsOptional() @IsString() tableNumber?: string;
  @IsOptional() @IsObject() deliveryAddress?: any;
  @IsOptional() @IsString() customerNote?: string;
  @IsOptional() @IsString() locationId?: string;
  // Menú público de origen: 'MESA' o 'DELIVERY'. Redundante con
  // `fulfillment`/`deliveryAddress` pero el frontend lo manda explícito
  // según la ruta (`/m/<slug>` vs `/m/<slug>/delivery`) y lo guardamos
  // para reportes y para futuras reglas de negocio per-canal.
  @IsOptional() @IsIn(['MESA', 'DELIVERY']) mode?: 'MESA' | 'DELIVERY';
  // Método de pago declarado por el cliente (informativo). PDF 2026-07-25.
  @IsOptional()
  @IsIn(['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'OTRO'])
  customerPaymentMethod?: string;
  @IsOptional() @IsString() @MaxLength(80) customerPaymentOther?: string;
}

class PublicRateBody {
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() @MaxLength(500) comment?: string;
}

@Controller('public/orders')
export class PublicOrdersController {
  constructor(private svc: OrdersService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post()
  create(@Body() body: PublicOrderBody) {
    return this.svc.createPublic(body);
  }

  @Public()
  @Get(':code')
  get(@Param('code') code: string) {
    return this.svc.getPublicByCode(code.toUpperCase());
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post(':code/rate')
  rate(@Param('code') code: string, @Body() body: PublicRateBody) {
    return this.svc.ratePublic(code.toUpperCase(), body.rating, body.comment);
  }
}
