import { BadRequestException, ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { createHash, randomBytes } from 'crypto';
import { EmailService } from '../email/email.service';
import { welcomeOwnerTemplate, passwordResetTemplate } from '../email/templates/templates';
import {
  isValidCategorySlug,
  DEFAULT_CATEGORY_SLUG,
} from '../common/business-categories';

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
  private logger = new Logger(AuthService.name);
  private googleClient: OAuth2Client | null;

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private audit: AuditService,
    private email: EmailService,
  ) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    this.googleClient = clientId ? new OAuth2Client(clientId) : null;
    if (!clientId) {
      this.logger.warn('GOOGLE_CLIENT_ID no configurado — login con Google deshabilitado');
    }
  }

  async login(
    email: string,
    password: string,
    ip?: string,
    opts: { scope?: 'scanner' } = {},
  ) {
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

    // Sesión "scanner" dura 6h (turno largo de cajero/staff que escanea
    // todo el día). Sesión normal usa el JWT_EXPIRES default.
    const accessToken =
      opts.scope === 'scanner'
        ? this.jwt.sign(payload, { expiresIn: '6h' })
        : this.jwt.sign(payload);
    const refreshToken = this.jwt.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh',
      expiresIn: process.env.JWT_REFRESH_EXPIRES ?? '30d',
    });

    return {
      accessToken,
      refreshToken,
      scope: opts.scope ?? 'default',
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        tenantId: user.tenantId,
      },
    };
  }

  /**
   * Login con Google: el frontend obtiene un ID token vía Google Identity
   * Services y nos lo pasa. Verificamos firma + audience contra GOOGLE_CLIENT_ID
   * y mapeamos por email a un User existente. NO creamos cuentas nuevas vía
   * Google — si el email no tiene cuenta, devolvemos 401 con mensaje claro.
   */
  async loginWithGoogle(idToken: string, ip?: string) {
    if (!this.googleClient || !process.env.GOOGLE_CLIENT_ID) {
      throw new BadRequestException(
        'Google login no está configurado en este entorno.',
      );
    }
    if (!idToken) throw new BadRequestException('idToken requerido');

    let payload: any = null;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (e: any) {
      this.logger.warn(`Google verifyIdToken failed: ${e?.message ?? e}`);
      throw new UnauthorizedException('Token de Google inválido');
    }

    const email = payload?.email?.toLowerCase();
    if (!email || payload?.email_verified === false) {
      throw new UnauthorizedException('Cuenta de Google sin email verificado');
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      this.audit.log({
        action: 'auth.login.google.failed',
        resource: `user:${email}`,
        ip,
        metadata: { reason: user ? 'inactive' : 'no_account' },
      });
      throw new UnauthorizedException(
        'No existe una cuenta de Clubify con este email. Pídele al dueño que te invite.',
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    this.audit.log({
      actorId: user.id,
      tenantId: user.tenantId,
      action: 'auth.login.google',
      resource: `user:${user.id}`,
      ip,
    });

    const tokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    };
    const accessToken = this.jwt.sign(tokenPayload);
    const refreshToken = this.jwt.sign(tokenPayload, {
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
    couponCode?: string;
    plan?: string;
    businessCategorySlug?: string;
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

    // Selección de plan. AMBOS PLANES requieren pago antes de usar la app
    // (decisión 2026-05-04 — eliminamos el trial de Elite). El lockscreen de
    // /app espera `hotmartSubscriberCode` antes de dejar entrar al panel.
    const requestedPlan = (dto.plan ?? '').toLowerCase().trim();
    const isProSignup = requestedPlan === 'pro';
    const targetPlanName = isProSignup ? 'Pro' : 'Elite';

    const defaultPlan =
      (await this.prisma.plan.findUnique({ where: { name: targetPlanName } })) ??
      (await this.prisma.plan.findUnique({ where: { name: 'Elite' } })) ??
      (await this.prisma.plan.findFirst({ where: { isActive: true }, orderBy: { priceMonthly: 'asc' } }));
    if (!defaultPlan) throw new BadRequestException('No hay planes configurados');

    const passwordHash = await this.hashPassword(dto.password);

    // Trial sin fecha — la "puerta" real es la verificación de tarjeta en
    // Hotmart (CardVerificationLockscreen). Dejamos `trialEndsAt = null`
    // para que el cron diario (que suspende TRIAL vencidos) NO suspenda
    // signups que están legítimamente en el lockscreen esperando pagar.
    const trialStartedAt = new Date();
    const trialEndsAt: Date | null = null;

    const businessCategorySlug =
      dto.businessCategorySlug && isValidCategorySlug(dto.businessCategorySlug)
        ? dto.businessCategorySlug
        : DEFAULT_CATEGORY_SLUG;

    // Creamos tenant + user en una transacción para que si dos signups
    // simultáneos con el mismo email pasan el findUnique check, el
    // segundo no deje un tenant huérfano cuando user.create falle con
    // P2002 (unique email). La transacción rollback el tenant también.
    let tenant: Awaited<ReturnType<typeof this.prisma.tenant.create>>;
    let user: Awaited<ReturnType<typeof this.prisma.user.create>>;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const t = await tx.tenant.create({
          data: {
            name: brandName,
            brandName,
            slug,
            email,
            whatsappPhone: dto.whatsappPhone?.trim() || null,
            businessCategorySlug,
            status: 'TRIAL',
            planId: defaultPlan.id,
            trialStartedAt,
            trialEndsAt,
          },
        });
        const u = await tx.user.create({
          data: {
            email,
            passwordHash,
            fullName: dto.fullName.trim(),
            role: 'TENANT_OWNER',
            tenantId: t.id,
          },
        });
        return { t, u };
      });
      tenant = result.t;
      user = result.u;
    } catch (e: any) {
      if (e?.code === 'P2002') {
        // Race condition: el user.create falló por email duplicado. La
        // transacción ya hizo rollback del tenant. Devolvemos el mismo
        // mensaje que el findUnique check de arriba.
        throw new ConflictException('Email ya registrado');
      }
      throw e;
    }

    this.audit.log({
      actorId: user.id,
      tenantId: tenant.id,
      action: 'auth.signup',
      resource: `tenant:${tenant.id}`,
      ip,
    });

    // Atribución promo: el cliente pudo venir con un cupón, un código de
    // referido directo, o ambos. Lookup tolerante (no falla el signup si
    // el código no existe).
    //
    // Lógica:
    //   - Si couponCode está, lo registramos como CouponUse e incrementamos
    //     useCount. Si el cupón está asociado a un ReferralCode, también
    //     creamos un ReferralUse para esa atribución.
    //   - Si además vino referralCode (manual + cupón mixto), prefiere el
    //     del cupón. Si no había cupón con atribución, usa el referralCode
    //     manual directamente.
    let attributedReferralCodeId: string | null = null;

    if (dto.couponCode) {
      const code = dto.couponCode.trim().toUpperCase();
      try {
        const coupon = await this.prisma.coupon.findUnique({ where: { code } });
        if (coupon && coupon.status === 'ACTIVE') {
          // Idempotente — único por (couponId, tenantId).
          await this.prisma.couponUse.create({
            data: { couponId: coupon.id, tenantId: tenant.id },
          });
          await this.prisma.coupon.update({
            where: { id: coupon.id },
            data: { useCount: { increment: 1 } },
          });
          if (coupon.referralCodeId) {
            attributedReferralCodeId = coupon.referralCodeId;
          }
        }
      } catch {
        /* noop */
      }
    }

    if (!attributedReferralCodeId && dto.referralCode) {
      const code = dto.referralCode.trim().toUpperCase();
      try {
        const ref = await this.prisma.referralCode.findUnique({ where: { code } });
        if (ref && ref.isActive) attributedReferralCodeId = ref.id;
      } catch {
        /* noop */
      }
    }

    if (attributedReferralCodeId) {
      try {
        await this.prisma.referralUse.create({
          data: {
            referralCodeId: attributedReferralCodeId,
            tenantId: tenant.id,
            status: 'SIGNED_UP',
          },
        });
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
