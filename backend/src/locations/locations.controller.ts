import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsInt, IsNumber, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import { LocationsService } from './locations.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class LocationBody {
  @IsString() name!: string;
  @IsOptional() @IsString() address?: string;
  @IsNumber() latitude!: number;
  @IsNumber() longitude!: number;
  @IsOptional() @IsInt() @Min(50) radiusMeters?: number;
  @IsOptional() @IsString() walletRelevantText?: string;
  // #20 (2026-06-17): link exacto de Google Maps de esta sede.
  @IsOptional() @IsString() mapsUrl?: string;
  // #3 (2026-06-18): administrador de sede (alertas de reseña negativa).
  @IsOptional() @IsString() @MaxLength(80) adminName?: string;
  @IsOptional() @IsString() @MaxLength(30) adminPhone?: string;
}

@Controller('locations')
@Roles('TENANT_OWNER', 'SUPER_ADMIN')
export class LocationsController {
  constructor(private svc: LocationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.list(user, tenantId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: LocationBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.create(user, body, tenantId);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: Partial<LocationBody>,
  ) {
    return this.svc.update(user, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.remove(user, id);
  }
}
