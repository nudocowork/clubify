import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { SalesChatService } from './sales-chat.service';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

class MensajeBody {
  @IsString() @MaxLength(1200) body!: string;
  @IsOptional() @IsIn(['sms', 'whatsapp']) channel?: string;
}

class NotaBody {
  @IsString() @MaxLength(4000) body!: string;
}

/**
 * La conversación con un lead.
 *
 * Quién entra lo decide `resolveTeamAccess` dentro del servicio, como en todo
 * el módulo: leer requiere pertenecer al equipo, escribir requiere además un
 * rol que no sea de solo lectura.
 */
@Controller('sales-teams/:teamId/leads/:leadId/chat')
@Roles('PLATFORM_OWNER', 'SUPER_ADMIN', 'TENANT_OWNER', 'TENANT_STAFF')
export class SalesChatController {
  constructor(private svc: SalesChatService) {}

  @Get()
  conversacion(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('leadId') leadId: string,
  ) {
    return this.svc.conversacion(user, teamId, leadId);
  }

  @Post()
  enviar(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('leadId') leadId: string,
    @Body() body: MensajeBody,
  ) {
    return this.svc.enviar(user, teamId, leadId, body);
  }

  /** Nota que se lee en el hilo y NO sale a ninguna parte. */
  @Post('nota')
  nota(
    @CurrentUser() user: AuthUser,
    @Param('teamId') teamId: string,
    @Param('leadId') leadId: string,
    @Body() body: NotaBody,
  ) {
    return this.svc.notaInterna(user, teamId, leadId, body);
  }
}
