import { Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../common/prisma/prisma.service';

// Onboarding Sync API — Fase B. Tokens de integración POR NEGOCIO. Se guarda
// solo el sha256 del token; el valor en claro se muestra una única vez.
@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  private hash(token: string) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /** Genera un token nuevo para el negocio. Devuelve el valor EN CLARO una sola
   *  vez (no se vuelve a poder ver) + el business_id. */
  async createToken(tenantId: string, label?: string) {
    // Prefijo reconocible + 32 bytes aleatorios (256 bits) en base64url.
    const token = 'clbf_' + crypto.randomBytes(32).toString('base64url');
    const row = await this.prisma.onboardingToken.create({
      data: {
        tenantId,
        tokenHash: this.hash(token),
        label: (label || '').trim().slice(0, 60) || 'Onboarding',
        lastFour: token.slice(-4),
      },
    });
    return {
      id: row.id,
      token, // ← en claro, SOLO en esta respuesta
      business_id: tenantId,
      label: row.label,
      createdAt: row.createdAt,
    };
  }

  /** Lista los tokens del negocio (sin el valor en claro). */
  async listTokens(tenantId: string) {
    const tokens = await this.prisma.onboardingToken.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        label: true,
        lastFour: true,
        createdAt: true,
        lastUsedAt: true,
        revokedAt: true,
      },
    });
    return { business_id: tenantId, tokens };
  }

  /** Revoca un token del negocio. Scoped por tenant (findFirst {id,tenantId}). */
  async revokeToken(tenantId: string, id: string) {
    const row = await this.prisma.onboardingToken.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Token no encontrado');
    await this.prisma.onboardingToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  /** Resuelve un token en claro → tenantId (o null si inválido/revocado).
   *  Actualiza lastUsedAt best-effort. Usado por OnboardingTokenGuard. */
  async resolveToken(rawToken: string): Promise<string | null> {
    if (!rawToken) return null;
    const row = await this.prisma.onboardingToken.findFirst({
      where: { tokenHash: this.hash(rawToken), revokedAt: null },
      select: { id: true, tenantId: true },
    });
    if (!row) return null;
    // No bloqueamos la request por el update de auditoría.
    this.prisma.onboardingToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    return row.tenantId;
  }
}
