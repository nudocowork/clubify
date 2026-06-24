import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { SuperAdminService } from './superadmin.service';
import { PrismaService } from '../common/prisma/prisma.service';

export type IconPurpose = 'any' | 'maskable' | 'apple';

/** Sujeto del icono ya resuelto: la imagen de origen + identidad para el
 *  fallback (inicial sobre color). Lo produce una marca o un negocio. */
type IconSubject = {
  source: string | null;
  name: string;
  primaryColor: string;
  backgroundColor: string | null;
};

/**
 * Generador de iconos de marca AL VUELO. Toma la única imagen que la marca ya
 * subió (faviconUrl → iconUrl → logoUrl) y produce el tamaño/propósito pedido
 * con `sharp`. Así una marca que sube SOLO su símbolo obtiene automáticamente
 * todas las variantes (favicon 16/32/48, apple-touch 180 opaco, PWA 192/512 y
 * maskable) sin re-subir nada — y sin heredar ningún icono de Clubify.
 *
 * - `any`      → fondo transparente, padding mínimo (favicon / PWA estándar).
 * - `maskable` → zona segura del 80% sobre fondo sólido (Android enmascara a
 *                círculo/squircle y recorta los bordes).
 * - `apple`    → 180×180 OPACO. iOS no soporta transparencia en el icono del
 *                home screen (lo pinta negro); por eso se compone sobre fondo.
 *
 * Si la marca no tiene ninguna imagen, genera un mosaico con su inicial sobre
 * `primaryColor` (nunca el icono verde de Clubify).
 */
@Injectable()
export class BrandIconService {
  private logger = new Logger(BrandIconService.name);

  constructor(
    private svc: SuperAdminService,
    private prisma: PrismaService,
  ) {}

  async generate(opts: {
    slug?: string;
    host?: string;
    tenantSlug?: string;
    size: number;
    purpose: IconPurpose;
  }): Promise<{ buffer: Buffer; contentType: string } | null> {
    const size = Math.max(16, Math.min(1024, Math.round(opts.size || 192)));
    const purpose: IconPurpose = opts.purpose ?? 'any';

    const subject = await this.resolveSubject(opts);
    if (!subject) return null;

    const source = subject.source;
    // Fondo: transparente para `any`; sólido (background o blanco) para los
    // propósitos opacos (apple/maskable).
    const bgHex =
      purpose === 'any' ? null : subject.backgroundColor || '#ffffff';
    // Zona segura: maskable necesita ~18% de margen por lado (Android recorta
    // hasta el 20%). apple un margen pequeño; `any` casi nada.
    const padRatio =
      purpose === 'maskable' ? 0.18 : purpose === 'apple' ? 0.1 : 0.06;

    const logoBuf = source ? await this.fetchImage(source) : null;
    if (!logoBuf) {
      return {
        buffer: await this.initialTile(
          subject.name,
          subject.primaryColor,
          size,
          purpose,
        ),
        contentType: 'image/png',
      };
    }

    try {
      const inner = Math.max(1, Math.round(size * (1 - padRatio * 2)));
      // density alta → SVGs de origen se rasterizan nítidos al ampliar.
      const resized = await sharp(logoBuf, { density: 384, failOn: 'none' })
        .resize(inner, inner, {
          fit: 'inside',
          withoutEnlargement: false,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();

      const bg = bgHex
        ? this.hexToRgba(bgHex, 1)
        : { r: 0, g: 0, b: 0, alpha: 0 };
      const out = await sharp({
        create: { width: size, height: size, channels: 4, background: bg },
      })
        .composite([{ input: resized, gravity: 'centre' }])
        .png({ compressionLevel: 9 })
        .toBuffer();
      return { buffer: out, contentType: 'image/png' };
    } catch (e: any) {
      this.logger.warn(
        `brand-icon generate failed (${e?.message ?? e}) — mosaico inicial`,
      );
      return {
        buffer: await this.initialTile(
          subject.name,
          subject.primaryColor,
          size,
          purpose,
        ),
        contentType: 'image/png',
      };
    }
  }

  /** Resuelve el sujeto del icono: un NEGOCIO (tenant) o una MARCA. Para el
   *  negocio la fuente es su logo → wallet logo → favicon/icon/logo de SU marca,
   *  y el fallback (sin imagen) es la inicial del negocio sobre su color. Nunca
   *  hereda Clubify. Para la marca, igual que antes. */
  private async resolveSubject(opts: {
    slug?: string;
    host?: string;
    tenantSlug?: string;
  }): Promise<IconSubject | null> {
    if (opts.tenantSlug) {
      const s = (opts.tenantSlug || '').trim().toLowerCase();
      if (!s) return null;
      // slug es único → findUnique evita el scoping por marca del middleware.
      const t = await this.prisma.tenant.findUnique({
        where: { slug: s },
        select: {
          logoUrl: true,
          walletLogoUrl: true,
          primaryColor: true,
          brandName: true,
          whiteLabel: {
            select: {
              faviconUrl: true,
              iconUrl: true,
              logoUrl: true,
              primaryColor: true,
              backgroundColor: true,
            },
          },
        },
      });
      if (!t) return null;
      const wl = t.whiteLabel;
      return {
        source:
          t.logoUrl ||
          t.walletLogoUrl ||
          wl?.faviconUrl ||
          wl?.iconUrl ||
          wl?.logoUrl ||
          null,
        name: t.brandName || 'N',
        primaryColor: t.primaryColor || wl?.primaryColor || '#16a34a',
        backgroundColor: wl?.backgroundColor || null,
      };
    }

    const brand = opts.slug
      ? await this.svc.getWhiteLabelBrandingBySlug(opts.slug)
      : opts.host
        ? await this.svc.getWhiteLabelBrandingByHost(opts.host)
        : null;
    if (!brand) return null;
    return {
      source: brand.faviconUrl || brand.iconUrl || brand.logoUrl || null,
      name: brand.name,
      primaryColor: brand.primaryColor,
      backgroundColor: brand.backgroundColor || null,
    };
  }

  private async fetchImage(url: string): Promise<Buffer | null> {
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      const ab = await r.arrayBuffer();
      return Buffer.from(ab);
    } catch {
      return null;
    }
  }

  /** Mosaico cuadrado con la inicial de la marca sobre su color. Para `any`
   *  redondea las esquinas (transparente fuera); para apple/maskable va a
   *  sangre completa (opaco). */
  private async initialTile(
    name: string,
    color: string | null | undefined,
    size: number,
    purpose: IconPurpose,
  ): Promise<Buffer> {
    const initial = (name?.trim()?.[0] ?? 'S').toUpperCase();
    const fill = color || '#16a34a';
    const fontSize = Math.round(size * 0.5);
    const rounded = purpose === 'any';
    const radius = rounded ? Math.round(size * 0.22) : 0;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${fill}"/><text x="50%" y="50%" dy="0.05em" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="${fontSize}" fill="#ffffff" text-anchor="middle" dominant-baseline="central">${initial}</text></svg>`;
    return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  }

  private hexToRgba(
    hex: string,
    alpha: number,
  ): { r: number; g: number; b: number; alpha: number } {
    const h = (hex || '').replace('#', '').trim();
    const full =
      h.length === 3
        ? h
            .split('')
            .map((c) => c + c)
            .join('')
        : h;
    const n = parseInt(full.slice(0, 6) || 'ffffff', 16);
    return {
      r: (n >> 16) & 255,
      g: (n >> 8) & 255,
      b: n & 255,
      alpha,
    };
  }
}
