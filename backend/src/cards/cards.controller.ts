import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsArray, IsBoolean, IsEnum, IsHexColor, IsIn, IsInt, IsOptional, IsString, Min, ValidateIf } from 'class-validator';
import { CardType } from '@prisma/client';
import { CardsService } from './cards.service';
import { WalletService } from '../wallet/wallet.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

/** Formas admitidas del logo. null = ROUNDED, el de siempre. */
const LOGO_SHAPES = ['SQUARE', 'ROUNDED', 'CIRCLE', 'RECTANGLE'];

class CardBody {
  @IsEnum(CardType) type!: CardType;
  @IsString() name!: string;
  // #24 (2026-06-16): nombre de marca por tarjeta para el pase wallet. null/''
  // → usa el Tenant.brandName.
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() walletBrandName?: string | null;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() terms?: string;
  @IsOptional() @IsBoolean() termsEnabled?: boolean;
  // PDF Software(8): muestra la casilla de políticas de datos en el registro.
  @IsOptional() @IsBoolean() dataPolicyEnabled?: boolean;
  @IsOptional() @IsHexColor() primaryColor?: string;
  @IsOptional() @IsHexColor() secondaryColor?: string;
  // Colores avanzados — null = limpiar y volver a default.
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsHexColor() stampActiveColor?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsHexColor() stampInactiveColor?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsHexColor() stampContourColor?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsHexColor() centerBgColor?: string | null;
  // Chip/fondo detrás del logo (header del pase + preview). null = sin chip.
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsHexColor() logoBgColor?: string | null;
  /** SQUARE | ROUNDED | CIRCLE | RECTANGLE. null = ROUNDED (el de siempre). */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(LOGO_SHAPES) logoShape?: string | null;
  // Wallet V3 — fondo del área de sellos. GRADIENT (legacy) | SOLID (uniforme) | IMAGE.
  @IsOptional() @IsIn(['GRADIENT', 'SOLID', 'IMAGE']) stampBgType?: 'GRADIENT' | 'SOLID' | 'IMAGE';
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() stampBgImageUrl?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() stampIconImageUrl?: string | null;
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
  // Wallet V3 — Premios Free: premios intermedios ilimitados dibujados dentro
  // del círculo en su posición. El backend normaliza/sanea la forma en el service.
  @IsOptional() @IsArray() freeRewards?: Array<{
    id?: string;
    pos: number;
    text?: string;
    emoji?: string;
    circleColor?: string;
    textColor?: string;
    active?: boolean;
  }>;
  @IsOptional() activeLinks?: Array<{ type: string; url: string; label: string }>;
  @IsOptional() socialLinks?: Record<string, string>;
  @IsOptional() @IsString() stampIcon?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  // Cupón → stamps card target al redeem. null = auto. Solo aplica
  // cuando type=COUPON/DISCOUNT/GIFT (el backend no enforza el matching
  // de tipo aquí — el frontend solo muestra el selector para esos
  // tipos).
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString()
  transformIntoCardId?: string | null;
  // false = el cupón se canjea y ahí termina, sin convertirse en nada.
  // `transformIntoCardId: null` no servía para expresarlo: null ya significa
  // "auto, la primera tarjeta de sellos activa".
  @IsOptional() @IsBoolean() transformOnRedeem?: boolean;
}

// Preview REAL del strip de sellos (imagen PNG generada por Sharp, la misma que
// recibe el cliente en su Wallet) para config aún NO guardada. Todos los campos
// son opcionales — el generador aplica defaults. Debe declarar cada campo por el
// ValidationPipe (whitelist + forbidNonWhitelisted): un campo no listado que
// llegue en el body haría fallar la request.
class PreviewStripsBody {
  @IsOptional() @IsString() primaryColor?: string;
  @IsOptional() @IsString() secondaryColor?: string;
  @IsOptional() @IsInt() @Min(1) stampsRequired?: number;
  @IsOptional() @IsString() stampIcon?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() stampIconImageUrl?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() stampActiveColor?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() stampInactiveColor?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() stampContourColor?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() centerBgColor?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() logoBgColor?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(LOGO_SHAPES) logoShape?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() heroImageUrl?: string | null;
  @IsOptional() @IsIn(['GRADIENT', 'SOLID', 'IMAGE']) stampBgType?: 'GRADIENT' | 'SOLID' | 'IMAGE';
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() stampBgImageUrl?: string | null;
  @IsOptional() @IsArray() freeRewards?: Array<{
    pos: number;
    text?: string;
    emoji?: string;
    circleColor?: string;
    textColor?: string;
    active?: boolean;
  }>;
}

@Controller('cards')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
export class CardsController {
  constructor(
    private svc: CardsService,
    private wallet: WalletService,
  ) {}

  // Preview REAL del cartón de sellos (imagen PNG del generador de producción)
  // en 3 estados: vacío / mitad / completo. Devuelve data URLs base64 para
  // pintarlas con <img> sin problemas de auth. La ruta '/preview-strips' es un
  // POST distinto del '@Post()' de creación → no colisiona.
  @Post('preview-strips')
  previewStrips(@Body() body: PreviewStripsBody) {
    return this.wallet.previewStampStrips(body);
  }

  /**
   * Las tarjetas del negocio.
   *
   * `especiales=1` incluye las plantillas de Alianzas y Club, que por defecto
   * NO salen: son la fontanería de esos módulos y en las demás pantallas del
   * panel (tienda, pop-ups del menú, QR de mostrador, segmentador de push)
   * solo eran ruido y un peligro. Lo pide la pantalla de Tarjetas cuando el
   * dueño filtra por ellas a propósito.
   */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') tenantId?: string,
    @Query('especiales') especiales?: string,
  ) {
    return this.svc.list(user, tenantId, especiales === '1');
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
