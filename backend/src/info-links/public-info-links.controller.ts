import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { InfoLinksService } from './info-links.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('public/i')
export class PublicInfoLinksController {
  constructor(private svc: InfoLinksService) {}

  @Public()
  @Get(':tenantSlug/:linkSlug')
  get(
    @Param('tenantSlug') tenantSlug: string,
    @Param('linkSlug') linkSlug: string,
    @Query('locale') locale?: string,
  ) {
    return this.svc.getPublic(tenantSlug, linkSlug, locale);
  }

  @Public()
  @Post(':id/track')
  track(
    @Param('id') id: string,
    @Body() body: { type: string; metadata?: any },
  ) {
    return this.svc.trackEvent(id, body.type, body.metadata ?? {});
  }
}

// Controller separado para el path `/public/info-link-by-root/:slug` que
// resuelve Infolinks por su rootSlug vanity (soyclubify.com/<slug>). Vive
// fuera del @Controller('public/i') porque el path raíz es distinto y no
// quiero shadowing entre `:tenantSlug/:linkSlug` y un slug de un nivel.
@Controller('public/info-link-by-root')
export class PublicInfoLinkByRootController {
  constructor(private svc: InfoLinksService) {}

  @Public()
  @Get(':slug')
  byRoot(@Param('slug') slug: string, @Query('locale') locale?: string) {
    return this.svc.getPublicByRoot(slug, locale);
  }
}
