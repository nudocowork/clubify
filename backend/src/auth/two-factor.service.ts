import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppConfigService } from '../common/config/app-config.service';

// Tolerancia ±30s (1 step pasado, 1 futuro) para compensar drift de reloj
// del dispositivo del usuario. epochTolerance está en segundos en otplib v13.
const TOTP_TOLERANCE_SECONDS = 30;

/**
 * 2FA TOTP (RFC 6238) compatible con Google Authenticator, 1Password,
 * Authy, etc.
 *
 * Flow:
 *   1. `setup()`  — genera un secret nuevo y lo guarda en User.totpSecret.
 *                   Retorna el otpauth:// URI para mostrar como QR. El 2FA
 *                   NO queda activo todavía.
 *   2. `confirm()` — el usuario escanea el QR y manda el primer código.
 *                    Si valida, `totpEnabledAt = now()` y a partir de
 *                    entonces TODOS los logins requieren TOTP.
 *   3. `verify()`  — usado en el login flow para validar el código.
 *   4. `disable()` — borra el secret (requiere TOTP válido).
 *
 * Política inicial: SUPER_ADMIN puede activar 2FA (recomendado). El flow
 * de login retorna `requires2FA: true` con un challengeToken corto que
 * el cliente debe canjear pasando el TOTP code en `/auth/2fa/challenge`.
 */
@Injectable()
export class TwoFactorService {
  /** Fallos seguidos antes de bloquear el segundo factor. */
  private static readonly MAX_FALLOS = 5;
  /** Cuánto dura el bloqueo. Temporal a propósito: uno permanente convertiría
   *  «fallar cinco veces» en quedarse fuera de la cuenta para siempre, y hoy
   *  no hay ninguna ruta de administración para desbloquear a nadie. */
  private static readonly BLOQUEO_MIN = 15;

  constructor(
    private prisma: PrismaService,
    private appConfig: AppConfigService,
  ) {}

  /**
   * Genera un secret nuevo (o reusa el existente si todavía no se
   * confirmó). Si 2FA ya está activado (totpEnabledAt seteado), falla —
   * el user debe desactivar primero antes de re-setup.
   */
  async setup(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        totpSecret: true,
        totpEnabledAt: true,
        whiteLabelId: true,
        tenantId: true,
      },
    });
    if (!user) throw new NotFoundException('User');
    if (user.totpEnabledAt) {
      throw new ConflictException(
        '2FA ya está activo. Desactivalo primero si quieres regenerar el secret.',
      );
    }

    const secret = generateSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: secret },
    });

    // El issuer aparece en la app autenticadora (Google Authenticator/Authy).
    // Un usuario de una marca blanca (Sellea) debe ver el nombre de SU marca.
    const issuer = await this.resolveBrandName(user.whiteLabelId, user.tenantId);
    const otpauth = generateURI({
      issuer,
      label: user.email,
      secret,
    });
    return { secret, otpauth };
  }

  /** Nombre de la marca del usuario (whiteLabelId directo o vía tenant).
   *  Sin marca → "Clubify". Evita filtrar "Clubify" en el 2FA de marcas blancas. */
  private async resolveBrandName(
    whiteLabelId: string | null | undefined,
    tenantId: string | null | undefined,
  ): Promise<string> {
    if (whiteLabelId) {
      const wl = await this.prisma.whiteLabel.findUnique({
        where: { id: whiteLabelId },
        select: { name: true },
      });
      if (wl?.name?.trim()) return wl.name.trim();
    } else if (tenantId) {
      const t = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { whiteLabel: { select: { name: true } } },
      });
      if (t?.whiteLabel?.name?.trim()) return t.whiteLabel.name.trim();
    }
    return 'Clubify';
  }

  /**
   * Confirma el setup: requiere un TOTP code válido para activar 2FA.
   * Una vez confirmado, todos los logins requieren el código.
   */
  async confirm(userId: string, totpCode: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, totpSecret: true, totpEnabledAt: true },
    });
    if (!user || !user.totpSecret) {
      throw new BadRequestException('Inicia el setup de 2FA primero.');
    }
    if (user.totpEnabledAt) {
      throw new ConflictException('2FA ya está activado.');
    }

    const result = verifySync({
      token: totpCode.replace(/\s+/g, ''),
      secret: user.totpSecret,
      epochTolerance: TOTP_TOLERANCE_SECONDS,
    });
    if (!result.valid) {
      throw new UnauthorizedException('Código TOTP inválido.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabledAt: new Date() },
    });
    return { ok: true };
  }

  /**
   * Verifica un TOTP code para un usuario con 2FA activado. Usado en el
   * paso 2 del login (challenge). No tira; retorna boolean.
   */
  async verify(userId: string, totpCode: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        totpSecret: true,
        totpEnabledAt: true,
        totpFallos: true,
        totpBloqueadoHasta: true,
      },
    });
    if (!user || !user.totpSecret || !user.totpEnabledAt) return false;

    // Bloqueado por fallar demasiado: ni se mira el código.
    if (user.totpBloqueadoHasta && user.totpBloqueadoHasta > new Date()) {
      return false;
    }

    const code = (totpCode ?? '').replace(/\s+/g, '');
    if (!code) return false;
    const result = verifySync({
      token: code,
      secret: user.totpSecret,
      epochTolerance: TOTP_TOLERANCE_SECONDS,
    });

    if (!result.valid) {
      // Probar un código costaba un HMAC y nada más. Con la tolerancia de
      // ±30 s hay unos tres códigos válidos por ventana, así que sin contador
      // —y sin límite de peticiones que funcione— el segundo factor de una
      // cuenta con la contraseña ya filtrada era cuestión de insistir.
      const fallos = user.totpFallos + 1;
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          totpFallos: fallos,
          // El bloqueo es TEMPORAL a propósito. Uno permanente convierte
          // «fallar cinco veces» en dejar a alguien fuera de su cuenta para
          // siempre, y no hay ruta de administración para desbloquearlo.
          totpBloqueadoHasta:
            fallos >= TwoFactorService.MAX_FALLOS
              ? new Date(Date.now() + TwoFactorService.BLOQUEO_MIN * 60 * 1000)
              : user.totpBloqueadoHasta,
        },
      });
      return false;
    }

    // Acertar limpia la cuenta de fallos: los cinco tiros son seguidos, no de
    // por vida.
    if (user.totpFallos > 0 || user.totpBloqueadoHasta) {
      await this.prisma.user
        .update({
          where: { id: userId },
          data: { totpFallos: 0, totpBloqueadoHasta: null },
        })
        .catch(() => undefined);
    }
    return true;
  }

  /**
   * Desactiva 2FA. Requiere TOTP válido para evitar bypass si la sesión
   * está comprometida.
   */
  async disable(userId: string, totpCode: string) {
    const ok = await this.verify(userId, totpCode);
    if (!ok) throw new UnauthorizedException('Código TOTP inválido.');
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: null, totpEnabledAt: null },
    });
    return { ok: true };
  }

  async isEnabled(userId: string): Promise<boolean> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { totpEnabledAt: true },
    });
    return !!u?.totpEnabledAt;
  }
}
