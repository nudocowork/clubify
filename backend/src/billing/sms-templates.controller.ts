import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { SmsTemplatesService } from './sms-templates.service';
import { Roles } from '../common/decorators/roles.decorator';

/**
 * Gestión de plantillas SMS desde el SuperAdmin (Integraciones). PLATFORM_OWNER
 * y SUPER_ADMIN pueden leer/editar los textos que el sistema envía.
 */
@Controller('superadmin/sms-templates')
@Roles('SUPER_ADMIN', 'PLATFORM_OWNER')
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
