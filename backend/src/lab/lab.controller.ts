import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LabCategory, LabPriority, LabStatus, LabVoteKind } from '@prisma/client';
import { LabService } from './lab.service';
import { LAB_LIMITE_MULTER_BYTES } from './lab-adjuntos';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

// ───────────── DTOs ─────────────

class CreateProposalDto {
  @IsString() @MinLength(5) @MaxLength(160)
  title!: string;

  @IsString() @MinLength(20) @MaxLength(4000)
  description!: string;

  @IsEnum(['CLIENTS', 'AFFILIATES'])
  category!: LabCategory;

  @IsOptional() @IsEnum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  priority?: LabPriority;

  @IsOptional() @IsString() @MaxLength(2000)
  expectedBenefit?: string;

  @IsOptional() @IsString() @MaxLength(600)
  attachmentUrl?: string;

  @IsOptional() @IsString() @MaxLength(40)
  attachmentKind?: string;
}

class VoteDto {
  @IsEnum(['LIKE', 'NEED', 'HIGH_PRIORITY', 'DISLIKE'])
  kind!: LabVoteKind;
}

class CommentDto {
  @IsString() @MinLength(2) @MaxLength(2000)
  body!: string;
}

class ListProposalsQuery {
  @IsEnum(['CLIENTS', 'AFFILIATES'])
  category!: LabCategory;

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

  @IsOptional() @IsEnum(['top', 'newest', 'topMonth'])
  sortBy?: 'top' | 'newest' | 'topMonth';

  @IsOptional() @IsString() @MaxLength(120)
  q?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  page?: number;
}

class CommentsQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  page?: number;
}

// ───────────── Controller público (autenticado) ─────────────
//
// El @Roles solo dice quién PUEDE llegar. Quién entra de verdad lo decide
// `LabService.visorDe`: en una marca blanca solo su administrador general; sus
// afiliados y negocios reciben 403 aunque su rol esté en la lista.
@Controller('lab')
@Roles(
  'SUPER_ADMIN',
  'MARKETING',
  'TENANT_OWNER',
  'AFFILIATE_INFLUENCER',
  'AFFILIATE_AMBASSADOR',
  'AFFILIATE_VENDOR',
  'AFFILIATE_SOCIO',
)
export class LabController {
  private static readonly PAGE_SIZE = 20;

  constructor(private svc: LabService) {}

  /** Alcance y marca de quien mira: el front pinta con esto el nombre y los colores. */
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.svc.contexto(user);
  }

  @Get('proposals')
  list(@CurrentUser() user: AuthUser, @Query() q: ListProposalsQuery) {
    const page = q.page ?? 0;
    // La marca sale del USUARIO, no de un parametro: si no, cualquiera pedia
    // el feed de otra marca cambiando la query.
    return this.svc.listPublic(user, q.category, {
      status: q.status,
      sortBy: q.sortBy,
      q: q.q,
      take: LabController.PAGE_SIZE,
      skip: page * LabController.PAGE_SIZE,
    });
  }

  @Get('proposals/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.getById(id, user);
  }

  @Post('proposals')
  create(@CurrentUser() user: AuthUser, @Body() body: CreateProposalDto) {
    return this.svc.createProposal(user, body);
  }

  /**
   * Sube la imagen o el video de una propuesta y devuelve su URL, que después
   * viaja en `attachmentUrl`. Se sube primero y se crea la propuesta después,
   * para poder ver el adjunto antes de enviarla.
   *
   * El `limits` explícito es necesario: sin él multer trunca los archivos
   * grandes en silencio y el video llega cortado al bucket. El tipo y el tope
   * fino los valida el servicio, que devuelve el motivo en español.
   */
  @Post('adjuntos')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: LAB_LIMITE_MULTER_BYTES } }),
  )
  subirAdjunto(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.svc.subirAdjunto(user, file);
  }

  /**
   * El AUTOR borra una propuesta suya, y esta se borra DE VERDAD, con sus votos
   * y sus comentarios.
   *
   * Es lo contrario de `DELETE /admin/lab/proposals/:id`, que solo la retira
   * del panel y deja rastro: cuando la plataforma quita algo hay que
   * explicárselo a la marca, y cuando el autor borra lo suyo no hay a quién
   * explicarle nada. El caso que lo pidió era limpiar las de prueba.
   *
   * Va en la ruta pública y no en la de admin a propósito: quien la llama es el
   * autor, no quien modera.
   */
  @Delete('proposals/:id')
  deleteOwn(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteOwnProposal(id, user);
  }

  @Post('proposals/:id/vote')
  vote(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: VoteDto,
  ) {
    return this.svc.vote(id, user, body.kind);
  }

  @Delete('proposals/:id/vote')
  removeVote(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.removeVote(id, user);
  }

  @Post('proposals/:id/comments')
  comment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: CommentDto,
  ) {
    return this.svc.comment(id, user, body.body);
  }

  @Get('proposals/:id/comments')
  comments(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() q: CommentsQuery,
  ) {
    const page = q.page ?? 0;
    return this.svc.listComments(id, user, 50, page * 50);
  }
}
