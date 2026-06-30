import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DeliveryStatus } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { DeliveryService } from './delivery.service';

class PortalDeliveryBody {
  @IsOptional() @IsString() @MaxLength(120) courierName?: string;
  @IsOptional() @IsString() @MaxLength(40) courierPhone?: string;
  @IsOptional() @IsString() @MaxLength(20) courierPlate?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100000) deliveryValue?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(600) etaMinutes?: number | null;
}

class PortalStatusBody {
  @IsIn([
    'WAITING_COURIER',
    'COURIER_ASSIGNED',
    'PICKED_UP',
    'ON_THE_WAY',
    'DELIVERED',
    'CANCELLED',
  ])
  status!: DeliveryStatus;
}

/**
 * Portal de la EMPRESA de domicilios (Fase 2). Solo role=DELIVERY_COMPANY.
 * Todo queda scopeado a `user.deliveryCompanyId` dentro del service.
 */
@Controller('delivery-portal')
@Roles('DELIVERY_COMPANY')
export class DeliveryPortalController {
  constructor(private svc: DeliveryService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.svc.getPortalContext(user);
  }

  @Get('deliveries')
  list(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.svc.listPortalDeliveries(user, status);
  }

  @Post('deliveries/:id/claim')
  claim(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.claimDelivery(user, id);
  }

  @Patch('deliveries/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: PortalDeliveryBody,
  ) {
    return this.svc.updatePortalDelivery(user, id, body);
  }

  @Patch('deliveries/:id/status')
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: PortalStatusBody,
  ) {
    return this.svc.transitionPortalStatus(user, id, body.status);
  }
}
