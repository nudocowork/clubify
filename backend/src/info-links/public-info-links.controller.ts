import { Body, Controller, Get, Param, Post } from '@nestjs/common';
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
  ) {
    return this.svc.getPublic(tenantSlug, linkSlug);
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
