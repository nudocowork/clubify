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
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
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

// HOTFIX 2026-06-05 (bug T): URL Google Reviews validada con regex
// estricta (debe ser un host típico de Google Reviews / Maps). Sin esto
// el dueño podía pegar "no se" y el QR público redirigía a un 404 →
// reseña perdida.
const GOOGLE_REVIEW_URL = /^https:\/\/(g\.page|maps\.app\.goo\.gl|search\.google\.com\/local|www\.google\.com\/maps|maps\.google\.com|g\.co)\/[^\s]+$/i;

class TargetBody {
  @IsString() @MaxLength(80) name!: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string | null;
  @IsUrl({ require_tld: false }) @Matches(GOOGLE_REVIEW_URL, {
    message:
      'googleReviewUrl debe ser un link de Google Reviews válido (g.page, maps.app.goo.gl, search.google.com/local, etc.)',
  })
  googleReviewUrl!: string;
  @IsOptional() @IsUUID() locationId?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(5) threshold?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) position?: number;
}

class TargetPatchBody {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string | null;
  @IsOptional() @IsUrl({ require_tld: false }) @Matches(GOOGLE_REVIEW_URL, {
    message:
      'googleReviewUrl debe ser un link de Google Reviews válido (g.page, maps.app.goo.gl, search.google.com/local, etc.)',
  })
  googleReviewUrl?: string;
  @IsOptional() @IsUUID() locationId?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(5) threshold?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) position?: number;
}

class ReorderItem {
  @IsUUID() id!: string;
  @IsInt() @Min(0) position!: number;
}

class ReorderBody {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ReorderItem)
  items!: ReorderItem[];
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

  // Lista pública de sedes activas para el selector multi-sede del /r/<slug>.
  // Si devuelve [] → frontend usa el link genérico tenant.googleReviewUrl.
  // Si devuelve 1 → redirect directo a esa sede. Si 2+ → selector intermedio.
  @Public()
  @Get('public/review-locations/:slug')
  publicReviewLocations(@Param('slug') slug: string) {
    return this.svc.listPublicForSlug(slug);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('public/r/:slug/submit')
  submit(@Param('slug') slug: string, @Body() body: SubmitDto) {
    return this.svc.submitPublic(slug, body);
  }

  // M7.3: CRUD de targets multi-sede del QR de reseñas. Tenant-scoped.
  // Los endpoints /review-locations son aliases más expresivos para el
  // caso de uso "multi-sede" (2026-06-06). Comparten servicio y modelo
  // (ReviewQrTarget) — no duplicamos lógica.
  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  @Get('review-qr-targets')
  listTargets(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.listTargets(user, tenantId);
  }

  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  @Get('review-locations')
  listLocations(
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
  @Post('review-locations')
  createLocation(
    @CurrentUser() user: AuthUser,
    @Body() body: TargetBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.createTarget(user, body, tenantId);
  }

  // PATCH reorder DEBE declararse antes que PATCH :id (NestJS toma la
  // primera ruta que matchea — sino ":id" capturaría "reorder" como id).
  @Roles('TENANT_OWNER', 'SUPER_ADMIN')
  @Patch('review-locations/reorder')
  reorderLocations(@CurrentUser() user: AuthUser, @Body() body: ReorderBody) {
    return this.svc.reorderTargets(user, body.items);
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
  @Patch('review-locations/:id')
  updateLocation(
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

  @Roles('TENANT_OWNER', 'SUPER_ADMIN')
  @Delete('review-locations/:id')
  deleteLocation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
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
