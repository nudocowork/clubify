import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class ReviewsService {
  constructor(private prisma: PrismaService) {}

  // ────────── Público (review filter) ────────── //

  /**
   * GET /api/public/r/:slug — datos para renderizar la página pública.
   * Devuelve sólo lo que el cliente final necesita ver: branding + URL
   * de Google. NUNCA devolvemos el feedback negativo histórico.
   */
  async getPublic(slug: string) {
    const t = await this.prisma.tenant.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        brandName: true,
        logoUrl: true,
        primaryColor: true,
        secondaryColor: true,
        whatsappPhone: true,
        googleReviewUrl: true,
        status: true,
      },
    });
    if (!t || t.status === 'SUSPENDED')
      throw new NotFoundException('Negocio no disponible');
    return t;
  }

  /**
   * POST /api/public/r/:slug/submit — guarda el feedback. Si rating ≥ 4
   * marcamos `redirectedToGoogle = true` para que el panel del dueño
   * sepa que esa "review" pasó a Google y no se quedó privada.
   */
  async submitPublic(
    slug: string,
    body: {
      rating: number;
      comment?: string;
      customerName?: string;
      customerPhone?: string;
      redirectedToGoogle?: boolean;
    },
  ) {
    const t = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, status: true },
    });
    if (!t || t.status === 'SUSPENDED')
      throw new NotFoundException('Negocio no disponible');

    const rating = Math.max(1, Math.min(5, Math.floor(body.rating)));

    return this.prisma.reviewFeedback.create({
      data: {
        tenantId: t.id,
        rating,
        comment: body.comment?.trim() || null,
        customerName: body.customerName?.trim() || null,
        customerPhone: body.customerPhone?.trim() || null,
        redirectedToGoogle: !!body.redirectedToGoogle,
      },
      select: { id: true, createdAt: true },
    });
  }

  // ────────── Panel del tenant ────────── //

  private tid(user: AuthUser, override?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!override) throw new ForbiddenException('tenantId required');
      return override;
    }
    if (!user.tenantId) throw new ForbiddenException();
    return user.tenantId;
  }

  /** Lista feedback recibido + KPIs del tenant. */
  async listMine(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    const items = await this.prisma.reviewFeedback.findMany({
      where: { tenantId: tid },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    let count1 = 0,
      count2 = 0,
      count3 = 0,
      count4 = 0,
      count5 = 0,
      goneToGoogle = 0,
      avgSum = 0,
      avgN = 0,
      unread = 0;
    for (const f of items) {
      if (f.rating === 1) count1++;
      else if (f.rating === 2) count2++;
      else if (f.rating === 3) count3++;
      else if (f.rating === 4) count4++;
      else if (f.rating === 5) count5++;
      if (f.redirectedToGoogle) goneToGoogle++;
      avgSum += f.rating;
      avgN++;
      if (!f.isRead && !f.redirectedToGoogle) unread++;
    }

    return {
      items,
      stats: {
        total: items.length,
        avg: avgN > 0 ? Math.round((avgSum / avgN) * 10) / 10 : null,
        unread,
        goneToGoogle,
        privateCount: items.length - goneToGoogle,
        ratings: { '1': count1, '2': count2, '3': count3, '4': count4, '5': count5 },
      },
    };
  }

  async markRead(user: AuthUser, id: string) {
    const f = await this.prisma.reviewFeedback.findUnique({ where: { id } });
    if (!f) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && f.tenantId !== user.tenantId)
      throw new ForbiddenException();
    return this.prisma.reviewFeedback.update({
      where: { id },
      data: { isRead: true },
    });
  }

  async remove(user: AuthUser, id: string) {
    const f = await this.prisma.reviewFeedback.findUnique({ where: { id } });
    if (!f) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && f.tenantId !== user.tenantId)
      throw new ForbiddenException();
    await this.prisma.reviewFeedback.delete({ where: { id } });
    return { ok: true };
  }
}
