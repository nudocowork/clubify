import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { randomBytes } from 'crypto';
import { Role } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { EmailService } from '../email/email.service';
import { welcomeStaffTemplate } from '../email/templates/templates';

class InviteStaffBody {
  @IsString() fullName!: string;
  @IsEmail() email!: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsIn(['TENANT_OWNER', 'TENANT_STAFF']) role?: Role;
}

class UpdateStaffBody {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsIn(['TENANT_OWNER', 'TENANT_STAFF']) role?: Role;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class ChangePasswordBody {
  @IsString() currentPassword!: string;
  @IsString() @MinLength(8) newPassword!: string;
}

class ResetStaffPasswordBody {
  @IsOptional() @IsString() @MinLength(8) newPassword?: string;
}

function genTempPassword() {
  // 10-char URL-safe random password
  return randomBytes(8).toString('base64').replace(/[+/=]/g, '').slice(0, 10);
}

@Controller('tenants/me/staff')
@Roles('TENANT_OWNER')
export class StaffController {
  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
    private email: EmailService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException();
    const users = await this.prisma.user.findMany({
      where: { tenantId: user.tenantId },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
    return users;
  }

  @Post()
  async invite(@CurrentUser() user: AuthUser, @Body() body: InviteStaffBody) {
    if (!user.tenantId) throw new ForbiddenException();
    const existing = await this.prisma.user.findUnique({
      where: { email: body.email.toLowerCase() },
    });
    if (existing) throw new BadRequestException('Ya existe un usuario con ese email');
    const tempPassword = genTempPassword();
    const passwordHash = await this.auth.hashPassword(tempPassword);
    const created = await this.prisma.user.create({
      data: {
        tenantId: user.tenantId,
        email: body.email.toLowerCase(),
        fullName: body.fullName,
        phone: body.phone,
        passwordHash,
        role: body.role ?? 'TENANT_STAFF',
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    // Email de bienvenida con credencial temporal
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
    });
    if (tenant) {
      const tpl = welcomeStaffTemplate({
        tenant: {
          brandName: tenant.brandName,
          logoUrl: tenant.logoUrl,
          primaryColor: tenant.primaryColor,
          whatsappPhone: tenant.whatsappPhone,
          slug: tenant.slug,
        },
        fullName: created.fullName,
        email: created.email,
        tempPassword,
        loginUrl: `${process.env.APP_URL ?? 'http://localhost:4848'}/login`,
      });
      this.email
        .send({
          to: created.email,
          subject: tpl.subject,
          html: tpl.html,
          text: tpl.text,
        })
        .catch(() => null);
    }

    return { ...created, tempPassword };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateStaffBody,
  ) {
    if (!user.tenantId) throw new ForbiddenException();
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target || target.tenantId !== user.tenantId) {
      throw new NotFoundException();
    }
    if (target.id === user.id && body.role && body.role !== target.role) {
      throw new BadRequestException('No puedes cambiar tu propio rol');
    }
    if (target.id === user.id && body.isActive === false) {
      throw new BadRequestException('No puedes desactivarte a ti mismo');
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        fullName: body.fullName,
        phone: body.phone,
        role: body.role,
        isActive: body.isActive,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
      },
    });
    return updated;
  }

  @Post(':id/reset-password')
  async resetPassword(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: ResetStaffPasswordBody,
  ) {
    if (!user.tenantId) throw new ForbiddenException();
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target || target.tenantId !== user.tenantId) {
      throw new NotFoundException();
    }
    const tempPassword = body.newPassword ?? genTempPassword();
    const passwordHash = await this.auth.hashPassword(tempPassword);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash },
    });
    return { tempPassword };
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    if (!user.tenantId) throw new ForbiddenException();
    if (id === user.id) {
      throw new BadRequestException('No puedes eliminarte a ti mismo');
    }
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target || target.tenantId !== user.tenantId) {
      throw new NotFoundException();
    }
    await this.prisma.user.delete({ where: { id } });
    return { ok: true };
  }
}

@Controller('users/me/password')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'SUPER_ADMIN')
export class ChangePasswordController {
  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
  ) {}

  @Post()
  async change(@CurrentUser() user: AuthUser, @Body() body: ChangePasswordBody) {
    const u = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!u) throw new NotFoundException();
    const argon2 = await import('argon2');
    const ok = await argon2.verify(u.passwordHash, body.currentPassword);
    if (!ok) throw new BadRequestException('Contraseña actual incorrecta');
    const passwordHash = await this.auth.hashPassword(body.newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });
    return { ok: true };
  }
}
