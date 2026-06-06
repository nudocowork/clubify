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
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CommissionExceptionsService } from './commission-exceptions.service';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

class CreateBody {
  @IsString() tenantId!: string;
  @IsString() recipientCodeId!: string;
  @IsNumber() @Min(0.01) @Max(100) customPercent!: number;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class UpdateBody {
  @IsOptional() @IsNumber() @Min(0.01) @Max(100) customPercent?: number;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class DisableQuery {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

class ListQuery {
  @IsOptional() @IsString() campaignId?: string;
  @IsOptional() @IsString() q?: string;
}

/**
 * /admin/commission-exceptions — solo SUPER_ADMIN. MARKETING NO debe
 * tocar comisiones (ver project_marketing_role_2026_05_23).
 */
@Controller('admin/commission-exceptions')
@Roles('SUPER_ADMIN')
export class CommissionExceptionsController {
  constructor(private svc: CommissionExceptionsService) {}

  @Get()
  list(@Query() q: ListQuery) {
    if (!q.campaignId) {
      return { items: [] };
    }
    return this.svc.listForCampaign(q.campaignId, q.q).then((items) => ({ items }));
  }

  @Get('tenant/:tenantId')
  listForTenant(@Param('tenantId') tenantId: string) {
    return this.svc.listForTenant(tenantId).then((items) => ({ items }));
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateBody) {
    return this.svc.upsert({
      tenantId: body.tenantId,
      recipientCodeId: body.recipientCodeId,
      customPercent: body.customPercent,
      reason: body.reason ?? null,
      isActive: body.isActive,
      createdById: user.id,
    });
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateBody,
  ) {
    return this.svc.patch(
      id,
      {
        customPercent: body.customPercent,
        reason: body.reason,
        isActive: body.isActive,
      },
      user.id,
    );
  }

  @Get(':id/history')
  history(@Param('id') id: string) {
    return this.svc.getHistoryForException(id).then((items) => ({ items }));
  }

  @Delete(':id')
  disable(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() q: DisableQuery,
  ) {
    return this.svc.disable(id, user.id, q.reason ?? null);
  }
}
