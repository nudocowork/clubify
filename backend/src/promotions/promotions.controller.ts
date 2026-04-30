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
import { IsBoolean, IsEnum, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';
import { PromotionType } from '@prisma/client';
import { PromotionsService } from './promotions.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class PromoBody {
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsEnum(PromotionType) type!: PromotionType;
  @IsNumber() value!: number;
  @IsOptional() @IsObject() conditions?: any;
  @IsOptional() @IsString() validFrom?: string;
  @IsOptional() @IsString() validUntil?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller('promotions')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
export class PromotionsController {
  constructor(private svc: PromotionsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.list(user, tenantId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: PromoBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.create(user, body, tenantId);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: Partial<PromoBody>,
  ) {
    return this.svc.update(user, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.remove(user, id);
  }
}
