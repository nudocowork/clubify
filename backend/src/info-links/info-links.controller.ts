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
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { InfoLinksService } from './info-links.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class InfoLinkBody {
  @IsString() title!: string;
  @IsOptional() @IsString() subtitle?: string;
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsString() heroImageUrl?: string;
  @IsOptional() @IsArray() gallery?: string[];
  @IsOptional() @IsArray() sections?: any[];
  @IsOptional() @IsArray() buttons?: any[];
  @IsOptional() @IsObject() theme?: any;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller('info-links')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
export class InfoLinksController {
  constructor(private svc: InfoLinksService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.list(user, tenantId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.get(user, id);
  }

  @Get(':id/stats')
  stats(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.stats(user, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: InfoLinkBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.create(user, body, tenantId);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: Partial<InfoLinkBody>,
  ) {
    return this.svc.update(user, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.remove(user, id);
  }
}
