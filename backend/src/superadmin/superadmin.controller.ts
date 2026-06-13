import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsEmail, IsHexColor, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
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

class AdjustCreditsBody {
  @IsString() whiteLabelId!: string;
  @IsInt() @Min(-1000000) @Max(1000000) amount!: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsIn(['PURCHASE', 'CONSUME', 'COMMIT', 'REFUND', 'ADJUSTMENT']) type?: any;
}

class HotmartLinkBody {
  @IsInt() @Min(1) credits!: number;
  @IsString() @MaxLength(120) label!: string;
  @IsString() @MaxLength(500) url!: string;
  @IsOptional() @IsNumber() price?: number | null;
  @IsOptional() @IsString() @MaxLength(8) currency?: string;
  @IsOptional() @IsInt() position?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
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

  // -------- Centro de Créditos --------

  @Get('credits')
  creditsCenter() {
    return this.svc.creditsCenter();
  }

  @Post('credits/adjust')
  adjust(@Body() body: AdjustCreditsBody) {
    return this.svc.adjustCredits(body);
  }

  // -------- Hotmart Links --------

  @Get('hotmart-links')
  listHotmartLinks() {
    return this.svc.listHotmartLinks();
  }

  @Post('hotmart-links')
  createHotmartLink(@Body() body: HotmartLinkBody) {
    return this.svc.createHotmartLink(body);
  }

  @Patch('hotmart-links/:id')
  updateHotmartLink(@Param('id') id: string, @Body() body: Partial<HotmartLinkBody>) {
    return this.svc.updateHotmartLink(id, body);
  }

  @Delete('hotmart-links/:id')
  removeHotmartLink(@Param('id') id: string) {
    return this.svc.removeHotmartLink(id);
  }
}
