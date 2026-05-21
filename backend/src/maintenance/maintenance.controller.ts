import { Body, Controller, Get, Patch } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';

/**
 * Endpoints SUPER_ADMIN para gestionar el modo mantenimiento.
 *
 * GET /admin/maintenance         → lee el estado actual (forceFresh: true
 *                                  para que el admin nunca vea cache stale)
 * PATCH /admin/maintenance       → setea enabled / message / until
 *
 * Estos endpoints están en la allowlist del MaintenanceGuard — siempre
 * funcionan, incluso con mantenimiento activo. Sino el SUPER_ADMIN se
 * quedaría encerrado afuera.
 */
@Controller('admin/maintenance')
@Roles('SUPER_ADMIN')
export class MaintenanceAdminController {
  constructor(private svc: MaintenanceService) {}

  @Get()
  status() {
    return this.svc.getStatus({ forceFresh: true });
  }

  @Patch()
  update(
    @Body()
    body: {
      enabled?: boolean;
      message?: string | null;
      until?: string | null;
    },
  ) {
    return this.svc.setStatus(body);
  }
}

/**
 * Endpoint PÚBLICO (sin auth) — el frontend lo consulta desde su
 * middleware Next.js para decidir si mostrar la página de mantenimiento.
 * Devuelve el mismo payload que el admin pero usa el cache de 30s
 * (no forceFresh) para que un site con tráfico no martirice el DB.
 */
@Controller('public/maintenance')
@Public()
export class MaintenancePublicController {
  constructor(private svc: MaintenanceService) {}

  @Get('status')
  status() {
    return this.svc.getStatus();
  }
}
