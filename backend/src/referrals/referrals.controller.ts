import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
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

  @Public()
  @Get('codes/:code')
  getByCode(@Param('code') code: string) {
    return this.svc.getByCode(code);
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
}
