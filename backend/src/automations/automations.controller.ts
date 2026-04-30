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
import { IsArray, IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';
import { AutomationsService } from './automations.service';
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

@Controller('automations')
@Roles('TENANT_OWNER', 'SUPER_ADMIN')
export class AutomationsController {
  constructor(private svc: AutomationsService) {}

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
