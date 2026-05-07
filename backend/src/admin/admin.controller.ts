import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  IsBoolean,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';
import { SuppliersService } from './suppliers.service';
import { PurchaseOrdersService } from './purchase-orders.service';

class SupplierBody {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsString() @MinLength(5) @MaxLength(30) phone!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
class SupplierUpdate {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class FrequentProductBody {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsNumber() @Min(0) defaultQty!: number;
  @IsString() @MaxLength(20) defaultUnit!: string;
  @IsOptional() @IsString() @MaxLength(20) dispatchDay?: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class OrderItemBody {
  @IsString() @MinLength(1) @MaxLength(120) productName!: string;
  @IsNumber() @Min(0) qty!: number;
  @IsString() @MaxLength(20) unit!: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() @MaxLength(20) dispatchDay?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class CreateOrderBody {
  @ValidateNested({ each: true })
  @Type(() => OrderItemBody)
  items!: OrderItemBody[];
}

class TemplateBody {
  @IsString() @MaxLength(2000) template!: string;
}

@Controller('admin')
@Roles('TENANT_OWNER', 'TENANT_STAFF')
export class AdminController {
  constructor(
    private suppliers: SuppliersService,
    private purchase: PurchaseOrdersService,
  ) {}

  // ─────────── Suppliers ───────────
  @Get('suppliers')
  listSuppliers(@CurrentUser() u: AuthUser) {
    if (!u.tenantId) throw new ForbiddenException();
    return this.suppliers.list(u.tenantId);
  }

  @Post('suppliers')
  @Roles('TENANT_OWNER')
  createSupplier(@CurrentUser() u: AuthUser, @Body() body: SupplierBody) {
    if (!u.tenantId) throw new ForbiddenException();
    return this.suppliers.create(u.tenantId, body);
  }

  @Patch('suppliers/:id')
  @Roles('TENANT_OWNER')
  updateSupplier(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() body: SupplierUpdate,
  ) {
    if (!u.tenantId) throw new ForbiddenException();
    return this.suppliers.update(u.tenantId, id, body);
  }

  @Delete('suppliers/:id')
  @Roles('TENANT_OWNER')
  removeSupplier(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    if (!u.tenantId) throw new ForbiddenException();
    return this.suppliers.remove(u.tenantId, id);
  }

  // ─────────── Frequent products ───────────
  @Get('frequent-products')
  listFrequentProducts(@CurrentUser() u: AuthUser) {
    if (!u.tenantId) throw new ForbiddenException();
    return this.purchase.listFrequentProducts(u.tenantId);
  }

  @Post('frequent-products')
  @Roles('TENANT_OWNER')
  createFrequentProduct(
    @CurrentUser() u: AuthUser,
    @Body() body: FrequentProductBody,
  ) {
    if (!u.tenantId) throw new ForbiddenException();
    return this.purchase.createFrequentProduct(u.tenantId, body);
  }

  @Patch('frequent-products/:id')
  @Roles('TENANT_OWNER')
  updateFrequentProduct(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() body: Partial<FrequentProductBody>,
  ) {
    if (!u.tenantId) throw new ForbiddenException();
    return this.purchase.updateFrequentProduct(u.tenantId, id, body);
  }

  @Delete('frequent-products/:id')
  @Roles('TENANT_OWNER')
  removeFrequentProduct(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    if (!u.tenantId) throw new ForbiddenException();
    return this.purchase.removeFrequentProduct(u.tenantId, id);
  }

  // ─────────── Purchase orders ───────────
  @Get('purchase-orders')
  listOrders(@CurrentUser() u: AuthUser) {
    if (!u.tenantId) throw new ForbiddenException();
    return this.purchase.listOrders(u.tenantId);
  }

  @Post('purchase-orders')
  @Roles('TENANT_OWNER')
  createOrder(@CurrentUser() u: AuthUser, @Body() body: CreateOrderBody) {
    if (!u.tenantId) throw new ForbiddenException();
    return this.purchase.createOrder(u.tenantId, u.id, body.items);
  }

  @Get('stats')
  stats(@CurrentUser() u: AuthUser) {
    if (!u.tenantId) throw new ForbiddenException();
    return this.purchase.stats(u.tenantId);
  }

  // ─────────── Template del mensaje a proveedor ───────────
  @Get('supplier-template')
  getTemplate() {
    return this.purchase.getTemplate();
  }

  @Patch('supplier-template')
  @Roles('TENANT_OWNER')
  setTemplate(@Body() body: TemplateBody) {
    return this.purchase.setTemplate(body.template);
  }
}
