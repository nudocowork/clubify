import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { CommissionsAuditService } from './commissions-audit.service';

class MarkRejectedBody {
  @IsArray() @IsString({ each: true }) ids!: string[];
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
  // #4 (2026-06-16): cascada OPT-IN. Si true, al rechazar una comisión se
  // rechazan también las hermanas de la MISMA venta (mismo referralUse +
  // periodKey → influencer/embajador/vendedor del mismo cobro). Default
  // FALSE: la UI de duplicados rechaza exactamente las ids pasadas (sus
  // hermanas son comisiones legítimas de otros actores, NO duplicados). Se
  // usa true sólo desde la acción "anular venta completa".
  @IsOptional() @IsBoolean() cascade?: boolean;
}

/**
 * Endpoint de auditoría de comisiones — Bloque 3 Fase A (2026-06-10).
 *
 * Read-only. NO modifica datos. Devuelve grupos sospechosos de
 * comisiones duplicadas para que el SUPER_ADMIN revise antes de aplicar
 * el unique constraint definitivo en Fase B.
 */
@Controller('admin/commissions/audit')
@Roles('SUPER_ADMIN')
export class CommissionsAuditController {
  constructor(private svc: CommissionsAuditService) {}

  @Get('duplicates')
  duplicates(
    @CurrentUser() user: AuthUser,
    @Query('limit') limit?: string,
  ) {
    return this.svc.findDuplicates({
      limit: limit ? Number(limit) : undefined,
      whiteLabelId: user.whiteLabelId ?? null,
    });
  }

  /** Fase B (2026-06-12): marca comisiones PENDING/APPROVED como
   *  REJECTED tras revisión manual del SUPER_ADMIN. PAID se preserva
   *  siempre. Cada cambio queda en AuditLog. */
  @Post('mark-rejected')
  markRejected(
    @CurrentUser() user: AuthUser,
    @Body() body: MarkRejectedBody,
  ) {
    return this.svc.markRejected({
      actorId: user.id,
      whiteLabelId: user.whiteLabelId ?? null,
      ids: body.ids,
      reason: body.reason,
      cascade: body.cascade === true,
    });
  }
}
