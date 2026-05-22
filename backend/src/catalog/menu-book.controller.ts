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
  IsBoolean,
  IsHexColor,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { MenuBookService } from './menu-book.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class SectionBody {
  @IsString() @MaxLength(80) title!: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class SectionPatchBody {
  @IsOptional() @IsString() @MaxLength(80) title?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class PageBody {
  @IsUrl({ require_tld: false }) imageUrl!: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() popupEnabled?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(120)
  popupTitle?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  popupDescription?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUrl({ require_tld: false })
  popupImageUrl?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(40)
  popupButtonText?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(500)
  popupButtonUrl?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsHexColor()
  popupButtonColor?: string | null;
}

class PagePatchBody {
  @IsOptional() @IsUrl({ require_tld: false }) imageUrl?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() popupEnabled?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(120)
  popupTitle?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  popupDescription?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUrl({ require_tld: false })
  popupImageUrl?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(40)
  popupButtonText?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(500)
  popupButtonUrl?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsHexColor()
  popupButtonColor?: string | null;
}

class ReorderBody {
  @IsArray() @IsString({ each: true }) ids!: string[];
}

/**
 * CRUD del menú visual tipo libro (FLIPBOOK). Endpoints admin scoped al
 * tenant del usuario actual (TENANT_OWNER/STAFF) o cualquiera vía
 * ?tenantId= para SUPER_ADMIN.
 */
@Controller('catalog/menu-book')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
export class MenuBookController {
  constructor(private svc: MenuBookService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.list(user, tenantId);
  }

  @Post('sections')
  createSection(
    @CurrentUser() user: AuthUser,
    @Body() body: SectionBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.createSection(user, body, tenantId);
  }

  @Patch('sections/:id')
  updateSection(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: SectionPatchBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.updateSection(user, id, body, tenantId);
  }

  @Delete('sections/:id')
  deleteSection(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.deleteSection(user, id, tenantId);
  }

  @Post('sections/reorder')
  reorderSections(
    @CurrentUser() user: AuthUser,
    @Body() body: ReorderBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.reorderSections(user, body.ids, tenantId);
  }

  @Post('sections/:sectionId/pages')
  createPage(
    @CurrentUser() user: AuthUser,
    @Param('sectionId') sectionId: string,
    @Body() body: PageBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.createPage(user, sectionId, body, tenantId);
  }

  @Patch('pages/:id')
  updatePage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: PagePatchBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.updatePage(user, id, body, tenantId);
  }

  @Delete('pages/:id')
  deletePage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.deletePage(user, id, tenantId);
  }

  @Post('sections/:sectionId/pages/reorder')
  reorderPages(
    @CurrentUser() user: AuthUser,
    @Param('sectionId') sectionId: string,
    @Body() body: ReorderBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.reorderPages(user, sectionId, body.ids, tenantId);
  }
}
