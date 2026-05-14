import { Body, Controller, Get, Headers, Ip, Param, Patch, Post, Query } from '@nestjs/common';
import { IsEmail, IsNumber, IsOptional, IsString } from 'class-validator';
import { CommissionStatus } from '@prisma/client';
import { ReferralsService } from './referrals.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';

class CreateReferralBody {
  @IsString() fullName!: string;
  @IsEmail() email!: string;
  @IsString() whatsapp!: string;
  @IsOptional() @IsNumber() commissionPercent?: number;
  @IsOptional() @IsString() source?: string;
}

class CommissionBody {
  @IsString() status!: CommissionStatus;
}

@Controller('referrals')
export class ReferralsController {
  constructor(private svc: ReferralsService) {}

  @Public()
  @Post('codes')
  create(@Body() body: CreateReferralBody) {
    return this.svc.createCode(body);
  }

  // Rutas con paths fijos primero (defense-in-depth: NestJS matchea por
  // orden de declaración cuando hay path params).
  @Roles('SUPER_ADMIN')
  @Get('summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.svc.adminSummary(user);
  }

  @Roles('SUPER_ADMIN')
  @Get('influencers')
  influencers(@CurrentUser() user: AuthUser) {
    return this.svc.listInfluencers(user);
  }

  @Roles('SUPER_ADMIN')
  @Get('ambassadors')
  ambassadors(@CurrentUser() user: AuthUser) {
    return this.svc.listAmbassadors(user);
  }

  @Roles('SUPER_ADMIN')
  @Get('clients')
  clients(@CurrentUser() user: AuthUser) {
    return this.svc.listClients(user);
  }

  @Roles('SUPER_ADMIN')
  @Get('config')
  getConfig(@CurrentUser() user: AuthUser) {
    return this.svc.getConfig(user);
  }

  @Roles('SUPER_ADMIN')
  @Patch('config')
  setConfig(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.svc.setConfig(user, body);
  }

  @Roles('SUPER_ADMIN')
  @Get('pending-ambassadors')
  pendingAmbassadors(@CurrentUser() user: AuthUser) {
    return this.svc.listPendingAmbassadors(user);
  }

  @Roles('SUPER_ADMIN')
  @Post('ambassadors/:id/approve')
  approveAmbassador(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.approveAmbassador(user, id);
  }

  @Roles('SUPER_ADMIN')
  @Post('ambassadors/:id/reject')
  rejectAmbassador(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.rejectAmbassador(user, id);
  }

  @Roles('SUPER_ADMIN')
  @Post('socio')
  createOrInviteSocio(
    @CurrentUser() user: AuthUser,
    @Body() body: { fullName: string; email: string; whatsapp: string; commissionPercent?: number; customCode?: string },
  ) {
    return this.svc.createOrInviteSocio(user, body);
  }

  // "Embajador Directo Empresa" — AMBASSADOR sin influencer parent.
  // Reporta directo a la empresa, no a un influencer. Mismo % de comisión
  // que un embajador normal, pero el 5% indirecto no va a nadie.
  @Roles('SUPER_ADMIN')
  @Post('ambassadors/company-direct')
  createCompanyDirectAmbassador(
    @CurrentUser() user: AuthUser,
    @Body() body: { fullName: string; email: string; whatsapp: string; commissionPercent?: number; customCode?: string },
  ) {
    return this.svc.createCompanyDirectAmbassador(user, body);
  }

  @Roles('SUPER_ADMIN')
  @Get('leaderboard')
  leaderboard(@CurrentUser() user: AuthUser) {
    return this.svc.leaderboard(user);
  }

  @Roles('SUPER_ADMIN')
  @Get('payouts')
  payouts(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('q') q?: string,
  ) {
    return this.svc.payouts(user, {
      status: status as any,
      dateFrom,
      dateTo,
      q,
    });
  }

  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  @Get('me')
  listMine(@CurrentUser() user: AuthUser) {
    return this.svc.listMine(user);
  }

  @Public()
  @Get('codes/:code')
  getByCode(@Param('code') code: string) {
    return this.svc.getByCode(code);
  }

  // Resolución pública de `slug` → ReferralCode. Usado por la route
  // Next `/ref/<slug>`. Loguea visita en ReferralVisit con UTM + referer.
  @Public()
  @Get('by-slug/:slug')
  resolveSlug(
    @Param('slug') slug: string,
    @Query('utm_source') utmSource?: string,
    @Query('utm_medium') utmMedium?: string,
    @Query('utm_campaign') utmCampaign?: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('referer') referer?: string,
    @Headers('cf-ipcountry') country?: string,
    @Ip() ip?: string,
  ) {
    return this.svc.resolveBySlug(slug, {
      utmSource,
      utmMedium,
      utmCampaign,
      userAgent,
      referer,
      country,
      ip,
    });
  }

  @Roles('SUPER_ADMIN')
  @Patch('codes/:id/slug')
  setSlug(
    @Param('id') id: string,
    @Body() body: { slug: string | null },
  ) {
    return this.svc.setSlug(id, body.slug);
  }

  @Roles('SUPER_ADMIN')
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.svc.list(user);
  }

  @Roles('SUPER_ADMIN')
  @Post('uses/:id/commission')
  createCommission(@Param('id') id: string, @Body() body: { amount: number }) {
    return this.svc.createCommission(id, body.amount);
  }

  @Roles('SUPER_ADMIN')
  @Patch('commissions/:id')
  setStatus(@Param('id') id: string, @Body() body: CommissionBody) {
    return this.svc.setCommissionStatus(id, body.status);
  }

  @Roles('SUPER_ADMIN')
  @Patch('commissions/:id/notes')
  setNotes(
    @Param('id') id: string,
    @Body() body: { notes?: string | null; markContacted?: boolean },
  ) {
    return this.svc.setCommissionNotes(id, body);
  }
}
