import type { Metadata } from 'next';
import { metadataDeNegocio } from '@/lib/public-page-metadata';

const API =
  process.env.BACKEND_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4949';

/**
 * Alta en la tarjeta de fidelización. Es el enlace que el negocio pega en su
 * bio y manda por WhatsApp para que el cliente se registre — o sea, el que más
 * se comparte de todos. Salía con la marca de Clubify.
 *
 * Aquí el negocio no viene en la raíz sino en `card.tenant`; el resto del
 * armado es el mismo que en las demás páginas públicas.
 */
export async function generateMetadata({
  params,
}: {
  params: { cardId: string };
}): Promise<Metadata> {
  const vacio = 'Tu tarjeta de fidelización';
  try {
    const res = await fetch(
      `${API}/api/passes/enroll/${params.cardId}`,
      { next: { revalidate: 300 } },
    );
    if (!res.ok) return { title: vacio };
    const d = await res.json();
    // `available: false` = la tarjeta no existe o está inactiva. Devolvemos
    // el genérico, nunca la marca de la plataforma.
    if (d?.available === false) return { title: vacio };

    const negocio = d?.card?.tenant ?? null;
    return metadataDeNegocio({
      negocio,
      // Los iconos se generan por slug del negocio, no por id de tarjeta.
      slug: negocio?.slug ?? params.cardId,
      sufijo: d?.card?.name?.trim() || 'Tarjeta de fidelización',
      descripcion: (n) =>
        `Registra tu tarjeta de ${n} y empieza a sumar desde tu primera visita.`,
      vacio,
    });
  } catch {
    return { title: vacio };
  }
}

export default function EnrollLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
