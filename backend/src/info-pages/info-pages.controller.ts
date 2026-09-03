import { Body, Controller, Get, Param, Patch, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IsArray, IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';
import { InfoPagesService } from './info-pages.service';
import { Roles } from '../common/decorators/roles.decorator';

// Body de edición de CONTENIDO. El slug queda EXCLUIDO a propósito (bloqueado);
// el service ignora cualquier clave no permitida.
class InfoPageBody {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() tag?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() subtitle?: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsString() heroImageUrl?: string;
  @IsOptional() @IsString() videoUrl?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsArray() sections?: any[];
  @IsOptional() @IsString() ctaText?: string;
  @IsOptional() @IsString() ctaUrl?: string;
  @IsOptional() @IsBoolean() formEnabled?: boolean;
  @IsOptional() @IsArray() formFields?: any[];
  @IsOptional() @IsObject() theme?: any;
  @IsOptional() @IsBoolean() isPublished?: boolean;
}

@Controller('superadmin/info-pages')
@Roles('PLATFORM_OWNER', 'SUPER_ADMIN')
export class InfoPagesController {
  constructor(private svc: InfoPagesService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Get(':slug')
  get(@Param('slug') slug: string) {
    return this.svc.get(slug);
  }

  @Patch(':slug')
  update(@Param('slug') slug: string, @Body() body: InfoPageBody) {
    return this.svc.update(slug, body as Record<string, unknown>);
  }

  @Get(':slug/leads')
  leads(@Param('slug') slug: string, @Query('q') q?: string) {
    return this.svc.listLeads(slug, q);
  }

  @Get(':slug/leads.csv')
  async leadsCsv(@Param('slug') slug: string, @Res() res: Response) {
    const csv = await this.svc.leadsCsv(slug);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-${slug}.csv"`);
    res.send(csv);
  }
}
