import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { IsEmail, IsHexColor, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { WhiteLabelStatus } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { SuperAdminService } from './superadmin.service';

class WhiteLabelBody {
  @IsString() @MaxLength(80) name!: string;
  @IsOptional() @IsString() @MaxLength(80) slug?: string;
  @IsOptional() @IsString() @MaxLength(140) domain?: string;
  @IsOptional() @IsString() @MaxLength(140) appDomain?: string;
  @IsOptional() @IsHexColor() primaryColor?: string;
  @IsOptional() @IsString() @MaxLength(2) initial?: string;
  @IsOptional() @IsEmail() adminEmail?: string;
}

class StatusBody {
  @IsIn(['ACTIVE', 'SUSPENDED']) status!: WhiteLabelStatus;
}

/**
 * Endpoints del MasterAdmin (Nivel 1 / Plataforma).
 *
 * Solo accesibles para PLATFORM_OWNER. La ruta base es /superadmin
 * y queda completamente aislada de los endpoints de Tenant (Clubify
 * y demás marcas blancas).
 */
@Controller('superadmin')
@Roles('PLATFORM_OWNER')
export class SuperAdminController {
  constructor(private svc: SuperAdminService) {}

  @Get('dashboard')
  dashboard() {
    return this.svc.dashboard();
  }

  @Get('white-labels')
  listWhiteLabels() {
    return this.svc.listWhiteLabels();
  }

  @Get('white-labels/:id')
  getWhiteLabel(@Param('id') id: string) {
    return this.svc.getWhiteLabel(id);
  }

  @Post('white-labels')
  createWhiteLabel(@Body() body: WhiteLabelBody) {
    return this.svc.createWhiteLabel(body);
  }

  @Patch('white-labels/:id')
  updateWhiteLabel(@Param('id') id: string, @Body() body: Partial<WhiteLabelBody>) {
    return this.svc.updateWhiteLabel(id, body);
  }

  @Patch('white-labels/:id/status')
  setStatus(@Param('id') id: string, @Body() body: StatusBody) {
    return this.svc.setStatus(id, body.status);
  }
}
