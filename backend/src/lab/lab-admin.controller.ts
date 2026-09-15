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

  @Delete('proposals/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteProposal(id, user);
  }

  @Get('metrics')
  metrics(@CurrentUser() user: AuthUser) {
    return this.svc.metrics(user);
  }
}
