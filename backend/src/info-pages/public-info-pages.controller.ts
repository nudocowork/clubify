import { Body, Controller, Get, Header, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InfoPagesService } from './info-pages.service';
import { Public } from '../common/decorators/public.decorator';

// Contenido idéntico para todos los visitantes (varía por slug) → cacheable en
// browser/CDN con revalidación en background.
const PUBLIC_CACHE =
  'public, max-age=30, s-maxage=180, stale-while-revalidate=600';

@Controller('public/info-pages')
export class PublicInfoPagesController {
  constructor(private svc: InfoPagesService) {}

  @Public()
  @Header('Cache-Control', PUBLIC_CACHE)
  @Get(':slug')
  get(@Param('slug') slug: string) {
    return this.svc.getPublic(slug);
  }

  // Endpoint público sin auth → throttle estricto (10/min/IP) anti-spam, además del
  // global. El cap de tamaño/tipo de cada valor lo hace submitLead en el service.
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post(':slug/lead')
  lead(@Param('slug') slug: string, @Body() body: Record<string, unknown>) {
    return this.svc.submitLead(slug, body ?? {});
  }
}
