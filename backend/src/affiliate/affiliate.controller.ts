import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { AffiliateService } from './affiliate.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('affiliate')
@Roles('AFFILIATE_INFLUENCER', 'AFFILIATE_AMBASSADOR', 'AFFILIATE_SOCIO')
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

  @Patch('me')
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body() body: { fullName?: string; phone?: string },
  ) {
    return this.svc.updateProfile(user, body);
  }

  @Post('ambassadors')
  createAmbassador(
    @CurrentUser() user: AuthUser,
    @Body() body: { fullName: string; email: string; whatsapp: string; commissionPercent?: number },
  ) {
    return this.svc.createAmbassadorAsInfluencer(user, body);
  }
}
