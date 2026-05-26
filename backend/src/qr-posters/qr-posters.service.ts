import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { QrPosterType } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { hasAdminBypass } from '../common/roles/admin-bypass';

@Injectable()
export class QrPostersService {
  constructor(private prisma: PrismaService) {}

  private tid(user: AuthUser, override?: string) {
    if (hasAdminBypass(user.role)) {
      if (!override) throw new ForbiddenException('tenantId required');
      return override;
    }
    if (!user.tenantId) throw new ForbiddenException();
    return user.tenantId;
  }

  /** Devuelve TODOS los carteles del tenant — usado por la página
   *  /app/marketing (sección "Mis QRs") para mostrar la galería.
   *  Cada poster trae counts de visits/exports para mostrar en el card. */
  async listMine(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    const posters = await this.prisma.qrPoster.findMany({
      where: { tenantId: tid },
      orderBy: [{ type: 'asc' }, { updatedAt: 'desc' }],
      include: {
        _count: { select: { visits: true, exports: true } },
      },
    });
    return posters.map((p) => ({
      ...p,
      visitCount: p._count.visits,
      exportCount: p._count.exports,
      _count: undefined,
    }));
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
    if (!hasAdminBypass(user.role) && found.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    return found;
  }

  /** Crea un cartel nuevo. Para editar uno existente usar updateById. */
  async create(
    user: AuthUser,
    body: {
      type: QrPosterType;
      name?: string;
      config?: any;
      targetUrl?: string | null;
      isActive?: boolean;
    },
    override?: string,
  ) {
    const tid = this.tid(user, override);
    return this.prisma.qrPoster.create({
      data: {
        tenantId: tid,
        type: body.type,
        name: body.name ?? '',
        config: body.config ?? {},
        targetUrl: body.targetUrl ?? null,
        isActive: body.isActive ?? true,
      },
    });
  }

  /** Actualiza un cartel existente por id. Verifica que el cartel
   *  pertenezca al tenant del usuario (o que sea super admin). */
  async updateById(
    user: AuthUser,
    id: string,
    body: {
      name?: string;
      config?: any;
      targetUrl?: string | null;
      isActive?: boolean;
    },
  ) {
    await this.getById(user, id); // valida ownership
    return this.prisma.qrPoster.update({
      where: { id },
      data: {
        name: body.name ?? undefined,
        config: body.config ?? undefined,
        targetUrl: body.targetUrl === undefined ? undefined : body.targetUrl,
        isActive: body.isActive ?? undefined,
      },
    });
  }

  async removeById(user: AuthUser, id: string) {
    await this.getById(user, id); // valida ownership
    await this.prisma.qrPoster.delete({ where: { id } });
    return { ok: true };
  }

  // ───────── Endpoint público /q/<id> ───────── //

  /**
   * Resuelve un QR poster a su URL destino y loguea la visita. Es lo que
   * el QR impreso codifica — al escanear, el usuario llega a /q/<id> que
   * dispara este método.
   *
   * Si targetUrl está seteado: lo usa directo.
   * Si no: arma la URL default según el tipo del poster.
   *   - MENU      → /m/<slug>
   *   - COUNTER   → /m/<slug>?counter=1  (placeholder — la lógica real
   *                  vive en el storefront)
   *   - DISCOUNT  → /m/<slug>?promo=1
   *   - REVIEWS   → /r/<slug>
   *   - INFOLINK  → /i/<slug>
   *
   * Si el poster no existe o está inactivo, retorna null — el caller
   * (controller) decide el response (404 vs landing).
   */
  async resolvePublicUrl(
    id: string,
    appUrl: string,
    ctx: { ip?: string; userAgent?: string; country?: string; referer?: string },
  ): Promise<string | null> {
    const poster = await this.prisma.qrPoster.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        targetUrl: true,
        isActive: true,
        tenant: { select: { slug: true } },
      },
    });
    if (!poster || !poster.isActive) return null;

    // Loguear visita fire-and-forget (no bloquear redirect si falla).
    this.prisma.qrPosterVisit
      .create({
        data: {
          posterId: poster.id,
          ip: ctx.ip?.slice(0, 60) ?? null,
          userAgent: ctx.userAgent?.slice(0, 500) ?? null,
          country: ctx.country?.slice(0, 8) ?? null,
          referer: ctx.referer?.slice(0, 1000) ?? null,
        },
      })
      .catch(() => null);

    const base = appUrl.replace(/\/+$/, '');

    // Override explícito gana — pero validamos contra whitelist para evitar
    // open redirect a phishing. Los QR son impresos e irreversibles; un admin
    // comprometido podría apuntar masivamente a sitios maliciosos. Si la URL
    // no pasa el check, cae al default por type (safer than sorry).
    if (poster.targetUrl && isSafeTargetUrl(poster.targetUrl, base)) {
      return poster.targetUrl;
    }

    const slug = poster.tenant.slug;
    switch (poster.type) {
      case 'MENU':
        return `${base}/m/${slug}`;
      case 'COUNTER':
        return `${base}/m/${slug}`;
      case 'DISCOUNT':
        return `${base}/m/${slug}?promo=1`;
      case 'REVIEWS':
        return `${base}/r/${slug}`;
      case 'INFOLINK':
        return `${base}/i/${slug}`;
      default:
        return `${base}/m/${slug}`;
    }
  }

  /** Loguea un export del cartel (PNG/PDF/SVG). El frontend dispara
   *  este endpoint cuando el dueño descarga el archivo. */
  async logExport(
    user: AuthUser,
    id: string,
    body: { format: string; sizeBytes?: number },
  ) {
    await this.getById(user, id); // valida ownership
    await this.prisma.qrPosterExport.create({
      data: {
        posterId: id,
        format: body.format.toUpperCase().slice(0, 8),
        sizeBytes: body.sizeBytes ?? null,
      },
    });
    return { ok: true };
  }
}

// Hosts permitidos para `targetUrl` además del mismo origin del appUrl.
// Limitado a destinos comerciales legítimos donde el negocio querría apuntar
// un QR: WhatsApp, Maps, redes sociales, plataformas de reservas comunes.
// NO incluye redirectores genéricos (bit.ly, etc.) — esos rompen el propósito
// de validar contra open redirect.
const QR_TARGET_HOST_WHITELIST = new Set([
  'wa.me',
  'api.whatsapp.com',
  'instagram.com',
  'www.instagram.com',
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'fb.me',
  'tiktok.com',
  'www.tiktok.com',
  'vm.tiktok.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'maps.google.com',
  'maps.app.goo.gl',
  'goo.gl',
  'google.com',
  'www.google.com',
  'linktr.ee',
]);

function isSafeTargetUrl(targetUrl: string, appUrl: string): boolean {
  const t = targetUrl.trim();
  if (!t) return false;
  // Protocolos non-http aceptados directamente (no son redirects web).
  if (/^(mailto:|tel:|sms:)/i.test(t)) return true;
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  // Same-origin con appUrl.
  try {
    const app = new URL(appUrl);
    if (url.host === app.host) return true;
  } catch {
    /* ignore */
  }
  // Whitelist explícita de hosts comerciales.
  return QR_TARGET_HOST_WHITELIST.has(url.host.toLowerCase());
}
