import { Body, Controller, Get, Headers, Ip, Param, Post, Query } from '@nestjs/common';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { StampAction } from '@prisma/client';
import { StampsService } from './stamps.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class StampBody {
  @IsUUID() passId!: string;
  @IsEnum(StampAction) action!: StampAction;
  @IsOptional() amount?: number;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsUUID() locationId?: string;
  // Requerido cuando se hace STAMP con amount>1 desde el escáner
  // (ver scanner.staffPin en super admin / settings).
  @IsOptional() @IsString() pin?: string;
  // Monto que el cliente pagó por la compra que motivó el scan.
  // Required en STAMP/VISIT para cards STAMPS/VISITS/HYBRID (validado en svc).
  // Solo informativo — no afecta la cantidad de sellos otorgados.
  @IsOptional() purchaseAmount?: number;
  // Saltarse el tope de sellos del dia a proposito. Solo lo honra el service
  // para SUPER_ADMIN; para el resto se ignora y el tope se aplica igual.
  @IsOptional() @IsBoolean() override?: boolean;
}

@Controller('stamps')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
export class StampsController {
  constructor(private svc: StampsService) {}

  @Post()
  record(
    @CurrentUser() user: AuthUser,
    @Body() body: StampBody,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-forwarded-for') xff?: string,
  ) {
    // ip real detrás del proxy (Railway) = primer valor de x-forwarded-for.
    const realIp = (xff?.split(',')[0]?.trim() || ip || '').slice(0, 60) || null;
    return this.svc.record(user, body, {
      ip: realIp,
      device: (userAgent ?? '').slice(0, 200) || null,
    });
  }

  @Get('history/:passId')
  history(@CurrentUser() user: AuthUser, @Param('passId') passId: string) {
    return this.svc.history(user, passId);
  }

  /** Wallet V3 — Historial/Auditoría de ajustes de sellos. Negocio ve el suyo;
   *  Master Admin (SUPER_ADMIN) puede pasar ?tenantId. */
  @Get('audit')
  audit(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') tenantId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.auditLog(user, {
      tenantId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  // Backfill admin: para coupon passes COMPLETED pre-fix del 2026-05-15
  // que no auto-crearon stamps card. Idempotente: ya existentes no se
  // duplican. Gated a SUPER_ADMIN para evitar abuso.
  @Post('backfill-coupon-promotion')
  @Roles('SUPER_ADMIN')
  backfillCouponPromotion(
    @CurrentUser() user: AuthUser,
    @Query('tenantSlug') tenantSlug?: string,
  ) {
    return this.svc.backfillCouponPromotion(user, tenantSlug);
  }
}
