import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
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
import { PreregAlertsService } from './prereg-alerts.service';
import { GrowBusinessService } from '../integrations/grow-business.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { parsePlanPeriodLabel } from '../common/plan-period';
import {
  welcomeOwnerTemplate,
  passwordResetTemplate,
  inviteAffiliateTemplate,
} from '../email/templates/templates';
import { resolveBrandEmail } from '../email/brand-email';
import { BrandEmailService } from '../email/brand-email.service';
import {
  isValidCategorySlug,
  DEFAULT_CATEGORY_SLUG,
} from '../common/business-categories';
import { cycleCreditCost } from '../common/business-types';
// HotmartService se resuelve LAZY vía ModuleRef.get + require() inline
// (ver consumePendingForTenant en signup). NO importar acá estáticamente
// — el ciclo de archivos (auth.service ↔ hotmart.service via PreregAlerts)
// rompe la registración de AuthService al boot. Solo type import.
import type { HotmartService } from '../billing/hotmart.service';

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
    private brandEmail: BrandEmailService,
    private appConfig: AppConfigService,
    private refreshTokens: RefreshTokenService,
    private twoFactor: TwoFactorService,
    private preregAlerts: PreregAlertsService,
    private growBusiness: GrowBusinessService,
    private moduleRef: ModuleRef,
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
      whiteLabelId?: string | null;
      deliveryCompanyId?: string | null;
      allyBusinessId?: string | null;
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
      // Marca blanca propia del admin (relación WhiteLabelAdmin). Para
      // Clubify y owners de tenant es null = scope global. Propagarlo en el
      // login (no solo en impersonación) hace que el admin de una marca
      // blanca quede aislado a sus datos también en login directo.
      whiteLabelId: user.whiteLabelId ?? null,
      // Empresa de domicilios (role=DELIVERY_COMPANY). null = no aplica.
      deliveryCompanyId: user.deliveryCompanyId ?? null,
      // Negocio aliado (role=ALLY_BUSINESS). null = no aplica.
      allyBusinessId: user.allyBusinessId ?? null,
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
      throw new UnauthorizedException('Challenge expirado, vuelve a hacer login');
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
        'No existe una cuenta con este email. Pídele al dueño que te invite.',
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
   * Resuelve la GrowBusinessAccount default para SMS automatizados de la
   * plataforma (password reset SMS, etc). Mismo Setting que prereg-alerts.
   * Devuelve null si no hay account configurada — el caller decide qué hacer.
   */
  private async resolveDefaultSmsAccount() {
    const setting = await this.prisma.setting.findUnique({
      where: { key: 'prereg.alertAccountId' },
    });
    if (setting?.value) {
      const acc = await this.prisma.growBusinessAccount.findFirst({
        where: { id: setting.value, deletedAt: null },
        select: { id: true, locationId: true, apiKey: true, switchNumber: true },
      });
      if (acc) return acc;
    }
    return this.prisma.growBusinessAccount.findFirst({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, locationId: true, apiKey: true, switchNumber: true },
    });
  }

  /**
   * Inicia el flow de password reset POR SMS. Mismo principio que el email:
   * SIEMPRE responde igual aunque el teléfono no exista (anti-enumeration).
   * Genera un código numérico de 6 dígitos, hashea con SHA-256 y lo guarda
   * en PasswordResetToken con TTL 10 min. Envía el código por SMS vía la
   * subcuenta default de GrowBusiness.
   */
  /**
   * #2 (review): localizar al ÚNICO usuario activo cuyo teléfono (solo
   * dígitos) TERMINA EXACTAMENTE en `last10`. Antes se usaba
   * `phone: { contains: last10 }` — match por substring en cualquier
   * posición — y como `User.phone` NO es único, podía resolver al usuario
   * equivocado y mandar el código de reset a otra cuenta (account takeover).
   * Si hay 0 o 2+ coincidencias exactas devolvemos null (no revelamos, no
   * enviamos a nadie).
   */
  private async findUniqueUserByPhoneLast10(last10: string) {
    const candidates = await this.prisma.user.findMany({
      where: { phone: { contains: last10 }, isActive: true },
    });
    const exact = candidates.filter(
      (u) => (u.phone ?? '').replace(/\D/g, '').slice(-10) === last10,
    );
    return exact.length === 1 ? exact[0] : null;
  }

  /**
   * Nombre de la marca de un usuario (admin de marca → user.whiteLabelId;
   * dueño/staff de negocio → tenant.whiteLabel). Sin marca → "Clubify".
   * Se usa para que los SMS/mensajes de auth muestren la marca correcta y no
   * filtren "Clubify" a marcas blancas.
   */
  private async resolveBrandNameForUser(user: {
    whiteLabelId?: string | null;
    tenantId?: string | null;
  }): Promise<string> {
    if (user.whiteLabelId) {
      const wl = await this.prisma.whiteLabel.findUnique({
        where: { id: user.whiteLabelId },
        select: { name: true },
      });
      if (wl?.name?.trim()) return wl.name.trim();
    } else if (user.tenantId) {
      const t = await this.prisma.tenant.findUnique({
        where: { id: user.tenantId },
        select: { whiteLabel: { select: { name: true } } },
      });
      if (t?.whiteLabel?.name?.trim()) return t.whiteLabel.name.trim();
    }
    return 'Clubify';
  }

  async requestPasswordResetSms(phone: string) {
    const normalized = phone.replace(/\D/g, '').trim();
    if (normalized.length < 7) return { ok: true };

    const last10 = normalized.slice(-10);
    const user = await this.findUniqueUserByPhoneLast10(last10);

    if (user && user.phone) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const codeHash = createHash('sha256').update(code).digest('hex');
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: codeHash, expiresAt },
      });

      const account = await this.resolveDefaultSmsAccount();
      if (account) {
        // Marca del usuario: un admin/dueño de marca blanca (Sellea) debe ver
        // el nombre de SU marca, nunca "Clubify".
        const brandName = await this.resolveBrandNameForUser(user);
        const body =
          `Tu código para restablecer la contraseña en ${brandName} es: ${code}\n\n` +
          `Vence en 10 minutos. Si no fuiste tú, ignora este mensaje.`;
        try {
          await this.growBusiness.sendSmsWithCreds(
            {
              locationId: account.locationId,
              apiKey: account.apiKey,
              switchNumber: account.switchNumber,
            },
            user.phone,
            body,
          );
        } catch (e) {
          this.logger.warn(
            `SMS de password reset falló para ${user.id}: ${(e as Error).message}`,
          );
        }
      } else {
        this.logger.warn(
          `Sin GrowBusinessAccount configurada — no se envió SMS de password reset`,
        );
      }
    }

    return { ok: true };
  }

  /**
   * Verifica el código SMS + cambia la contraseña. El input es phone +
   * code (6 dígitos) + newPassword. Hashea el código y busca un token
   * vigente no usado para el user matching phone.
   */
  async resetPasswordWithSmsCode(phone: string, code: string, newPassword: string) {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('La contraseña debe tener al menos 8 caracteres');
    }
    const normalized = phone.replace(/\D/g, '').trim();
    if (normalized.length < 7) {
      throw new BadRequestException('Código inválido o vencido');
    }
    const last10 = normalized.slice(-10);
    const user = await this.findUniqueUserByPhoneLast10(last10);
    if (!user) throw new BadRequestException('Código inválido o vencido');

    const codeHash = createHash('sha256').update(code.trim()).digest('hex');
    const token = await this.prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        tokenHash: codeHash,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!token) throw new BadRequestException('Código inválido o vencido');

    const passwordHash = await this.hashPassword(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, passwordChangedAt: new Date() },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      }),
    ]);
    return { ok: true };
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

      // Marca blanca del usuario: el email de reset hereda su identidad
      // (nombre + color + logo) en vez de mostrar Clubify. Los admins de marca
      // la llevan en user.whiteLabelId; los dueños/staff de un negocio, vía su
      // tenant.whiteLabel. Sin marca → branding Clubify default.
      let brand:
        | { name: string; primaryColor?: string | null; logoUrl?: string | null }
        | null = null;
      if (user.whiteLabelId) {
        brand = await this.prisma.whiteLabel.findUnique({
          where: { id: user.whiteLabelId },
          select: { name: true, primaryColor: true, logoUrl: true },
        });
      } else if (user.tenantId) {
        const t = await this.prisma.tenant.findUnique({
          where: { id: user.tenantId },
          select: {
            whiteLabel: { select: { name: true, primaryColor: true, logoUrl: true } },
          },
        });
        brand = t?.whiteLabel ?? null;
      }

      this.email.send({
        to: user.email,
        ...passwordResetTemplate({
          fullName: user.fullName,
          resetUrl,
          expiresInMinutes: 30,
          brand,
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
    role:
      | 'AFFILIATE_INFLUENCER'
      | 'AFFILIATE_AMBASSADOR'
      | 'AFFILIATE_SOCIO'
      | 'AFFILIATE_VENDOR';
    referralCodeId: string;
    phone?: string;
    /** Si viene, se setea como password del User en vez de un placeholder
     *  random. El admin lo recibe en la response para compartirlo con el
     *  afiliado (no se envía email de reset). Útil para que el admin
     *  comparta credenciales directas vía WhatsApp / SMS / verbal. */
    presetPassword?: string;
  }): Promise<{ ok: true; userId: string; password: string | null }> {
    const email = opts.email.toLowerCase().trim();

    // Si admin pasó presetPassword, generamos su hash; sino, placeholder
    // random (flow tradicional vía email de reset).
    const usingPresetPassword = !!opts.presetPassword && opts.presetPassword.length >= 8;
    const passwordToHash = usingPresetPassword
      ? opts.presetPassword!
      : randomBytes(32).toString('hex');

    let user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      const hashed = await this.hashPassword(passwordToHash);
      user = await this.prisma.user.create({
        data: {
          email,
          fullName: opts.fullName,
          phone: opts.phone,
          passwordHash: hashed,
          role: opts.role,
          isActive: true,
        },
      });
    } else if (
      user.role === 'TENANT_OWNER' ||
      user.role === 'TENANT_STAFF' ||
      user.role === 'SUPER_ADMIN' ||
      user.role === 'MARKETING'
    ) {
      // ALTO #5 (2026-06-12): antes el caller (admin) NO sabía que el
      // email ya pertenecía a un user no-afiliado. La ReferralCode se
      // linkeaba al user existente silenciosamente → el TENANT_OWNER
      // pasaba a ser dueño de un code de afiliado sin ningún cambio
      // visible. Ahora bloqueamos explícito y dejamos que el admin
      // decida (usar otro email o re-crear el user).
      throw new ConflictException(
        `El email ${email} ya pertenece a un usuario ${user.role}. ` +
          `Usa otro email o elimina la cuenta existente primero.`,
      );
    } else if (
      user.role !== opts.role &&
      (user.role === 'AFFILIATE_INFLUENCER' ||
        user.role === 'AFFILIATE_AMBASSADOR' ||
        user.role === 'AFFILIATE_SOCIO' ||
        user.role === 'AFFILIATE_VENDOR')
    ) {
      // Si ya era affiliate pero con otro rol (ej: era embajador y ahora
      // se vuelve influencer titular), actualizamos el rol.
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { role: opts.role },
      });
    } else if (usingPresetPassword) {
      // User existente + admin pasó preset password → resetear password.
      // Equivale a un admin reset manual.
      const hashed = await this.hashPassword(passwordToHash);
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: hashed, passwordChangedAt: new Date() },
      });
    }

    // Linkear ReferralCode → User (solo si aún no estaba linkeado).
    await this.prisma.referralCode.update({
      where: { id: opts.referralCodeId },
      data: { ownerUserId: user.id },
    });

    // Si admin seteó password directo, NO mandamos email de reset.
    // El admin se encarga de compartir las credenciales (el password
    // viene en la response del endpoint que llamó esto).
    if (usingPresetPassword) {
      this.logger.log(
        `Afiliado creado con password directo: ${email} role=${opts.role}`,
      );
      return { ok: true, userId: user.id, password: passwordToHash };
    }

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7d
    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    const appUrl = this.appConfig.APP_URL;
    const inviteUrl = `${appUrl}/reset/${rawToken}?affiliate=1`;

    // Datos del código para el template (commission %, campaña, parent).
    // HOTFIX 2026-06-05 (bug #15): para role=VENDOR, el parent vive en
    // parentEmbajadorCode (no parentCode que es INFLUENCER→AMBASSADOR).
    // Antes el template caía al fallback "tu embajador" sin nombre.
    const code = await this.prisma.referralCode.findUnique({
      where: { id: opts.referralCodeId },
      include: {
        parentCode: { select: { ownerName: true } },
        parentEmbajadorCode: { select: { ownerName: true } },
        ownerOfCampaign: { select: { name: true } },
        // Marca del afiliado → el email de invitación hereda su branding
        // (Sellea), nunca Clubify. Clubify (o sin marca) cae al default.
        whiteLabel: { select: { slug: true, name: true, primaryColor: true, logoUrl: true } },
      },
    });
    const affiliateBrand =
      code?.whiteLabel && code.whiteLabel.slug !== 'clubify'
        ? {
            name: code.whiteLabel.name,
            primaryColor: code.whiteLabel.primaryColor,
            logoUrl: code.whiteLabel.logoUrl,
          }
        : null;

    const parentName =
      code?.role === 'VENDOR'
        ? code?.parentEmbajadorCode?.ownerName ?? null
        : code?.parentCode?.ownerName ?? null;

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
          parentName,
          brand: affiliateBrand,
        }),
      })
      .catch((e) =>
        this.logger.warn(`Email de invite affiliate falló: ${e.message}`),
      );

    this.logger.log(
      `Invite affiliate enviado: ${email} role=${opts.role} (token expira en 7d)`,
    );

    return { ok: true, userId: user.id, password: null };
  }

  /**
   * #12 (2026-06-16): MODIFICAR / RESETEAR la contraseña de un afiliado ya
   * existente desde el panel admin. Si el afiliado ya tiene cuenta de login
   * (ReferralCode.ownerUserId), actualizamos su passwordHash. Si todavía no
   * tiene cuenta (creado sin password), la creamos vía inviteAffiliate con la
   * password provista. Devuelve las credenciales para que el admin las comparta.
   */
  async setAffiliatePasswordByCode(
    referralCodeId: string,
    newPassword: string,
  ): Promise<{ email: string; password: string; loginUrl: string }> {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException(
        'La contraseña debe tener al menos 8 caracteres',
      );
    }
    const code = await this.prisma.referralCode.findUnique({
      where: { id: referralCodeId },
      select: {
        id: true,
        ownerUserId: true,
        ownerEmail: true,
        ownerName: true,
        ownerWhatsapp: true,
        role: true,
      },
    });
    if (!code) throw new NotFoundException('Código de afiliado no encontrado');

    const loginUrl = `${this.appConfig.APP_URL}/login`;

    // Caso 1: ya tiene cuenta de login → actualizamos su password.
    if (code.ownerUserId) {
      const user = await this.prisma.user.findUnique({
        where: { id: code.ownerUserId },
      });
      if (user) {
        const hashed = await this.hashPassword(newPassword);
        await this.prisma.user.update({
          where: { id: user.id },
          data: { passwordHash: hashed, passwordChangedAt: new Date() },
        });
        this.logger.log(
          `Password de afiliado modificada por admin: ${user.email}`,
        );
        return { email: user.email, password: newPassword, loginUrl };
      }
    }

    // Caso 2: aún no tiene cuenta de login → la creamos con esta password.
    const roleMap: Record<
      string,
      'AFFILIATE_INFLUENCER' | 'AFFILIATE_AMBASSADOR' | 'AFFILIATE_VENDOR' | 'AFFILIATE_SOCIO'
    > = {
      INFLUENCER: 'AFFILIATE_INFLUENCER',
      AMBASSADOR: 'AFFILIATE_AMBASSADOR',
      VENDOR: 'AFFILIATE_VENDOR',
      SOCIO: 'AFFILIATE_SOCIO',
    };
    const role = roleMap[code.role];
    if (!role) {
      throw new BadRequestException(
        'Este código no es un afiliado al que se le pueda crear cuenta',
      );
    }
    const res = await this.inviteAffiliate({
      email: code.ownerEmail,
      fullName: code.ownerName || code.ownerEmail,
      role,
      referralCodeId: code.id,
      phone: code.ownerWhatsapp || undefined,
      presetPassword: newPassword,
    });
    return {
      email: code.ownerEmail,
      password: res.password ?? newPassword,
      loginUrl,
    };
  }

  /**
   * Emite accessToken + refreshToken para un userId existente, saltando
   * password check. Usado SOLO por flows internos que ya validaron la
   * autorización por su cuenta (ej: self-register de vendedor desde
   * `/seller/register/<code>` después de validar el embajador). El user
   * que se loguea NUNCA es el caller — siempre es el dueño del userId.
   */
  async issueAuthTokensForUserId(userId: string, ip: string | null) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        tenantId: true,
        whiteLabelId: true,
        isActive: true,
      },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Usuario no encontrado o inactivo');
    }
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      whiteLabelId: user.whiteLabelId ?? null,
    };
    const accessToken = this.jwt.sign(payload);
    const refreshToken = await this.refreshTokens.issue({
      userId: user.id,
      payload,
      ip,
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
    };
  }

  /** Helper público: genera una contraseña random legible (10 chars
   *  alfanuméricos sin caracteres ambiguos). Útil para que el admin la
   *  comparta verbalmente sin confusiones de O/0 o l/1/I. */
  generateReadablePassword(length: number = 10): string {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz';
    const bytes = randomBytes(length);
    let pwd = '';
    for (let i = 0; i < length; i++) {
      pwd += alphabet[bytes[i] % alphabet.length];
    }
    return pwd;
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

  /**
   * Devuelve el AuthUser enriquecido con preferredLocale. Llamado
   * desde GET /auth/me — el frontend hidrata el i18n provider con
   * este valor al login para que el idioma elegido siga al user.
   */
  async meWithPreferredLocale(user: AuthUser): Promise<AuthUser & { preferredLocale: string | null }> {
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { preferredLocale: true },
    });
    return { ...user, preferredLocale: row?.preferredLocale ?? null };
  }

  /**
   * Persiste la elección de idioma del user. El DTO ya validó el enum
   * ('es' | 'en' | 'pt') a nivel controller. Idempotente — actualizar
   * con el mismo valor no rompe nada.
   */
  async updatePreferredLocale(
    userId: string,
    locale: 'es' | 'en' | 'pt' | 'en-GB' | 'en-US' | 'pt-BR',
  ) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { preferredLocale: locale },
    });
    return { ok: true, locale };
  }

  /**
   * Devuelve datos del PendingHotmartPayment para el email dado, para
   * que /activar pre-llene el form. Endpoint público — devolvemos
   * `{ found: false }` cuando no hay match para no filtrar via 404
   * la existencia de emails. El comprador llegó con `?email=` desde el
   * WhatsApp/SMS/email de recuperación post-pago Hotmart (2026-06-11).
   */
  async checkPendingPayment(emailRaw: string): Promise<{
    found: boolean;
    buyerName?: string | null;
    buyerPhone?: string | null;
    productName?: string | null;
    purchaseValue?: number | null;
    purchaseCurrency?: string | null;
    periodicity?: 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL' | null;
  }> {
    const email = String(emailRaw ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return { found: false };
    }
    const pending = await this.prisma.pendingHotmartPayment.findFirst({
      where: { email, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!pending) return { found: false };

    const raw = (pending.rawPayload ?? {}) as any;
    const buyer = raw?.data?.buyer ?? {};
    const purchase = raw?.data?.purchase ?? {};
    const product = raw?.data?.product ?? {};
    const value =
      Number(purchase?.price?.value) ||
      Number(purchase?.original_offer_price?.value) ||
      null;
    // Fix 2026-06-12: la moneda viene en el payload, no asumir USD.
    // Fix 2026-08-18: en producción Hotmart la manda como `currency_value`
    // (ej. {"value":148.55,"currency_value":"USD"}); leyendo solo
    // `currency_code` esto quedaba SIEMPRE null y el guard de moneda de abajo
    // no filtraba nada → un pago en COP (541498) se leía como plan ANUAL.
    const purchaseCurrency =
      (purchase?.price?.currency_code ??
        purchase?.price?.currency_value ??
        purchase?.original_offer_price?.currency_code ??
        purchase?.original_offer_price?.currency_value ??
        null) as string | null;

    // Periodicidad para el pre-fill del form. Orden de confianza:
    //   1. subscription.plan.name — el plan REAL ("Plan Trimestral 150 USD").
    //   2. product.name — genérico en la práctica, pero barato de chequear.
    //   3. monto vs landing plans (~68/150/278/500 USD), solo si la moneda es USD.
    //
    // Fix 2026-08-18: antes solo se miraba (2), y el producto de Clubify se
    // llama "CLUBIFY - TARJETAS DE FIDELIZACION" — sin ninguna palabra de
    // periodicidad. O sea que SIEMPRE caía a adivinar por monto, y si el
    // comprador ni siquiera pasaba por acá el alta quedaba con
    // planPeriodicity=null (caso El Arrayán express). Esto ya no es la única
    // defensa: activatePurchase también deriva la periodicidad del payload y
    // la persiste. Acá sigue siendo solo el pre-fill de la UI.
    const planName: string = String(raw?.data?.subscription?.plan?.name ?? '');
    const productName: string = String(product?.name ?? '');
    let periodicity: 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL' | null =
      parsePlanPeriodLabel(planName) ?? parsePlanPeriodLabel(productName);
    if (
      !periodicity &&
      value != null &&
      (purchaseCurrency === 'USD' || !purchaseCurrency)
    ) {
      // Heurística por monto SOLO si la moneda es USD (que es donde los
      // landing plans fueron definidos: 68/150/278/500). En COP/BRL/etc
      // el monto convertido no matchea, así que dejamos `periodicity`
      // en null y el frontend cae al picker normal.
      if (value >= 400) periodicity = 'ANUAL';
      else if (value >= 250) periodicity = 'SEMESTRAL';
      else if (value >= 120) periodicity = 'TRIMESTRAL';
      else if (value > 0) periodicity = 'MENSUAL';
    }

    return {
      found: true,
      buyerName: buyer?.name ?? null,
      buyerPhone: buyer?.checkout_phone ?? buyer?.phone ?? null,
      productName: productName || null,
      purchaseValue: value,
      purchaseCurrency,
      periodicity,
    };
  }

  /** Resuelve la marca (whiteLabelId) de un negocio que se da de alta por
   *  signup público. Prioridad: dominio del Origin → pago Stripe pendiente por
   *  email → código de referido de una marca. Devuelve null para Clubify (su
   *  scope incluye los tenants con whiteLabelId null). */
  private async resolveSignupWhiteLabelId(args: {
    email: string;
    referralCode?: string;
    origin?: string;
  }): Promise<string | null> {
    const normHost = (s?: string | null) =>
      (s ?? '')
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .split('/')[0]
        .split(':')[0]
        .replace(/^www\./, '');

    // 1. Dominio (Origin del navegador): el panel/landing de la marca corre en
    //    su propio dominio. Cubre pagar→datos y datos→pago.
    const host = normHost(args.origin);
    if (
      host &&
      host !== 'localhost' &&
      !host.startsWith('127.') &&
      !host.endsWith('soyclubify.com') &&
      !host.endsWith('clubify.app')
    ) {
      try {
        const wls = await this.prisma.whiteLabel.findMany({
          select: { id: true, slug: true, domain: true, appDomain: true },
        });
        const match = wls.find(
          (w) => normHost(w.domain) === host || normHost(w.appDomain) === host,
        );
        if (match && match.slug !== 'clubify') return match.id;
      } catch {
        /* noop */
      }
    }

    // 2. Pago Stripe pendiente por email (marcas con Stripe, ej. Sellea).
    const e = (args.email ?? '').trim().toLowerCase();
    if (e) {
      const pending = await this.prisma.pendingStripePayment
        .findFirst({
          where: { email: e, consumedAt: null },
          orderBy: { createdAt: 'desc' },
          select: { whiteLabelId: true },
        })
        .catch(() => null);
      if (pending?.whiteLabelId) return pending.whiteLabelId;
    }

    // 3. Código de referido que pertenece a una marca (no Clubify).
    if (args.referralCode) {
      const code = args.referralCode.trim().toUpperCase();
      const ref = await this.prisma.referralCode
        .findUnique({
          where: { code },
          select: { whiteLabel: { select: { id: true, slug: true } } },
        })
        .catch(() => null);
      if (ref?.whiteLabel && ref.whiteLabel.slug !== 'clubify') {
        return ref.whiteLabel.id;
      }
    }

    // 4. Clubify (default): ID EXPLÍCITO, no null. FIX PDF 1254: antes los
    // signups de Clubify quedaban con whiteLabelId=null y algunas vistas los
    // contaban y otras no (Samuel 56 vs Javier 54, faltaba Veterinaria Moran).
    // Con el ID explícito, TODOS los tenants tienen marca y el conteo es
    // consistente. El scope de Clubify ya matchea id + null, así que no rompe
    // nada legacy.
    const clubify = await this.prisma.whiteLabel
      .findFirst({ where: { slug: 'clubify' }, select: { id: true } })
      .catch(() => null);
    return clubify?.id ?? null;
  }

  async signup(dto: {
    email: string;
    password: string;
    fullName: string;
    brandName: string;
    whatsappPhone?: string;
    referralCode?: string;
    plan?: string;
    /** Periodicidad elegida en la landing. Informativo (no afecta billing). */
    planPeriodicity?: 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';
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
  }, ip?: string, origin?: string) {
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

    // Plan único: Elite. El parámetro `dto.plan` se ignora desde 2026-05-16
    // (Pro descontinuado). Pago inmediato — el lockscreen de /app espera
    // `hotmartSubscriberCode` antes de dejar entrar al panel.
    void dto.plan;
    const defaultPlan =
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
    // MARCA del negocio: heredada por dominio (Origin) → pago Stripe pendiente
    // → código de referido. Sin esto el tenant quedaba whiteLabelId=null → lo
    // veía Clubify y, para marcas con Stripe (ej. Sellea), consumePendingForTenant
    // abortaba (exige tenant.whiteLabelId) y el pago NUNCA activaba la cuenta.
    // Clubify se mantiene en null (su scope incluye los null).
    const signupWhiteLabelId = await this.resolveSignupWhiteLabelId({
      email,
      referralCode: dto.referralCode,
      origin,
    });

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
            planPeriodicity: dto.planPeriodicity ?? null,
            whiteLabelId: signupWhiteLabelId,
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

    // Atribución: si el cliente vino con un código de referido (link
    // /ref/<slug> o tipeado), lo resolvemos para crear el ReferralUse.
    // Lookup tolerante — no falla el signup si el código no existe.
    let attributedReferralCodeId: string | null = null;

    if (dto.referralCode) {
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

    // Flujo "pago → datos": si el cliente pagó en Hotmart ANTES de crear
    // la cuenta (eligió plan → pagó → recién ahora llena sus datos), el
    // webhook ya guardó un PendingHotmartPayment por su email. Lo
    // consumimos AHORA — después de crear tenant+user+ReferralUse — para
    // activar el tenant al instante (status ACTIVE + comisión del
    // referido). Si no hay pago pendiente (flujo normal datos→pago, o
    // visita directa a /activar), la cuenta queda en TRIAL bloqueada y el
    // webhook la activará cuando llegue (findTenant ya la encontrará).
    // Best-effort: si falla, el signup NO se rompe.
    try {
      // require() inline para que el módulo `billing/hotmart.service` se
      // resuelva en runtime, no al cargar este archivo. Sin esto, TS
      // compila un `require('../billing/hotmart.service')` al top del
      // archivo y el ciclo a través de PreregAlertsService rompe la
      // registración de AuthService.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { HotmartService: HotmartServiceClass } = require('../billing/hotmart.service');
      const hotmart = this.moduleRef.get<HotmartService>(HotmartServiceClass, { strict: false });
      const activated = await hotmart.consumePendingForTenant(
        tenant.id,
        email,
      );
      if (activated) {
        this.logger.log(
          `Signup activado al instante por pago pendiente — tenant=${tenant.id}`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `consumePendingForTenant falló para tenant=${tenant.id}: ${(e as Error).message}`,
      );
    }

    // Análogo para marcas con Stripe: si el comprador pagó por Stripe antes de
    // crear la cuenta, hay un PendingStripePayment por su email + marca. Mismo
    // require() inline para resolver el servicio en runtime (evita ciclo DI).
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { StripeService: StripeServiceClass } = require('../billing/stripe.service');
      const stripe = this.moduleRef.get(StripeServiceClass, { strict: false });
      const activated = await stripe.consumePendingForTenant(tenant.id, email);
      if (activated) {
        this.logger.log(
          `Signup activado al instante por pago Stripe pendiente — tenant=${tenant.id}`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `consumePendingForTenant (Stripe) falló para tenant=${tenant.id}: ${(e as Error).message}`,
      );
    }

    // Análogo para marcas con Cross (CrossPay): si el comprador pagó por Cross
    // antes de crear la cuenta, hay un PendingCrossPayment por su email + marca.
    // Mismo require() inline para resolver el servicio en runtime (evita ciclo DI).
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { CrossService: CrossServiceClass } = require('../billing/cross.service');
      const cross = this.moduleRef.get(CrossServiceClass, { strict: false });
      const activated = await cross.consumePendingForTenant(tenant.id, email);
      if (activated) {
        this.logger.log(
          `Signup activado al instante por pago Cross pendiente — tenant=${tenant.id}`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `consumePendingForTenant (Cross) falló para tenant=${tenant.id}: ${(e as Error).message}`,
      );
    }

    // Welcome email best-effort (no bloqueante). Resolvemos la IDENTIDAD de email
    // de la marca: nombre (asunto/cuerpo dicen "Sellea"), remitente propio
    // (from=hola@selleala.com si está verificado) y link al panel de la marca
    // (selleala.com/login). Sin marca / sin remitente propio → default Clubify.
    const welcomeBrandRow = await this.prisma.tenant
      .findUnique({
        where: { id: tenant.id },
        select: { whiteLabelId: true, whiteLabel: { select: { name: true } } },
      })
      .catch(() => null);
    const brandEmail = await resolveBrandEmail(
      this.prisma,
      welcomeBrandRow?.whiteLabelId ?? null,
      this.appConfig.APP_URL,
    );
    // Sale por la subcuenta de Grow Business de la marca, igual que el resto
    // de los correos. Antes iba por EmailService, que sin RESEND_API_KEY cae al
    // adaptador de consola: el correo se escribía en el log y nunca llegaba.
    void this.brandEmail.sendRaw({
      whiteLabelId: welcomeBrandRow?.whiteLabelId ?? null,
      to: email,
      ...welcomeOwnerTemplate({
        tenant,
        fullName: dto.fullName.trim(),
        trialEndsAt,
        appUrl: this.appConfig.APP_URL,
        brand: welcomeBrandRow?.whiteLabel?.name
          ? { name: welcomeBrandRow.whiteLabel.name }
          : null,
        loginUrl: brandEmail.hasBrandSender ? brandEmail.loginUrl : undefined,
      }),
    });

    // SMS al equipo (Javier/Jhon) avisando del nuevo preregistro.
    // Fire-and-forget — el service captura sus propios errores y no
    // propaga. Si la subcuenta GB falla o los Settings están mal, el
    // signup no se rompe. Resolve referrer/campaign si vino con código.
    let referrerName: string | null = null;
    let campaignName: string | null = null;
    if (attributedReferralCodeId) {
      const code = await this.prisma.referralCode
        .findUnique({
          where: { id: attributedReferralCodeId },
          select: {
            ownerName: true,
            ownerOfCampaign: { select: { name: true } },
          },
        })
        .catch(() => null);
      referrerName = code?.ownerName ?? null;
      campaignName = code?.ownerOfCampaign?.name ?? null;
    }
    const source = attributedReferralCodeId
      ? 'Afiliado'
      : dto.attribution?.viaSlug
        ? `Landing (/ref/${dto.attribution.viaSlug})`
        : 'Landing principal';
    this.preregAlerts
      .alertSignup({
        userId: user.id,
        customerName: dto.fullName.trim(),
        customerEmail: email,
        customerPhone: dto.whatsappPhone ?? null,
        source,
        referrerName,
        campaignName,
      })
      .catch(() => null);

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
      whiteLabelId: user.whiteLabelId ?? null,
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

  /**
   * Info pública de una marca para tematizar la página de auto-registro InfoLink
   * (/i-registro/<marca>). Solo branding — ya es público en su storefront.
   */
  async getBrandForInfoLinkSignup(slug: string) {
    const wl = await this.prisma.whiteLabel.findUnique({
      where: { slug: (slug || '').toLowerCase().trim() },
      select: {
        name: true,
        slug: true,
        logoUrl: true,
        iconUrl: true,
        faviconUrl: true,
        primaryColor: true,
        secondaryColor: true,
        backgroundColor: true,
        creditsUnlimited: true,
        creditsAvailable: true,
        status: true,
      },
    });
    if (!wl || wl.status === 'SUSPENDED' || wl.slug === 'clubify') {
      throw new NotFoundException('Marca no encontrada');
    }
    return {
      slug: wl.slug,
      name: wl.name,
      logoUrl: wl.logoUrl ?? wl.iconUrl ?? null,
      faviconUrl: wl.faviconUrl ?? null,
      primaryColor: wl.primaryColor ?? null,
      secondaryColor: wl.secondaryColor ?? null,
      backgroundColor: wl.backgroundColor ?? null,
      // Avisa en la UI si la marca no tiene cupo (el negocio nacería bloqueado).
      hasCredits:
        wl.creditsUnlimited ||
        (wl.creditsAvailable ?? 0) >= cycleCreditCost('INFOLINK', 'MENSUAL'),
    };
  }

  /**
   * Auto-registro de un negocio "Solo InfoLink" desde el link compartible de
   * una marca (/i-registro/<marca>). Crea el negocio con businessType=INFOLINK
   * bajo la marca y DESCUENTA 0.25 créditos de la marca automáticamente. Si la
   * marca no tiene cupo, el negocio queda creado pero BLOQUEADO (igual que el
   * flujo del panel). Auto-login: devuelve tokens como signup.
   */
  async infolinkSignup(
    dto: {
      brandSlug: string;
      email: string;
      password: string;
      fullName: string;
      brandName: string;
      phone?: string;
    },
    ip?: string,
  ) {
    const email = dto.email.toLowerCase().trim();
    const brandName = dto.brandName.trim();
    if (!brandName) throw new BadRequestException('Nombre del negocio requerido');

    const brand = await this.prisma.whiteLabel.findUnique({
      where: { slug: (dto.brandSlug || '').toLowerCase().trim() },
      select: { id: true, name: true, slug: true, creditsUnlimited: true, status: true },
    });
    if (!brand || brand.status === 'SUSPENDED') {
      throw new NotFoundException('Marca no encontrada');
    }
    if (brand.slug === 'clubify') {
      throw new BadRequestException('Esta marca no admite auto-registro InfoLink');
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email ya registrado');

    // Slug único global.
    let slug = slugify(brandName) || `infolink-${Date.now()}`;
    let suffix = 0;
    while (await this.prisma.tenant.findUnique({ where: { slug } })) {
      suffix += 1;
      slug = `${slugify(brandName)}-${suffix}`;
    }

    // Plan "Sin plan" (precio 0) — la facturación es por créditos de la marca.
    const plan =
      (await this.prisma.plan.findUnique({ where: { name: 'Sin plan' } })) ??
      (await this.prisma.plan.create({
        data: { name: 'Sin plan', priceMonthly: 0, isActive: true },
      }));

    const passwordHash = await this.hashPassword(dto.password);
    // Código placeholder para que el lockscreen de tarjeta (Hotmart) no bloquee:
    // los InfoLink de marca se activan por créditos, no por Hotmart.
    const placeholderCode = `wl-${randomBytes(6).toString('hex')}`;

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
            phone: dto.phone?.trim() || null,
            whatsappPhone: dto.phone?.trim() || null,
            businessType: 'INFOLINK',
            businessCategorySlug: DEFAULT_CATEGORY_SLUG,
            status: 'SUSPENDED', // se activa abajo si la marca tiene créditos
            planId: plan.id,
            planPeriodicity: 'MENSUAL',
            whiteLabelId: brand.id,
            hotmartSubscriberCode: placeholderCode,
            trialStartedAt: new Date(),
            trialEndsAt: null,
            currentPeriodEnd: null,
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
      if (e?.code === 'P2002') throw new ConflictException('Email ya registrado');
      throw e;
    }

    // Cobro del ciclo: 0.25 (InfoLink mensual). Race-safe. Marca ilimitada activa
    // sin cobrar. Sin cupo → queda bloqueado (SUSPENDED).
    const cost = cycleCreditCost('INFOLINK', 'MENSUAL');
    const oneMonth = new Date();
    oneMonth.setMonth(oneMonth.getMonth() + 1);
    let blocked = true;
    if (brand.creditsUnlimited) {
      await this.prisma.tenant.update({
        where: { id: tenant.id },
        data: { status: 'ACTIVE', currentPeriodEnd: oneMonth },
      });
      blocked = false;
    } else {
      const debit = await this.prisma.whiteLabel.updateMany({
        where: { id: brand.id, creditsAvailable: { gte: cost } },
        data: { creditsAvailable: { decrement: cost }, creditsUsed: { increment: cost } },
      });
      if (debit.count > 0) {
        await this.prisma.tenant.update({
          where: { id: tenant.id },
          data: { status: 'ACTIVE', currentPeriodEnd: oneMonth },
        });
        await this.prisma.creditTransaction
          .create({
            data: {
              whiteLabelId: brand.id,
              type: 'CONSUME',
              amount: -cost,
              tenantId: tenant.id,
              note: `Auto-registro InfoLink · ${brandName} · ${cost} créd`,
            },
          })
          .catch(() => undefined);
        blocked = false;
      }
    }

    this.audit.log({
      actorId: user.id,
      tenantId: tenant.id,
      action: 'auth.infolink_signup',
      resource: `tenant:${tenant.id}`,
      ip,
    });

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      whiteLabelId: user.whiteLabelId ?? null,
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
      // true si la marca no tenía cupo → negocio creado pero bloqueado.
      blocked,
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

  /**
   * Registro al MODO PRUEBA — 5 días gratis. Diferencias con `signup`:
   *  - `trialEndsAt = now + 5d` (signup normal lo deja null porque la
   *    puerta real es Hotmart).
   *  - Dedup estricto: email + phone + brandName derivado de empresa o
   *    fullName. Mensaje único para no filtrar cuál campo colisionó.
   *  - Captura `trialSource`, `trialCompany`, `trialCity` en el tenant.
   *  - Si el `source` no viene explícito y SÍ trae `referralCode`,
   *    infiere AMBASSADOR/INFLUENCER del rol del code.
   *  - No cobra ni dispara checkout — el dueño accede directo al panel
   *    y al expirar el trial cae en el lockscreen "Activar ahora" (F3).
   */
  async trialSignup(
    dto: {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      phone: string;
      company?: string;
      city?: string;
      referralCode?: string;
      source?: 'LANDING' | 'AMBASSADOR' | 'INFLUENCER' | 'VENDOR' | 'CAMPAIGN' | 'DIRECT';
      attribution?: {
        viaSlug?: string;
        utmSource?: string;
        utmMedium?: string;
        utmCampaign?: string;
        referer?: string;
      };
    },
    ip?: string,
  ) {
    const email = dto.email.toLowerCase().trim();
    const phoneRaw = (dto.phone ?? '').replace(/[^\d+]/g, '');
    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();
    const fullName = `${firstName} ${lastName}`.trim();
    const company = dto.company?.trim() || '';
    const city = dto.city?.trim() || null;
    const brandName = company || fullName;
    if (!brandName) {
      throw new BadRequestException('Empresa o nombre requerido');
    }

    // Dedup estricto: email (User), phone (User), email (Tenant), brandName
    // (Tenant). Mensaje único para no filtrar cuál campo colisionó —
    // protección anti-enumeration + mensaje legible para el dueño.
    //
    // ALTO #6 (2026-06-12): si la cuenta previa está SUSPENDED + sin
    // pago Hotmart (= trial abandonado), permitimos re-intentar.
    // Renombramos los datos del user viejo a tombstone para liberar
    // las constraints UNIQUE. Tenant viejo queda como histórico
    // (status SUSPENDED + emails/brandName cambiados con sufijo).
    const dupUser = await this.prisma.user.findFirst({
      where: phoneRaw
        ? { OR: [{ email }, { phone: phoneRaw }] }
        : { email },
      select: {
        id: true,
        email: true,
        phone: true,
        tenant: {
          select: {
            id: true,
            status: true,
            deletedAt: true,
            hotmartSubscriberCode: true,
          },
        },
      },
    });
    const dupTenant = await this.prisma.tenant.findFirst({
      where: { OR: [{ email }, { brandName }] },
      select: {
        id: true,
        status: true,
        deletedAt: true,
        hotmartSubscriberCode: true,
        email: true,
        brandName: true,
      },
    });

    function isAbandonedTrialTenant(t: {
      status: string;
      deletedAt: Date | null;
      hotmartSubscriberCode: string | null;
    }): boolean {
      if (t.deletedAt) return true;
      // SUSPENDED + sin código Hotmart = nunca pagó → es trial muerto.
      return t.status === 'SUSPENDED' && !t.hotmartSubscriberCode;
    }

    const userBlocking =
      dupUser &&
      !(dupUser.tenant && isAbandonedTrialTenant(dupUser.tenant));
    const tenantBlocking = dupTenant && !isAbandonedTrialTenant(dupTenant);

    if (userBlocking || tenantBlocking) {
      throw new ConflictException(
        'Ya existe una prueba asociada a esta información.',
      );
    }

    // Liberar las UNIQUE renombrando los registros abandonados.
    const tombstoneSuffix = `-deleted-${Date.now()}`;
    if (dupUser && dupUser.tenant && isAbandonedTrialTenant(dupUser.tenant)) {
      await this.prisma.user.update({
        where: { id: dupUser.id },
        data: {
          email: dupUser.email + tombstoneSuffix,
          phone: dupUser.phone ? dupUser.phone + tombstoneSuffix : null,
          isActive: false,
        },
      });
    }
    if (dupTenant && isAbandonedTrialTenant(dupTenant)) {
      await this.prisma.tenant.update({
        where: { id: dupTenant.id },
        data: {
          email: dupTenant.email + tombstoneSuffix,
          brandName: dupTenant.brandName + tombstoneSuffix,
        },
      });
    }

    let slug = slugify(brandName) || `prueba-${Date.now()}`;
    let suffix = 0;
    while (
      RESERVED_SLUGS.has(slug) ||
      (await this.prisma.tenant.findUnique({ where: { slug } }))
    ) {
      suffix += 1;
      slug = `${slugify(brandName)}-${suffix}`;
    }

    const defaultPlan =
      (await this.prisma.plan.findUnique({ where: { name: 'Elite' } })) ??
      (await this.prisma.plan.findFirst({
        where: { isActive: true },
        orderBy: { priceMonthly: 'asc' },
      }));
    if (!defaultPlan) {
      throw new BadRequestException('No hay planes configurados');
    }

    const passwordHash = await this.hashPassword(dto.password);

    // Trial 5 días exactos. trialEndsAt → 23:59:59 del día 5 para que
    // no expire mid-jornada por una diferencia de minutos.
    const trialStartedAt = new Date();
    const trialEndsAt = new Date(trialStartedAt.getTime());
    trialEndsAt.setDate(trialEndsAt.getDate() + 5);
    trialEndsAt.setHours(23, 59, 59, 999);

    // Si el frontend mandó source explícito, lo usamos. Si vino referralCode
    // pero no source, lo inferimos del rol (INFLUENCER/AMBASSADOR/VENDOR).
    // Sin info: DIRECT.
    //
    // VALIDACIÓN ITEM 4 (2026-06-05): si vino referralCode, exigimos que
    // exista Y esté isActive. Si no existe, lanzamos BadRequest claro
    // (mejor que silenciosamente atribuir a DIRECT — el embajador no se
    // entera de que su link está roto). Si no está activo, tampoco
    // atribuimos (NO bloqueamos el trial — el cliente igual se registra
    // como DIRECT) pero loggeamos para que el admin sepa.
    let trialSource: string = dto.source ?? 'DIRECT';
    let attributedReferralCodeId: string | null = null;
    if (dto.referralCode) {
      const code = await this.prisma.referralCode
        .findUnique({
          where: { code: dto.referralCode.trim().toUpperCase() },
          select: { id: true, role: true, isActive: true },
        })
        .catch(() => null);
      if (!code) {
        throw new BadRequestException(
          'El código de referido no existe. Verifica el link y vuelve a intentar.',
        );
      }
      if (code.isActive) {
        attributedReferralCodeId = code.id;
        if (!dto.source) {
          if (code.role === 'INFLUENCER') trialSource = 'INFLUENCER';
          else if (code.role === 'VENDOR') trialSource = 'VENDOR';
          else trialSource = 'AMBASSADOR';
        }
      }
      // Si !isActive: no atribuimos pero el trial sigue (queda como DIRECT).
    }

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
            whatsappPhone: phoneRaw || null,
            status: 'TRIAL',
            planId: defaultPlan.id,
            trialStartedAt,
            trialEndsAt,
            trialSource,
            trialCompany: company || null,
            trialCity: city,
          },
        });
        const u = await tx.user.create({
          data: {
            email,
            passwordHash,
            fullName,
            phone: phoneRaw || null,
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
        throw new ConflictException(
          'Ya existe una prueba asociada a esta información.',
        );
      }
      throw e;
    }

    this.audit.log({
      actorId: user.id,
      tenantId: tenant.id,
      action: 'auth.trial_signup',
      resource: `tenant:${tenant.id}`,
      ip,
      metadata: { trialSource, hasReferral: !!attributedReferralCodeId },
    });

    // Registrar ReferralUse para que /admin/affiliates vea el trial igual
    // que un signup normal. Fire-and-forget; el trial signup no se rompe.
    if (attributedReferralCodeId) {
      this.prisma.referralUse
        .create({
          data: {
            referralCodeId: attributedReferralCodeId,
            tenantId: tenant.id,
            status: 'SIGNED_UP',
            viaSlug: dto.attribution?.viaSlug ?? null,
            utmSource: dto.attribution?.utmSource ?? null,
            utmMedium: dto.attribution?.utmMedium ?? null,
            utmCampaign: dto.attribution?.utmCampaign ?? null,
            referer: dto.attribution?.referer ?? null,
          },
        })
        .catch(() => null);
    }

    // SMS interno a Javier + Jhon (no al dueño del trial — eso lo
    // gestiona el equipo comercial con seguimiento manual). El método
    // captura sus propios errores y no propaga.
    let referrerName: string | null = null;
    let campaignName: string | null = null;
    if (attributedReferralCodeId) {
      const code = await this.prisma.referralCode
        .findUnique({
          where: { id: attributedReferralCodeId },
          select: {
            ownerName: true,
            ownerOfCampaign: { select: { name: true } },
          },
        })
        .catch(() => null);
      referrerName = code?.ownerName ?? null;
      campaignName = code?.ownerOfCampaign?.name ?? null;
    }
    this.preregAlerts
      .alertSignup({
        userId: user.id,
        customerName: fullName,
        customerEmail: email,
        customerPhone: phoneRaw || null,
        source: `Trial (${trialSource})`,
        referrerName,
        campaignName,
      })
      .catch(() => null);

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      whiteLabelId: user.whiteLabelId ?? null,
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
        trialEndsAt: tenant.trialEndsAt,
      },
    };
  }
}
