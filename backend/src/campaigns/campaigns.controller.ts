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
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CampaignStatus } from '@prisma/client';
import { CampaignsService } from './campaigns.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';

class CreateCampaignBody {
  @IsString() name!: string;
  @IsString() influencerName!: string;
  @IsString() influencerEmail!: string;
  @IsString() influencerWhatsapp!: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) influencerCommissionPercent?: number;
  @IsOptional() @IsString() influencerCustomCode?: string;
}

class UpdateCampaignBody {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEnum(CampaignStatus) status?: CampaignStatus;
}

class AmbassadorBody {
  @IsString() fullName!: string;
  @IsString() email!: string;
  @IsString() whatsapp!: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) commissionPercent?: number;
  @IsOptional() @IsString() customCode?: string;
}

@Controller('campaigns')
@Roles('SUPER_ADMIN')
export class CampaignsController {
  constructor(private svc: CampaignsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.svc.list(user);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.get(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateCampaignBody) {
    return this.svc.create(user, body as any);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateCampaignBody,
  ) {
    return this.svc.update(user, id, body);
  }

  @Post(':id/ambassadors')
  addAmbassador(
    @CurrentUser() user: AuthUser,
    @Param('id') campaignId: string,
    @Body() body: AmbassadorBody,
  ) {
    return this.svc.addAmbassador(user, campaignId, body);
  }

  @Delete('ambassadors/:id')
  removeAmbassador(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.removeAmbassador(user, id);
  }
}

class PublicApplyBody {
  @IsString() @MinLength(2) @MaxLength(120) fullName!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(8) @MaxLength(30) whatsapp!: string;
}

/**
 * Endpoints públicos para la landing /refer/[ownerCode] — cualquier
 * persona con el link puede ver info de la campaña y postularse como
 * embajador. Item 18 del spec ("autogeneración de embajadores").
 */
@Controller('public/campaigns')
export class PublicCampaignsController {
  constructor(private svc: CampaignsService) {}

  /** Lectura — más permisivo (60/min/IP) porque la landing puede ser
   *  refresheada o linkeada desde distintos lugares. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('by-owner-code/:code')
  byOwnerCode(@Param('code') code: string) {
    return this.svc.getPublicByOwnerCode(code);
  }

  /** Escritura — 5/min/IP. Si un atacante quiere crear muchos
   *  embajadores spam tiene que rotar IPs. Mejor que nada hasta que se
   *  agregue captcha. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('by-owner-code/:code/apply')
  apply(@Param('code') code: string, @Body() body: PublicApplyBody) {
    return this.svc.applyAsAmbassador(code, body);
  }
}
