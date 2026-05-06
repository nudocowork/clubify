import { Controller, Get } from '@nestjs/common';
import { SystemHealthService } from './system-health.service';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('admin/system-health')
export class SystemHealthController {
  constructor(private svc: SystemHealthService) {}

  @Roles('SUPER_ADMIN')
  @Get()
  snapshot() {
    return this.svc.snapshot();
  }
}
