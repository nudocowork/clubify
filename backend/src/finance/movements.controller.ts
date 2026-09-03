import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { MovementsService } from './movements.service';

/** CONTABILIDAD — Fase 4. Movimientos (libro de caja unificado, solo lectura). */
@Roles('SUPER_ADMIN')
@Controller('admin/contabilidad/movimientos')
export class MovementsController {
  constructor(private movements: MovementsService) {}

  @Get()
  list(
    @Query('scope') scope?: string,
    @Query('kind') kind?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.movements.list({
      onlyClubify: scope !== 'all',
      kind: kind === 'INGRESO' || kind === 'EGRESO' ? kind : undefined,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }
}
