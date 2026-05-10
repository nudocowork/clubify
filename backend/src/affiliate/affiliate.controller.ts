import { Controller, Get } from '@nestjs/common';
import { AffiliateService } from './affiliate.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('affiliate')
@Roles('AFFILIATE_INFLUENCER', 'AFFILIATE_AMBASSADOR')
export class AffiliateController {
  constructor(private svc: AffiliateService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.svc.me(user);
  }

  @Get('clients')
  clients(@CurrentUser() user: AuthUser) {
    return this.svc.clients(user);
  }

  @Get('commissions')
  commissions(@CurrentUser() user: AuthUser) {
    return this.svc.commissions(user);
  }
}
