import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/** Campos editables de la ficha de un negocio aliado. Compartido por el portal
 *  del negocio y por el Master Admin. `categoryId` solo lo aplica el admin. */
export class AllyProfileBody {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsArray() photos?: string[];
  @IsOptional() @IsString() @MaxLength(240) address?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() latitude?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() longitude?: number | null;
  @IsOptional() hours?: Record<string, any>;
  @IsOptional() @IsString() @MaxLength(30) whatsapp?: string;
  @IsOptional() @IsString() @MaxLength(120) instagram?: string;
  @IsOptional() @IsString() @MaxLength(200) website?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() categoryId?: string | null;
}

const BENEFIT_LIMIT_PERIODS = ['LIFETIME', 'DAY', 'WEEK', 'MONTH', 'YEAR'];
const BENEFIT_TYPES = ['PERCENT_OFF', 'AMOUNT_OFF', 'TWO_FOR_ONE', 'FREEBIE', 'PRODUCT', 'OTHER'];

/** Beneficio/promoción de un negocio aliado. Para crear, `title` es requerido
 *  (se valida en el servicio); en update todo es opcional. */
export class BenefitBody {
  @IsOptional() @IsIn(BENEFIT_TYPES) type?: any;
  @IsOptional() @IsString() @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsString() @MaxLength(2000) terms?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) percentOff?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) amountOffCents?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) normalPriceCents?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) memberPriceCents?: number | null;
  @IsOptional() @IsString() @MaxLength(8) currency?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() validFrom?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() validUntil?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) maxRedemptions?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) maxPerMember?: number | null;
  // Ventana sobre la que cuenta maxPerMember (spec §7). Omitirlo deja LIFETIME,
  // que es el comportamiento histórico. 'Ilimitado' = maxPerMember null.
  @IsOptional() @IsIn(BENEFIT_LIMIT_PERIODS) limitPeriod?: any;
  @IsOptional() @IsIn(['DRAFT', 'ACTIVE', 'PAUSED']) status?: 'DRAFT' | 'ACTIVE' | 'PAUSED';
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() categoryId?: string | null;
}


/**
 * Sede de un aliado (spec §5 y §9). Un aliado puede tener varias, cada una con
 * su geofence propio. `latitude`/`longitude` null = sede sin ubicación en el
 * mapa: sirve para la ficha, pero no puede disparar geopush.
 */
export class AllyLocationBody {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(120) city?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(-90) @Max(90) latitude?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(-180) @Max(180) longitude?: number | null;
  // Apple ignora radios muy chicos y los muy grandes disparan lejos del local.
  @IsOptional() @IsInt() @Min(50) @Max(5000) radiusMeters?: number;
  @IsOptional() @IsString() @MaxLength(200) geopushMessage?: string;
  @IsOptional() @IsBoolean() geopushActive?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
