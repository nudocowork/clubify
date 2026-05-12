import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

/** Pricing global de los planes Clubify usado por el módulo Cotizaciones
 * (SuperAdmin). Editables sin redeploy. Las cotizaciones congelan el
 * precio en su `priceSnapshot` al crearse, así que cambiar acá no rompe
 * cotizaciones viejas. */
export type PricingSettings = {
  eliteCost: number;
  proCost: number;
  currency: string;
};

export type BrandingSettings = {
  appLogoUrl: string | null;
  faviconUrl: string | null;
  supportWhatsapp: string | null;
  // Popup de bienvenida que se muestra al dueño la primera vez que entra
  // al panel después de comprar el servicio.
  welcomePopupImageUrl: string | null;
  welcomePopupEnabled: boolean;
  // PIN que el cajero debe ingresar en /scan cuando agrega más de 1
  // sello a una tarjeta (anti-abuso). El super admin lo configura.
  // Plain text — solo super admin lo lee, comparison se hace server-side.
  scannerStaffPin: string | null;
  // Datos de contacto comercial — usados en los CTAs de la landing
  // pública (Hablar con ventas, Instagram, email). Públicos.
  salesWhatsapp: string | null;
  salesEmail: string | null;
  salesInstagram: string | null;
};

const KEYS = {
  appLogoUrl: 'branding.appLogoUrl',
  faviconUrl: 'branding.faviconUrl',
  supportWhatsapp: 'support.whatsappPhone',
  welcomePopupImageUrl: 'welcomePopup.imageUrl',
  welcomePopupEnabled: 'welcomePopup.enabled',
  scannerStaffPin: 'scanner.staffPin',
  salesWhatsapp: 'sales.whatsappPhone',
  salesEmail: 'sales.email',
  salesInstagram: 'sales.instagramUrl',
  pricingEliteCost: 'pricing.eliteCost',
  pricingProCost: 'pricing.proCost',
  pricingCurrency: 'pricing.currency',
} as const;

const PRICING_DEFAULTS: PricingSettings = {
  eliteCost: 50,
  proCost: 99,
  currency: 'USD',
};

/** Devuelve true si el PIN provisto coincide con el seteado por el super
 * admin. Si no hay PIN configurado, también devuelve true (backwards
 * compat — no bloquea hasta que se configure). */
