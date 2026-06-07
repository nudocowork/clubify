import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PaymentMethodKind } from '@prisma/client';
import { PayoutsService } from './payouts.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

// Lado AFFILIATE — countdown + perfil + historial.
@Controller('affiliate/payouts')
@Roles(
  'AFFILIATE_INFLUENCER',
  'AFFILIATE_AMBASSADOR',
  'AFFILIATE_SOCIO',
  'AFFILIATE_VENDOR',
)
export class AffiliatePayoutsController {
  constructor(private svc: PayoutsService) {}

  @Get('summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.svc.summary(user);
  }

  @Get('profile')
  getProfile(@CurrentUser() user: AuthUser) {
    return this.svc.getProfile(user);
  }

  @Patch('profile')
  upsertProfile(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      firstName?: string;
      lastName?: string;
      phoneCountry?: string;
      phone?: string;
      method?: PaymentMethodKind;
      binanceEmail?: string;
      binancePhone?: string;
      binanceNote?: string;
      bankCountry?: string;
      bankName?: string;
      bankAccountType?: string;
      bankAccountNo?: string;
      bankHolderName?: string;
      bankHolderDoc?: string;
      bankNote?: string;
    },
  ) {
    return this.svc.upsertProfile(user, body);
  }

  @Get('history')
  history(@CurrentUser() user: AuthUser) {
    return this.svc.myPayouts(user);
  }
}

// Lado SUPER_ADMIN — listo por pagar + perfiles + ejecutar pago.
@Controller('admin/payouts')
@Roles('SUPER_ADMIN')
export class AdminPayoutsController {
  constructor(private svc: PayoutsService) {}

  @Get('ready-to-pay')
  readyToPay(@CurrentUser() user: AuthUser) {
    return this.svc.adminReadyToPay(user);
  }

  @Get('profiles')
  listProfiles(
    @CurrentUser() user: AuthUser,
    @Query('filter') filter?: 'all' | 'pending',
  ) {
    return this.svc.adminListProfiles(user, filter);
  }

  @Patch('profiles/:userId')
  reviewProfile(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Body() body: { approve: boolean; rejectionReason?: string | null },
  ) {
    return this.svc.adminApproveProfile(
      user,
      userId,
      body.approve,
      body.rejectionReason,
    );
  }

  @Post('users/:userId/create')
  createPayout(
    @CurrentUser() user: AuthUser,
    @Param('userId') recipientUserId: string,
  ) {
    return this.svc.adminCreatePayout(user, recipientUserId);
  }

  @Post(':payoutId/mark-paid')
  markPaid(
    @CurrentUser() user: AuthUser,
    @Param('payoutId') payoutId: string,
    @Body()
    body: { proofUrl: string; proofMimeType?: string; notes?: string },
  ) {
    return this.svc.adminMarkPayoutPaid(user, payoutId, body);
  }
}
