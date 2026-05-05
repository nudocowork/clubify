'use client';
import { useEffect } from 'react';
import { useBranding } from '@/lib/useBranding';

/**
 * Reemplaza el `<link rel="icon">` del head con el favicon configurado en
 * super admin (Setting branding.faviconUrl). Si no hay setting, queda el
 * default de /public/favicon.png que viene del metadata de Next.
 */
export function DynamicFavicon() {
  const { faviconUrl } = useBranding();
  useEffect(() => {
    if (!faviconUrl) return;
    const links = document.querySelectorAll(
      "link[rel='icon'], link[rel='shortcut icon']",
    );
    links.forEach((l) => l.parentElement?.removeChild(l));
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = faviconUrl;
    link.type = 'image/png';
    document.head.appendChild(link);
  }, [faviconUrl]);
  return null;
}