export async function checkScannerPin(prisma: any, providedPin: string | null | undefined): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: KEYS.scannerStaffPin } });
  const stored = row?.value?.trim();
  if (!stored) return true; // no configurado → permitir
  return (providedPin ?? '').trim() === stored;
}

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  /** Versión pública — NO incluye scannerStaffPin (sensitive). */
  async getBranding(): Promise<Omit<BrandingSettings, 'scannerStaffPin'>> {
    const full = await this.getBrandingAdmin();
    const { scannerStaffPin, ...rest } = full;
    void scannerStaffPin;
    return rest;
  }

  /** Versión admin — incluye TODO incluyendo el PIN. Solo super admin. */
  async getBrandingAdmin(): Promise<BrandingSettings> {
    const rows = await this.prisma.setting.findMany({
      where: {
        key: {
          in: [
            KEYS.appLogoUrl,
            KEYS.faviconUrl,
            KEYS.supportWhatsapp,
            KEYS.welcomePopupImageUrl,
            KEYS.welcomePopupEnabled,
            KEYS.scannerStaffPin,
            KEYS.salesWhatsapp,
            KEYS.salesEmail,
            KEYS.salesInstagram,
          ],
        },
      },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const norm = (v: string | undefined) => {
      if (!v) return null;
      const t = v.trim();
      return t.length > 0 ? t : null;
    };
    const enabledRaw = map.get(KEYS.welcomePopupEnabled);
    return {
      appLogoUrl: norm(map.get(KEYS.appLogoUrl)),
      faviconUrl: norm(map.get(KEYS.faviconUrl)),
      supportWhatsapp: norm(map.get(KEYS.supportWhatsapp)),
      welcomePopupImageUrl: norm(map.get(KEYS.welcomePopupImageUrl)),
      welcomePopupEnabled: enabledRaw === undefined ? true : enabledRaw !== 'false',
      scannerStaffPin: norm(map.get(KEYS.scannerStaffPin)),
      salesWhatsapp: norm(map.get(KEYS.salesWhatsapp)),
      salesEmail: norm(map.get(KEYS.salesEmail)),
      salesInstagram: norm(map.get(KEYS.salesInstagram)),
    };
  }

  async setBranding(data: Partial<BrandingSettings>): Promise<BrandingSettings> {
    const ops: Promise<unknown>[] = [];
    if (data.appLogoUrl !== undefined) {
      ops.push(this.upsert(KEYS.appLogoUrl, data.appLogoUrl ?? ''));
    }
    if (data.faviconUrl !== undefined) {
      ops.push(this.upsert(KEYS.faviconUrl, data.faviconUrl ?? ''));
    }
    if (data.supportWhatsapp !== undefined) {
      ops.push(this.upsert(KEYS.supportWhatsapp, data.supportWhatsapp ?? ''));
    }
    if (data.welcomePopupImageUrl !== undefined) {
      ops.push(this.upsert(KEYS.welcomePopupImageUrl, data.welcomePopupImageUrl ?? ''));
    }
    if (data.welcomePopupEnabled !== undefined) {
      ops.push(
        this.upsert(KEYS.welcomePopupEnabled, data.welcomePopupEnabled ? 'true' : 'false'),
      );
    }
    if (data.scannerStaffPin !== undefined) {
      // Trim + permitir vacío (desactiva el check)
      ops.push(this.upsert(KEYS.scannerStaffPin, (data.scannerStaffPin ?? '').trim()));
    }
    if (data.salesWhatsapp !== undefined) {
      ops.push(this.upsert(KEYS.salesWhatsapp, (data.salesWhatsapp ?? '').trim()));
    }
    if (data.salesEmail !== undefined) {
      ops.push(this.upsert(KEYS.salesEmail, (data.salesEmail ?? '').trim()));
    }
    if (data.salesInstagram !== undefined) {
      ops.push(this.upsert(KEYS.salesInstagram, (data.salesInstagram ?? '').trim()));
    }
    await Promise.all(ops);
    return this.getBrandingAdmin();
  }

  /** Lee precios fijos de Elite/Pro y moneda. Si no están seteados usa
   * los defaults de PRICING_DEFAULTS. Lectura pública: la cotización
   * la crea el super admin pero los precios igual pueden mostrarse en
   * landing o materiales públicos. */
  async getPricing(): Promise<PricingSettings> {
    const rows = await this.prisma.setting.findMany({
      where: {
        key: {
          in: [KEYS.pricingEliteCost, KEYS.pricingProCost, KEYS.pricingCurrency],
        },
      },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const num = (v: string | undefined, def: number) => {
      if (v === undefined) return def;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : def;
    };
    const currency = (map.get(KEYS.pricingCurrency) ?? '').trim();
    return {
      eliteCost: num(map.get(KEYS.pricingEliteCost), PRICING_DEFAULTS.eliteCost),
      proCost: num(map.get(KEYS.pricingProCost), PRICING_DEFAULTS.proCost),
      currency: currency || PRICING_DEFAULTS.currency,
    };
  }

  async setPricing(data: Partial<PricingSettings>): Promise<PricingSettings> {
    const ops: Promise<unknown>[] = [];
    if (data.eliteCost !== undefined) {
      ops.push(this.upsert(KEYS.pricingEliteCost, String(data.eliteCost)));
    }
    if (data.proCost !== undefined) {
      ops.push(this.upsert(KEYS.pricingProCost, String(data.proCost)));
    }
    if (data.currency !== undefined) {
      ops.push(this.upsert(KEYS.pricingCurrency, (data.currency ?? '').trim()));
    }
    await Promise.all(ops);
    return this.getPricing();
  }

  /** Cupón Hotmart global. Se aplica a TODOS los checkouts. String
   *  vacío = sin cupón. Hotmart aplica el descuento server-side al
   *  cargar la página de pago. */
  async getHotmartCoupon(): Promise<{ couponCode: string | null }> {
    const s = await this.prisma.setting.findUnique({
      where: { key: 'billing.hotmartCouponCode' },
    });
    const v = s?.value?.trim();
    return { couponCode: v ? v : null };
  }

  async setHotmartCoupon(
    couponCode: string | null,
  ): Promise<{ couponCode: string | null }> {
    const clean = couponCode?.trim() ?? '';
    await this.upsert('billing.hotmartCouponCode', clean);
    return { couponCode: clean ? clean : null };
  }

  /** Master prompt opcional para la IA Clubify — texto libre que se
   *  prepone al system prompt del support widget. El admin lo edita
   *  desde /admin/ai-knowledge para inyectar instrucciones / tono /
   *  features específicas sin tocar el código. */
  async getSupportMasterPrompt(): Promise<{ prompt: string | null }> {
    const s = await this.prisma.setting.findUnique({
      where: { key: 'support.masterPrompt' },
    });
    const v = s?.value?.trim();
    return { prompt: v ? v : null };
  }

  async setSupportMasterPrompt(
    prompt: string | null,
  ): Promise<{ prompt: string | null }> {
    const clean = prompt?.trim() ?? '';
    await this.upsert('support.masterPrompt', clean);
    return { prompt: clean ? clean : null };
  }

  private upsert(key: string, value: string) {
    return this.prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }
}
