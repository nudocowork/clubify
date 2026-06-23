import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'crypto';
import { Role } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppConfigService } from '../common/config/app-config.service';

export type RefreshPayload = {
  sub: string;
  email: string;
  role: Role;
  tenantId: string | null;
  // Marca blanca propia del admin (relación WhiteLabelAdmin). DEBE viajar en el
  // refresh: sin esto, al rotar el token se re-firma el accessToken sin marca y
  // el admin de una marca (ej: Sellea) cae al default del panel /admin (Clubify)
  // → ve negocios de otra marca. Bug de aislamiento crítico 2026-06-23.
  whiteLabelId?: string | null;
};

export type IssueOpts = {
  userId: string;
  payload: RefreshPayload;
  /** Si reutilizamos una family (caso rotation), pasar el id. */
  familyId?: string;
  ip?: string | null;
  userAgent?: string | null;
};

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * Maneja el ciclo de vida de refresh tokens:
 *   - issue(): crea uno nuevo (login fresh) y arranca una family.
 *   - rotate(): consume el viejo, devuelve uno nuevo en la misma family.
 *   - revokeFamily(): invalida toda la cadena (logout o reuso detectado).
 *   - revokeAllForUser(): logout global (cambio de password, admin).
 *
 * Token reuse detection: si un token YA rotado se intenta usar de nuevo,
 * la family entera se revoca (asumimos compromiso). El cliente legítimo
 * fue forzado a re-loguearse — molesto, pero seguro.
 *
 * Para invalidar sesiones por cambio de password, comparamos
 * `User.passwordChangedAt` con el `iat` del token: si el password cambió
 * después de que el token se emitió, lo rechazamos.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private appConfig: AppConfigService,
  ) {}

  async issue(opts: IssueOpts): Promise<string> {
    const familyId = opts.familyId ?? randomUUID();
    const tokenId = randomUUID();

    const token = this.jwt.sign(opts.payload, {
      secret: this.appConfig.JWT_REFRESH_SECRET,
      expiresIn: this.appConfig.JWT_REFRESH_EXPIRES,
      jwtid: tokenId,
    });

    // Extraemos exp directamente del token firmado para evitar drift entre
    // jsonwebtoken y nuestro cálculo manual de Date.now() + parseDuration.
    const decoded = this.jwt.decode(token) as { exp: number; iat: number };
    const expiresAt = new Date(decoded.exp * 1000);

    await this.prisma.refreshToken.create({
      data: {
        id: tokenId,
        userId: opts.userId,
        tokenHash: sha256Hex(token),
        familyId,
        expiresAt,
        ip: opts.ip ?? null,
        userAgent: opts.userAgent?.slice(0, 500) ?? null,
      },
    });

    return token;
  }

  /**
   * Verifica el refresh, rota a uno nuevo, marca el viejo como rotado.
   * Si detecta reuso o el password cambió después del token → revoca
   * la family y lanza UnauthorizedException.
   */
  async rotate(
    oldToken: string,
    opts: { ip?: string | null; userAgent?: string | null } = {},
  ) {
    let decoded: RefreshPayload & { iat: number; exp: number; jti?: string };
    try {
      decoded = this.jwt.verify(oldToken, {
        secret: this.appConfig.JWT_REFRESH_SECRET,
      }) as any;
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenHash = sha256Hex(oldToken);
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!record) {
      // Token firmado correctamente pero no existe en DB → forjado o ya
      // limpiado por TTL. No tenemos familyId disponible para revocar.
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    if (record.revokedAt) {
      // REUSO DETECTADO. Token ya fue rotado y alguien intenta usarlo de
      // nuevo → asumimos compromiso. Revocamos la family entera.
      this.logger.warn(
        `Refresh token reuse detected · userId=${record.userId} familyId=${record.familyId}`,
      );
      await this.revokeFamily(record.familyId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: record.userId },
      select: {
        id: true,
        email: true,
        role: true,
        tenantId: true,
        // Re-leemos la marca desde la DB (fuente de verdad) en cada rotación →
        // las sesiones viejas sin marca se auto-sanan al refrescar.
        whiteLabelId: true,
        isActive: true,
        passwordChangedAt: true,
      },
    });
    if (!user || !user.isActive) {
      await this.revokeFamily(record.familyId);
      throw new UnauthorizedException('User inactive');
    }

    // Si el password cambió DESPUÉS de que se emitió este token, lo
    // rechazamos (defensa contra session-hijack tras password rotate).
    if (
      user.passwordChangedAt &&
      decoded.iat * 1000 < user.passwordChangedAt.getTime()
    ) {
      await this.revokeFamily(record.familyId);
      throw new UnauthorizedException('Session invalidated');
    }

    // Emitimos el nuevo refresh ANTES de marcar el viejo como rotado para
    // que si la inserción falla no quedemos sin token activo.
    const newPayload: RefreshPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      whiteLabelId: user.whiteLabelId ?? null,
    };
    const newToken = await this.issue({
      userId: user.id,
      payload: newPayload,
      familyId: record.familyId,
      ip: opts.ip,
      userAgent: opts.userAgent,
    });

    const newRecord = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256Hex(newToken) },
      select: { id: true },
    });

    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: {
        revokedAt: new Date(),
        replacedByTokenId: newRecord?.id ?? null,
      },
    });

    return { refreshToken: newToken, user, payload: newPayload };
  }

  async revokeFamily(familyId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Revoca un token específico (logout single-session). Idempotente:
   * si el token no existe o ya estaba revocado, no falla.
   */
  async revokeOne(refreshToken: string) {
    const tokenHash = sha256Hex(refreshToken);
    await this.prisma.refreshToken
      .update({
        where: { tokenHash },
        data: { revokedAt: new Date() },
      })
      .catch(() => null);
  }
}
