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

@Controller()
export class SupportController {
  constructor(private svc: SupportService) {}

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
}
