import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { QuotePlan } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { SoloPlataformaGuard } from '../common/guards/solo-plataforma.guard';
import { QuotesService } from './quotes.service';

class CreateQuoteDto {
  @IsString() @MinLength(1) @MaxLength(120) customerName!: string;
  @IsString() @MinLength(1) @MaxLength(120) businessName!: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsEmail() @MaxLength(160) email?: string;
  @IsEnum(QuotePlan) plan!: QuotePlan;
  @IsOptional() @IsString() @MaxLength(60) templateSlug?: string;
}

class ListQuotesQuery {
  @IsOptional() @IsEnum(QuotePlan) plan?: QuotePlan;
  @IsOptional() @IsString() @MaxLength(60) templateSlug?: string;
  @IsOptional() @IsString() advisorId?: string;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) take?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) skip?: number;
  @IsOptional() @IsIn(['include', 'only', 'exclude']) archived?:
    | 'include'
    | 'only'
    | 'exclude';
}

/**
 * Cotizaciones es un módulo de la PLATAFORMA: cotiza los planes de Clubify,
 * con los precios globales de `admin/pricing`. `Quote` no tiene marca ni
 * negocio, así que ninguna consulta de aquí está filtrada por nada.
 *
 * Sin este candado, el admin de cualquier marca blanca —que es un SUPER_ADMIN
 * con `whiteLabelId`— listaba y borraba TODAS las cotizaciones, con el nombre,
 * teléfono, correo y precio de cada cliente (auditoría del 2026-09-24).
 */
@Controller('admin/quotes')
@Roles('SUPER_ADMIN')
@UseGuards(SoloPlataformaGuard)
export class QuotesController {
  constructor(private svc: QuotesService) {}

  @Get('stats')
  stats() {
    return this.svc.stats();
  }

  @Get()
  list(@Query() q: ListQuotesQuery) {
    return this.svc.list(q);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateQuoteDto) {
    return this.svc.create(user.id, body);
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.svc.getById(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  /** Marcar que el PDF de esta cotización fue descargado. Proxy de
   * "interés del cliente" — el frontend lo llama fire-and-forget después
   * de generar el blob. */
  @Post(':id/pdf-downloaded')
  bumpPdfDownload(@Param('id') id: string) {
    return this.svc.bumpPdfDownload(id);
  }

  /** Archivar cotización — sale del listing principal sin borrarse. */
  @Patch(':id/archive')
  archive(@Param('id') id: string) {
    return this.svc.archive(id);
  }

  /** Desarchivar — vuelve al listing principal. */
  @Patch(':id/unarchive')
  unarchive(@Param('id') id: string) {
    return this.svc.unarchive(id);
  }
}
