import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsArray, IsBoolean, IsEnum, IsHexColor, IsIn, IsInt, IsOptional, IsString, Min, ValidateIf } from 'class-validator';
import { CardType } from '@prisma/client';
import { CardsService } from './cards.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class CardBody {
  @IsEnum(CardType) type!: CardType;
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() terms?: string;
  @IsOptional() @IsBoolean() termsEnabled?: boolean;
  @IsOptional() @IsHexColor() primaryColor?: string;
  @IsOptional() @IsHexColor() secondaryColor?: string;
  // Colores avanzados — null = limpiar y volver a default.
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsHexColor() stampActiveColor?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsHexColor() stampInactiveColor?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsHexColor() stampContourColor?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsHexColor() centerBgColor?: string | null;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsString() heroImageUrl?: string;
  @IsOptional() @IsString() iconUrl?: string;
  @IsOptional() @IsInt() @Min(1) stampsRequired?: number;
  @IsOptional() @IsString() rewardText?: string;
  @IsOptional() pointsPerCurrency?: number;
  @IsOptional() @IsInt() discountPercent?: number;
  // CASHBACK: % devuelto en saldo + compra mínima opcional
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() cashbackPercent?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) cashbackMinPurchase?: number | null;
  // Monto mínimo por sello (STAMPS/VISITS/HYBRID). null = sin restricción.
  @IsOptional() @ValidateIf((_, v) => v !== null) minAmountPerStamp?: number | null;
  // VISITS: cuántas visitas para canjear el premio
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) visitsRequired?: number | null;
  // MEMBERSHIP con tiers VIP. tiers: [{name, threshold, perks?, color?, icon?}]
  @IsOptional() @IsArray() tiers?: Array<{
    name: string;
    threshold: number;
    perks?: string[];
    color?: string;
    icon?: string;
  }>;
  @IsOptional() @IsIn(['spend', 'visits', 'stamps']) tierMetric?: 'spend' | 'visits' | 'stamps';
  // null permite borrar la fecha y volver a "Ilimitado".
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() validFrom?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() validUntil?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) validDaysAfterIssue?: number | null;
  // Ubicación / sede asociada (multi-sede). null = limpiar.
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() locationId?: string | null;
  // Información (paso 4 del wizard) — todos opcionales.
  @IsOptional() @IsString() howToEarnText?: string;
  @IsOptional() @IsString() businessName?: string;
  @IsOptional() @IsString() rewardDescText?: string;
  @IsOptional() @IsString() stampEarnedMessage?: string;
  @IsOptional() @IsString() rewardEarnedMessage?: string;
  // multiRewards: [{at:5, reward:"5% off"}, {at:10, reward:"10% off"}]
  // activeLinks: [{type:"URL"|"PHONE"|"EMAIL"|"ADDRESS", url, label}]
  @IsOptional() multiRewards?: Array<{ at: number; reward: string }>;
  @IsOptional() activeLinks?: Array<{ type: string; url: string; label: string }>;
  @IsOptional() socialLinks?: Record<string, string>;
  @IsOptional() @IsString() stampIcon?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller('cards')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
export class CardsController {
  constructor(private svc: CardsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.list(user, tenantId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.get(user, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: CardBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.create(user, body, tenantId);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: Partial<CardBody>,
  ) {
    return this.svc.update(user, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.remove(user, id);
  }
}
