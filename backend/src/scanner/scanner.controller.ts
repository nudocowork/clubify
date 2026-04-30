import { Body, Controller, Post } from '@nestjs/common';
import { IsString } from 'class-validator';
import { ScannerService } from './scanner.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class VerifyBody {
  @IsString() qrToken!: string;
}

@Controller('scanner')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
export class ScannerController {
  constructor(private svc: ScannerService) {}

  @Post('verify')
  verify(@CurrentUser() user: AuthUser, @Body() body: VerifyBody) {
    return this.svc.verifyQr(user, body.qrToken);
  }
}
