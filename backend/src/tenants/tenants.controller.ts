import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { IsEmail, IsHexColor, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { TenantsService } from './tenants.service';
import { Roles } from '../common/decorators/roles.decorator';
import { TenantStatus } from '@prisma/client';

class CreateTenantBody {
  @IsString() brandName!: string;
  @IsEmail() email!: string;
  @IsOptional() @IsString() phone?: string;
  @IsUUID() planId!: string;
  @IsOptional() @IsHexColor() primaryColor?: string;
  @IsOptional() @IsHexColor() secondaryColor?: string;
  @IsString() ownerFullName!: string;
  @IsOptional() @IsString() ownerPassword?: string;
  @IsOptional() @IsString() referredByCode?: string;
}

class UpdateTenantBody {
  @IsOptional() @IsString() brandName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsHexColor() primaryColor?: string;
  @IsOptional() @IsHexColor() secondaryColor?: string;
  @IsOptional() @IsString() status?: TenantStatus;
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsInt() @Min(1) maxLocationsOverride?: number;
}

@Controller('tenants')
@Roles('SUPER_ADMIN')
export class TenantsController {
  constructor(private svc: TenantsService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.getById(id);
  }

  @Post()
  create(@Body() body: CreateTenantBody) {
    return this.svc.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateTenantBody) {
    return this.svc.update(id, body);
  }

  @Patch(':id/status')
  status(@Param('id') id: string, @Body() body: { status: TenantStatus }) {
    return this.svc.setStatus(id, body.status);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
