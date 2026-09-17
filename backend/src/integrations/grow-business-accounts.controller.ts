import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { GrowBusinessAccountsService } from './grow-business-accounts.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { resolveBrandScope } from '../common/white-label/brand-scope.util';

class CreateAccountDto {
  @IsString() @MinLength(2) name!: string;
  @IsString() @MinLength(3) locationId!: string;
  @IsString() @MinLength(10) apiKey!: string;
  @IsOptional() @IsInt() @Min(1) switchNumber?: number | null;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsString() purpose?: string;
}

class UpdateAccountDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() @MinLength(3) locationId?: string;
  @IsOptional() @IsString() @MinLength(10) apiKey?: string;
  @IsOptional() switchNumber?: number | null;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsString() purpose?: string;
}

/**
 * Subcuentas GLOBALES de Grow Business: son de la plataforma (Clubify) y la
 * tabla no tiene marca.
 *
 * `@Roles('SUPER_ADMIN', …)` no bastaba: un admin de marca blanca ES un
 * SUPER_ADMIN con `whiteLabelId`, así que el de Sellea podía listar, editar y
 * probar las subcuentas de Clubify. Ahora solo entra la plataforma: sesión sin
 * marca, o sesión DENTRO de Clubify — que es como trabaja hoy el operador:
 * «entra» a Clubify desde /superadmin y recibe un SUPER_ADMIN con el
 * `whiteLabelId` de Clubify (mismo criterio que `resolveBrandScope`).
 */
@Controller('admin/integrations/grow-business-accounts')
@Roles('SUPER_ADMIN', 'MARKETING')
export class GrowBusinessAccountsController {
  constructor(
    private svc: GrowBusinessAccountsService,
    private prisma: PrismaService,
  ) {}

  private async esPlataforma(user: AuthUser): Promise<boolean> {
    if (!user?.whiteLabelId) return true;
    const scope = await resolveBrandScope(this.prisma, user.whiteLabelId);
    return scope.isClubify;
  }

  private async soloPlataforma(user: AuthUser): Promise<void> {
    if (!(await this.esPlataforma(user))) {
      throw new ForbiddenException('Las subcuentas de Grow Business son de la plataforma.');
    }
  }

  /**
   * A una marca blanca se le responde con la lista VACÍA y no con un 403: la
   * ficha del negocio (`/admin/tenants/[id]`) carga este listado para elegir
   * subcuenta de alertas y con un 403 le saltaba un error en pantalla. Vacía
   * es además la verdad para ella: no tiene subcuentas globales aquí.
   */
  @Get()
  async list(@CurrentUser() user: AuthUser) {
    if (!(await this.esPlataforma(user))) return [];
    return this.svc.list();
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: CreateAccountDto) {
    await this.soloPlataforma(user);
    return this.svc.create(body);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateAccountDto,
  ) {
    await this.soloPlataforma(user);
    return this.svc.update(id, body);
  }

  @Post(':id/test')
  async test(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.soloPlataforma(user);
    return this.svc.test(id);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.soloPlataforma(user);
    return this.svc.remove(id);
  }
}
