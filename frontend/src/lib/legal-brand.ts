import { headers } from 'next/headers';

/**
 * Resuelve la identidad de marca para las páginas legales (/legal/terms,
 * /legal/privacy) por HOST — el mismo patrón que usan favicon, login y la
 * landing. Cada marca blanca ve su PROPIO contenido legal (nombre, dominio,
 * correo, logo) SIN ninguna mención a Clubify. Default = Clubify cuando el
 * host es soyclubify.com / dev / sin match.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

export type LegalBrand = {
  isClubify: boolean;
  brandName: string;
  /** Quién opera el servicio (Clubify = "Nudo Creativo"; marca blanca = su nombre). */
  operator: string;
  /** Dominio público de la marca (ej. soyclubify.com / selleala.com). */
  domain: string;
  /** Cómo se nombra la pasarela de pago en el texto legal. */
  paymentProvider: string;
  contactEmail: string;
  privacyEmail: string;
  /** Logo subido de la marca (header de las páginas legales). null = usar <Logo>. */
  logoUrl: string | null;
};

const CLUBIFY: LegalBrand = {
  isClubify: true,
  brandName: 'Clubify',
  operator: 'Nudo Creativo',
  domain: 'soyclubify.com',
  paymentProvider: 'Hotmart',
  contactEmail: 'hola@soyclubify.com',
  privacyEmail: 'privacidad@soyclubify.com',
  logoUrl: null,
};

export async function resolveLegalBrand(): Promise<LegalBrand> {
  const host = (headers().get('host') ?? '').toLowerCase().split(':')[0];
  if (
    !host ||
    host === 'localhost' ||
    host.startsWith('127.') ||
    host.endsWith('soyclubify.com') ||
    host.endsWith('clubify.app')
  ) {
    return CLUBIFY;
  }
  try {
    const r = await fetch(
      `${API_URL}/api/superadmin-public/white-labels/branding-by-host?host=${encodeURIComponent(host)}`,
      { next: { revalidate: 60 } },
    );
    if (!r.ok) return CLUBIFY;
    const d = await r.json();
    if (!d || !d.slug || d.slug === 'clubify') return CLUBIFY;
    const name: string = d.name || host;
    const email: string = d.contactEmail || `hola@${host}`;
    return {
      isClubify: false,
      brandName: name,
      operator: name,
      domain: host,
      // Las marcas blancas no exponen la pasarela específica (aislamiento).
      paymentProvider: 'nuestra pasarela de pago segura',
      contactEmail: email,
      privacyEmail: email,
      logoUrl: d.logoUrl ?? null,
    };
  } catch {
    return CLUBIFY;
  }
}
