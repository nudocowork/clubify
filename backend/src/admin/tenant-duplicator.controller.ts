import { Body, Controller, Param, Post } from '@nestjs/common';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { TenantDuplicatorService } from './tenant-duplicator.service';

// DTOs ANTES del @Controller (regla del codebase: hoisting de decorators).
class DuplicateTenantBody {
  @IsString() @MinLength(2) @MaxLength(80) newBrandName!: string;

  // Slug URL-safe: minúsculas, números y guiones. Bloqueamos el resto para
  // que el nuevo negocio sea ruteable como /m/<slug> sin ambigüedad.
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'El slug solo puede tener minúsculas, números y guiones',
  })
  newSlug!: string;

  @IsEmail() newOwnerEmail!: string;

  @IsOptional() @IsString() @MaxLength(30) newOwnerPhone?: string;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(72) newOwnerPassword?: string;

  @IsBoolean() includeDatabase!: boolean;

  // Si el email ya está en uso, el endpoint devuelve 409. El SUPER_ADMIN
  // reenvía con esta flag para forzar el duplicado.
  @IsOptional() @IsBoolean() allowDuplicateEmail?: boolean;
}

/**
 * POST /admin/tenants/:id/duplicate
 *
 * Duplica un negocio existente con 2 modalidades (config-only o full-DB).
 * Solo SUPER_ADMIN puede ejecutarlo. Devuelve un reporte step-by-step con
 * status individual; pasos individuales no abortan el proceso.
 */
@Controller('admin/tenants')
@Roles('SUPER_ADMIN')
export class TenantDuplicatorController {
  constructor(private svc: TenantDuplicatorService) {}

  @Post(':id/duplicate')
  duplicate(
    @Param('id') id: string,
    @Body() body: DuplicateTenantBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.duplicate({
      sourceTenantId: id,
      newBrandName: body.newBrandName,
      newSlug: body.newSlug,
      newOwnerEmail: body.newOwnerEmail,
      newOwnerPhone: body.newOwnerPhone ?? null,
      newOwnerPassword: body.newOwnerPassword ?? null,
      includeDatabase: !!body.includeDatabase,
      createdById: user.id,
      allowDuplicateEmail: !!body.allowDuplicateEmail,
    });
  }
}
