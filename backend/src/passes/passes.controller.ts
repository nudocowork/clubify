import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { IsUUID } from 'class-validator';
import { PassesService } from './passes.service';
import { WalletService } from '../wallet/wallet.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';

class IssueBody {
  @IsUUID() cardId!: string;
  @IsUUID() customerId!: string;
}

@Controller('passes')
export class PassesController {
  constructor(
    private svc: PassesService,
    private wallet: WalletService,
  ) {}

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
