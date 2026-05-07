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
import { Throttle } from '@nestjs/throttler';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, IsBoolean } from 'class-validator';
import { ReviewsService } from './reviews.service';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class SubmitDto {
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
  @IsOptional() @IsString() @MaxLength(80) customerName?: string;
  @IsOptional() @IsString() @MaxLength(40) customerPhone?: string;
  @IsOptional() @IsBoolean() redirectedToGoogle?: boolean;
}

@Controller()
export class ReviewsController {
  constructor(private svc: ReviewsService) {}

  // Público (review filter UI)
  @Public()
  @Get('public/r/:slug')
  getPublic(@Param('slug') slug: string) {
    return this.svc.getPublic(slug);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('public/r/:slug/submit')
  submit(@Param('slug') slug: string, @Body() body: SubmitDto) {
    return this.svc.submitPublic(slug, body);
  }

  // Panel del tenant
  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  @Get('reviews')
  list(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.listMine(user, tenantId);
  }

  @Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
  @Patch('reviews/:id/read')
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.markRead(user, id);
  }

  @Roles('TENANT_OWNER', 'SUPER_ADMIN')
  @Delete('reviews/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.remove(user, id);
  }
}
