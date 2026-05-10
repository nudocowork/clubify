import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { CouponDuration, CouponStatus } from '@prisma/client';
import { CouponsService } from './coupons.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';

class CouponBody {
  @IsString() code!: string;
  @IsNumber() @Min(0.1) @Max(100) discountPercent!: number;
  @IsOptional() @IsISO8601() validFrom?: string | null;
  @IsOptional() @IsISO8601() validUntil?: string | null;
  @IsOptional() @IsInt() @Min(1) maxUses?: number | null;
  @IsOptional() @IsString() applicablePlans?: string;
  @IsOptional() @IsEnum(CouponDuration) duration?: CouponDuration;
  @IsOptional() @IsEnum(CouponStatus) status?: CouponStatus;
  @IsOptional() @IsString() referralCodeId?: string | null;
  @IsOptional() @IsString() campaignId?: string | null;
}

@Controller('coupons')
@Roles('SUPER_ADMIN')
export class CouponsController {
  constructor(private svc: CouponsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.svc.list(user);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CouponBody) {
    return this.svc.create(user, body as any);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: Partial<CouponBody>,
  ) {
    return this.svc.update(user, id, body as any);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.remove(user, id);
  }
}

/**
 * Endpoint público — el front del signup lo llama mientras el cliente
 * tipea el código. Devuelve siempre 200 (no 404 si no existe), con `type`
 * indicando qué hacer.
 */
@Controller('public/promo')
export class PublicPromoController {
  constructor(private svc: CouponsService) {}

  @Public()
  @Get('validate')
  validate(@Query('code') code: string, @Query('plan') plan?: string) {
    return this.svc.resolvePublic({ code, planName: plan });
  }
}
