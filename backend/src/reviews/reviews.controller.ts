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
import { Throttle } from '@nestjs/throttler';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  IsBoolean,
} from 'class-validator';
import { ReviewsService } from './reviews.service';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class SubmitDto {
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
  @IsOptional() @IsString() @MaxLength(80) customerName?: string;
  @IsOptional() @IsString() @MaxLength(40) customerPhone?: string;
  @IsOptional() @IsBoolean() redirectedToGoogle?: boolean;
  // M7.3: target del QR multi-sede (opcional). null/ausente = link
  // genérico del tenant.
  @IsOptional() @IsUUID() reviewTargetId?: string;
}

class TargetBody {
  @IsString() @MaxLength(80) name!: string;
  @IsUrl({ require_tld: false }) googleReviewUrl!: string;
  @IsOptional() @IsUUID() locationId?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(5) threshold?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class TargetPatchBody {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsUrl({ require_tld: false }) googleReviewUrl?: string;
  @IsOptional() @IsUUID() locationId?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(5) threshold?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller()
export class ReviewsController {
  constructor(private svc: ReviewsService) {}

  // Público (review filter UI)
  @Public()
  @Get('public/r/:slug')
  getPublic(
    @Param('slug') slug: string,
    @Query('target') targetId?: string,
  ) {
    return this.svc.getPublic(slug, targetId);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('public/r/:slug/submit')
  submit(@Param('slug') slug: string, @Body() body: SubmitDto) {
    return this.svc.submitPublic(slug, body);
  }

  // M7.3: CRUD de targets multi-sede del QR de reseñas. Tenant-scoped.
  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  @Get('review-qr-targets')
  listTargets(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.listTargets(user, tenantId);
  }

  @Roles('TENANT_OWNER', 'SUPER_ADMIN')
  @Post('review-qr-targets')
  createTarget(
    @CurrentUser() user: AuthUser,
    @Body() body: TargetBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.createTarget(user, body, tenantId);
  }

  @Roles('TENANT_OWNER', 'SUPER_ADMIN')
  @Patch('review-qr-targets/:id')
  updateTarget(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: TargetPatchBody,
  ) {
    return this.svc.updateTarget(user, id, body);
  }

  @Roles('TENANT_OWNER', 'SUPER_ADMIN')
  @Delete('review-qr-targets/:id')
  deleteTarget(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteTarget(user, id);
  }

  // Panel del tenant
  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  @Get('reviews')
  list(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.listMine(user, tenantId);
  }

  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  @Patch('reviews/:id/read')
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.markRead(user, id);
  }

  @Roles('TENANT_OWNER', 'SUPER_ADMIN')
  @Delete('reviews/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.remove(user, id);
  }

  /** Logs de envíos de SMS por reseñas negativas para un tenant.
   *  Usado desde /admin/tenants/[id]. SUPER_ADMIN + MARKETING (rol
   *  marketing gestiona campañas/comms y necesita ver estos logs). */
  @Roles('SUPER_ADMIN', 'MARKETING')
  @Get('admin/tenants/:id/review-alerts/logs')
  reviewAlertLogs(@Param('id') id: string) {
    return this.svc.listReviewAlertLogs(id);
  }
}
