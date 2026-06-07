// Legacy redirect — QRs viejos que apuntan a /m/<slug>/delivery van a
// la nueva ruta /d/<slug> (separación de rutas 2026-06-07).
//
// Fix audit 2026-06-07: propagar searchParams (`?promo=X`, `?utm_*`,
// etc) sino los QR Descuento legacy quedan sin código.
import { redirect } from 'next/navigation';

export default function LegacyDeliveryRedirect({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const qs = buildQS(searchParams);
  redirect(`/d/${params.slug}${qs}`);
}

function buildQS(
  searchParams?: Record<string, string | string[] | undefined>,
): string {
  if (!searchParams) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (Array.isArray(v)) v.forEach((it) => it && sp.append(k, it));
    else if (v) sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}
