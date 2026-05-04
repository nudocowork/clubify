import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { createHash, randomBytes } from 'crypto';
import { EmailService } from '../email/email.service';
import { welcomeOwnerTemplate, passwordResetTemplate } from '../email/templates/templates';

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private audit: AuditService,
    private email: EmailService,
  ) {}

  async login(email: string, password: string, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      this.audit.log({
        action: 'auth.login.failed',
        resource: `user:${email}`,
        ip,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) {
      this.audit.log({
        actorId: user.id,
        action: 'auth.login.failed',
        resource: `user:${user.id}`,
        ip,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    this.audit.log({
      actorId: user.id,
      tenantId: user.tenantId,
      action: 'auth.login',
      resource: `user:${user.id}`,
      ip,
    });

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    };

    const accessToken = this.jwt.sign(payload);
    const refreshToken = this.jwt.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh',
      expiresIn: process.env.JWT_REFRESH_EXPIRES ?? '30d',
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        tenantId: user.tenantId,
      },
    };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwt.verify(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh',
      });
      const newPayload = {
        sub: payload.sub,
        email: payload.email,
        role: payload.role,
        tenantId: payload.tenantId,
      };
      return { accessToken: this.jwt.sign(newPayload) };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async hashPassword(plain: string) {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  /**
   * Inicia el flow de password reset. SIEMPRE responde igual (incluso si el
   * email no existe) para no filtrar qué emails están registrados.
   */
  async requestPasswordReset(email: string) {
    const normalized = email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });

    if (user && user.isActive) {
      const rawToken = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min

      await this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      });

      const appUrl = process.env.APP_URL ?? 'https://soyclubify.com';
      const resetUrl = `${appUrl}/reset/${rawToken}`;

      this.email.send({
        to: user.email,
        ...passwordResetTemplate({
          fullName: user.fullName,
          resetUrl,
          expiresInMinutes: 30,
        }),
      });
    }

    return { ok: true };
  }

  async resetPassword(rawToken: string, newPassword: string) {
    if (newPassword.length < 8) {
      throw new BadRequestException('La contraseña debe tener al menos 8 caracteres');
    }
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Link inválido o expirado');
    }
    const passwordHash = await this.hashPassword(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      // Invalida tokens previos del mismo user (defensa en profundidad)
      this.prisma.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null, id: { not: record.id } },
        data: { usedAt: new Date() },
      }),
    ]);
    return { ok: true };
  }

  async signup(dto: {
    email: string;
    password: string;
    fullName: string;
    brandName: string;
    whatsappPhone?: string;
    referralCode?: string;
    plan?: string;
  }, ip?: string) {
    const email = dto.email.toLowerCase().trim();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email ya registrado');

    const brandName = dto.brandName.trim();
    if (!brandName) throw new BadRequestException('Nombre del negocio requerido');

    let slug = slugify(brandName) || `negocio-${Date.now()}`;
    let suffix = 0;
    while (await this.prisma.tenant.findUnique({ where: { slug } })) {
      suffix += 1;
      slug = `${slugify(brandName)}-${suffix}`;
    }

    // Selección de plan: Pro va sin trial (paga directo); Elite es default con
    // trial de 10 días. El frontend manda `plan: 'pro'` cuando el usuario
    // viene del CTA del plan Pro en el landing.
    const requestedPlan = (dto.plan ?? '').toLowerCase().trim();
    const isProSignup = requestedPlan === 'pro';
    const targetPlanName = isProSignup ? 'Pro' : 'Elite';

    const defaultPlan =
      (await this.prisma.plan.findUnique({ where: { name: targetPlanName } })) ??
      (await this.prisma.plan.findUnique({ where: { name: 'Elite' } })) ??
      (await this.prisma.plan.findFirst({ where: { isActive: true }, orderBy: { priceMonthly: 'asc' } }));
    if (!defaultPlan) throw new BadRequestException('No hay planes configurados');

    const passwordHash = await this.hashPassword(dto.password);

    // Pro = trial expirado al instante (debe pagar para usar la app);
    // Elite = 10 días de prueba.
    const TRIAL_DAYS = isProSignup ? 0 : 10;
    const trialStartedAt = new Date();
    const trialEndsAt = new Date(trialStartedAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

    const tenant = await this.prisma.tenant.create({
      data: {
        name: brandName,
        brandName,
        slug,
        email,
        whatsappPhone: dto.whatsappPhone?.trim() || null,
        status: 'TRIAL',
        planId: defaultPlan.id,
        trialStartedAt,
        trialEndsAt,
      },
    });

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName: dto.fullName.trim(),
        role: 'TENANT_OWNER',
        tenantId: tenant.id,
      },
    });

    this.audit.log({
      actorId: user.id,
      tenantId: tenant.id,
      action: 'auth.signup',
      resource: `tenant:${tenant.id}`,
      ip,
    });

    // Si vino con código de referido, registrar el ReferralUse para tracking
    // de comisiones. Best-effort: si el código no existe, ignorar silenciosamente.
    if (dto.referralCode) {
      const code = dto.referralCode.trim().toUpperCase();
      try {
        const ref = await this.prisma.referralCode.findUnique({ where: { code } });
        if (ref && ref.isActive) {
          await this.prisma.referralUse.create({
            data: {
              referralCodeId: ref.id,
              tenantId: tenant.id,
              status: 'SIGNED_UP',
            },
          });
        }
      } catch {
        /* noop */
      }
    }

    // Welcome email best-effort (no bloqueante)
    this.email.send({
      to: email,
      ...welcomeOwnerTemplate({
        tenant,
        fullName: dto.fullName.trim(),
        trialEndsAt,
        appUrl: process.env.APP_URL ?? 'https://soyclubify.com',
      }),
    });

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    };
    const accessToken = this.jwt.sign(payload);
    const refreshToken = this.jwt.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh',
      expiresIn: process.env.JWT_REFRESH_EXPIRES ?? '30d',
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        tenantId: user.tenantId,
      },
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        brandName: tenant.brandName,
      },
    };
  }
}
