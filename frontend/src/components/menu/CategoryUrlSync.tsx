'use client';

// Sincroniza la URL del browser con la categoría visible en el
// storefront público. Funciona para los layouts vertical-acordeón
// (CLASSIC / GRID / CAROUSELS / CLEAN / COMPACT / CLUVI) que usan
// `id="cat-${catId}"` en cada AccordionSection.
//
// Dos direcciones:
//   1. Path → scroll: si la URL es /m/x/cafe-caliente al cargar, scroll
//      a esa categoría y dejar el slug en URL.
//   2. Scroll → path: cuando el usuario scrollea, detectamos qué
//      categoría está más visible y actualizamos URL con replaceState
//      (sin inflar el back-button).
//
// No aplica a SECTIONS (que tiene activeSection state propio que se
// sincroniza inline en LayoutSections) ni a FLIPBOOK (que usa su propio
// MenuBookViewer con sync interna).

import { useEffect, useRef } from 'react';
import { buildStorefrontPath, type StorefrontMode } from '@/lib/menu/storefront-mode';

type CategoryLike = {
  id: string;
  slug?: string;
  subsections?: { id: string; slug?: string; name?: string }[];
};

export function CategoryUrlSync({
  storefrontSlug,
  categories,
  initialSectionSlug,
  initialSubSlug,
  mode,
}: {
  /** Slug del negocio (segmento /m/[slug]). */
  storefrontSlug: string;
  /** Categorías del menú con sus slugs. */
  categories: CategoryLike[];
  /** Slug de categoría inicial desde URL (path param). */
  initialSectionSlug?: string;
  /** Slug de subcategoría inicial desde URL (3er nivel). */
  initialSubSlug?: string;
  /** Canal activo — preserva /delivery en los replaceState. */
  mode: StorefrontMode;
}) {
  // Track del último slug visible para evitar replaceState innecesarios
  // (el observer dispara con cada cambio mínimo de visibility).
  const lastSlugRef = useRef<string | null>(null);
  // No corremos el scroll → URL hasta haber hecho el scroll inicial,
  // sino al cargar /m/x/y se pisaría el path con la primera categoría
  // visible en lugar de respetar el slug recibido.
  const initialScrollDoneRef = useRef(false);

  // ── Path → scroll inicial
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!initialSectionSlug || categories.length === 0) {
      initialScrollDoneRef.current = true;
      return;
    }
    // Buscar categoría por slug. Si subSlug también, priorizamos la
    // subsección (más específico).
    let targetId: string | null = null;
    for (const cat of categories) {
      if (cat.slug === initialSectionSlug) {
        if (initialSubSlug) {
          const sub = (cat.subsections ?? []).find(
            (s) => s.slug === initialSubSlug,
          );
          if (sub) targetId = sub.id;
        }
        targetId = targetId ?? cat.id;
        break;
      }
    }
    // Pequeño delay para que el DOM termine de renderizar las
    // AccordionSection antes del scroll.
    const t = setTimeout(() => {
      if (targetId) {
        const el = document.getElementById(`cat-${targetId}`);
        if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
      initialScrollDoneRef.current = true;
    }, 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories.length, initialSectionSlug, initialSubSlug]);

  // ── Scroll → path: IntersectionObserver detecta categoría visible
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (categories.length === 0) return;

    // Map de catId → slug + parentSlug para construir el path correcto.
    const slugByCatId = new Map<
      string,
      { slug: string; parentSlug?: string }
    >();
    for (const cat of categories) {
      if (cat.slug) slugByCatId.set(cat.id, { slug: cat.slug });
      for (const sub of cat.subsections ?? []) {
        if (sub.slug && cat.slug) {
          slugByCatId.set(sub.id, { slug: sub.slug, parentSlug: cat.slug });
        }
      }
    }

    function updateUrl(catId: string) {
      const info = slugByCatId.get(catId);
      if (!info) return;
      const newPath = buildStorefrontPath(
        storefrontSlug,
        mode,
        info.parentSlug ?? info.slug,
        info.parentSlug ? info.slug : null,
      );
      if (window.location.pathname === newPath) return;
      if (lastSlugRef.current === newPath) return;
      lastSlugRef.current = newPath;
      window.history.replaceState({}, '', newPath);
    }

    // Sort entries por su posición visible — la categoría con más área
    // visible "gana". Tracking simple por intersectionRatio.
    const visibleRatios = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id.replace(/^cat-/, '');
          if (entry.isIntersecting) {
            visibleRatios.set(id, entry.intersectionRatio);
          } else {
            visibleRatios.delete(id);
          }
        }
        if (!initialScrollDoneRef.current) return;
        if (visibleRatios.size === 0) return;
        // Categoría con mayor intersectionRatio = la más visible.
        let topId: string | null = null;
        let topRatio = -1;
        for (const [id, ratio] of visibleRatios.entries()) {
          if (ratio > topRatio) {
            topRatio = ratio;
            topId = id;
          }
        }
        if (topId) updateUrl(topId);
      },
      {
        // threshold con varios pasos para que el ratio sea preciso.
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
        // rootMargin negativo arriba para no contar la barra sticky.
        rootMargin: '-60px 0px -40% 0px',
      },
    );

    for (const id of slugByCatId.keys()) {
      const el = document.getElementById(`cat-${id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories.length, storefrontSlug, mode]);

  return null;
}
