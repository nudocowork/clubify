import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type PageProps = {
  params: { slug: string };
  searchParams: { [k: string]: string | string[] | undefined };
};

/**
 * Link corto público de afiliado: `/ref/<slug>`.
 *
 * Server component → resuelve el slug en el backend (que loguea la visita
 * en ReferralVisit con UTM + referer + IP + país) → redirige a
 * `/signup?ref=<code>&via=<slug>` con los UTMs preservados.
 *
 * Si el slug no existe, devuelve 404 (notFound) para no leakear código.
 */
export default async function RefRedirect({ params, searchParams }: PageProps) {
  const slug = (params?.slug ?? '').toLowerCase().trim().slice(0, 80);
  if (!slug) notFound();

  const utm = {
    utm_source: pickString(searchParams.utm_source),
    utm_medium: pickString(searchParams.utm_medium),
    utm_campaign: pickString(searchParams.utm_campaign),
  };

  const h = headers();
  const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

  // Pasamos UTMs como query y dejamos que el backend lea referer/UA/IP de los
  // headers que Next reenvía. Note: en server fetch los headers que el
  // backend ve son los del fetch interno, NO los del cliente; por eso
  // forwardamos explícitamente los relevantes.
  const qs = new URLSearchParams();
  if (utm.utm_source) qs.set('utm_source', utm.utm_source);
  if (utm.utm_medium) qs.set('utm_medium', utm.utm_medium);
  if (utm.utm_campaign) qs.set('utm_campaign', utm.utm_campaign);

  const userAgent = h.get('user-agent') ?? '';
  const referer = h.get('referer') ?? '';
  const country =
    h.get('x-vercel-ip-country') ?? h.get('cf-ipcountry') ?? '';
  const clientIp =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    h.get('x-real-ip') ??
    '';

  let resolved: { code: string; slug: string; ownerName: string } | null = null;
  try {
    const r = await fetch(`${API}/api/referrals/by-slug/${encodeURIComponent(slug)}?${qs}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'user-agent': userAgent,
        referer,
        ...(country ? { 'cf-ipcountry': country } : {}),
        ...(clientIp ? { 'x-forwarded-for': clientIp } : {}),
      },
    });
    if (r.ok) {
      resolved = (await r.json()) as { code: string; slug: string; ownerName: string };
    }
  } catch {
    // Si el backend está caído, igual mandamos a home para que el visitante
    // no quede atascado en una pantalla rota.
  }

  if (!resolved) notFound();

  // Construir destino de signup con `ref` (código real) + `via` (slug
  // usado, para atribución posterior) + UTMs preservados.
  const dest = new URLSearchParams();
  dest.set('ref', resolved.code);
  dest.set('via', resolved.slug);
  if (utm.utm_source) dest.set('utm_source', utm.utm_source);
  if (utm.utm_medium) dest.set('utm_medium', utm.utm_medium);
  if (utm.utm_campaign) dest.set('utm_campaign', utm.utm_campaign);

  redirect(`/signup?${dest.toString()}`);
}

function pickString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0]?.trim().slice(0, 80) || undefined;
  return v?.trim().slice(0, 80) || undefined;
}
