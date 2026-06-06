import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LabCategory, LabPriority, LabStatus, LabVoteKind } from '@prisma/client';
import { LabService } from './lab.service';
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

  @Get('proposals')
  list(@Query() q: ListProposalsQuery) {
    const page = q.page ?? 0;
    return this.svc.listPublic(q.category, {
      status: q.status,
      sortBy: q.sortBy,
      q: q.q,
      take: LabController.PAGE_SIZE,
      skip: page * LabController.PAGE_SIZE,
    });
  }

  @Get('proposals/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.getById(id, user.id);
  }

  @Post('proposals')
  create(@CurrentUser() user: AuthUser, @Body() body: CreateProposalDto) {
    return this.svc.createProposal(user.id, body);
  }

  @Post('proposals/:id/vote')
  vote(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: VoteDto,
  ) {
    return this.svc.vote(id, user.id, body.kind);
  }

  @Delete('proposals/:id/vote')
  removeVote(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.removeVote(id, user.id);
  }

  @Post('proposals/:id/comments')
  comment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: CommentDto,
  ) {
    return this.svc.comment(id, user.id, body.body);
  }

  @Get('proposals/:id/comments')
  comments(@Param('id') id: string, @Query() q: CommentsQuery) {
    const page = q.page ?? 0;
    return this.svc.listComments(id, 50, page * 50);
  }
}
