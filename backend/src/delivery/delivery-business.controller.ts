import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { DeliveryService } from './delivery.service';

class ChatBody {
  @IsString() @MinLength(1) @MaxLength(1000) body!: string;
}

/**
 * Chat del domicilio — lado NEGOCIO (usuario del tenant). Scopeado al pedido
 * del propio negocio dentro del service. (Fase 3B)
 */
@Controller('delivery-business')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
export class DeliveryBusinessController {
  constructor(private svc: DeliveryService) {}

  @Get('orders/:orderId/chat')
  chatList(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string) {
    return this.svc.businessChatList(user, orderId);
  }

  @Post('orders/:orderId/chat')
  chatPost(
    @CurrentUser() user: AuthUser,
    @Param('orderId') orderId: string,
    @Body() body: ChatBody,
  ) {
    return this.svc.businessChatPost(user, orderId, body.body);
  }

  // ─── Canal directo con la empresa de domicilios asignada (PDF 1254) ───
  @Get('delivery-companies')
  companies(@CurrentUser() user: AuthUser) {
    return this.svc.businessDeliveryCompanies(user);
  }

  @Get('delivery-companies/:companyId/chat')
  companyChatList(
    @CurrentUser() user: AuthUser,
    @Param('companyId') companyId: string,
  ) {
    return this.svc.businessCompanyChatList(user, companyId);
  }

  @Post('delivery-companies/:companyId/chat')
  companyChatPost(
    @CurrentUser() user: AuthUser,
    @Param('companyId') companyId: string,
    @Body() body: ChatBody,
  ) {
    return this.svc.businessCompanyChatPost(user, companyId, body.body);
  }
}
