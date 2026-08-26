import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { CuponeraService } from './cuponera.service';
import { AllyLocationBody, AllyProfileBody, BenefitBody } from './cuponera.dto';

class ScanBody {
  @IsString() @MaxLength(120) qrToken!: string;
}
class RedeemBody {
  @IsString() @MaxLength(120) benefitId!: string;
  @IsOptional() @IsString() @MaxLength(120) passId?: string;
  @IsOptional() @IsString() @MaxLength(120) qrToken?: string;
}
class StampActionBody {
  @IsString() @MaxLength(120) programId!: string;
  @IsOptional() @IsString() @MaxLength(120) passId?: string;
  @IsOptional() @IsString() @MaxLength(120) qrToken?: string;
}
class BenefitStatusBody {
  @IsIn(['DRAFT', 'ACTIVE', 'PAUSED']) status!: 'DRAFT' | 'ACTIVE' | 'PAUSED';
}

/**
 * Portal del NEGOCIO ALIADO (role=ALLY_BUSINESS), servido en /cuponera/panel.
 * Scopea todo al `user.allyBusinessId` del token (mismo patrón que
 * /delivery-portal para DELIVERY_COMPANY). Fase 2 = ficha; Fase 3 = beneficios
 * + canje por QR.
 */
@Controller('cuponera/ally')
@Roles('ALLY_BUSINESS')
export class AllyPortalController {
  constructor(private svc: CuponeraService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.svc.getAllyForPortal(user);
  }

  @Patch('profile')
  updateProfile(@CurrentUser() user: AuthUser, @Body() body: AllyProfileBody) {
    return this.svc.updateAllyProfile(user, body);
  }

  @Get('metrics')
  metrics(@CurrentUser() user: AuthUser) {
    return this.svc.allyMetrics(user);
  }

  // --- Beneficios ---
  @Get('benefits')
  benefits(@CurrentUser() user: AuthUser) {
    return this.svc.listAllyBenefits(user);
  }
  @Post('benefits')
  createBenefit(@CurrentUser() user: AuthUser, @Body() body: BenefitBody) {
    return this.svc.createAllyBenefit(user, body);
  }
  @Patch('benefits/:id')
  updateBenefit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: BenefitBody) {
    return this.svc.updateAllyBenefit(user, id, body);
  }
  @Patch('benefits/:id/status')
  toggleBenefit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: BenefitStatusBody) {
    return this.svc.updateAllyBenefit(user, id, { status: body.status });
  }
  @Get('benefits/:id/history')
  benefitHistory(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.listBenefitHistory(user, id);
  }
  @Delete('benefits/:id')
  deleteBenefit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteAllyBenefit(user, id);
  }

  // --- Canje por QR ---
  // Sedes del aliado (spec §5 y §9). Cada una con su geofence y mensaje.
  @Get('locations')
  locations(@CurrentUser() user: AuthUser) {
    return this.svc.listAllyLocations(user);
  }
  @Post('locations')
  createLocation(@CurrentUser() user: AuthUser, @Body() body: AllyLocationBody) {
    return this.svc.createAllyLocation(user, body);
  }
  @Patch('locations/:id')
  updateLocation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: AllyLocationBody,
  ) {
    return this.svc.updateAllyLocation(user, id, body);
  }
  @Delete('locations/:id')
  deleteLocation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteAllyLocation(user, id);
  }

  @Post('scan')
  scan(@CurrentUser() user: AuthUser, @Body() body: ScanBody) {
    return this.svc.scanMember(user, body.qrToken);
  }
  @Post('redeem')
  redeem(@CurrentUser() user: AuthUser, @Body() body: RedeemBody) {
    return this.svc.redeemBenefit(user, body);
  }
  @Get('redemptions')
  redemptions(@CurrentUser() user: AuthUser) {
    return this.svc.allyRedemptions(user);
  }

  // --- Sellos comunitarios (Fase 5) ---
  @Post('stamp')
  grantStamp(@CurrentUser() user: AuthUser, @Body() body: StampActionBody) {
    return this.svc.grantStamp(user, body);
  }
  @Post('stamp/redeem')
  redeemStamp(@CurrentUser() user: AuthUser, @Body() body: StampActionBody) {
    return this.svc.redeemStampReward(user, body);
  }
}
