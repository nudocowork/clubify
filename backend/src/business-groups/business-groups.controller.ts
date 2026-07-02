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
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { BusinessGroupStatus } from '@prisma/client';
import { BusinessGroupsService } from './business-groups.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

const PERIODS = ['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'];

class CreateGroupBody {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(120) responsibleName?: string;
  @IsOptional() @IsEmail() responsibleEmail?: string;
  @IsOptional() @IsString() @MaxLength(30) responsiblePhone?: string;
  @IsOptional() @IsString() @MaxLength(120) hotmartSubscriberCode?: string;
  @IsOptional() @IsIn(PERIODS) planPeriodicity?: string;
  @IsOptional() @IsNumber() @Min(0) priceUsd?: number | null;
  @IsOptional() @IsString() nextChargeDate?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tenantIds?: string[];
  @IsOptional() @IsString() @MaxLength(64) referralCodeId?: string;
}

class UpdateGroupBody {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(120) responsibleName?: string;
  @IsOptional() @IsEmail() responsibleEmail?: string;
  @IsOptional() @IsString() @MaxLength(30) responsiblePhone?: string;
  @IsOptional() @IsString() @MaxLength(120) hotmartSubscriberCode?: string;
  @IsOptional() @IsIn(PERIODS) planPeriodicity?: string;
  @IsOptional() @IsNumber() @Min(0) priceUsd?: number | null;
  @IsOptional() @IsString() nextChargeDate?: string;
  @IsOptional() @IsString() @MaxLength(64) referralCodeId?: string;
}

class StatusBody {
  @IsIn(['ACTIVE', 'PAST_DUE', 'SUSPENDED']) status!: BusinessGroupStatus;
}

class AddTenantBody {
  @IsString() tenantId!: string;
}

@Controller('admin/business-groups')
@Roles('SUPER_ADMIN')
export class BusinessGroupsController {
  constructor(private svc: BusinessGroupsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.svc.list(user);
  }

  @Get('available-tenants')
  available(@CurrentUser() user: AuthUser) {
    return this.svc.availableTenants(user);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.get(id, user);
  }

  @Post()
  create(@Body() body: CreateGroupBody, @CurrentUser() user: AuthUser) {
    return this.svc.create(body, user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: UpdateGroupBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.update(id, body, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.remove(id, user);
  }

  @Post(':id/tenants')
  addTenant(
    @Param('id') id: string,
    @Body() body: AddTenantBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.addTenant(id, body.tenantId, user);
  }

  @Delete(':id/tenants/:tenantId')
  removeTenant(
    @Param('id') id: string,
    @Param('tenantId') tenantId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.removeTenant(id, tenantId, user);
  }

  /** Cambia el estado financiero del grupo y cascadea a sus negocios.
   *  Sirve para suspender/reactivar manualmente y para probar el flujo. */
  @Post(':id/status')
  setStatus(
    @Param('id') id: string,
    @Body() body: StatusBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.setStatus(id, body.status, user);
  }
}
