// Legacy redirect → /d/<slug>/<sectionSlug>. Fix audit 2026-06-07:
// propagar searchParams (promo, utm).
import { redirect } from 'next/navigation';

export default function LegacyDeliverySectionRedirect({
  params,
  searchParams,
}: {
  params: { slug: string; sectionSlug: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const qs = buildQS(searchParams);
  redirect(`/d/${params.slug}/${params.sectionSlug}${qs}`);
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
