import { Body, Controller, Get, Patch } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { SettingsService } from './settings.service';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class BrandingDto {
  @IsOptional() @IsString() appLogoUrl?: string | null;
  @IsOptional() @IsString() faviconUrl?: string | null;
  @IsOptional() @IsString() supportWhatsapp?: string | null;
}

@Controller()
export class SettingsController {
  constructor(private svc: SettingsService) {}

  /** Público — el frontend del panel y landing leen branding desde acá. */
  @Public()
  @Get('branding')
  getBranding() {
    return this.svc.getBranding();
  }

  /** Solo super admin puede cambiar el branding global. */
  @Patch('admin/branding')
  @Roles('SUPER_ADMIN')
  setBranding(@Body() body: BrandingDto) {
    return this.svc.setBranding(body);
  }
}
