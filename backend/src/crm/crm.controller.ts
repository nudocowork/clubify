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
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
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

class ContactCreateBody {
  @IsOptional() @IsString() stageId?: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(80) instagram?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
}

class ContactUpdateBody {
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(120)
  name?: string | null;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(40)
  phone?: string | null;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(80)
  instagram?: string | null;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(200)
  address?: string | null;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(4000)
  description?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
}

class ContactMoveBody {
  @IsString() stageId!: string;
}

class ButtonCreateBody {
  @IsString() @MaxLength(80) name!: string;
  @IsOptional() @IsString() @MaxLength(20) color?: string;
  @IsOptional() @IsString() @MaxLength(8) icon?: string;
  @IsString() channel!: 'SMS' | 'WHATSAPP' | 'EMAIL' | 'NOTE';
  @IsOptional() @IsString() @MaxLength(4000) messageBody?: string;
  @IsOptional() @IsString() @MaxLength(500) attachmentUrl?: string;
  @IsOptional() @IsString() @MaxLength(200) attachmentName?: string;
  @IsOptional() @IsString() moveToStageId?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) addTags?: string[];
  @IsOptional() delaySeconds?: number;
  @IsOptional() requiresConfirmation?: boolean;
}

class ButtonUpdateBody {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(20) color?: string;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(8)
  icon?: string | null;
  @IsOptional() @IsString() channel?: 'SMS' | 'WHATSAPP' | 'EMAIL' | 'NOTE';
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(4000)
  messageBody?: string | null;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(500)
  attachmentUrl?: string | null;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(200)
  attachmentName?: string | null;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString()
  moveToStageId?: string | null;
  @IsOptional() @IsArray() @IsString({ each: true }) addTags?: string[];
  @IsOptional() delaySeconds?: number;
  @IsOptional() requiresConfirmation?: boolean;
}

class ButtonReorderBody {
  @IsArray() @IsString({ each: true }) ids!: string[];
}

class ButtonExecuteBody {
  @IsString() contactId!: string;
}

class NoteAddBody {
  @IsString() @MaxLength(4000) body!: string;
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

  // ────────────── Contactos (C2) ──────────────

  /** Lista los contactos del user. Opcionalmente filtra por stageId
   *  (query param). El frontend del kanban (C3) puede usar esto para
   *  cargar todos a la vez y agruparlos client-side, o paginar por
   *  columna. */
  @Get('contacts')
  listContacts(
    @CurrentUser() user: AuthUser,
    @Query('stageId') stageId?: string,
  ) {
    return this.svc.listMyContacts(user, stageId);
  }

  @Get('contacts/:id')
  getContact(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.getContact(user, id);
  }

  @Post('contacts')
  createContact(
    @CurrentUser() user: AuthUser,
    @Body() body: ContactCreateBody,
  ) {
    return this.svc.createContact(user, body);
  }

  @Patch('contacts/:id/stage')
  moveContact(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: ContactMoveBody,
  ) {
    return this.svc.moveContactToStage(user, id, body.stageId);
  }

  @Patch('contacts/:id')
  updateContact(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: ContactUpdateBody,
  ) {
    return this.svc.updateContact(user, id, body);
  }

  @Delete('contacts/:id')
  deleteContact(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteContact(user, id);
  }

  // ────────────── Botones automáticos (C5) ──────────────

  @Get('buttons')
  listButtons(@CurrentUser() user: AuthUser) {
    return this.svc.listButtons(user);
  }

  @Post('buttons')
  createButton(
    @CurrentUser() user: AuthUser,
    @Body() body: ButtonCreateBody,
  ) {
    return this.svc.createButton(user, body);
  }

  // Reorder ANTES de :id por shadowing.
  @Patch('buttons/reorder')
  reorderButtons(
    @CurrentUser() user: AuthUser,
    @Body() body: ButtonReorderBody,
  ) {
    return this.svc.reorderButtons(user, body.ids);
  }

  @Patch('buttons/:id')
  updateButton(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: ButtonUpdateBody,
  ) {
    return this.svc.updateButton(user, id, body);
  }

  @Delete('buttons/:id')
  deleteButton(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.deleteButton(user, id);
  }

  @Post('buttons/:id/execute')
  executeButton(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: ButtonExecuteBody,
  ) {
    return this.svc.executeButton(user, id, body.contactId);
  }

  // ────────────── Historial / Actividades (C6) ──────────────

  /** Timeline del contacto: todas las actividades ordenadas por fecha
   *  desc. Solo el dueño del contacto puede leerlo. */
  @Get('contacts/:id/activities')
  listActivities(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.svc.listContactActivities(user, id);
  }

  /** Agrega una nota manual al contacto. Va al timeline como NOTE_ADDED. */
  @Post('contacts/:id/notes')
  addNote(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: NoteAddBody,
  ) {
    return this.svc.addNote(user, id, body.body);
  }
}
