import type { Metadata } from 'next';

/**
 * Metadata de las páginas públicas de un negocio: lo que WhatsApp, Instagram
 * y Facebook pintan cuando alguien comparte el enlace.
 *
 * Una ruta que no exporta `generateMetadata` hereda la del layout raíz, o sea
 * el logo y el título de **Clubify**. Un negocio de Sellea compartía su enlace
 * y salía la marca de otra plataforma. Ver [[clubify-fugas-de-marca]].
 *
 * LA REGLA: sin datos del negocio NO se pinta nada. Un preview vacío no delata
 * a nadie; uno inventado sí. Nunca un `?? 'Clubify'` ni una imagen de la
 * plataforma como respaldo.
 */

const API =
  process.env.BACKEND_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4949';

const ICON_API =
  process.env.NEXT_PUBLIC_API_URL ?? 'https://api.soyclubify.com';

/** Lo mínimo que necesitamos de cualquier endpoint público de negocio. */
export type NegocioPublico = {
  brandName?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  description?: string | null;
  heroImageUrl?: string | null;
  brand?: { name?: string | null; primaryColor?: string | null } | null;
};

/** Trae el negocio desde un endpoint público. `null` si no resuelve. */
export async function traerNegocio(
  ruta: string,
): Promise<NegocioPublico | null> {
  try {
    // 5 min de caché: estas páginas se comparten en ráfagas y el preview lo
    // pide cada cliente de mensajería que toca el enlace.
    const res = await fetch(`${API}${ruta}`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const d = (await res.json()) as NegocioPublico;
    return d?.brandName?.trim() ? d : null;
  } catch {
    return null;
  }
}

/**
 * Arma la metadata a partir del negocio. `slug` se usa para los iconos, que
 * los genera el backend cuadrados y opacos desde el logo del negocio — nunca
 * la imagen cruda, que siendo ancha sale pixelada en un acceso directo.
 */
export function metadataDeNegocio(opts: {
  negocio: NegocioPublico | null;
  slug: string;
  /** Se antepone al nombre del negocio: "Menú de …", "Tu tarjeta de …". */
  sufijo?: string;
  descripcion?: (nombre: string) => string;
  /** Título cuando no hay negocio. Genérico a propósito. */
  vacio: string;
}): Metadata {
  const n = opts.negocio;
  if (!n?.brandName?.trim()) return { title: opts.vacio };

  const negocio = n.brandName.trim();
  const titulo = opts.sufijo ? `${negocio} · ${opts.sufijo}` : negocio;
  const descripcion =
    n.description?.trim() ||
    (opts.descripcion ? opts.descripcion(negocio) : negocio);

  const imagen = n.heroImageUrl?.trim() || n.logoUrl?.trim() || null;

  const v =
    (n.logoUrl || opts.slug || '1')
      .toString()
      .slice(-16)
      .replace(/[^a-zA-Z0-9]/g, '') || '1';
  const icono = (size: number, purpose: 'any' | 'apple') =>
    `${ICON_API}/api/superadmin-public/white-labels/icon?tenant=${encodeURIComponent(
      opts.slug,
    )}&size=${size}&purpose=${purpose}&v=${v}`;

  const color = n.primaryColor || n.brand?.primaryColor;

  return {
    title: titulo,
    description: descripcion,
    openGraph: {
      title: titulo,
      description: descripcion,
      // `siteName` es lo que la app de mensajería muestra como origen: el
      // negocio, no la plataforma que lo hospeda.
      siteName: negocio,
      ...(imagen ? { images: [{ url: imagen, alt: negocio }] } : {}),
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title: titulo,
      description: descripcion,
      ...(imagen ? { images: [imagen] } : {}),
    },
    icons: {
      icon: [
        { url: icono(32, 'any'), sizes: '32x32', type: 'image/png' },
        { url: icono(48, 'any'), sizes: '48x48', type: 'image/png' },
        { url: icono(192, 'any'), sizes: '192x192', type: 'image/png' },
      ],
      shortcut: [{ url: icono(48, 'any') }],
      apple: [{ url: icono(180, 'apple'), sizes: '180x180', type: 'image/png' }],
    },
    ...(color ? { themeColor: color } : {}),
  };
}
