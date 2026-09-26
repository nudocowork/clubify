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
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LabCategory, LabStatus } from '@prisma/client';
import { LabService } from './lab.service';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

// ───────────── DTOs ─────────────

class ListAdminQuery {
  @IsOptional() @IsEnum(['CLIENTS', 'AFFILIATES'])
  category?: LabCategory;

  @IsOptional()
  @IsEnum([
    'PENDING',
    'REJECTED',
    'EVALUATING',
    'APPROVED',
    'IN_DEVELOPMENT',
    'IN_TESTING',
    'IMPLEMENTED',
  ])
  status?: LabStatus;

  @IsOptional() @IsString() @MaxLength(120)
  q?: string;

  /** Id de una marca, o 'plataforma' para Clubify y las propuestas sin marca. */
  @IsOptional() @IsString() @MaxLength(64)
  whiteLabelId?: string;

  /** Ranking por votos de todas las marcas, para la pestaña «Top votadas». */
  @IsOptional() @IsEnum(['top', 'topMonth'])
  sortBy?: 'top' | 'topMonth';

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  page?: number;
}

/**
 * Retirar del panel acepta un motivo, y ese motivo SE LE ENSEÑA A LA MARCA: es
 * la diferencia entre «desapareció» y «nos dijeron por qué». Opcional, porque
 * exigirlo haría que alguien escriba «.» para salir del paso y entonces el
 * campo miente en vez de estar vacío.
 */
class RetirarDto {
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

class SetStatusDto {
  @IsEnum([
    'PENDING',
    'REJECTED',
    'EVALUATING',
    'APPROVED',
    'IN_DEVELOPMENT',
    'IN_TESTING',
    'IMPLEMENTED',
  ])
  status!: LabStatus;

  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;
}

// ───────────── Controller admin ─────────────
//
// Un admin de marca blanca es SUPER_ADMIN y pasa este @Roles. El candado que lo
// deja fuera de la moderación (que ve todas las marcas) está en el servicio.
@Controller('admin/lab')
@Roles('SUPER_ADMIN', 'MARKETING')
export class LabAdminController {
  private static readonly PAGE_SIZE = 30;

  constructor(private svc: LabService) {}

  @Get('proposals')
  list(@CurrentUser() user: AuthUser, @Query() q: ListAdminQuery) {
    const page = q.page ?? 0;
    return this.svc.listAdmin(user, {
      category: q.category,
      status: q.status,
      q: q.q,
      whiteLabelId: q.whiteLabelId,
      sortBy: q.sortBy,
      take: LabAdminController.PAGE_SIZE,
      skip: page * LabAdminController.PAGE_SIZE,
    });
  }

  @Patch('proposals/:id/status')
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: SetStatusDto,
  ) {
    return this.svc.setStatus(id, body.status, user, body.reason ?? null);
  }

  @Post('proposals/:src/merge-into/:dst')
  merge(
    @CurrentUser() user: AuthUser,
    @Param('src') src: string,
    @Param('dst') dst: string,
  ) {
    return this.svc.mergeProposals(src, dst, user);
  }

  /**
   * RETIRA la propuesta del panel. No la borra: en el Lab de la marca queda su
   * línea con «Clubify la eliminó del panel» y el motivo.
   *
   * Sigue siendo `DELETE` porque es lo que el panel ya llama y porque para
   * quien lo pulsa la acción es «eliminar». Lo que cambia es que ahora deja
   * rastro para quien la escribió.
   */
  @Delete('proposals/:id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: RetirarDto,
  ) {
    return this.svc.removeProposal(id, user, body?.reason);
  }

  /** Deshace la retirada. Retirar sin deshacer sería un viaje de ida. */
  @Post('proposals/:id/restaurar')
  restore(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.restoreProposal(id, user);
  }

  @Get('metrics')
  metrics(@CurrentUser() user: AuthUser) {
    return this.svc.metrics(user);
  }
}
