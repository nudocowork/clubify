import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { InfoPagesService } from './info-pages.service';
import { Public } from '../common/decorators/public.decorator';

// API server-to-server para administrar las páginas informativas desde
// team_clubify (sección COMERCIAL). Protegida por header x-api-key ==
// TEAM_INTEGRATION_KEY (el MISMO mecanismo que el feed de comisiones en
// referrals.controller). El dato sigue viviendo en Clubify (tabla InfoPage) y se
// refleja en soyclubify.com/informacion — team_clubify solo lo edita en remoto.
// Reusa exactamente el mismo servicio que el panel superadmin.
@Controller('integration/info-pages')
export class IntegrationInfoPagesController {
  constructor(private svc: InfoPagesService) {}

  private assertKey(apiKey?: string) {
    const expected = process.env.TEAM_INTEGRATION_KEY;
    if (!expected || apiKey !== expected) throw new UnauthorizedException();
  }

  @Public()
  @Get()
  list(@Headers('x-api-key') apiKey?: string) {
    this.assertKey(apiKey);
    return this.svc.list();
  }

  @Public()
  @Get(':slug')
  get(@Headers('x-api-key') apiKey: string, @Param('slug') slug: string) {
    this.assertKey(apiKey);
    return this.svc.get(slug);
  }

  // Body = contenido editable. El service filtra por su whitelist EDITABLE (slug
  // bloqueado); usar Record evita que el ValidationPipe global recorte campos.
  @Public()
  @Patch(':slug')
  update(
    @Headers('x-api-key') apiKey: string,
    @Param('slug') slug: string,
    @Body() body: Record<string, unknown>,
  ) {
    this.assertKey(apiKey);
    return this.svc.update(slug, body ?? {});
  }

  @Public()
  @Get(':slug/leads')
  leads(
    @Headers('x-api-key') apiKey: string,
    @Param('slug') slug: string,
    @Query('q') q?: string,
  ) {
    this.assertKey(apiKey);
    return this.svc.listLeads(slug, q);
  }

  @Public()
  @Get(':slug/leads.csv')
  async leadsCsv(
    @Headers('x-api-key') apiKey: string,
    @Param('slug') slug: string,
    @Res() res: Response,
  ) {
    this.assertKey(apiKey);
    const csv = await this.svc.leadsCsv(slug);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-${slug}.csv"`);
    res.send(csv);
  }
}
