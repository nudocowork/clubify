import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { SuperAdminService } from './superadmin.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { CacheAcotada } from '../common/cache-acotada';
import { descargarAcotado } from '../common/descarga-acotada';

export type IconPurpose = 'any' | 'maskable' | 'apple';

/**
 * Topes del generador. La ruta es PÚBLICA (la pide el `<head>` de cada menú,
 * InfoLink y panel) y descargaba el logo con `fetch` a pelo —sin tiempo
 * máximo ni tope de tamaño— y lo pasaba por `sharp` en CADA petición.
 */
const TIMEOUT_LOGO_MS = 5000;
/** Igual que el tope de subida de imágenes del panel (`media.service`). */
const MAX_BYTES_LOGO = 15 * 1024 * 1024;
/**
 * Diez minutos: la clave lleva la URL del logo y los colores, así que un
 * cambio de branding (subida nueva = URL nueva) no espera a que caduque. El
 * plazo solo cubre re-subir DISTINTO contenido a la misma URL.
 */
const TTL_ICONO_MS = 10 * 60_000;
/** Si el logo no bajó, el mosaico de respaldo se recuerda poco: puede ser un mal rato de R2. */
const TTL_TRAS_FALLO_MS = 30_000;

type IconoGenerado = { buffer: Buffer; contentType: string };

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

  /** Iconos ya generados, por (logo, colores, tamaño, propósito). */
  private readonly iconos = new CacheAcotada<IconoGenerado>({
    maxEntradas: 200,
    maxBytes: 16 * 1024 * 1024,
    pesar: (v) => v.buffer.length,
    ttlMs: TTL_ICONO_MS,
  });
  /** Logos descargados: un mismo logo sirve para todos los tamaños. */
  private readonly logos = new CacheAcotada<Buffer | null>({
    maxEntradas: 50,
    maxBytes: 32 * 1024 * 1024,
    pesar: (b) => b?.length ?? 0,
    ttlMs: TTL_ICONO_MS,
  });

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
  }): Promise<IconoGenerado | null> {
    const size = Math.max(16, Math.min(1024, Math.round(opts.size || 192)));
    const purpose: IconPurpose = opts.purpose ?? 'any';

    const subject = await this.resolveSubject(opts);
    if (!subject) return null;

    // La clave es lo que DIBUJA el icono, no lo que se pidió: `?v=` no llega
    // aquí, y con la clave por slug un cambio de logo seguiría sirviendo el
    // viejo — que el navegador guardaría como `immutable` para siempre.
    const clave = JSON.stringify([
      subject.source,
      subject.name,
      subject.primaryColor,
      subject.backgroundColor,
      size,
      purpose,
    ]);
    const hecho = this.iconos.get(clave);
    if (hecho) return hecho;
    const out = await this.dibujar(subject, size, purpose);
    this.iconos.set(clave, out.icono, out.logoFallo ? TTL_TRAS_FALLO_MS : undefined);
    return out.icono;
  }

  private async dibujar(
    subject: IconSubject,
    size: number,
    purpose: IconPurpose,
  ): Promise<{ icono: IconoGenerado; logoFallo: boolean }> {
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
        icono: {
          buffer: await this.initialTile(
            subject.name,
            subject.primaryColor,
            size,
            purpose,
          ),
          contentType: 'image/png',
        },
        // Sin logo configurado el mosaico ES el icono; con logo que no bajó,
        // es un respaldo que no conviene recordar mucho.
        logoFallo: !!source,
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
      return { icono: { buffer: out, contentType: 'image/png' }, logoFallo: false };
    } catch (e: any) {
      this.logger.warn(
        `brand-icon generate failed (${e?.message ?? e}) — mosaico inicial`,
      );
      return {
        icono: {
          buffer: await this.initialTile(
            subject.name,
            subject.primaryColor,
            size,
            purpose,
          ),
          contentType: 'image/png',
        },
        logoFallo: true,
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
    if (this.logos.has(url)) return this.logos.get(url) ?? null;
    try {
      // Con tiempo máximo y tope de bytes: un servidor lento colgaba la
      // petición pública, y uno que mandaba cientos de megas los metía
      // enteros en memoria antes de que `sharp` los rechazara.
      const r = await descargarAcotado(url, {
        timeoutMs: TIMEOUT_LOGO_MS,
        maxBytes: MAX_BYTES_LOGO,
      });
      const buf = r.ok ? r.buffer : null;
      this.logos.set(url, buf, buf ? undefined : TTL_TRAS_FALLO_MS);
      return buf;
    } catch (e: any) {
      this.logger.warn(`brand-icon: el logo no bajó (${e?.message ?? e})`);
      this.logos.set(url, null, TTL_TRAS_FALLO_MS);
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
