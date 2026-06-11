import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CommissionsAuditService } from './commissions-audit.service';

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
}
