// Legacy redirect → /d/<slug>/<sectionSlug>.
import { redirect } from 'next/navigation';

export default function LegacyDeliverySectionRedirect({
  params,
}: {
  params: { slug: string; sectionSlug: string };
}) {
  redirect(`/d/${params.slug}/${params.sectionSlug}`);
}
