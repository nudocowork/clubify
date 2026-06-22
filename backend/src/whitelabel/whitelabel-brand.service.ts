import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Branding normalizado de una marca blanca, listo para exponer en superficies
 * públicas (storefront, tarjeta, QR, pass) y heredarse a los negocios. La
 * atribución ("Hecho con X" / "Creado por X" / "Powered by X") se DERIVA del
 * nombre — no hay literal de marca hardcodeado.
 */
export type ResolvedBrand = {
  id: string | null;
  name: string;
  slug: string;
  logoUrl: string | null;
  iconUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  secondaryColor: string | null;
  instagram: string | null;
  contactEmail: string | null;
  initial: string;
  /** Dominio público de la marca (https://…), derivado de domain/appDomain. */
  websiteUrl: string;
  attribution: { madeWith: string; createdBy: string; poweredBy: string };
};

const WL_SELECT = {
  id: true,
  slug: true,
  name: true,
  domain: true,
  appDomain: true,
  logoUrl: true,
  iconUrl: true,
  faviconUrl: true,
  primaryColor: true,
  secondaryColor: true,
  instagram: true,
  contactEmail: true,
  initial: true,
} as const;

/**
 * Fuente ÚNICA de branding por marca para las superficies de negocio/cliente.
 * Un negocio resuelve SIEMPRE su marca desde `tenant.whiteLabelId` (NO por host
 * — un negocio Sellea puede verse en un host Clubify). Si no tiene marca
 * (legacy), cae al row real `clubify` (NUNCA una constante de código).
 */
@Injectable()
export class WhitelabelBrandService {
  constructor(private prisma: PrismaService) {}

  static attribution(name: string) {
    return {
      madeWith: `Hecho con ${name}`,
      createdBy: `Creado por ${name}`,
      poweredBy: `Powered by ${name}`,
    };
  }

  /** Resuelve la marca por su id; null → row `clubify`. */
  async resolveByWhiteLabelId(
    whiteLabelId: string | null | undefined,
  ): Promise<ResolvedBrand> {
    let wl: any = null;
    if (whiteLabelId) {
      wl = await this.prisma.whiteLabel
        .findUnique({ where: { id: whiteLabelId }, select: WL_SELECT })
        .catch(() => null);
    }
    if (!wl) {
      wl = await this.prisma.whiteLabel
        .findFirst({ where: { slug: 'clubify' }, select: WL_SELECT })
        .catch(() => null);
    }
    return this.normalize(wl);
  }

  /** Resuelve la marca de un negocio (por tenantId). */
  async resolveTenant(tenantId: string): Promise<ResolvedBrand> {
    const t = await this.prisma.tenant
      .findUnique({
        where: { id: tenantId },
        select: { whiteLabelId: true },
      })
      .catch(() => null);
    return this.resolveByWhiteLabelId(t?.whiteLabelId ?? null);
  }

  /** Normaliza un row de WhiteLabel (o null) al shape público. */
  normalize(wl: any): ResolvedBrand {
    const name: string = (wl?.name && String(wl.name).trim()) || 'Clubify';
    const rawDomain: string =
      wl?.domain || wl?.appDomain || 'soyclubify.com';
    const domain = String(rawDomain).replace(/^https?:\/\//, '').replace(/\/+$/, '');
    return {
      id: wl?.id ?? null,
      name,
      slug: wl?.slug ?? 'clubify',
      logoUrl: wl?.logoUrl ?? null,
      iconUrl: wl?.iconUrl ?? null,
      faviconUrl: wl?.faviconUrl ?? null,
      primaryColor: wl?.primaryColor || '#22C55E',
      secondaryColor: wl?.secondaryColor ?? null,
      instagram: wl?.instagram ?? null,
      contactEmail: wl?.contactEmail ?? null,
      initial: (wl?.initial && String(wl.initial).trim()) || name[0]?.toUpperCase() || 'C',
      websiteUrl: `https://${domain}`,
      attribution: WhitelabelBrandService.attribution(name),
    };
  }
}
