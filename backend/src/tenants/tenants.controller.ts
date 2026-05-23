import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsDateString, IsEmail, IsHexColor, IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { TenantsService } from './tenants.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { TenantStatus } from '@prisma/client';
import { TenantLockGuard } from '../common/guards/tenant-lock.guard';

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
  @IsOptional() @IsString() businessCategorySlug?: string;
  @IsOptional() @IsBoolean() freeAccount?: boolean;
  @IsOptional() @IsInt() @Min(1) trialDays?: number;
  @IsOptional() @IsDateString() nextChargeDate?: string;
  @IsOptional() @IsString() hotmartSubscriberCode?: string;
}

class BillingBody {
  @IsIn(['free', 'trial', 'paid', 'pending'])
  mode!: 'free' | 'trial' | 'paid' | 'pending';
  @IsOptional() @IsInt() @Min(1) trialDays?: number;
  @IsOptional() @IsInt() @Min(0) gracePeriodDays?: number;
  @IsOptional() @IsDateString() nextChargeDate?: string;
  @IsOptional() @IsString() hotmartSubscriberCode?: string;
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
  @IsOptional() @IsInt() @Min(0) gracePeriodDays?: number;
  // Asignar subcuenta global de Grow Business para alertas SMS de
  // reseñas. null = limpiar (volver a credenciales propias del tenant).
  @IsOptional() reviewAlertsAccountId?: string | null;
}

@Controller('tenants')
@Roles('SUPER_ADMIN')
export class TenantsController {
  constructor(
    private svc: TenantsService,
    private lockGuard: TenantLockGuard,
  ) {}

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

  @Post(':id/extend-trial')
  extendTrial(@Param('id') id: string, @Body() body: { days?: number }) {
    return this.svc.extendTrial(id, body?.days ?? 7);
  }

  @Patch(':id/billing')
  billing(@Param('id') id: string, @Body() body: BillingBody) {
    return this.svc.updateBilling(id, body);
  }

  @Post(':id/impersonate')
  impersonate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.impersonate(id, user.id);
  }

  /** Toggle demo lock. Body: { locked: boolean, reason?: string }.
   *  Cuando locked=true, no-SUPER_ADMIN no puede modificar nada en
   *  ese tenant — pensado para cuentas demo que los embajadores muestran
   *  a prospects sin riesgo. Invalida cache del guard al toque. */
  @Patch(':id/lock')
  async setLock(
    @Param('id') id: string,
    @Body() body: { locked: boolean; reason?: string | null },
  ) {
    const result = await this.svc.setLock(id, {
      locked: !!body?.locked,
      reason: body?.reason ?? null,
    });
    this.lockGuard.invalidate(id);
    return result;
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
