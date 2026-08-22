import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';
import { ProductsService } from './products.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class ProductBody {
  // 2026-06-12: nullable para permitir productos sin categoría
  // (Bloque 2 spec). ValidateIf deja pasar null explícito sin pedirle
  // UUID. Cuando es null el producto se renderiza en una sección
  // "Sin categoría" en los storefront layouts.
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsNumber() basePrice!: number;
  @IsOptional() @IsIn(['FIXED', 'RANGE']) priceMode?: 'FIXED' | 'RANGE';
  // priceMax solo válido cuando priceMode='RANGE'. Aceptamos null
  // explícito para limpiar (volver al modo FIXED).
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsNumber() priceMax?: number | null;
  // PDF 346 #1: cómo se interpreta el precio de las variantes/tamaños.
  // Faltaba aquí → el ValidationPipe (forbidNonWhitelisted) rechazaba el
  // create/update con "property variantPriceMode should not exist".
  @IsOptional() @IsIn(['DELTA', 'ABSOLUTE']) variantPriceMode?: 'DELTA' | 'ABSOLUTE';
  // Cuantas variantes puede marcar el cliente. null o 1 = se elige una sola
  // (radio, comportamiento historico). >= 2 = casillas multiples.
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsInt()
  @Min(1)
  maxVariantsTotal?: number | null;
  // Tope de extras que el cliente puede elegir EN TOTAL. null = sin tope.
  // Se acepta null explicito para poder quitarlo desde el panel.
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsInt()
  @Min(1)
  maxExtrasTotal?: number | null;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsArray() tags?: string[];
  @IsOptional() @IsBoolean() isAvailable?: boolean;
  @IsOptional() @IsBoolean() availableForMesa?: boolean;
  @IsOptional() @IsBoolean() availableForDelivery?: boolean;
  @IsOptional() @IsBoolean() isRecommended?: boolean;
  @IsOptional() @IsNumber() position?: number;
  @IsOptional() @IsArray() variants?: any[];
  @IsOptional() @IsArray() extras?: any[];
  @IsOptional() stock?: number | null;
  @IsOptional() stockAlert?: number | null;
}

@Controller('catalog/products')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'TENANT_ORDERS', 'SUPER_ADMIN')
export class ProductsController {
  constructor(private svc: ProductsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') tenantId?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.svc.list(user, tenantId, categoryId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.get(user, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: ProductBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.create(user, body, tenantId);
  }

  @Patch('reorder')
  reorder(@CurrentUser() user: AuthUser, @Body() body: { ids: string[] }) {
    return this.svc.reorder(user, body.ids);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: Partial<ProductBody>,
  ) {
    return this.svc.update(user, id, body);
  }

  @Patch(':id/availability')
  toggle(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { isAvailable: boolean },
  ) {
    return this.svc.setAvailable(user, id, body.isAvailable);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.remove(user, id);
  }
}
