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

  /** Devuelve TODOS los carteles del tenant — usado por la página
   *  /app/marketing (sección "Mis QRs") para mostrar la galería. */
  async listMine(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    return this.prisma.qrPoster.findMany({
      where: { tenantId: tid },
      orderBy: [{ type: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  /**
   * Legacy: el editor de cada tipo (qr-menu, qr-counter, etc.) carga
   * "el cartel del tipo" y guarda upsert. Con multi-QR, ahora retorna
   * el MÁS RECIENTE de ese tipo (o null si no hay), y upsertByType
   * crea uno nuevo si no existe o actualiza el más reciente. Para
   * editar variantes usar las nuevas rutas por id.
   */
  async getByType(user: AuthUser, type: QrPosterType, override?: string) {
    const tid = this.tid(user, override);
    return this.prisma.qrPoster.findFirst({
      where: { tenantId: tid, type },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async upsertByType(
    user: AuthUser,
    type: QrPosterType,
    body: { name?: string; config: any },
    override?: string,
  ) {
    const tid = this.tid(user, override);
    // findFirst+update/create en vez de upsert porque ya no hay unique
    // compuesto — Prisma upsert necesita un where unique exacto.
    const existing = await this.prisma.qrPoster.findFirst({
      where: { tenantId: tid, type },
      orderBy: { updatedAt: 'desc' },
    });
    if (existing) {
      return this.prisma.qrPoster.update({
        where: { id: existing.id },
        data: {
          name: body.name ?? undefined,
          config: body.config ?? undefined,
        },
      });
    }
    return this.prisma.qrPoster.create({
      data: {
        tenantId: tid,
        type,
        name: body.name ?? '',
        config: body.config ?? {},
      },
    });
  }

  async removeByType(user: AuthUser, type: QrPosterType, override?: string) {
    const tid = this.tid(user, override);
    // Solo borra el más reciente del tipo. Para borrar variantes
    // específicas, usar removeById con el id particular.
    const existing = await this.prisma.qrPoster.findFirst({
      where: { tenantId: tid, type },
      orderBy: { updatedAt: 'desc' },
    });
    if (!existing) throw new NotFoundException();
    await this.prisma.qrPoster.delete({ where: { id: existing.id } });
    return { ok: true };
  }

  // ───────── nuevos métodos por id (multi-QR) ───────── //

  async getById(user: AuthUser, id: string) {
    const found = await this.prisma.qrPoster.findUnique({ where: { id } });
    if (!found) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && found.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    return found;
  }

  /** Crea un cartel nuevo. Para editar uno existente usar updateById. */
  async create(
    user: AuthUser,
    body: { type: QrPosterType; name?: string; config?: any },
    override?: string,
  ) {
    const tid = this.tid(user, override);
    return this.prisma.qrPoster.create({
      data: {
        tenantId: tid,
        type: body.type,
        name: body.name ?? '',
        config: body.config ?? {},
      },
    });
  }

  /** Actualiza un cartel existente por id. Verifica que el cartel
   *  pertenezca al tenant del usuario (o que sea super admin). */
  async updateById(
    user: AuthUser,
    id: string,
    body: { name?: string; config?: any },
  ) {
    await this.getById(user, id); // valida ownership
    return this.prisma.qrPoster.update({
      where: { id },
      data: {
        name: body.name ?? undefined,
        config: body.config ?? undefined,
      },
    });
  }

  async removeById(user: AuthUser, id: string) {
    await this.getById(user, id); // valida ownership
    await this.prisma.qrPoster.delete({ where: { id } });
    return { ok: true };
  }
}
