/**
 * Landing público de un link UTM. El dueño comparte
 * https://soyclubify.com/c/u/{slug} en su campaña; resolvemos el slug
 * server-side y redirigimos a la página de inscripción de la tarjeta
 * con `?utm={slug}` para que el bonus de bienvenida se aplique al
 * crear el pass.
 */
import { notFound, redirect } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const dynamic = 'force-dynamic';

export default async function UtmRedirect({
  params,
}: {
  params: { slug: string };
}) {
  const res = await fetch(`${API}/api/public/c/u/${params.slug}`, {
    cache: 'no-store',
  });
  if (!res.ok) notFound();
  const data = await res.json();
  redirect(`/c/${data.cardId}?utm=${params.slug}`);
}
