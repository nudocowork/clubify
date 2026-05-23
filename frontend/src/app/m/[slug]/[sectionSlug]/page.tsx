'use client';
/**
 * /m/[slug]/[sectionSlug] — URL compartible que abre directamente una
 * sección puntual del menú público.
 *
 * Reusa el storefront principal pasando `initialSectionSlug` para que el
 * viewer (FLIPBOOK por ahora) arranque en la primera página de esa sección.
 * Si el sectionSlug no existe, el viewer hace fallback a la página 0 sin
 * romper la pantalla.
 *
 * No duplica fetch ni lógica — el componente <StorefrontPublic> ya maneja
 * todo el branching por layout.
 */
import { useParams } from 'next/navigation';
import { StorefrontPublic } from '../page';

export default function StorefrontPublicSection() {
  const { sectionSlug } = useParams<{ slug: string; sectionSlug: string }>();
  return <StorefrontPublic initialSectionSlug={sectionSlug} />;
}
