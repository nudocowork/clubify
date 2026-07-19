import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { AcademyService } from './academy.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class AcademyVideoBody {
  @IsOptional() @IsString() @MaxLength(500) youtubeUrl?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MaxLength(400) description?: string;
}

/** Academia — configuración de videos por MARCA. Solo el SUPER_ADMIN de la
 *  marca (aislado: el service scopea todo por su whiteLabelId). */
@Controller('academy')
@Roles('SUPER_ADMIN')
export class AcademyController {
  constructor(private svc: AcademyService) {}

  /** Videos configurados de la marca del admin. */
  @Get('videos')
  list(@CurrentUser() user: AuthUser) {
    return this.svc.listForBrand(user);
  }

  /** Guardar (upsert) el video de un módulo, en la marca del admin. */
  @Put('videos/:moduleKey')
  upsert(
    @CurrentUser() user: AuthUser,
    @Param('moduleKey') moduleKey: string,
    @Body() body: AcademyVideoBody,
  ) {
    return this.svc.upsert(user, moduleKey, body);
  }
}
