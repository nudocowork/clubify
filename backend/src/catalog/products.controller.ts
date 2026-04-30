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
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';
import { ProductsService } from './products.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class ProductBody {
  @IsUUID() categoryId!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsNumber() basePrice!: number;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsArray() tags?: string[];
  @IsOptional() @IsBoolean() isAvailable?: boolean;
  @IsOptional() @IsNumber() position?: number;
  @IsOptional() @IsArray() variants?: any[];
  @IsOptional() @IsArray() extras?: any[];
}

@Controller('catalog/products')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
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
