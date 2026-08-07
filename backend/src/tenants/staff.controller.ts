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
  @IsOptional() @IsIn(['TENANT_OWNER', 'TENANT_STAFF', 'TENANT_ORDERS']) role?: Role;
  // Fase F 2026-06-07: opcional; null = sin sede asignada / aplica a todas.
  @IsOptional() @IsString() locationId?: string | null;
}

class UpdateStaffBody {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsIn(['TENANT_OWNER', 'TENANT_STAFF', 'TENANT_ORDERS']) role?: Role;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() locationId?: string | null;
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
        locationId: true,
        location: { select: { id: true, name: true } },
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
    // Si viene locationId, validar que pertenezca al mismo tenant.
    if (body.locationId) {
      const loc = await this.prisma.location.findUnique({
        where: { id: body.locationId },
        select: { tenantId: true },
      });
      if (!loc || loc.tenantId !== user.tenantId) {
        throw new BadRequestException('La sede seleccionada no es válida');
      }
    }
    const created = await this.prisma.user.create({
      data: {
        tenantId: user.tenantId,
        email: body.email.toLowerCase(),
        fullName: body.fullName,
        phone: body.phone,
        passwordHash,
        role: body.role ?? 'TENANT_STAFF',
        isActive: true,
        locationId: body.locationId ?? null,
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
      const emailBrand = tenant.whiteLabelId
        ? await this.prisma.whiteLabel.findUnique({
            where: { id: tenant.whiteLabelId },
            select: { name: true },
          })
        : null;
      const tpl = welcomeStaffTemplate({
        tenant: {
          brandName: tenant.brandName,
          logoUrl: tenant.logoUrl,
          primaryColor: tenant.primaryColor,
          whatsappPhone: tenant.whatsappPhone,
          slug: tenant.slug,
        },
        brand: emailBrand?.name ? { name: emailBrand.name } : null,
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
    if (body.locationId) {
      const loc = await this.prisma.location.findUnique({
        where: { id: body.locationId },
        select: { tenantId: true },
      });
      if (!loc || loc.tenantId !== user.tenantId) {
        throw new BadRequestException('La sede seleccionada no es válida');
      }
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        fullName: body.fullName,
        phone: body.phone,
        role: body.role,
        isActive: body.isActive,
        // Permite explícitamente desasignar pasando null o '' (lo
        // normalizamos a null para no chocar con la FK).
        locationId:
          body.locationId === undefined
            ? undefined
            : body.locationId === null || body.locationId === ''
            ? null
            : body.locationId,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        locationId: true,
        location: { select: { id: true, name: true } },
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

  /**
   * Fase F 2026-06-07: ranking de sellos por miembro + por sede.
   * Por defecto últimos 30 días. Útil para que el TENANT_OWNER vea
   * desempeño de su equipo.
   */
  @Get('metrics')
  async metrics(@CurrentUser() user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException();
    const since = new Date(Date.now() - 30 * 86400_000);
    const [byMember, byLocation, staff, locations] = await Promise.all([
      this.prisma.stamp.groupBy({
        by: ['operatorId'],
        where: { tenantId: user.tenantId, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.stamp.groupBy({
        by: ['locationId'],
        where: { tenantId: user.tenantId, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.user.findMany({
        where: { tenantId: user.tenantId },
        select: {
          id: true,
          fullName: true,
          role: true,
          locationId: true,
          location: { select: { id: true, name: true } },
        },
      }),
      this.prisma.location.findMany({
        where: { tenantId: user.tenantId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const memberMap = new Map(staff.map((s) => [s.id, s]));
    const locMap = new Map(locations.map((l) => [l.id, l.name]));

    const memberRanking = byMember
      .map((row) => {
        const m = row.operatorId ? memberMap.get(row.operatorId) : null;
        return {
          userId: row.operatorId,
          fullName: m?.fullName ?? 'Sin operador',
          role: m?.role ?? null,
          locationId: m?.locationId ?? null,
          locationName: m?.location?.name ?? null,
          stamps: row._count._all,
        };
      })
      .sort((a, b) => b.stamps - a.stamps);

    const locationRanking = byLocation
      .map((row) => ({
        locationId: row.locationId,
        locationName: row.locationId
          ? locMap.get(row.locationId) ?? '—'
          : 'Sin sede',
        stamps: row._count._all,
      }))
      .sort((a, b) => b.stamps - a.stamps);

    return {
      sinceDays: 30,
      memberRanking,
      locationRanking,
      totalStamps: memberRanking.reduce((s, r) => s + r.stamps, 0),
    };
  }
}

@Controller('users/me/password')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'TENANT_ORDERS', 'SUPER_ADMIN')
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

class UpdateProfileBody {
  @IsOptional() @IsString() @MinLength(2) fullName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
}

@Controller('users/me')
@Roles('TENANT_OWNER', 'TENANT_STAFF', 'TENANT_ORDERS', 'SUPER_ADMIN')
export class UserMeController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async me(@CurrentUser() user: AuthUser) {
    const u = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        tenantId: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });
    if (!u) throw new NotFoundException();
    return u;
  }

  @Patch()
  async update(@CurrentUser() user: AuthUser, @Body() body: UpdateProfileBody) {
    if (body.email) {
      const email = body.email.toLowerCase().trim();
      const exists = await this.prisma.user.findFirst({
        where: { email, id: { not: user.id } },
      });
      if (exists) throw new BadRequestException('Ese email ya está en uso');
      body.email = email;
    }
    return this.prisma.user.update({
      where: { id: user.id },
      data: body,
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
      },
    });
  }
}
