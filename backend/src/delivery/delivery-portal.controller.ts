import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
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
  // Moto de la flota elegida al asignar (PDF245 P1). null = desasignar.
  @IsOptional() @IsString() @MaxLength(40) vehicleId?: string | null;
}

class VehicleBody {
  @IsString() @MinLength(1) @MaxLength(20) plate!: string;
  @IsString() @MinLength(1) @MaxLength(80) driverName!: string;
  @IsOptional() @IsString() @MaxLength(40) driverPhone?: string;
}

class VehicleUpdateBody {
  @IsOptional() @IsString() @MaxLength(20) plate?: string;
  @IsOptional() @IsString() @MaxLength(80) driverName?: string;
  @IsOptional() @IsString() @MaxLength(40) driverPhone?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class ChatBody {
  @IsString() @MinLength(1) @MaxLength(1000) body!: string;
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

  @Get('stats')
  stats(@CurrentUser() user: AuthUser) {
    return this.svc.getPortalStats(user);
  }

  @Get('deliveries')
  list(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.svc.listPortalDeliveries(user, status);
  }

  @Post('deliveries/:id/claim')
  claim(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.claimDelivery(user, id);
  }

  // ─── Flota de motos (PDF245 P1) ───
  @Get('vehicles')
  listVehicles(@CurrentUser() user: AuthUser) {
    return this.svc.listVehicles(user);
  }

  @Post('vehicles')
  createVehicle(@CurrentUser() user: AuthUser, @Body() body: VehicleBody) {
    return this.svc.createVehicle(user, body);
  }

  @Patch('vehicles/:id')
  updateVehicle(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: VehicleUpdateBody,
  ) {
    return this.svc.updateVehicle(user, id, body);
  }

  @Delete('vehicles/:id')
  removeVehicle(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.removeVehicle(user, id);
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

  // Chat del domicilio — lado empresa.
  @Get('deliveries/:id/chat')
  chatList(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.companyChatList(user, id);
  }

  @Post('deliveries/:id/chat')
  chatPost(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: ChatBody,
  ) {
    return this.svc.companyChatPost(user, id, body.body);
  }

  // ─── Chat directo POR NEGOCIO (PDF 1254): lista de chats + conversación ───
  @Get('business-chats')
  businessChats(@CurrentUser() user: AuthUser) {
    return this.svc.companyBusinessChats(user);
  }

  @Get('business-chats/:tenantId')
  businessChatList(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
  ) {
    return this.svc.companyBusinessChatList(user, tenantId);
  }

  @Post('business-chats/:tenantId')
  businessChatPost(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Body() body: ChatBody,
  ) {
    return this.svc.companyBusinessChatPost(user, tenantId, body.body);
  }
}
