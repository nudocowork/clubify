import type { Metadata } from 'next';
import { hostDeLaPeticion } from '@/lib/host-de-la-peticion';
import {
  baseDeLaVistaPrevia,
  colorDelTema,
  iconosDelPase,
} from '@/lib/vista-previa-del-negocio.mjs';

const API =
  process.env.BACKEND_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4949';

/**
 * Metadata para la vista pública del pase wallet.
 * Cuando se comparte el link, muestra el negocio y el tipo de tarjeta.
 */
export async function generateMetadata({
  params,
}: {
  params: { passId: string };
}): Promise<Metadata> {
  try {
    const res = await fetch(`${API}/api/passes/${params.passId}/public`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) {
      return {
        title: 'Mi tarjeta',
        description: 'Tu tarjeta de fidelización digital.',
      };
    }
    const data = await res.json();
    // El título y la vista previa los ve el CLIENTE FINAL, y es lo que pinta
    // WhatsApp al compartir el enlace. Cae al nombre del NEGOCIO, nunca a
    // Clubify: la tarjeta de un negocio Sellea no puede anunciarse con el
    // nombre de otra plataforma.
    const brand = data?.tenant?.brandName ?? '';
    const cardName = data?.card?.name ?? 'Tarjeta de fidelización';
    const title = brand ? `${cardName} · ${brand}` : cardName;
    const description = brand
      ? `Tu tarjeta wallet en ${brand}. Suma sellos y reclama tu premio.`
      : 'Tu tarjeta wallet. Suma sellos y reclama tu premio.';
    // Color, favicon y dominio: del negocio, luego de SU marca, y si no hay,
    // nada. Antes un negocio sin logo se quedaba con el verde, los iconos de
    // /public y el `og:url` de Clubify, aunque la tarjeta fuera de Sellea.
    const color = colorDelTema(data?.tenant?.primaryColor, data?.brand?.primaryColor);
    const icons = iconosDelPase({
      logoDelNegocio: data?.tenant?.logoUrl,
      marca: data?.brand,
    });
    const base = baseDeLaVistaPrevia({
      host: hostDeLaPeticion(),
      websiteUrl: data?.brand?.websiteUrl,
    });
    return {
      title,
      description,
      robots: { index: false, follow: false }, // privado por usuario
      ...(color ? { themeColor: color } : {}),
      ...(icons ? { icons } : {}),
      openGraph: {
        title,
        description,
        siteName: brand,
        ...(base ? { url: `${base}/w/${params.passId}` } : {}),
        type: 'website',
      },
    };
  } catch {
    return {
      title: 'Mi tarjeta',
      description: 'Tu tarjeta de fidelización digital.',
      robots: { index: false, follow: false },
    };
  }
}

export default function WalletLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
