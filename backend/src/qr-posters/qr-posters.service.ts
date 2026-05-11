import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { QrPosterType } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class QrPostersService {
  constructor(private prisma: PrismaService) {}

  private tid(user: AuthUser, override?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!override) throw new ForbiddenException('tenantId required');
      return override;
    }
    if (!user.tenantId) throw new ForbiddenException();
    return user.tenantId;
  }

  async getByType(user: AuthUser, type: QrPosterType, override?: string) {
    const tid = this.tid(user, override);
    return this.prisma.qrPoster.findUnique({
      where: { tenantId_type: { tenantId: tid, type } },
    });
  }

  async listMine(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    return this.prisma.qrPoster.findMany({
      where: { tenantId: tid },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Upsert por (tenantId, type). Cada tenant tiene hasta 1 poster por
   * tipo — el editor visual del frontend siempre carga el existente o
   * crea uno nuevo. Para H5 (cuando agreguemos versionado/galería) esto
   * puede pasar a permitir múltiples por tipo.
   */
  async upsertByType(
    user: AuthUser,
    type: QrPosterType,
    body: { name?: string; config: any },
    override?: string,
  ) {
    const tid = this.tid(user, override);
    return this.prisma.qrPoster.upsert({
      where: { tenantId_type: { tenantId: tid, type } },
      create: {
        tenantId: tid,
        type,
        name: body.name ?? '',
        config: body.config ?? {},
      },
      update: {
        name: body.name ?? undefined,
        config: body.config ?? undefined,
      },
    });
  }

  async removeByType(user: AuthUser, type: QrPosterType, override?: string) {
    const tid = this.tid(user, override);
    const existing = await this.prisma.qrPoster.findUnique({
      where: { tenantId_type: { tenantId: tid, type } },
    });
    if (!existing) throw new NotFoundException();
    await this.prisma.qrPoster.delete({ where: { id: existing.id } });
    return { ok: true };
  }
}
