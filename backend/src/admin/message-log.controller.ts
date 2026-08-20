import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';
import { MessageLogService } from './message-log.service';

const CHANNELS = new Set(['SMS', 'WhatsApp', 'Email']);
const STATUSES = new Set(['sent', 'failed']);

/**
 * Historial de envíos (SMS / WhatsApp / correo) para el panel /admin/mensajes.
 * Read-only: el log lo escribe GrowBusinessService al enviar; acá solo se lee.
 *
 * Acceso: PLATFORM_OWNER ve todo (y puede filtrar por marca vía
 * ?whiteLabelId); un SUPER_ADMIN de marca queda acotado a SU marca en el
 * service (el query param de marca se ignora para él). MARKETING queda fuera
 * a propósito: el historial trae correos y teléfonos de clientes reales.
 */
@Controller('admin/message-log')
@Roles('PLATFORM_OWNER', 'SUPER_ADMIN')
export class MessageLogController {
  constructor(private svc: MessageLogService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('whiteLabelId') whiteLabelId?: string,
    @Query('channel') channel?: string,
    @Query('status') status?: string,
    @Query('templateId') templateId?: string,
    @Query('tenantId') tenantId?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    // Valores fuera del enum → 400 explícito, no un filtro que "no matchea
    // nada" (un vacío falso acá se lee como «no se envió nada»).
    if (channel && !CHANNELS.has(channel)) {
      throw new BadRequestException(`Canal inválido: ${channel}`);
    }
    if (status && !STATUSES.has(status)) {
      throw new BadRequestException(`Estado inválido: ${status}`);
    }
    return this.svc.list(
      { role: user.role, whiteLabelId: user.whiteLabelId ?? null },
      {
        whiteLabelId: whiteLabelId || null,
        channel: channel || null,
        status: status || null,
        templateId: templateId || null,
        tenantId: tenantId || null,
        q: q || null,
        from: from || null,
        to: to || null,
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
      },
    );
  }

  /** Por plantilla: cuántos salieron y cuántos fallaron en el rango. */
  @Get('summary')
  summary(
    @CurrentUser() user: AuthUser,
    @Query('whiteLabelId') whiteLabelId?: string,
    @Query('channel') channel?: string,
    @Query('status') status?: string,
    @Query('templateId') templateId?: string,
    @Query('tenantId') tenantId?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (channel && !CHANNELS.has(channel)) {
      throw new BadRequestException(`Canal inválido: ${channel}`);
    }
    if (status && !STATUSES.has(status)) {
      throw new BadRequestException(`Estado inválido: ${status}`);
    }
    return this.svc.summary(
      { role: user.role, whiteLabelId: user.whiteLabelId ?? null },
      {
        whiteLabelId: whiteLabelId || null,
        channel: channel || null,
        status: status || null,
        templateId: templateId || null,
        tenantId: tenantId || null,
        q: q || null,
        from: from || null,
        to: to || null,
      },
    );
  }

  /** Opciones de los dropdowns (plantillas/negocios del alcance + marcas). */
  @Get('filters')
  filters(
    @CurrentUser() user: AuthUser,
    @Query('whiteLabelId') whiteLabelId?: string,
  ) {
    return this.svc.filterOptions(
      { role: user.role, whiteLabelId: user.whiteLabelId ?? null },
      whiteLabelId || null,
    );
  }
}
