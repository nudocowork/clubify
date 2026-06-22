import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { safeUrlOrNull } from '../common/util/safe-url';
import {
  TranslatableItem,
  TranslationService,
  normalizeLocale,
} from '../catalog/translation.service';
import { WhitelabelBrandService } from '../whitelabel/whitelabel-brand.service';

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60) || `link-${Date.now().toString(36).slice(-6)}`
  );
}

// Lista de paths "raíz" del dominio que NO pueden ser usados como rootSlug
// vanity de un Infolink. Incluye: top-level routes del frontend, paths del
// backend visibles (api, q), reservas comunes para crecer (dashboard, blog,
// terms, etc.) y palabras técnicas.
const ROOT_SLUG_RESERVED = new Set([
  // Frontend top-level routes existentes
  'admin', 'affiliate', 'app', 'book', 'c', 'demo-wallet', 'dev-login',
  'forgot', 'i', 'industria', 'industrias', 'legal', 'login', 'm', 'o',
  'onboarding', 'preview', 'r', 'ref', 'refer', 'reset', 'scan', 'signup',
  'w', 'q',
  // Backend / APIs
  'api', 'health', 'docs', 'metrics',
  // Reservas para crecer
  'dashboard', 'settings', 'billing', 'pricing', 'search', 'help', 'support',
  'terms', 'privacy', 'about', 'contact', 'blog', 'home', 'index',
  'sitemap', 'robots', 'favicon', 'manifest',
  // Files técnicos
  'static', 'public', 'assets', '_next', 'images', 'img',
]);

/**
 * Sanitiza y valida un rootSlug candidato. Retorna el valor normalizado o
 * tira BadRequestException con razón legible.
 */
function normalizeRootSlug(input: string): string {
  const clean = slugify(input);
  if (!clean) {
    throw new BadRequestException('La URL personalizada no puede estar vacía');
  }
  if (clean.length < 2) {
    throw new BadRequestException('La URL debe tener al menos 2 caracteres');
  }
  if (clean.length > 40) {
    throw new BadRequestException('La URL no puede tener más de 40 caracteres');
  }
  if (ROOT_SLUG_RESERVED.has(clean)) {
    throw new BadRequestException(
      `La URL "/${clean}" está reservada por el sistema. Elige otra.`,
    );
  }
  return clean;
}

export type InfoLinkDto = {
  title: string;
  subtitle?: string;
  slug?: string;
  // rootSlug: URL vanity GLOBAL. Si llega string vacío o null, se limpia
  // (se desasocia el vanity). Si llega valor, se valida + asigna.
  rootSlug?: string | null;
  heroImageUrl?: string;
  gallery?: string[];
  sections?: any[];
  buttons?: any[];
  theme?: any;
  isActive?: boolean;
};

@Injectable()
export class InfoLinksService {
  constructor(
    private prisma: PrismaService,
    private translator: TranslationService,
    private brand: WhitelabelBrandService,
  ) {}

