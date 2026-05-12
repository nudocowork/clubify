import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SupportService } from './support.service';
import { SettingsService } from '../settings/settings.service';
import { Roles } from '../common/decorators/roles.decorator';

class ChatMessageDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';
  @IsString() @MaxLength(2000) content!: string;
}

class AskDto {
  @IsString() @MaxLength(1000) question!: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  history?: ChatMessageDto[];
}

class KnowledgeBody {
  @IsString() title!: string;
  @IsString() content!: string;
  @IsOptional() @IsString() category?: string;
}

class KnowledgeUpdateBody {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class BulkImportBody {
  @IsString() @MaxLength(200_000) text!: string;
  @IsIn(['sections', 'paragraphs', 'whole']) mode!: 'sections' | 'paragraphs' | 'whole';
  @IsOptional() @IsString() @MaxLength(80) category?: string;
}

class MasterPromptBody {
  // Null o string vacío = limpiar el master prompt.
  @IsOptional() @IsString() @MaxLength(20_000) prompt?: string | null;
}

@Controller()
export class SupportController {
  constructor(
    private svc: SupportService,
    private settings: SettingsService,
  ) {}

  /**
   * Endpoint del widget — accesible para cualquier usuario logueado en
   * el panel (TENANT_OWNER, STAFF, SUPER_ADMIN). Throttled para evitar
   * abuso del Anthropic API.
   */
  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('support/ask')
  ask(@Body() body: AskDto) {
    return this.svc.ask(body.question, body.history ?? []);
  }

  // ----- Admin CRUD del knowledge base ----- //

  @Roles('SUPER_ADMIN')
  @Get('admin/knowledge')
  list() {
    return this.svc.list();
  }

  @Roles('SUPER_ADMIN')
  @Post('admin/knowledge')
  create(@Body() body: KnowledgeBody) {
    return this.svc.create(body);
  }

  @Roles('SUPER_ADMIN')
  @Patch('admin/knowledge/:id')
  update(@Param('id') id: string, @Body() body: KnowledgeUpdateBody) {
    return this.svc.update(id, body);
  }

  @Roles('SUPER_ADMIN')
  @Delete('admin/knowledge/:id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  /** Import masivo desde un documento pegado. Soporta 3 modos:
   *  sections (## headers), paragraphs, whole. Item 29 del spec —
   *  permite al admin subir un brief largo y partirlo en KnowledgeEntry
   *  sin tipear cada uno. */
  @Roles('SUPER_ADMIN')
  @Post('admin/knowledge/bulk-import')
  bulkImport(@Body() body: BulkImportBody) {
    return this.svc.bulkImport(body);
  }

  /** Master prompt opcional — texto libre que se prepone al system
   *  prompt del widget. Permite al admin inyectar instrucciones
   *  específicas sin redeploy. */
  @Roles('SUPER_ADMIN')
  @Get('admin/support/master-prompt')
  getMasterPrompt() {
    return this.settings.getSupportMasterPrompt();
  }

  @Roles('SUPER_ADMIN')
  @Patch('admin/support/master-prompt')
  setMasterPrompt(@Body() body: MasterPromptBody) {
    return this.settings.setSupportMasterPrompt(body.prompt ?? null);
  }
}
