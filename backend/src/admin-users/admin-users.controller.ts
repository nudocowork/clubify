import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { randomBytes } from 'crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';

class CreateAdminBody {
  @IsString() fullName!: string;
  @IsEmail() email!: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() @MinLength(8) password?: string;
}

class UpdateAdminBody {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class ResetAdminPasswordBody {
  @IsOptional() @IsString() @MinLength(8) newPassword?: string;
}

function genTempPassword() {
  return randomBytes(8).toString('base64').replace(/[+/=]/g, '').slice(0, 10);
}

/**
 * CRUD de usuarios SUPER_ADMIN. Solo otro SUPER_ADMIN puede listar/crear/
 * editar/eliminar admins. Pensado para que el founder agregue más miembros
 * del equipo interno (soporte, ventas) que necesitan acceso al panel
 * /admin/* sin estar vinculados a un tenant.
 */
@Controller('admin/users')
@Roles('SUPER_ADMIN')
export class AdminUsersController {
  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
  ) {}

  @Get()
  async list() {
    return this.prisma.user.findMany({
      where: { role: 'SUPER_ADMIN' },
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        totpEnabledAt: true,
      },
    });
  }

  @Post()
  async create(@Body() body: CreateAdminBody) {
    const email = body.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestException('Ya existe un usuario con ese email');
    }
    const tempPassword = body.password?.trim() || genTempPassword();
    const passwordHash = await this.auth.hashPassword(tempPassword);
    const created = await this.prisma.user.create({
      data: {
        email,
        fullName: body.fullName.trim(),
        phone: body.phone?.trim() || null,
        passwordHash,
        role: 'SUPER_ADMIN',
        tenantId: null,
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        isActive: true,
        createdAt: true,
      },
    });
    // Devolvemos el tempPassword en la response — el creador se lo
    // comparte por canal seguro (Slack/WhatsApp). El admin nuevo está
    // obligado a habilitar 2FA en el primer login (flow ya existente).
    return { ...created, tempPassword };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateAdminBody,
  ) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target || target.role !== 'SUPER_ADMIN') {
      throw new NotFoundException();
    }
    if (target.id === user.id && body.isActive === false) {
      throw new BadRequestException('No puedes desactivarte a ti mismo');
    }
    // Si vamos a desactivar, asegurarse de que queda al menos un admin activo.
    if (body.isActive === false && target.isActive) {
      const remainingActive = await this.prisma.user.count({
        where: { role: 'SUPER_ADMIN', isActive: true, id: { not: id } },
      });
      if (remainingActive === 0) {
        throw new BadRequestException(
          'No puedes desactivar el último SUPER_ADMIN activo del sistema',
        );
      }
    }
    return this.prisma.user.update({
      where: { id },
      data: {
        fullName: body.fullName,
        phone: body.phone,
        isActive: body.isActive,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        isActive: true,
        lastLoginAt: true,
      },
    });
  }

  @Post(':id/reset-password')
  async resetPassword(
    @Param('id') id: string,
    @Body() body: ResetAdminPasswordBody,
  ) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target || target.role !== 'SUPER_ADMIN') {
      throw new NotFoundException();
    }
    const tempPassword = body.newPassword?.trim() || genTempPassword();
    const passwordHash = await this.auth.hashPassword(tempPassword);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash, passwordChangedAt: new Date() },
    });
    return { tempPassword };
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    if (id === user.id) {
      throw new BadRequestException('No puedes eliminarte a ti mismo');
    }
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target || target.role !== 'SUPER_ADMIN') {
      throw new NotFoundException();
    }
    const remainingActive = await this.prisma.user.count({
      where: { role: 'SUPER_ADMIN', isActive: true, id: { not: id } },
    });
    if (remainingActive === 0) {
      throw new BadRequestException(
        'No puedes eliminar el último SUPER_ADMIN activo del sistema',
      );
    }
    await this.prisma.user.delete({ where: { id } });
    return { ok: true };
  }
}