  private tid(user: AuthUser, override?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!override) throw new ForbiddenException('tenantId required');
      return override;
    }
    if (!user.tenantId) throw new ForbiddenException();
    return user.tenantId;
  }

  // 2026-06-06: cuando el dueño crea/duplica sin asignar un slug propio,
  // el default ahora es `infolink`, `infolink2`, `infolink3`, … en vez del
  // viejo `slugify(title)` (que producía URLs sucias como `mi-nuevo-link-copia`).
  // Si el dueño quiere personalizar, sigue pudiendo mandar `slug` en el PATCH.
  private async nextDefaultSlug(tenantId: string): Promise<string> {
    const existing = await this.prisma.infoLink.findMany({
      where: { tenantId, slug: { startsWith: 'infolink' } },
      select: { slug: true },
    });
    // "infolink" se trata como N=1. "infolink<N>" con N>=2 se parsea numérico.
    // Cualquier slug que arranque con "infolink" pero NO matchee el patrón
    // (ej. "infolink-promo") se ignora — el siguiente default arranca limpio.
    let maxN = 0;
    for (const e of existing) {
      if (e.slug === 'infolink') {
        if (maxN < 1) maxN = 1;
        continue;
      }
      const m = /^infolink(\d+)$/.exec(e.slug);
      if (!m) continue;
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > maxN) maxN = n;
    }
    return maxN === 0 ? 'infolink' : `infolink${maxN + 1}`;
  }

  list(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    return this.prisma.infoLink.findMany({
      where: { tenantId: tid },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { events: true } } },
    });
  }

  async get(user: AuthUser, id: string) {
    const link = await this.prisma.infoLink.findUnique({ where: { id } });
    if (!link) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && link.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    return link;
  }

  /**
   * Sanitiza un array de buttons en el shape del editor, reemplazando
   * cualquier URL con scheme no permitido por null. Defensa contra
   * stored XSS — un TENANT_OWNER/STAFF podría guardar `javascript:...`
   * en `button.url` o `button.popup.buttonUrl` que después se ejecuta
   * cuando un cliente hace click. Idem para `sections[].coverUrl` etc.
   *
   * Aplica al PATCH/POST y también al clone (duplicate).
   */
  private sanitizeButtonsUrls(buttons: any): any {
    if (!Array.isArray(buttons)) return buttons;
    return buttons.map((b) => {
      if (!b || typeof b !== 'object') return b;
      const next: any = { ...b };
      if (typeof next.url === 'string') {
        next.url = safeUrlOrNull(next.url) ?? '';
      }
      if (next.popup && typeof next.popup === 'object') {
        const popup: any = { ...next.popup };
        if (typeof popup.buttonUrl === 'string') {
          popup.buttonUrl = safeUrlOrNull(popup.buttonUrl) ?? '';
        }
        if (typeof popup.continueUrl === 'string') {
          popup.continueUrl = safeUrlOrNull(popup.continueUrl) ?? '';
        }
        next.popup = popup;
      }
      return next;
    });
  }

  async create(user: AuthUser, dto: InfoLinkDto, override?: string) {
    const tid = this.tid(user, override);
    let slug: string;
    if (dto.slug && dto.slug.trim().length > 0) {
      // URL personalizada: respetamos lo que escribió el dueño y solo
      // resolvemos colisiones con sufijo numérico clásico.
      slug = slugify(dto.slug);
      let suffix = 0;
      while (
        await this.prisma.infoLink.findFirst({
          where: { tenantId: tid, slug: suffix === 0 ? slug : `${slug}-${suffix}` },
        })
      ) {
        suffix++;
      }
      if (suffix > 0) slug = `${slug}-${suffix}`;
    } else {
      // Default: `infolink`, `infolink2`, … (URL limpia y compartible).
      slug = await this.nextDefaultSlug(tid);
    }

    return this.prisma.infoLink.create({
      data: {
        tenantId: tid,
        slug,
        title: dto.title,
        subtitle: dto.subtitle,
        heroImageUrl: dto.heroImageUrl,
        gallery: (dto.gallery ?? []) as any,
        sections: (dto.sections ?? []) as any,
        buttons: this.sanitizeButtonsUrls(dto.buttons ?? []) as any,
        theme: (dto.theme ?? {}) as any,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(user: AuthUser, id: string, dto: Partial<InfoLinkDto>) {
    await this.get(user, id);

    // rootSlug: tres casos.
    //   undefined  → no tocar.
    //   null/''    → desasociar (vanity off).
    //   string     → validar + chequear duplicado + asignar.
    let rootSlugUpdate: string | null | undefined = undefined;
    if (dto.rootSlug !== undefined) {
      const raw = (dto.rootSlug ?? '').trim();
      if (!raw) {
        rootSlugUpdate = null;
      } else {
        const clean = normalizeRootSlug(raw);
        const existing = await this.prisma.infoLink.findUnique({
          where: { rootSlug: clean },
          select: { id: true },
        });
        if (existing && existing.id !== id) {
          throw new ConflictException(
            `La URL "/${clean}" ya está usada por otro Infolink`,
          );
        }
        rootSlugUpdate = clean;
      }
    }

    return this.prisma.infoLink.update({
      where: { id },
      data: {
        title: dto.title ?? undefined,
        subtitle: dto.subtitle === undefined ? undefined : dto.subtitle,
        rootSlug: rootSlugUpdate,
        heroImageUrl: dto.heroImageUrl === undefined ? undefined : dto.heroImageUrl,
        gallery: dto.gallery === undefined ? undefined : (dto.gallery as any),
        sections: dto.sections === undefined ? undefined : (dto.sections as any),
        buttons:
          dto.buttons === undefined
            ? undefined
            : (this.sanitizeButtonsUrls(dto.buttons) as any),
        theme: dto.theme === undefined ? undefined : (dto.theme as any),
        isActive: dto.isActive === undefined ? undefined : dto.isActive,
      },
    });
  }

  async remove(user: AuthUser, id: string) {
    await this.get(user, id);
    await this.prisma.infoLink.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Clona un InfoLink: copia estructura (sections, buttons, theme, hero,
   * gallery, popups, todo lo persistido en el row). NO copia stats:
   * views=0, sin InfoLinkEvent asociados. Genera slug único auto.
   * Title nuevo = "<original> (copia)".
   */
  async duplicate(user: AuthUser, id: string) {
    const src = await this.get(user, id);
    const tid = src.tenantId;

    // 2026-06-06: el duplicado ahora también usa el pattern `infolink`,
    // `infolink2`, … (antes generaba URLs sucias como `mi-link-copia`).
    // Si el dueño quiere personalizar después, edita el slug desde el PATCH.
    const data = {
      tenantId: tid,
      title: `${src.title} (copia)`,
      subtitle: src.subtitle,
      heroImageUrl: src.heroImageUrl,
      gallery: src.gallery as any,
      sections: src.sections as any,
      buttons: src.buttons as any,
      theme: src.theme as any,
      isActive: src.isActive,
      // views queda en 0 (default schema), sin InfoLinkEvent — cada copia
      // arranca su propio tracking limpio.
    };

    // Race condition: dos duplicates concurrentes del mismo source pueden
    // resolver el mismo `nextDefaultSlug`; el segundo create tira P2002
    // contra `@@unique([tenantId, slug])`. Reintentamos hasta 4 veces —
    // cada intento re-resuelve el slug desde el estado actual.
    for (let attempt = 0; attempt < 4; attempt++) {
      const slug = await this.nextDefaultSlug(tid);
      try {
        return await this.prisma.infoLink.create({
          data: { ...data, slug },
        });
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e;
      }
    }
    throw new Error('No se pudo generar un slug único para la copia. Intenta de nuevo.');
  }

  async stats(user: AuthUser, id: string) {
    await this.get(user, id);
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const events = await this.prisma.infoLinkEvent.findMany({
      where: { infoLinkId: id, createdAt: { gte: since30 } },
    });
    const counts = { view: 0, click_button: 0, qr_scan: 0 } as Record<string, number>;
    const buttonClicks = new Map<string, number>();
    for (const e of events) {
      counts[e.type] = (counts[e.type] ?? 0) + 1;
      if (e.type === 'click_button') {
        const label = (e.metadata as any)?.label ?? 'Sin etiqueta';
        buttonClicks.set(label, (buttonClicks.get(label) ?? 0) + 1);
      }
    }
    return {
      views: counts.view,
      qrScans: counts.qr_scan,
      buttonClicks: Object.fromEntries(buttonClicks),
      total: events.length,
    };
  }

  // ============ Público ============

  async getPublic(tenantSlug: string, linkSlug: string, localeRaw?: string) {
    const locale = normalizeLocale(localeRaw);
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: {
        id: true,
        brandName: true,
        logoUrl: true,
        primaryColor: true,
        secondaryColor: true,
        whatsappPhone: true,
        instagramUrl: true,
        mapsUrl: true,
        slug: true,
        status: true,
        // Marca blanca del negocio: el infolink muestra "Hecho con {marca}".
        whiteLabelId: true,
        locations: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            address: true,
            latitude: true,
            longitude: true,
            // #20 (2026-06-17): link exacto por sede para el botón "Dirección".
            mapsUrl: true,
          },
        },
      },
    });
    if (!tenant || tenant.status === 'SUSPENDED') {
      throw new NotFoundException('No disponible');
    }
    const link = await this.prisma.infoLink.findUnique({
      where: { tenantId_slug: { tenantId: tenant.id, slug: linkSlug } },
    });
    if (!link || !link.isActive) throw new NotFoundException('Link no disponible');

    // Incrementa views (best-effort, no bloquea respuesta)
    this.prisma.infoLink
      .update({ where: { id: link.id }, data: { views: { increment: 1 } } })
      .catch(() => null);
    this.prisma.infoLinkEvent
      .create({ data: { infoLinkId: link.id, type: 'view' } })
      .catch(() => null);

    // Marca blanca del negocio (atribución/web/inicial). Nunca Clubify por
    // defecto: legacy sin marca cae al row real `clubify`.
    const b = await this.brand.resolveByWhiteLabelId(tenant.whiteLabelId);
    const brand = {
      name: b.name,
      slug: b.slug,
      websiteUrl: b.websiteUrl,
      logoUrl: b.logoUrl,
      iconUrl: b.iconUrl,
      faviconUrl: b.faviconUrl,
      primaryColor: b.primaryColor,
      initial: b.initial,
      attribution: b.attribution,
    };

    if (locale === 'es') return { tenant, link, brand };

    // Fase 5: traducción del title + subtitle del InfoLink. El JSON
    // de sections/buttons queda en ES por ahora (estructuras complejas
    // — Fase 6 si hace falta).
    const items: TranslatableItem[] = [];
    if (link.title) {
      items.push({
        entityType: 'infolink',
        entityId: link.id,
        field: 'title',
        text: link.title,
      });
    }
    if (link.subtitle) {
      items.push({
        entityType: 'infolink',
        entityId: link.id,
        field: 'subtitle',
        text: link.subtitle,
      });
    }
    if (items.length === 0) return { tenant, link, brand };
    const tr = await this.translator.translateMenuBatch(
      tenant.id,
      items,
      locale,
    );
    return {
      tenant,
      link: {
        ...link,
        title: tr.get(`infolink:${link.id}:title`) ?? link.title,
        subtitle:
          link.subtitle == null
            ? link.subtitle
            : (tr.get(`infolink:${link.id}:subtitle`) ?? link.subtitle),
      },
      brand,
    };
  }

  trackEvent(linkId: string, type: string, metadata: any = {}) {
    return this.prisma.infoLinkEvent
      .create({
        data: { infoLinkId: linkId, type, metadata },
      })
      .catch(() => null);
  }

  /**
   * Resuelve un Infolink por su rootSlug global (vanity URL).
   * Acceso público: `soyclubify.com/<rootSlug>` → este método.
   * Devuelve la misma shape que getPublic (tenant + link) para que el
   * frontend pueda renderearlo igual sin lógica diferenciada.
   */
  async getPublicByRoot(rootSlug: string, localeRaw?: string) {
    const clean = (rootSlug || '').toLowerCase().trim().slice(0, 60);
    if (!clean) throw new NotFoundException('No disponible');
    const link = await this.prisma.infoLink.findUnique({
      where: { rootSlug: clean },
    });
    if (!link || !link.isActive) {
      throw new NotFoundException('No disponible');
    }
    // Reutilizamos getPublic para no duplicar la lógica de tenant lookup +
    // tracking + traducción. Como ya tenemos el link, solo necesitamos el
    // tenantSlug + linkSlug que getPublic acepta.
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: link.tenantId },
      select: { slug: true },
    });
    if (!tenant) throw new NotFoundException('No disponible');
    return this.getPublic(tenant.slug, link.slug, localeRaw);
  }
}
