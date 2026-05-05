import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PassesService } from './passes.service';
import { WalletService } from '../wallet/wallet.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';

class IssueBody {
  @IsUUID() cardId!: string;
  @IsUUID() customerId!: string;
}

class EnrollBody {
  @IsString() @MinLength(2) @MaxLength(80) fullName!: string;
  @IsString() @MinLength(8) @MaxLength(20) phone!: string;
  @IsOptional() @IsEmail() email?: string;
}

@Controller('passes')
export class PassesController {
  constructor(
    private svc: PassesService,
    private wallet: WalletService,
    private prisma: PrismaService,
  ) {}

  /**
   * Auto-enrollment público: muestra info de la tarjeta antes de que el
   * cliente llene el form. No expone tenantId ni datos sensibles.
   */
  @Public()
  @Get('enroll/:cardId')
  async getEnrollCard(@Param('cardId') cardId: string) {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      select: {
        id: true,
        name: true,
        type: true,
        description: true,
        rewardText: true,
        terms: true,
        primaryColor: true,
        secondaryColor: true,
        stampsRequired: true,
        isActive: true,
        tenant: {
          select: {
            brandName: true,
            logoUrl: true,
            primaryColor: true,
            slug: true,
            status: true,
          },
        },
      },
    });
    if (!card || !card.isActive || card.tenant.status === 'SUSPENDED') {
      return { available: false };
    }
    return { available: true, card };
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('enroll/:cardId')
  enroll(@Param('cardId') cardId: string, @Body() body: EnrollBody) {
    return this.svc.enrollPublic(cardId, body);
  }

  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  @Get()
  list(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.list(user, tenantId);
  }

  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  @Post()
  issue(@CurrentUser() user: AuthUser, @Body() body: IssueBody) {
    return this.svc.issue(user, body.cardId, body.customerId);
  }

  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.get(user, id);
  }

  @Public()
  @Get('lookup/by-phone')
  lookupByPhone(
    @Query('slug') slug: string,
    @Query('phone') phone: string,
  ) {
    return this.svc.findByPhonePublic(slug, phone);
  }

  @Public()
  @Get(':id/public')
  getPublic(@Param('id') id: string) {
    return this.svc.getPublic(id);
  }

  @Public()
  @Get(':id/apple.pkpass')
  async apple(@Param('id') id: string, @Res() res: Response) {
    const buf = await this.wallet.generateApplePass(id);
    res.set({
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': `attachment; filename="${id}.pkpass"`,
    });
    res.send(buf);
  }

  @Public()
  @Get(':id/google')
  async google(@Param('id') id: string) {
    const url = await this.wallet.generateGoogleSaveUrl(id);
    return { saveUrl: url };
  }
}
