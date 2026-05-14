import { BadRequestException, ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { createHash, randomBytes } from 'crypto';
import { EmailService } from '../email/email.service';
import { AppConfigService } from '../common/config/app-config.service';
import { RefreshTokenService } from './refresh-token.service';
import { TwoFactorService } from './two-factor.service';
import {
  welcomeOwnerTemplate,
  passwordResetTemplate,
  inviteAffiliateTemplate,
} from '../email/templates/templates';
import {
  isValidCategorySlug,
  DEFAULT_CATEGORY_SLUG,
} from '../common/business-categories';

// Subdominios reservados por Clubify (no pueden ser tenant slugs porque
// chocan con app.soyclubify.com / api.soyclubify.com / etc.).
// MANTENER SINCRONIZADO con frontend/src/middleware.ts RESERVED_SUBS.
const RESERVED_SLUGS = new Set([
  'www',
  'app',
  'api',
  'admin',
  'docs',
  'help',
  'status',
  'mail',
  'cdn',
  'assets',
]);

function slugify(s: string) {
  const base = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
  // Si el slug resulta ser una palabra reservada, le añadimos un sufijo
  // numérico para evitar conflicto con subdominios del sistema.
  if (RESERVED_SLUGS.has(base)) return `${base}-1`;
  return base;
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
    private appConfig: AppConfigService,
    private refreshTokens: RefreshTokenService,
    private twoFactor: TwoFactorService,
  ) {
    const clientId = appConfig.get('GOOGLE_CLIENT_ID');
    this.googleClient = clientId ? new OAuth2Client(clientId) : null;
    if (!clientId) {
      this.logger.warn('GOOGLE_CLIENT_ID no configurado — login con Google deshabilitado');
    }
  }

  async login(
    email: string,
    password: string,
    ip?: string,
    opts: { scope?: 'scanner'; userAgent?: string } = {},
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

    // Si el usuario tiene 2FA activo, NO emitimos tokens todavía. Retornamos
    // un challengeToken corto (5 min) que el cliente debe canjear vía
    // POST /auth/2fa/challenge con el código TOTP. El challenge se firma
    // con JWT_REFRESH_SECRET para que NO sirva como accessToken (JwtStrategy
    // usa JWT_SECRET) ni como refreshToken (no está en la tabla RefreshToken).
    if (user.totpEnabledAt) {
      const challengeToken = this.jwt.sign(
        { sub: user.id, purpose: '2fa_challenge' },
        {
          secret: this.appConfig.JWT_REFRESH_SECRET,
          expiresIn: '5m',
        },
      );
      this.audit.log({
        actorId: user.id,
        tenantId: user.tenantId,
        action: 'auth.2fa.challenge.required',
        resource: `user:${user.id}`,
        ip,
      });
      return { requires2FA: true as const, challengeToken };
    }

    return this.issueSession(user, ip, {
      scope: opts.scope,
      userAgent: opts.userAgent,
      auditAction: 'auth.login',
    });
  }

  /**
   * Emite access + refresh tokens para un usuario ya autenticado. Centraliza
   * la firma de tokens y el persist del refresh para login/signup/google/2fa.
   */
  private async issueSession(
    user: {
      id: string;
      email: string;
      role: any;
      tenantId: string | null;
      fullName: string;
    },
    ip: string | undefined,
    opts: {
      scope?: 'scanner';
      userAgent?: string;
      auditAction: string;
    },
  ) {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    this.audit.log({
      actorId: user.id,
      tenantId: user.tenantId,
      action: opts.auditAction,
      resource: `user:${user.id}`,
      ip,
    });

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    };

    const accessToken =
      opts.scope === 'scanner'
        ? this.jwt.sign(payload, { expiresIn: '6h' })
        : this.jwt.sign(payload);
    const refreshToken = await this.refreshTokens.issue({
      userId: user.id,
      payload,
      ip: ip ?? null,
      userAgent: opts.userAgent ?? null,
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
   * Segundo paso del login cuando el usuario tiene 2FA activado. Valida el
   * challengeToken (TTL 5min) + el código TOTP, y emite los tokens reales.
   */
  async challenge2FA(
    challengeToken: string,
    totpCode: string,
    ip?: string,
    userAgent?: string,
  ) {
    if (!challengeToken || !totpCode) {
      throw new UnauthorizedException('Challenge inválido');
    }
    let payload: any;
    try {
      payload = this.jwt.verify(challengeToken, {
        secret: this.appConfig.JWT_REFRESH_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Challenge expirado, volvé a hacer login');
    }
    if (payload?.purpose !== '2fa_challenge' || !payload?.sub) {
      throw new UnauthorizedException('Challenge inválido');
    }

    const valid = await this.twoFactor.verify(payload.sub, totpCode);
    if (!valid) {
      this.audit.log({
        actorId: payload.sub,
        action: 'auth.2fa.challenge.failed',
        resource: `user:${payload.sub}`,
        ip,
      });
      throw new UnauthorizedException('Código TOTP inválido');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException();
    }

    return this.issueSession(user, ip, {
      userAgent,
      auditAction: 'auth.2fa.challenge.ok',
    });
  }

  /**
   * Login con Google: el frontend obtiene un ID token vía Google Identity
   * Services y nos lo pasa. Verificamos firma + audience contra GOOGLE_CLIENT_ID
   * y mapeamos por email a un User existente. NO creamos cuentas nuevas vía
   * Google — si el email no tiene cuenta, devolvemos 401 con mensaje claro.
   */
  async loginWithGoogle(idToken: string, ip?: string, userAgent?: string) {
    const googleClientId = this.appConfig.get('GOOGLE_CLIENT_ID');
    if (!this.googleClient || !googleClientId) {
      throw new BadRequestException(
        'Google login no está configurado en este entorno.',
      );
    }
    if (!idToken) throw new BadRequestException('idToken requerido');

    let payload: any = null;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: googleClientId,
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

    // Mismo gating de 2FA que el login con password.
    if (user.totpEnabledAt) {
      const challengeToken = this.jwt.sign(
        { sub: user.id, purpose: '2fa_challenge' },
        { secret: this.appConfig.JWT_REFRESH_SECRET, expiresIn: '5m' },
      );
      return { requires2FA: true as const, challengeToken };
    }

    return this.issueSession(user, ip, {
      userAgent,
      auditAction: 'auth.login.google',
    });
  }

  async refresh(
    refreshToken: string,
    ip?: string,
    userAgent?: string,
  ) {
    const { refreshToken: newRefresh, payload } = await this.refreshTokens.rotate(
      refreshToken,
      { ip: ip ?? null, userAgent: userAgent ?? null },
    );
    const accessToken = this.jwt.sign(payload);
    return { accessToken, refreshToken: newRefresh };
  }

  /** Logout: revoca el refresh actual. Idempotente. */
  async logout(refreshToken?: string) {
    if (refreshToken) {
      await this.refreshTokens.revokeOne(refreshToken);
    }
    return { ok: true };
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

      const appUrl = this.appConfig.APP_URL;
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

  /**
   * Invita a un afiliado (influencer/embajador) creando su User si no
   * existe, lo enlaza al ReferralCode, genera un token de set-password
   * con TTL largo (7 días) y manda email con link a /reset/{token}.
   *
   * Idempotente: si el User ya existe se reenvía el invite.
   * Retorna { token } solo en dev/log para inspección — el email es la
   * via canónica de entrega.
   */
  async inviteAffiliate(opts: {
    email: string;
    fullName: string;
    role: 'AFFILIATE_INFLUENCER' | 'AFFILIATE_AMBASSADOR' | 'AFFILIATE_SOCIO';
    referralCodeId: string;
    phone?: string;
  }) {
    const email = opts.email.toLowerCase().trim();

    let user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Password placeholder — el affiliate la define al aceptar el invite.
      const placeholderHash = await this.hashPassword(randomBytes(32).toString('hex'));
      user = await this.prisma.user.create({
        data: {
          email,
          fullName: opts.fullName,
          phone: opts.phone,
          passwordHash: placeholderHash,
          role: opts.role,
          isActive: true,
        },
      });
    } else if (
      user.role !== opts.role &&
      (user.role === 'AFFILIATE_INFLUENCER' ||
        user.role === 'AFFILIATE_AMBASSADOR' ||
        user.role === 'AFFILIATE_SOCIO')
    ) {
      // Si ya era affiliate pero con otro rol (ej: era embajador y ahora
      // se vuelve influencer titular), actualizamos el rol.
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { role: opts.role },
      });
    }

    // Linkear ReferralCode → User (solo si aún no estaba linkeado).
    await this.prisma.referralCode.update({
      where: { id: opts.referralCodeId },
      data: { ownerUserId: user.id },
    });

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7d
    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    const appUrl = this.appConfig.APP_URL;
    const inviteUrl = `${appUrl}/reset/${rawToken}?affiliate=1`;

    // Datos del código para el template (commission %, campaña, parent).
    const code = await this.prisma.referralCode.findUnique({
      where: { id: opts.referralCodeId },
      include: {
        parentCode: { select: { ownerName: true } },
        ownerOfCampaign: { select: { name: true } },
      },
    });

    this.email
      .send({
        to: user.email,
        ...inviteAffiliateTemplate({
          fullName: user.fullName,
          inviteUrl,
          role: opts.role,
          code: code?.code ?? '',
          commissionPercent: Number(code?.commissionPercent ?? 0),
          campaignName: code?.ownerOfCampaign?.name ?? null,
          parentName: code?.parentCode?.ownerName ?? null,
        }),
      })
      .catch((e) =>
        this.logger.warn(`Email de invite affiliate falló: ${e.message}`),
      );

    this.logger.log(
      `Invite affiliate enviado: ${email} role=${opts.role} (token expira en 7d)`,
    );

    return { ok: true, userId: user.id };
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
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        // passwordChangedAt fuerza que cualquier refresh emitido antes de
        // ahora sea rechazado (RefreshTokenService.rotate verifica iat).
        data: { passwordHash, passwordChangedAt: now },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: now },
      }),
      // Invalida tokens previos del mismo user (defensa en profundidad)
      this.prisma.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null, id: { not: record.id } },
        data: { usedAt: now },
      }),
    ]);

    // Revocar TODAS las sesiones activas del usuario (logout global). Si la
    // razón del reset fue robo de credenciales, esto cierra el agujero de
    // inmediato — los tokens existentes quedan inservibles.
    await this.refreshTokens.revokeAllForUser(record.userId);

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
    /** Token público de una Quote — viene del /q/<token> CTA. Si matchea,
     *  marcamos la cotización como convertida con el tenant recién creado. */
    quoteToken?: string;
    /** Atribución captada por RefCapture (slug `/ref/<slug>` + UTMs + referer
     *  externo). Se guarda en ReferralUse para análisis de fuente. */
    attribution?: {
      viaSlug?: string;
      utmSource?: string;
      utmMedium?: string;
      utmCampaign?: string;
      referer?: string;
    };
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
        const attr = dto.attribution ?? {};
        await this.prisma.referralUse.create({
          data: {
            referralCodeId: attributedReferralCodeId,
            tenantId: tenant.id,
            status: 'SIGNED_UP',
            viaSlug: attr.viaSlug?.toLowerCase().slice(0, 80) || null,
            utmSource: attr.utmSource?.slice(0, 80) || null,
            utmMedium: attr.utmMedium?.slice(0, 80) || null,
            utmCampaign: attr.utmCampaign?.slice(0, 80) || null,
            referer: attr.referer?.slice(0, 1000) || null,
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
        appUrl: this.appConfig.APP_URL,
      }),
    });

    // Atribución a Quote (signup vino vía /q/<token>). Fire-and-forget:
    // si el token no existe o la cotización ya estaba convertida, el
    // signup no falla. Idempotencia con `convertedAt: null` en where para
    // que un cliente que pase 2 veces por el flujo no pise la primera
    // atribución.
    if (dto.quoteToken) {
      const token = dto.quoteToken.trim();
      if (token.length >= 8 && token.length <= 64) {
        this.prisma.quote
          .updateMany({
            where: { publicToken: token, convertedAt: null },
            data: { convertedAt: new Date(), convertedToTenantId: tenant.id },
          })
          .catch(() => null);
      }
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    };
    const accessToken = this.jwt.sign(payload);
    const refreshToken = await this.refreshTokens.issue({
      userId: user.id,
      payload,
      ip: ip ?? null,
      userAgent: null,
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
