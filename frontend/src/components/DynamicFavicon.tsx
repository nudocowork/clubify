'use client';
import { useEffect } from 'react';
import { useBranding } from '@/lib/useBranding';
import { useAuthBrand } from '@/components/AuthBrand';

/**
 * Reemplaza el `<link rel="icon">` del head con el favicon configurado en
 * super admin (Setting branding.faviconUrl). Si no hay setting, queda el
 * default de /public/favicon.png que viene del metadata de Next.
 *
 * IMPORTANTE: NO removemos los <link> que crea Next.js — esos están
 * controlados por React/Next y borrarlos rompe el reconciler con
 * "Cannot read properties of null (reading 'removeChild')". En su lugar
 * agregamos UN solo <link rel="icon"> nuestro al final del head; los
 * navegadores priorizan el último que ven, así sobrescribe los anteriores.
 */
const CLUBIFY_FAVICON_ID = '__clubify_dynamic_favicon';

export function DynamicFavicon() {
  const { faviconUrl } = useBranding();
  const { brand, loading } = useAuthBrand();
  // En el dominio de una marca NO aplicamos el favicon global de Clubify.
  // Preferimos su favicon dedicado → icono dashboard → logo; si no tiene
  // ninguno, dejamos el favicon del metadata SSR (nunca el verde de Clubify).
  const effective = brand
    ? brand.faviconUrl ?? brand.iconUrl ?? brand.logoUrl ?? null
    : faviconUrl;
  useEffect(() => {
    if (typeof document === 'undefined') return;
    // Mientras resolvemos la marca por host, no tocamos nada (evita flash del
    // favicon Clubify en el dominio de la marca).
    if (loading) return;
    let link = document.getElementById(
      CLUBIFY_FAVICON_ID,
    ) as HTMLLinkElement | null;
    if (!effective) {
      // Si no hay favicon custom, removemos el nuestro (no los de Next).
      if (link && link.parentNode) link.parentNode.removeChild(link);
      return;
    }
    if (!link) {
      link = document.createElement('link');
      link.id = CLUBIFY_FAVICON_ID;
      link.rel = 'icon';
      link.type = 'image/png';
      document.head.appendChild(link);
    }
    if (link.href !== effective) link.href = effective;
  }, [effective, loading]);
  return null;
}
