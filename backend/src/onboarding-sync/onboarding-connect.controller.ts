import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { OnboardingService } from './onboarding.service';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class CreateTokenBody {
  @IsOptional() @IsString() @MaxLength(60) label?: string;
}

// "Conectar con Onboarding": el DUEÑO del negocio genera/lista/revoca sus
// tokens desde el panel. Autenticación normal (JWT + rol TENANT_OWNER). El
// tenantId sale del token de sesión — cada dueño solo administra SU negocio.
@Controller('tenants/me/onboarding')
@Roles('TENANT_OWNER')
export class OnboardingConnectController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('tokens')
  list(@CurrentUser() user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException();
    return this.onboarding.listTokens(user.tenantId);
  }

  @Post('token')
  create(@CurrentUser() user: AuthUser, @Body() body: CreateTokenBody) {
    if (!user.tenantId) throw new ForbiddenException();
    return this.onboarding.createToken(user.tenantId, body?.label);
  }

  @Delete('token/:id')
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    if (!user.tenantId) throw new ForbiddenException();
    return this.onboarding.revokeToken(user.tenantId, id);
  }
}
