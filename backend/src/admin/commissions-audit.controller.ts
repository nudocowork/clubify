import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { CommissionsAuditService } from './commissions-audit.service';

class MarkRejectedBody {
  @IsArray() @IsString({ each: true }) ids!: string[];
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
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
  duplicates(@Query('limit') limit?: string) {
    return this.svc.findDuplicates({
      limit: limit ? Number(limit) : undefined,
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
      ids: body.ids,
      reason: body.reason,
    });
  }
}
