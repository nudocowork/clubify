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
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { CategoriesService } from './categories.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class CategoryBody {
  @IsString() name!: string;
  @IsOptional() @IsUUID() parentId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() imageUrl?: string;
  // tagline acepta string o null (null para limpiar). MaxLength 200
  // por si el dueño se entusiasma — UI debería avisarle ~80.
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(200)
  tagline?: string | null;
  // coverConfig acepta cualquier objeto o null. Validación estructural
  // la hace el frontend (es una config visual flexible).
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsObject()
  coverConfig?: Record<string, any> | null;
}

class ReorderBody {
  @IsArray() ids!: string[];
}

@Controller('catalog/categories')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
export class CategoriesController {
  constructor(private svc: CategoriesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.list(user, tenantId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: CategoryBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.create(user, body, tenantId);
  }

  @Patch('reorder')
  reorder(@CurrentUser() user: AuthUser, @Body() body: ReorderBody) {
    return this.svc.reorder(user, body.ids);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: Partial<CategoryBody>,
  ) {
    return this.svc.update(user, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.remove(user, id);
  }
}
