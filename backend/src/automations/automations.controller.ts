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
  IsArray,
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { AutomationsService, AUTOMATION_TEMPLATES } from './automations.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class RuleBody {
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsObject() trigger!: any;
  @IsOptional() @IsArray() conditions?: any[];
  @IsArray() actions!: any[];
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class WorkflowBody {
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsString() triggerType!: string;
  @IsOptional() @IsNumber() triggerDays?: number;
  @IsArray() steps!: any[];
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller('automations')
@Roles('TENANT_OWNER', 'SUPER_ADMIN')
export class AutomationsController {
  constructor(private svc: AutomationsService) {}

  @Get('templates')
  templates() {
    return AUTOMATION_TEMPLATES;
  }

  @Post('from-template/:id')
  createFromTemplate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { cardId?: string },
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.createFromTemplate(user, id, body ?? {}, tenantId);
  }

  // ===== Workflows multipaso (Fase B) — rutas de 2 segmentos, no colisionan
  // con las de regla simple (:id de 1 segmento). =====
  @Get('workflows')
  listWorkflows(
    @CurrentUser() user: AuthUser,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.listWorkflows(user, tenantId);
  }

  @Post('workflows')
  createWorkflow(
    @CurrentUser() user: AuthUser,
    @Body() body: WorkflowBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.createWorkflow(user, body as any, tenantId);
  }

  @Patch('workflows/:id')
  updateWorkflow(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: Partial<WorkflowBody>,
  ) {
    return this.svc.updateWorkflow(user, id, body as any);
  }

  @Delete('workflows/:id')
  removeWorkflow(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.removeWorkflow(user, id);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.list(user, tenantId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: RuleBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.create(user, body, tenantId);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: Partial<RuleBody>,
  ) {
    return this.svc.update(user, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.remove(user, id);
  }
}
