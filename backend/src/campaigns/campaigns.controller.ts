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
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { CampaignStatus } from '@prisma/client';
import { CampaignsService } from './campaigns.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

const ABSORPTIONS = ['ORIGINAL_PRICE', 'PAID_PRICE', 'EMPRESA_ABSORBS', 'PROPORTIONAL'] as const;

class CreateCampaignBody {
  @IsString() name!: string;
  @IsString() influencerName!: string;
  @IsString() influencerEmail!: string;
  @IsString() influencerWhatsapp!: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) influencerCommissionPercent?: number;
  @IsOptional() @IsString() influencerCustomCode?: string;
  @IsOptional() @IsIn(ABSORPTIONS as any) discountAbsorption?: string;
}

class UpdateCampaignBody {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEnum(CampaignStatus) status?: CampaignStatus;
  @IsOptional() @IsIn(ABSORPTIONS as any) discountAbsorption?: string;
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
