// Legacy redirect → /d/<slug>/<sectionSlug>/<subSlug>.
import { redirect } from 'next/navigation';

export default function LegacyDeliverySubSectionRedirect({
  params,
}: {
  params: { slug: string; sectionSlug: string; subSlug: string };
}) {
  redirect(
    `/d/${params.slug}/${params.sectionSlug}/${params.subSlug}`,
  );
}
