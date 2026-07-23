import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { OnboardingWebhookService } from './onboarding-webhook.service';

// Onboarding Sync API — Fase C. Escrituras por entidad, TODAS scoped al
// tenantId que resuelve el token (nunca del body). Upsert NO destructivo: crea
// o actualiza, nunca borra lo que el negocio agregó a mano (excepto horarios,
// que son un set completo intencional). Idempotencia por llaves estables:
// categorías por slug(name), productos por (name, categoría), cupones por name.

function slugify(input: string): string {
  const s = (input || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || 'item';
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : v == null ? undefined : String(v);
}
function money(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) {
    throw new BadRequestException('Precio inválido (número >= 0).');
  }
  return n;
}
function decimal(v: unknown, label: string): Prisma.Decimal {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new BadRequestException(`${label} inválido.`);
  return new Prisma.Decimal(n);
}
function dateOrNull(v: unknown): Date | null {
  if (v == null || v === '') return null;
  const d = new Date(String(v));
  if (isNaN(d.getTime())) throw new BadRequestException('Fecha inválida (ISO).');
  return d;
}

// Estilo/plantilla del menú: los 8 nombres del onboarding → enum MenuLayout de
// Clubify. Acepta también los valores nativos (uppercase). Desconocido → null
// (se ignora, no rompe el sync).
const MENU_LAYOUT_MAP: Record<string, string> = {
  classic: 'CLASSIC',
  grid: 'GRID',
  hero: 'CAROUSELS',
  clean: 'CLEAN',
  compact: 'COMPACT',
  dark: 'CLUVI',
  premium: 'SECTIONS',
  flipbook: 'FLIPBOOK',
  // alias directos a los valores nativos de Clubify
  carousels: 'CAROUSELS',
  cluvi: 'CLUVI',
  sections: 'SECTIONS',
};
function mapMenuLayout(v: unknown): string | null {
  if (!v) return null;
  return MENU_LAYOUT_MAP[String(v).trim().toLowerCase()] ?? null;
}

