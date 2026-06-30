import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { DeliveryService } from './delivery.service';

class DeliveryCompanyBody {
  @IsOptional() @IsString() @MaxLength(64) whiteLabelId?: string | null;
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(500) logoUrl?: string;
  @IsOptional() @IsString() @MaxLength(40) whatsapp?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(120) responsible?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100000)
  commissionPerDelivery?: number | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) brandIds?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) tenantIds?: string[];
}

class CompanyAdminBody {
  @IsEmail() email!: string;
  @IsString() @MaxLength(120) fullName!: string;
  @IsString() @Length(8, 200) password!: string;
}

class AdminPasswordBody {
  @IsString() @Length(8, 200) password!: string;
}

class AdminToggleBody {
  @IsBoolean() isActive!: boolean;
}

/**
 * Master Admin — Empresas de Domicilios (Fase 1, Red de Domicilios).
 * Solo PLATFORM_OWNER. Ruta bajo /superadmin para alinearse con el resto del
 * panel Master Admin.
 */
@Controller('superadmin/delivery-companies')
@Roles('PLATFORM_OWNER')
export class DeliveryAdminController {
  constructor(private svc: DeliveryService) {}

  /** Marcas + negocios disponibles para poblar los selectores del form. */
  @Get('assignable')
  assignable() {
    return this.svc.assignableData();
  }

  @Get()
  list() {
    return this.svc.listCompanies();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.getCompany(id);
  }

  @Post()
  create(@Body() body: DeliveryCompanyBody, @CurrentUser() user: AuthUser) {
    return this.svc.createCompany(body, user.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: Partial<DeliveryCompanyBody>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.updateCompany(id, body, user.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.deleteCompany(id, user.id);
  }

  // ── Cuentas de login de la empresa (portal /domicilios) ──

  @Post(':id/admins')
  createAdmin(
    @Param('id') id: string,
    @Body() body: CompanyAdminBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.createCompanyAdmin(id, body, user.id);
  }

  @Patch(':id/admins/:userId/password')
  setAdminPassword(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() body: AdminPasswordBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.setCompanyAdminPassword(id, userId, body.password, user.id);
  }

  @Patch(':id/admins/:userId/toggle')
  toggleAdmin(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() body: AdminToggleBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.toggleCompanyAdmin(id, userId, body.isActive, user.id);
  }
}
