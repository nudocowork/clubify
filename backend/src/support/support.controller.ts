import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
import { KnowledgeAudience } from '@prisma/client';
import { SupportService } from './support.service';
import { KnowledgeDocumentService } from './knowledge-document.service';
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
  // tenant = soporte producto (dueño / staff); affiliate = mentor de ventas
  // para afiliados (influencers / embajadores). Switchea system prompt.
  @IsOptional() @IsIn(['tenant', 'affiliate']) audience?: 'tenant' | 'affiliate';
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
    private docs: KnowledgeDocumentService,
    private settings: SettingsService,
  ) {}

  /**
   * Endpoint del widget — accesible para cualquier usuario logueado en
   * el panel (TENANT_OWNER, STAFF, SUPER_ADMIN). Throttled para evitar
   * abuso del Anthropic API.
   */
  @Roles(
    'TENANT_OWNER',
    'TENANT_STAFF',
    'SUPER_ADMIN',
    'AFFILIATE_INFLUENCER',
    'AFFILIATE_AMBASSADOR',
    'AFFILIATE_SOCIO',
  )
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('support/ask')
  ask(@Body() body: AskDto) {
    return this.svc.ask(body.question, body.history ?? [], body.audience ?? 'tenant');
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

  // ─── Documentos (Fase 5: RAG) ────────────────────────────────────── //

  @Roles('SUPER_ADMIN')
  @Get('admin/knowledge/documents')
  listDocs(@Query('audience') audience?: string) {
    return this.docs.list({
      audience: parseAudience(audience),
    });
  }

  @Roles('SUPER_ADMIN')
  @Post('admin/knowledge/documents')
  @UseInterceptors(FileInterceptor('file'))
  uploadDoc(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { title?: string; audience?: string; category?: string },
  ) {
    if (!file) throw new BadRequestException('Adjuntá un archivo');
    const aud = parseAudience(body.audience) ?? 'BOTH';
    return this.docs.uploadAndProcess({
      title: body.title || file.originalname.replace(/\.[^.]+$/, ''),
      audience: aud as KnowledgeAudience,
      category: body.category,
      file,
    });
  }

  @Roles('SUPER_ADMIN')
  @Delete('admin/knowledge/documents/:id')
  removeDoc(@Param('id') id: string) {
    return this.docs.remove(id);
  }

  @Roles('SUPER_ADMIN')
  @Patch('admin/knowledge/documents/:id/active')
  setDocActive(@Param('id') id: string, @Body() body: { isActive: boolean }) {
    return this.docs.setActive(id, !!body.isActive);
  }
}

function parseAudience(v?: string): KnowledgeAudience | undefined {
  if (!v) return undefined;
  const up = v.toUpperCase();
  if (up === 'TENANT' || up === 'AFFILIATE' || up === 'BOTH') {
    return up as KnowledgeAudience;
  }
  return undefined;
}
