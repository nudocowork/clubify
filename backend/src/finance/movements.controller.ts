import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { MovementsService } from './movements.service';
import { rangoDe } from './where-periodo';

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
    @Query('period') period?: string,
  ) {
    return this.movements.list({
      onlyClubify: scope !== 'all',
      kind: kind === 'INGRESO' || kind === 'EGRESO' ? kind : undefined,
      // `period` manda; `from`/`to` siguen para rangos a medida.
      ...(period
        ? rangoDe(period)
        : { from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined }),
    });
  }
}
