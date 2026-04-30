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
  IsInt,
  IsObject,
  IsOptional,
  IsString,
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
}
