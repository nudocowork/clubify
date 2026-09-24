import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { SmsTemplatesService } from './sms-templates.service';
import { Roles } from '../common/decorators/roles.decorator';
import { SoloPlataformaGuard } from '../common/guards/solo-plataforma.guard';

/**
 * Gestión de plantillas SMS desde el SuperAdmin (Integraciones). PLATFORM_OWNER
 * y SUPER_ADMIN pueden leer/editar los textos que el sistema envía.
 *
 * Estas son las plantillas GLOBALES (`sms.<id>`): las que recibe cualquier
 * cliente de una marca que no tenga texto propio. Las de una marca viven en
 * `sms.wl.<marca>.<id>` y se editan en su propia pantalla.
 *
 * Por eso solo la plataforma: el admin de una marca blanca es un SUPER_ADMIN
 * con `whiteLabelId` y, sin este candado, cambiaba el SMS que reciben los
 * clientes de TODAS las demás marcas (auditoría del 2026-09-24).
 */
@Controller('superadmin/sms-templates')
@Roles('SUPER_ADMIN', 'PLATFORM_OWNER')
@UseGuards(SoloPlataformaGuard)
export class SmsTemplatesController {
  constructor(private svc: SmsTemplatesService) {}

  @Get()
  list() {
    return this.svc.getAll();
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { text?: string }) {
    return this.svc.update(id, body?.text ?? '');
  }
}