// Saneo de URL para botones del infolink: solo http(s). Un dominio pelado se
// promueve a https://. Esquemas peligrosos (javascript:, data:) → ''.
function safeUrl(u: unknown): string {
  const s = String(u ?? '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|\?|#|$)/i.test(s)) return 'https://' + s;
  return '';
}
function extractPhone(u: unknown): string | null {
  const d = String(u ?? '').replace(/\D/g, '');
  return d.length >= 7 ? d : null;
}

// Mapea un botón del onboarding { label, type, url | popup_message } al shape de
// botón de Clubify (JSON en InfoLink.buttons). Los tipos nativos de Clubify que
// NO leen `url` (MENU/MAPS) solo se usan si NO viene url; con url se degrada a
// EXTERNAL para honrar el destino que mandó el onboarding. Devuelve null si el
// botón no tiene destino válido (se descarta).
function mapInfolinkButton(raw: any): Record<string, any> | null {
  const label = (str(raw?.label) ?? '').trim() || 'Ver';
  const type = String(raw?.type ?? 'link').trim().toLowerCase();
  const url = safeUrl(raw?.url);
  const popupMsg = raw?.popup_message ?? raw?.popupMessage;
  if (type === 'popup') {
    return {
      label,
      type: 'POPUP',
      popup: {
        title: label,
        description: popupMsg != null ? String(popupMsg) : '',
        imageUrl: null,
        ctaText: '',
        ctaUrl: '',
      },
    };
  }
  if (type === 'whatsapp') {
    const phone = extractPhone(raw?.url);
    if (phone) return { label, type: 'WHATSAPP', waPhone: phone, waMessage: '' };
    return url ? { label, type: 'EXTERNAL', url } : null;
  }
  if (type === 'menu' && !url) return { label, type: 'MENU', menuVariant: 'DELIVERY' };
  if (type === 'maps' && !url) return { label, type: 'MAPS' };
  // link | reviews | social | reserva | (menu/maps con url) → EXTERNAL
  return url ? { label, type: 'EXTERNAL', url } : null;
}

// Push automáticas por evento → AutomationRule. trigger.type + título/cuerpo
// por defecto (del motor); el `message` del onboarding pisa el body.
const AUTOMATION_EVENT_MAP: Record<
  string,
  { trigger: Record<string, any>; title: string; defaultBody: string }
> = {
  welcome: {
    trigger: { type: 'PASS_CREATED' },
    title: '¡Bienvenido/a {{customerName}}! 🎉',
    defaultBody: 'Tu tarjeta {{cardName}} está activa. Empieza a sumar.',
  },
  birthday: {
    trigger: { type: 'BIRTHDAY' },
    title: '🎉 Feliz cumpleaños {{customerName}}',
    defaultBody: 'Ven a {{businessName}}, tenemos un obsequio para ti 🎁',
  },
  stamp: {
    trigger: { type: 'STAMP_ADDED' },
    title: '¡Sumaste un sello! ⭐',
    defaultBody: '¡Vas muy bien! Sigue sumando para tu recompensa.',
  },
  reward: {
    trigger: { type: 'PASS_COMPLETED' },
    title: '🎁 ¡Premio desbloqueado!',
    defaultBody: '{{rewardText}} es tuyo. Canjéalo en tu próxima visita.',
  },
  inactivity: {
    trigger: { type: 'INACTIVITY', days: 30 },
    title: 'Te extrañamos {{customerName}} 💌',
    defaultBody: 'Hace un mes que no nos vemos. ¡Te esperamos!',
  },
};

@Injectable()
export class OnboardingSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhook: OnboardingWebhookService,
  ) {}

  // ── 1. Datos del negocio ──────────────────────────────────────────────
  async syncBusiness(tenantId: string, b: any) {
    const data: Record<string, any> = {};
    // Requeridos-no-nulos: solo se setean si viene un valor no vacío.
    if (b.name && String(b.name).trim()) data.name = String(b.name).trim();
    if (b.brandName && String(b.brandName).trim())
      data.brandName = String(b.brandName).trim();
    if (b.email && String(b.email).trim()) data.email = String(b.email).trim();
    if (b.businessCategorySlug !== undefined)
      data.businessCategorySlug = b.businessCategorySlug
        ? slugify(String(b.businessCategorySlug))
        : null;
    if (b.country !== undefined && b.country)
      data.country = String(b.country).toUpperCase().slice(0, 2);
    for (const k of [
      'phone',
      'whatsappPhone',
      'whatsappOrdersPhone',
      'whatsappDeliveryPhone',
      'whatsappReservationsPhone',
      'city', // ju1053 Fase 3
    ]) {
      if (b[k] !== undefined) data[k] = b[k] ? String(b[k]) : null;
    }
    const updated = Object.keys(data);
    if (updated.length) {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: data as Prisma.TenantUpdateInput,
      });
    }
    // description (descripción corta del negocio) vive en Storefront (1:1), no
    // en Tenant. Se mapea acá para que el onboarding la mande junto al negocio.
    if (b.description !== undefined) {
      const desc = b.description ? String(b.description) : '';
      await this.prisma.storefront.upsert({
        where: { tenantId },
        create: { tenantId, description: desc },
        update: { description: desc },
      });
      updated.push('description');
    }
    return { ok: true, updated };
  }

  // ── 2. Branding ───────────────────────────────────────────────────────
  async syncBranding(tenantId: string, b: any) {
    const data: Record<string, any> = {};
    for (const k of ['logoUrl', 'walletLogoUrl', 'pushLogoUrl']) {
      if (b[k] !== undefined) data[k] = b[k] ? String(b[k]) : null;
    }
    for (const k of ['primaryColor', 'secondaryColor']) {
      if (b[k]) data[k] = String(b[k]); // no-nulos con default: solo si truthy
    }
    if (Object.keys(data).length) {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: data as Prisma.TenantUpdateInput,
      });
    }
    // Presentación de la vitrina (Storefront 1:1): portada del menú
    // (photo_menu_banner=heroImageUrl), estilo/plantilla del menú (menuLayout,
    // 8 valores) e imagen del popup del menú (photo_popup=popupImageUrl).
    const sf: Record<string, any> = {};
    if (b.heroImageUrl !== undefined)
      sf.heroImageUrl = b.heroImageUrl ? String(b.heroImageUrl) : null;
    if (b.menuLayout !== undefined) {
      const layout = mapMenuLayout(b.menuLayout);
      if (layout) sf.menuLayout = layout;
    }
    if (b.popupImageUrl !== undefined)
      sf.popupImageUrl = b.popupImageUrl ? String(b.popupImageUrl) : null;
    if (Object.keys(sf).length) {
      await this.prisma.storefront.upsert({
        where: { tenantId },
        create: { tenantId, ...sf },
        update: sf,
      });
    }
    return { ok: true };
  }

  // ── 3. Redes / contacto ───────────────────────────────────────────────
  async syncContact(tenantId: string, b: any) {
    const data: Record<string, any> = {};
    for (const k of [
      'instagramUrl',
      'facebookUrl',
      'mapsUrl',
      'whatsappPhone',
      'tiktokUrl', // ju1053 Fase 3
      'websiteUrl', // ju1053 Fase 3
    ]) {
      if (b[k] !== undefined) data[k] = b[k] ? String(b[k]) : null;
    }
    if (!Object.keys(data).length) return { ok: true, updated: [] };
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: data as Prisma.TenantUpdateInput,
    });
    return { ok: true, updated: Object.keys(data) };
  }

  // ── 4. Google Reviews ─────────────────────────────────────────────────
  async syncReviews(tenantId: string, b: any) {
    const data: Record<string, any> = {};
    if (b.googleReviewUrl !== undefined)
      data.googleReviewUrl = b.googleReviewUrl ? String(b.googleReviewUrl) : null;
    // alert_phone: número que recibe el aviso cuando un cliente califica 1-3★
    // (las 4-5★ van a Google). Acepta reviewAlertsPhone o alertPhone. Al llegar
    // un número se activa el aviso; al limpiarlo, se desactiva.
    if (b.reviewAlertsPhone !== undefined || b.alertPhone !== undefined) {
      const raw = b.reviewAlertsPhone ?? b.alertPhone;
      data.reviewAlertsPhone = raw ? String(raw) : null;
      data.reviewAlertsEnabled = !!raw;
    }
    if (b.reviewAlertsThreshold !== undefined && b.reviewAlertsThreshold !== null) {
      const th = Math.min(5, Math.max(1, Math.floor(Number(b.reviewAlertsThreshold))));
      if (Number.isFinite(th)) data.reviewAlertsThreshold = th;
    }
    if (!Object.keys(data).length) return { ok: true, updated: [] };
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: data as Prisma.TenantUpdateInput,
    });
    return { ok: true, updated: Object.keys(data) };
  }

  // ── 5. Sede / ubicación (la primera del negocio) ──────────────────────
  async syncLocation(tenantId: string, b: any) {
    const existing = await this.prisma.location.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const data: Record<string, any> = {};
    if (b.address !== undefined) data.address = String(b.address ?? '');
    if (b.mapsUrl !== undefined) data.mapsUrl = b.mapsUrl ? String(b.mapsUrl) : null;
    if (b.latitude !== undefined && b.latitude !== null)
      data.latitude = decimal(b.latitude, 'latitude');
    if (b.longitude !== undefined && b.longitude !== null)
      data.longitude = decimal(b.longitude, 'longitude');
    if (existing) {
      await this.prisma.location.update({ where: { id: existing.id }, data });
      return { ok: true, location_id: existing.id, created: false };
    }
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { brandName: true },
    });
    const created = await this.prisma.location.create({
      data: {
        tenantId,
        name: (b.name ? String(b.name) : '') || t?.brandName || 'Principal',
        address: data.address ?? '',
        latitude: data.latitude ?? new Prisma.Decimal(0),
        longitude: data.longitude ?? new Prisma.Decimal(0),
        mapsUrl: data.mapsUrl ?? null,
      },
    });
    return { ok: true, location_id: created.id, created: true };
  }

  // ── 6. Programa de sellos (la tarjeta STAMPS del negocio) ─────────────
  async syncLoyaltyCard(tenantId: string, b: any) {
    const name = str(b.name)?.trim();
    const data: Record<string, any> = {};
    if (name) data.name = name;
    if (b.stampsRequired !== undefined)
      data.stampsRequired =
        b.stampsRequired == null ? null : Math.max(1, Math.floor(Number(b.stampsRequired)));
    for (const k of [
      'rewardText',
      'rewardDescText',
      'description',
      'rewardEarnedMessage',
      'stampEarnedMessage',
      'stampIcon',
    ]) {
      if (b[k] !== undefined && b[k] != null) data[k] = String(b[k]);
    }
    for (const k of ['primaryColor', 'secondaryColor']) {
      if (b[k]) data[k] = String(b[k]);
    }
    // Fondo de la tarjeta de fidelidad (photo_card_android). Al setear una
    // imagen activamos stampBgType=IMAGE para que se renderice detrás de los
    // sellos; al limpiarla NO tocamos el tipo (queda en su default previo).
    if (b.stampBgImageUrl !== undefined) {
      const url = b.stampBgImageUrl ? String(b.stampBgImageUrl) : null;
      data.stampBgImageUrl = url;
      if (url) data.stampBgType = 'IMAGE';
    }
    const existing = await this.prisma.card.findFirst({
      where: { tenantId, type: 'STAMPS' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.card.update({ where: { id: existing.id }, data });
      return { ok: true, card_id: existing.id, created: false };
    }
    if (!name) {
      throw new BadRequestException(
        'Para crear la tarjeta de sellos se requiere `name`.',
      );
    }
    const created = await this.prisma.card.create({
      data: { tenantId, type: 'STAMPS', ...data, name },
    });
    return { ok: true, card_id: created.id, created: true };
  }

  // ── 7. Horarios (set completo a nivel negocio) ────────────────────────
  async syncHours(tenantId: string, items: any) {
    if (!Array.isArray(items)) {
      throw new BadRequestException('Se espera un arreglo de horarios.');
    }
    const rows = items.map((h: any, i: number) => {
      const weekday = Math.floor(Number(h?.weekday));
      const startMin = Math.floor(Number(h?.startMin));
      const endMin = Math.floor(Number(h?.endMin));
      if (!(weekday >= 0 && weekday <= 6)) {
        throw new BadRequestException(
          `weekday inválido en item ${i} (0=domingo … 6=sábado).`,
        );
      }
      if (!(startMin >= 0 && startMin < 1440 && endMin > startMin && endMin <= 1440)) {
        throw new BadRequestException(
          `Rango inválido en item ${i} (minutos 0–1440, end>start).`,
        );
      }
      return { tenantId, weekday, startMin, endMin };
    });
    await this.prisma.$transaction([
      this.prisma.serviceAvailability.deleteMany({
        where: { tenantId, providerId: null },
      }),
      ...(rows.length
        ? [this.prisma.serviceAvailability.createMany({ data: rows })]
        : []),
    ]);
    return { ok: true, count: rows.length };
  }

  // ── 8. Módulos / funcionalidades ──────────────────────────────────────
  async syncModules(tenantId: string, b: any) {
    const tData: Record<string, any> = {};
    if (b.reservations !== undefined) tData.reservationsEnabled = !!b.reservations;
    if (b.serviceReservations !== undefined)
      tData.serviceReservationsEnabled = !!b.serviceReservations;
    if (Object.keys(tData).length) {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: tData as Prisma.TenantUpdateInput,
      });
    }
    const sData: Record<string, any> = {};
    if (b.digitalMenu !== undefined) sData.digitalMenuEnabled = !!b.digitalMenu;
    if (b.orders !== undefined) sData.ordersEnabled = !!b.orders;
    if (b.ordersDelivery !== undefined)
      sData.ordersDeliveryEnabled = !!b.ordersDelivery;
    if (b.published !== undefined) sData.isPublished = !!b.published;
    if (Object.keys(sData).length) {
      await this.prisma.storefront.upsert({
        where: { tenantId },
        create: { tenantId, ...sData },
        update: sData,
      });
    }
    return { ok: true };
  }

  // ── 9. Categorías del menú (upsert por slug, no destructivo) ──────────
  async upsertCategories(tenantId: string, items: any) {
    if (!Array.isArray(items)) {
      throw new BadRequestException('Se espera un arreglo de categorías.');
    }
    const out: any[] = [];
    for (const c of items) {
      const name = str(c?.name)?.trim();
      if (!name) throw new BadRequestException('Cada categoría requiere `name`.');
      const slug = slugify(name);
      const data: Record<string, any> = { name };
      if (c.description !== undefined)
        data.description = c.description ? String(c.description) : null;
      if (c.imageUrl !== undefined)
        data.imageUrl = c.imageUrl ? String(c.imageUrl) : null;
      if (c.position !== undefined) data.position = Math.floor(Number(c.position)) || 0;
      const existing = await this.prisma.category.findFirst({
        where: { tenantId, parentId: null, slug },
        select: { id: true },
      });
      if (existing) {
        await this.prisma.category.update({ where: { id: existing.id }, data });
        out.push({ name, slug, id: existing.id, created: false });
      } else {
        const created = await this.prisma.category.create({
          data: { tenantId, slug, ...data } as Prisma.CategoryUncheckedCreateInput,
        });
        out.push({ name, slug, id: created.id, created: true });
      }
    }
    return { ok: true, categories: out };
  }

  // ── 10. Productos del menú (upsert por name+categoría, no destructivo) ─
  async upsertProducts(tenantId: string, items: any) {
    if (!Array.isArray(items)) {
      throw new BadRequestException('Se espera un arreglo de productos.');
    }
    const out: any[] = [];
    for (const p of items) {
      const name = str(p?.name)?.trim();
      if (!name) throw new BadRequestException('Cada producto requiere `name`.');
      // Resuelve la categoría por slug (de categorySlug o categoryName).
      let categoryId: string | null = null;
      const catRef = p.categorySlug || p.categoryName;
      if (catRef) {
        const cat = await this.prisma.category.findFirst({
          where: { tenantId, slug: slugify(String(catRef)) },
          select: { id: true },
        });
        categoryId = cat?.id ?? null;
      }
      const data: Record<string, any> = { name };
      if (p.description !== undefined)
        data.description = p.description ? String(p.description) : '';
      if (p.basePrice !== undefined)
        data.basePrice = new Prisma.Decimal(money(p.basePrice));
      if (p.imageUrl !== undefined)
        data.imageUrl = p.imageUrl ? String(p.imageUrl) : null;
      if (p.isAvailable !== undefined) data.isAvailable = !!p.isAvailable;
      if (p.isRecommended !== undefined) data.isRecommended = !!p.isRecommended;
      if (p.position !== undefined) data.position = Math.floor(Number(p.position)) || 0;
      const existing = await this.prisma.product.findFirst({
        where: { tenantId, name, categoryId },
        select: { id: true },
      });
      if (existing) {
        await this.prisma.product.update({
          where: { id: existing.id },
          data: { ...data, categoryId },
        });
        out.push({ name, id: existing.id, created: false });
      } else {
        if (p.basePrice === undefined) {
          throw new BadRequestException(
            `El producto "${name}" requiere \`basePrice\` para crearse.`,
          );
        }
        const created = await this.prisma.product.create({
          data: { tenantId, categoryId, ...data } as Prisma.ProductUncheckedCreateInput,
        });
        out.push({ name, id: created.id, created: true });
      }
    }
    return { ok: true, products: out };
  }

  // ── 11. Cupones (Card type COUPON, upsert por name, no destructivo) ───
  async upsertCoupons(tenantId: string, items: any) {
    if (!Array.isArray(items)) {
      throw new BadRequestException('Se espera un arreglo de cupones.');
    }
    const out: any[] = [];
    for (const c of items) {
      const name = str(c?.name)?.trim();
      if (!name) throw new BadRequestException('Cada cupón requiere `name`.');
      const data: Record<string, any> = { name };
      if (c.description !== undefined)
        data.description = c.description ? String(c.description) : '';
      if (c.terms !== undefined) data.terms = c.terms ? String(c.terms) : '';
      if (c.imageUrl !== undefined)
        data.heroImageUrl = c.imageUrl ? String(c.imageUrl) : null;
      // ju1053 Fase 3: código canjeable + cantidad disponible (antes iban en
      // `terms`; ahora en campos reales). Acepta code/couponCode y
      // quantity/couponQuantity. quantity null/inválido = sin límite declarado.
      if (c.couponCode !== undefined || c.code !== undefined) {
        const code = c.couponCode ?? c.code;
        data.couponCode = code ? String(code) : null;
      }
      if (c.couponQuantity !== undefined || c.quantity !== undefined) {
        const q = c.couponQuantity ?? c.quantity;
        const n = q == null ? null : Math.max(0, Math.floor(Number(q)));
        data.couponQuantity = Number.isFinite(n) ? n : null;
      }
      if (c.validFrom !== undefined) data.validFrom = dateOrNull(c.validFrom);
      if (c.validUntil !== undefined) data.validUntil = dateOrNull(c.validUntil);
      const existing = await this.prisma.card.findFirst({
        where: { tenantId, type: 'COUPON', name },
        select: { id: true },
      });
      if (existing) {
        await this.prisma.card.update({ where: { id: existing.id }, data });
        out.push({ name, id: existing.id, created: false });
      } else {
        const created = await this.prisma.card.create({
          data: { tenantId, type: 'COUPON', ...data, name },
        });
        out.push({ name, id: created.id, created: true });
      }
    }
    return { ok: true, coupons: out };
  }

  // ── 11b. Infolink (link-in-bio) — upsert por negocio, reemplaza botones ──
  async syncInfolink(tenantId: string, b: any) {
    const data: Record<string, any> = {};
    if (b.title !== undefined) data.title = b.title ? String(b.title) : '';
    // description del onboarding → subtitle; cover → heroImageUrl.
    if (b.subtitle !== undefined)
      data.subtitle = b.subtitle ? String(b.subtitle) : null;
    else if (b.description !== undefined)
      data.subtitle = b.description ? String(b.description) : null;
    if (b.cover !== undefined || b.heroImageUrl !== undefined) {
      const cover = b.cover ?? b.heroImageUrl;
      data.heroImageUrl = cover ? String(cover) : null;
    }
    if (Array.isArray(b.buttons)) {
      data.buttons = (b.buttons as any[]).map(mapInfolinkButton).filter(Boolean);
    }
    const existing = await this.prisma.infoLink.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.infoLink.update({ where: { id: existing.id }, data });
      return { ok: true, infolink_id: existing.id, created: false };
    }
    const created = await this.prisma.infoLink.create({
      data: {
        tenantId,
        slug: 'infolink',
        title: data.title ?? '',
        subtitle: data.subtitle ?? null,
        heroImageUrl: data.heroImageUrl ?? null,
        buttons: (data.buttons ?? []) as any,
      },
    });
    return { ok: true, infolink_id: created.id, created: true };
  }

  // ── 11c. Push automáticas por evento → AutomationRule (upsert por trigger) ──
  async syncAutomations(tenantId: string, b: any) {
    const updated: string[] = [];
    for (const key of Object.keys(AUTOMATION_EVENT_MAP)) {
      const incoming = b?.[key];
      if (incoming === undefined || incoming === null) continue;
      const def = AUTOMATION_EVENT_MAP[key];
      const enabled = !!incoming.enabled;
      const msg = incoming.message != null ? String(incoming.message).trim() : '';
      const actions = [
        { type: 'SEND_PUSH', title: def.title, body: msg || def.defaultBody },
      ];
      // Buscar la regla existente de ESE evento (por trigger.type) para no
      // duplicar. El onboarding es la fuente de verdad de estos mensajes.
      const existing = await this.prisma.automationRule.findFirst({
        where: {
          tenantId,
          trigger: { path: ['type'], equals: def.trigger.type },
        },
        select: { id: true },
      });
      if (existing) {
        await this.prisma.automationRule.update({
          where: { id: existing.id },
          data: {
            isActive: enabled,
            trigger: def.trigger as any,
            actions: actions as any,
          },
        });
      } else {
        await this.prisma.automationRule.create({
          data: {
            tenantId,
            name: `Onboarding: ${key}`,
            description: 'Sincronizado desde el onboarding.',
            trigger: def.trigger as any,
            conditions: [] as any,
            actions: actions as any,
            isActive: enabled,
          },
        });
      }
      updated.push(key);
    }
    return { ok: true, updated };
  }

  // ── 12. Publicar / activar el negocio ─────────────────────────────────
  async activate(tenantId: string) {
    const t = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { status: 'ACTIVE' },
      select: { id: true, brandName: true, phone: true, slug: true },
    });
    await this.prisma.storefront.upsert({
      where: { tenantId },
      create: { tenantId, isPublished: true },
      update: { isPublished: true },
    });
    // Fase D: webhook saliente `business.activated` (fire-and-forget, best-effort).
    void this.webhook.emitBusinessActivated(tenantId);
    return {
      ok: true,
      business_id: t.id,
      name: t.brandName,
      phone: t.phone,
      slug: t.slug,
      status: 'ACTIVE',
    };
  }
}
