import { Body, Controller, ForbiddenException, Get, Patch } from '@nestjs/common';
import { IsHexColor, IsOptional, IsString } from 'class-validator';
import { TenantsService } from './tenants.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class UpdateMyBody {
  @IsOptional() @IsString() brandName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() whatsappPhone?: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsHexColor() primaryColor?: string;
  @IsOptional() @IsHexColor() secondaryColor?: string;
  @IsOptional() @IsString() instagramUrl?: string;
  @IsOptional() @IsString() facebookUrl?: string;
  @IsOptional() @IsString() mapsUrl?: string;
}

@Controller('tenants/me')
@Roles('TENANT_OWNER', 'TENANT_STAFF')
export class TenantMeController {
  constructor(private svc: TenantsService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException();
    return this.svc.getMine(user.tenantId);
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() body: UpdateMyBody) {
    if (!user.tenantId) throw new ForbiddenException();
    return this.svc.updateMine(user.tenantId, body);
  }
}
