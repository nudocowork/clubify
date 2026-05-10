import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { StampAction } from '@prisma/client';
import { StampsService } from './stamps.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class StampBody {
  @IsUUID() passId!: string;
  @IsEnum(StampAction) action!: StampAction;
  @IsOptional() amount?: number;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsUUID() locationId?: string;
  // Requerido cuando se hace STAMP con amount>1 desde el escáner
  // (ver scanner.staffPin en super admin / settings).
  @IsOptional() @IsString() pin?: string;
  // Monto que el cliente pagó por la compra que motivó el scan.
  // Required en STAMP/VISIT para cards STAMPS/VISITS/HYBRID (validado en svc).
  // Solo informativo — no afecta la cantidad de sellos otorgados.
  @IsOptional() purchaseAmount?: number;
}

@Controller('stamps')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
export class StampsController {
  constructor(private svc: StampsService) {}

  @Post()
  record(@CurrentUser() user: AuthUser, @Body() body: StampBody) {
    return this.svc.record(user, body);
  }

  @Get('history/:passId')
  history(@CurrentUser() user: AuthUser, @Param('passId') passId: string) {
    return this.svc.history(user, passId);
  }
}
