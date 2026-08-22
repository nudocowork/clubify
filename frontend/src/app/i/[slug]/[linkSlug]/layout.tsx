import type { Metadata } from 'next';

const API =
  process.env.BACKEND_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4949';

/**
 * Vista previa del InfoLink al compartirlo (WhatsApp, Instagram, Facebook).
 *
 * Esta ruta no generaba metadata, así que heredaba la del layout raíz: cuando
 * un negocio mandaba su enlace, WhatsApp pintaba el logo y el título de
 * **Clubify**, no los suyos. El negocio comparte lo suyo y sale la marca de la
 * plataforma — justo lo contrario de lo que queremos.
 *
 * Ahora la miniatura es el logo del NEGOCIO y el título su nombre. La URL no
 * cambia: los enlaces ya compartidos siguen funcionando igual, solo cambia lo
 * que se ve al previsualizarlos.
 *
 * Mismo patrón que `/m/[slug]/layout.tsx`. Ver [[clubify-fugas-de-marca]].
 */
export async function generateMetadata({
  params,
}: {
  params: { slug: string; linkSlug: string };
}): Promise<Metadata> {
  // Sin datos del negocio NO se pinta nada de la plataforma: un preview vacío
  // no delata a nadie, uno con la marca de Clubify sí.
  const vacio: Metadata = { title: 'Enlace' };

  try {
    const res = await fetch(
      `${API}/api/public/i/${params.slug}/${params.linkSlug}`,
      { next: { revalidate: 300 } },
    );
    if (!res.ok) return vacio;

    const d = await res.json();
    const negocio: string | undefined = d?.tenant?.brandName?.trim();
    if (!negocio) return vacio;

    const link = d?.link ?? {};
    // El título del link suele venir vacío (el negocio pone su nombre en el
    // banner); en ese caso manda el nombre del negocio, nunca un genérico.
    const titulo = link.title?.trim() || negocio;
    const descripcion =
      link.subtitle?.trim() ||
      d?.tenant?.description?.trim() ||
      `Todos los enlaces de ${negocio} en un solo lugar.`;

    // La miniatura: el logo del negocio. Si no tiene, el banner del link.
    // No hay fallback a una imagen de la plataforma.
    const imagen: string | null =
      d?.tenant?.logoUrl?.trim() ||
      link.theme?.bannerConfig?.imageUrl?.trim() ||
      null;

    // Iconos del negocio por el generador (cuadrado, opaco), igual que el
    // storefront. Nunca la imagen cruda: un logo ancho sale pixelado.
    const ICON_API =
      process.env.NEXT_PUBLIC_API_URL ?? 'https://api.soyclubify.com';
    const v =
      (d?.tenant?.logoUrl || params.slug || '1')
        .toString()
        .slice(-16)
        .replace(/[^a-zA-Z0-9]/g, '') || '1';
    const icono = (size: number, purpose: 'any' | 'apple') =>
      `${ICON_API}/api/superadmin-public/white-labels/icon?tenant=${encodeURIComponent(
        params.slug,
      )}&size=${size}&purpose=${purpose}&v=${v}`;

    const color = d?.tenant?.primaryColor || d?.tenant?.brand?.primaryColor;

    return {
      title: titulo,
      description: descripcion,
      openGraph: {
        title: titulo,
        description: descripcion,
        // siteName es lo que WhatsApp muestra como origen: el negocio.
        siteName: negocio,
        ...(imagen
          ? { images: [{ url: imagen, alt: negocio }] }
          : {}),
        type: 'website',
      },
      twitter: {
        // Sin logo cuadrado grande, `summary` se ve mejor que
        // `summary_large_image` recortando un logo.
        card: imagen ? 'summary' : 'summary',
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
        apple: [
          { url: icono(180, 'apple'), sizes: '180x180', type: 'image/png' },
        ],
      },
      ...(color ? { themeColor: color } : {}),
    };
  } catch {
    return vacio;
  }
}

export default function InfoLinkLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
