import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { CrmService } from './crm.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class StageCreateBody {
  @IsString() @MaxLength(60) name!: string;
  @IsOptional() @IsString() @MaxLength(20) color?: string;
}

class StageUpdateBody {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsString() @MaxLength(20) color?: string;
}

class StageReorderBody {
  @IsArray() @IsString({ each: true }) stageIds!: string[];
}

class PipelineRenameBody {
  @IsString() @MaxLength(80) name!: string;
}

/**
 * CRM (Bloque C — C1). Endpoints scoped al user actual: cada afiliado
 * tiene SU propio pipeline + stages. No hay path params de userId — el
 * pipeline se resuelve siempre desde el JWT.
 *
 * Roles permitidos: los 3 AFFILIATE_* + SUPER_ADMIN. SUPER_ADMIN entra
 * por ahora para poder probar/asistir; cuando agreguemos equipos en C4
 * dejaremos un endpoint admin separado para gestionar pipelines ajenos.
 */
@Controller('crm')
@Roles(
  'AFFILIATE_INFLUENCER',
  'AFFILIATE_AMBASSADOR',
  'AFFILIATE_SOCIO',
  'SUPER_ADMIN',
)
export class CrmController {
  constructor(private svc: CrmService) {}

  /** Devuelve el pipeline + stages del user. Auto-crea con 5 stages
   *  default si es el primer acceso. */
  @Get('pipeline')
  getMyPipeline(@CurrentUser() user: AuthUser) {
    return this.svc.ensureMyPipeline(user);
  }

  @Patch('pipeline')
  renamePipeline(
    @CurrentUser() user: AuthUser,
    @Body() body: PipelineRenameBody,
  ) {
    return this.svc.renamePipeline(user, body.name);
  }

  @Post('stages')
  createStage(
    @CurrentUser() user: AuthUser,
    @Body() body: StageCreateBody,
  ) {
    return this.svc.createStage(user, body);
  }

  // IMPORTANTE: las rutas con paths fijos (reorder) DEBEN ir antes que
  // las que usan path params (:id), sino NestJS captura "reorder" como
  // un id y la específica nunca se alcanza.
  @Patch('stages/reorder')
  reorderStages(
    @CurrentUser() user: AuthUser,
    @Body() body: StageReorderBody,
  ) {
    return this.svc.reorderStages(user, body.stageIds);
  }

  @Patch('stages/:id')
  updateStage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: StageUpdateBody,
  ) {
    return this.svc.updateStage(user, id, body);
  }

  @Delete('stages/:id')
  deleteStage(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteStage(user, id);
  }
}
