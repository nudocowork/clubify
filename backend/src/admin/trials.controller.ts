import { Controller, Get, Query } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { TrialsService } from './trials.service';
import { Roles } from '../common/decorators/roles.decorator';

class ListQuery {
  @IsOptional()
  @IsIn(['active', 'expired', 'converted', 'all'])
  filter?: 'active' | 'expired' | 'converted' | 'all';
}

/**
 * Panel /admin/trials. SUPER_ADMIN + MARKETING (marketing tracks
 * adquisición y conversion por canal). Read-only — extender/convertir/
 * suspender se hace desde /admin/tenants/[id] (acciones existentes).
 */
@Controller('admin/trials')
@Roles('SUPER_ADMIN', 'MARKETING')
export class TrialsController {
  constructor(private svc: TrialsService) {}

  @Get()
  list(@Query() q: ListQuery) {
    return this.svc.list(q.filter);
  }

  @Get('metrics')
  metrics() {
    return this.svc.metrics();
  }
}
