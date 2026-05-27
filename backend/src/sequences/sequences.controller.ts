import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  SequenceMessageChannel,
  SequenceMessageType,
  SequenceStepKind,
  SequenceTriggerKind,
  SequenceWaitUnit,
} from '@prisma/client';
import { SequencesService } from './sequences.service';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

// ───────────── DTOs ─────────────

class StepBody {
  @IsOptional() @IsString() id?: string;
  @IsInt() @Min(0) order!: number;
  @IsEnum([
    'SEND_MESSAGE',
    'WAIT',
    'MOVE_STAGE',
    'ADD_TAG',
    'REMOVE_TAG',
    'ASSIGN_USER',
    'END',
  ])
  kind!: SequenceStepKind;

  @IsOptional() @IsEnum(['SMS', 'WHATSAPP'])
  messageChannel?: SequenceMessageChannel | null;
  @IsOptional() @IsEnum(['TEXT', 'AUDIO', 'VIDEO', 'PDF', 'IMAGE'])
  messageType?: SequenceMessageType | null;
  @IsOptional() @IsString() @MaxLength(4000)
  messageBody?: string | null;
  @IsOptional() @IsString() @MaxLength(600)
  attachmentUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(200)
  attachmentName?: string | null;

  @IsOptional() @IsInt() @Min(1)
  waitAmount?: number | null;
  @IsOptional() @IsEnum(['MINUTES', 'HOURS', 'DAYS', 'WEEKS'])
  waitUnit?: SequenceWaitUnit | null;

  @IsOptional() @IsString()
  moveToStageId?: string | null;

  @IsOptional() @IsArray() @IsString({ each: true })
  tags?: string[];

  @IsOptional() @IsString()
  assignToUserId?: string | null;

  @IsOptional() @IsNumber()
  nodeX?: number | null;
  @IsOptional() @IsNumber()
  nodeY?: number | null;
}

class TriggerBody {
  @IsOptional() @IsString() id?: string;
  @IsEnum([
    'MANUAL',
    'CONTACT_CREATED',
    'STAGE_CHANGED',
    'TAG_ADDED',
    'CONTACT_FROM_GB',
  ])
  kind!: SequenceTriggerKind;
  @IsOptional() @IsObject() config?: Record<string, any>;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class CreateSequenceBody {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => StepBody)
  steps?: StepBody[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TriggerBody)
  triggers?: TriggerBody[];
}

class UpdateSequenceBody {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => StepBody)
  steps?: StepBody[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TriggerBody)
  triggers?: TriggerBody[];
}

class EnrollBody {
  @IsString() contactId!: string;
}

// ───────────── Controller ─────────────

@Controller('crm/sequences')
@Roles(
  'AFFILIATE_INFLUENCER',
  'AFFILIATE_AMBASSADOR',
  'AFFILIATE_SOCIO',
  'SUPER_ADMIN',
)
export class SequencesController {
  constructor(private svc: SequencesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.svc.list(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.get(user.id, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateSequenceBody) {
    return this.svc.create(user.id, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateSequenceBody,
  ) {
    return this.svc.update(user.id, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.remove(user.id, id);
  }

  @Post(':id/duplicate')
  duplicate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.duplicate(user.id, id);
  }

  /**
   * Inscribir manualmente un contacto en la secuencia.
   * Triggers automáticos (CONTACT_CREATED/STAGE_CHANGED/etc) llegan en F3.
   */
  @Post(':id/enroll')
  enroll(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: EnrollBody,
  ) {
    return this.svc.enroll({
      sequenceId: id,
      contactId: body.contactId,
      triggerKind: 'MANUAL',
      actorUserId: user.id,
    });
  }

  // ─── Enrollment management ───

  @Get('enrollments/by-contact/:contactId')
  enrollmentsForContact(
    @CurrentUser() _user: AuthUser,
    @Param('contactId') contactId: string,
  ) {
    return this.svc.listEnrollmentsForContact(contactId);
  }

  @Post('enrollments/:enrollmentId/pause')
  pause(
    @CurrentUser() user: AuthUser,
    @Param('enrollmentId') enrollmentId: string,
  ) {
    return this.svc.pauseEnrollment(user.id, enrollmentId);
  }

  @Post('enrollments/:enrollmentId/resume')
  resume(
    @CurrentUser() user: AuthUser,
    @Param('enrollmentId') enrollmentId: string,
  ) {
    return this.svc.resumeEnrollment(user.id, enrollmentId);
  }

  @Post('enrollments/:enrollmentId/cancel')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('enrollmentId') enrollmentId: string,
  ) {
    return this.svc.cancelEnrollment(user.id, enrollmentId);
  }
}
