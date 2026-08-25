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
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { MenusService } from './menus.service';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class CrearMenuBody {
  @IsString() name!: string;
  // null explícito = carta sin sede asignada todavía.
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  locationId?: string | null;
  /** Copiar el catálogo de otra carta al crearla. */
  @IsOptional() @IsBoolean() duplicar?: boolean;
  /**
   * Qué carta copiar. **null = el menú principal**, que no es una fila sino
   * todo lo que tiene `menuId = null`. Omitir el campo con `duplicar: true`
   * copia el principal.
   */
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  duplicarDe?: string | null;
}

class EditarMenuBody {
  @IsOptional() @IsString() name?: string;
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsUUID()
  locationId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class BorrarMenuBody {
  /** El nombre exacto de la carta. Sin esto no se borra. */
  @IsString() confirmacion!: string;
}

/**
 * Cartas del negocio (una por sede).
 *
 * La función se habilita negocio por negocio desde el panel de admin
 * (`Tenant.multiMenuEnabled`): la inmensa mayoría tiene un solo menú y no
 * tiene por qué ver esta complejidad.
 */
@Controller('catalog/menus')
@Roles('TENANT_OWNER', 'SUPER_ADMIN')
export class MenusController {
  constructor(private svc: MenusService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('tenantId') tenantId?: string) {
    return this.svc.list(user, tenantId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: CrearMenuBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.create(user, body, tenantId);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: EditarMenuBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.update(user, id, body, tenantId);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: BorrarMenuBody,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.svc.remove(user, id, body?.confirmacion ?? '', tenantId);
  }
}
