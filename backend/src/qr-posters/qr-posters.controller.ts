import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Ip,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Redirect,
  Res,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { QrPosterType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { QrPostersService } from './qr-posters.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { construirPdfDeImprenta } from './pdf-de-imprenta';

class UpsertDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsObject() config!: Record<string, any>;
}

class CreateDto {
  @IsEnum(QrPosterType) type!: QrPosterType;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsObject() config?: Record<string, any>;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(500)
  targetUrl?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class UpdateDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsObject() config?: Record<string, any>;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(500)
  targetUrl?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class MedidasDto {
  // De una tarjeta de visita a un cartel grande. Fuera de eso es un error de
  // quien llama, no un cartel.
  @IsNumber() @Min(10) @Max(1200) w!: number;
  @IsNumber() @Min(10) @Max(1200) h!: number;
}

class QrImprentaDto {
  @IsString() @MaxLength(2000) url!: string;
  // Fracciones del lienzo: ver `pdf-de-imprenta.ts`.
  @IsNumber() @Min(0) @Max(1) x!: number;
  @IsNumber() @Min(0) @Max(1) y!: number;
  @IsNumber() @Min(0.01) @Max(1) lado!: number;
  @IsOptional() @IsNumber() @Min(0) @Max(8) margenEnModulos?: number;
}

class PdfImprentaDto {
  /** El cartel rasterizado SIN el QR, como dataURL (JPEG o PNG). El QR va
   *  aparte y vectorial: es la pieza que no se puede rasterizar. */
  @IsString() @MaxLength(14_000_000) cartel!: string;
  @ValidateNested() @Type(() => MedidasDto) mm!: MedidasDto;
  @IsOptional() @ValidateIf((_, v) => v !== null) @ValidateNested() @Type(() => QrImprentaDto)
  qr?: QrImprentaDto | null;
  @IsOptional() @IsIn(['cmyk', 'rgb']) colores?: 'cmyk' | 'rgb';
  @IsOptional() @IsBoolean() marcasDeCorte?: boolean;
}

class LogExportDto {
  @IsString() @MaxLength(8) format!: string;
  @IsOptional() sizeBytes?: number;
}

@Controller('qr-posters')
export class QrPostersController {
  constructor(private svc: QrPostersService) {}

  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN', 'MARKETING')
  @Get()
  list(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.listMine(user, tenantId);
  }

  // ───────── nuevos endpoints por id (multi-QR) ───────── //

  @Roles('TENANT_OWNER', 'SUPER_ADMIN', 'MARKETING')
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.create(user, body, tenantId);
  }

  // OJO con el orden: este Get(:id) DEBE ir DESPUÉS de los Get específicos
  // (by-type/:type) sino captura sus URLs como id literal "by-type". El
  // Patch/Delete por id no chocan porque /by-type/:type usa Put/Delete.
  // Ver feedback_nestjs_route_order.md para el patrón.
  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN', 'MARKETING')
  @Get('by-type/:type')
  getByType(
    @CurrentUser() user: AuthUser,
    @Param('type') type: QrPosterType,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.getByType(user, type, tenantId);
  }

  @Roles('TENANT_OWNER', 'SUPER_ADMIN', 'MARKETING')
  @Put('by-type/:type')
  upsertByType(
    @CurrentUser() user: AuthUser,
    @Param('type') type: QrPosterType,
    @Body() body: UpsertDto,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.upsertByType(user, type, body, tenantId);
  }

  @Roles('TENANT_OWNER', 'SUPER_ADMIN', 'MARKETING')
  @Delete('by-type/:type')
  removeByType(
    @CurrentUser() user: AuthUser,
    @Param('type') type: QrPosterType,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.removeByType(user, type, tenantId);
  }

  // Endpoints por id — declarados DESPUÉS de los by-type para que el
  // route matching no se confunda.
  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN', 'MARKETING')
  @Get(':id')
  getById(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.getById(user, id);
  }

  @Roles('TENANT_OWNER', 'SUPER_ADMIN', 'MARKETING')
  @Patch(':id')
  updateById(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateDto,
  ) {
    return this.svc.updateById(user, id, body);
  }

  @Roles('TENANT_OWNER', 'SUPER_ADMIN', 'MARKETING')
  @Delete(':id')
  removeById(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.removeById(user, id);
  }

  /** El frontend dispara esto cuando el dueño descarga el cartel
   *  (PNG/PDF/SVG). Loguea el evento para mostrar "descargado N veces"
   *  en el card del poster. */
  /**
   * El PDF para imprenta: CMYK, con el QR vectorial en negro puro, sangrado y
   * marcas de corte. Ver `pdf-de-imprenta.ts` para el porqué de cada cosa.
   *
   * No depende de un cartel guardado: recibe el render tal cual lo ve el
   * negocio, así sale exactamente lo que diseñó, con sus fuentes y sus emojis,
   * sin un segundo motor de dibujo que mantener idéntico al del editor.
   */
  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN', 'MARKETING')
  @Post('pdf-imprenta')
  async pdfImprenta(@Body() body: PdfImprentaDto, @Res() res: Response) {
    const m = /^data:image\/(png|jpeg|jpg);base64,(.+)$/.exec(body.cartel);
    if (!m) {
      throw new BadRequestException('El cartel tiene que llegar como imagen PNG o JPEG.');
    }
    const cartel = Buffer.from(m[2], 'base64');
    const pdf = await construirPdfDeImprenta({
      mm: body.mm,
      cartel,
      qr: body.qr ?? null,
      colores: body.colores ?? 'cmyk',
      marcasDeCorte: body.marcasDeCorte ?? true,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="cartel-imprenta.pdf"');
    res.setHeader('Content-Length', String(pdf.length));
    res.end(pdf);
  }

  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN', 'MARKETING')
  @Post(':id/export-log')
  logExport(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: LogExportDto,
  ) {
    return this.svc.logExport(user, id, body);
  }
}

/**
 * Controller PÚBLICO separado para el redirect dinámico `/q/<id>`.
 * El QR impreso codifica esta URL — al escanear, el usuario llega aquí,
 * el servicio loguea la visita y retorna un 302 al targetUrl resuelto
 * (override o default por tipo).
 *
 * Si el poster no existe o está inactivo, devuelve 404 limpio (sin
 * leak del tenant). NO requiere auth.
 */
@Controller('q')
export class QrPosterPublicRedirectController {
  constructor(private svc: QrPostersService) {}

  @Public()
  @Get(':id')
  @Redirect()
  async redirect(
    @Param('id') id: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('referer') referer?: string,
    @Headers('cf-ipcountry') country?: string,
    @Ip() ip?: string,
  ) {
    const appUrl = process.env.APP_URL ?? 'https://soyclubify.com';
    const target = await this.svc.resolvePublicUrl(id, appUrl, {
      ip,
      userAgent,
      country,
      referer,
    });
    if (!target) throw new NotFoundException('QR no disponible');
    return { url: target, statusCode: 302 };
  }
}
