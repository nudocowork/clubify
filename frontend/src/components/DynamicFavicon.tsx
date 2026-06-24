'use client';
import { useEffect } from 'react';
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
  const { brand, loading } = useAuthBrand();
  // En el dominio de una marca usamos su favicon dedicado → icono → logo.
  // Para Clubify NO inyectamos nada: el metadata SSR ya sirve el favicon por
  // el generador (símbolo cuadrado sobre fondo sólido). Antes inyectábamos la
  // imagen CRUDA del Setting (ej. flecha verde transparente) al final del head
  // y, como el browser prioriza el último <link icon>, tapaba el bueno y a
  // tamaño favicon se veía invisible.
  const effective = brand
    ? brand.faviconUrl ?? brand.iconUrl ?? brand.logoUrl ?? null
    : null;
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
