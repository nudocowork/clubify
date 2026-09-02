import { SignupForm, type Brand } from './SignupForm';

/**
 * Auto-registro de un negocio "Solo InfoLink" desde el link de una marca:
 *   selleala.com/i-registro/<marca>
 *
 * SERVER COMPONENT: resuelve la marca por el slug de la URL EN EL SERVIDOR y se
 * la pasa al form ya resuelta → el primer render ya sale con el logo y los
 * colores de la marca, sin parpadeo (antes era 100% cliente y pintaba con el
 * tema por defecto hasta que el fetch traía la marca). El tier (?tier=pro)
 * también se lee acá para que el form no necesite useSearchParams (que forzaría
 * CSR y reintroduciría el flash).
 */
export const dynamic = 'force-dynamic';

const API =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, '') || 'https://api.soyclubify.com';

export default async function InfoLinkSignupPage({
  params,
  searchParams,
}: {
  params: { brand: string };
  searchParams: { tier?: string };
}) {
  const brandSlug = String(params?.brand ?? '');
  const tier: 'FREE' | 'PRO' =
    (searchParams?.tier || '').toLowerCase() === 'pro' ? 'PRO' : 'FREE';

  let initialBrand: Brand | null = null;
  try {
    // OJO: el backend monta TODO bajo el prefijo global `/api`
    // (main.ts → setGlobalPrefix('api')). Sin ese `/api` este fetch daba 404,
    // `initialBrand` quedaba null y el form caía SIEMPRE al fetch cliente →
    // por eso el flash de marca (logo/colores/tagline) nunca se fue. Este es el
    // fix raíz del FOUC: con la URL correcta el primer render del server ya trae
    // la marca. Timeout corto para que un branding lento no bloquee el TTFB.
    const res = await fetch(
      `${API}/api/auth/infolink-brand/${encodeURIComponent(brandSlug)}`,
      { next: { revalidate: 300 }, signal: AbortSignal.timeout(2000) },
    );
    if (res.ok) initialBrand = (await res.json()) as Brand;
  } catch {
    // Si el server no la pudo traer (red/timeout), el form la resuelve en
    // cliente como fallback (caso raro).
  }

  return (
    <SignupForm brandSlug={brandSlug} initialBrand={initialBrand} tier={tier} />
  );
}
