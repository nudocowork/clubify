'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Página en HTML de una cuponera (la principal o la de directorio), escrita
 * por su administrador.
 *
 * Va en un iframe con `sandbox` y SIN `allow-same-origin`: el HTML corre en un
 * origen opaco, así que sus scripts no pueden leer el token de quien la visita
 * ni llamar a la API en su nombre. Es lo que permite aceptar HTML con scripts
 * sin sanearlo. `allow-top-navigation-by-user-activation` deja que un botón
 * «Unirme» lleve a la página completa, pero solo si la persona lo toca.
 */
export function PaginaHtml({ slug, tipo }: { slug: string; tipo: 'principal' | 'directorio' }) {
  const [pagina, setPagina] = useState<{ name: string; html: string } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const q = tipo === 'directorio' ? '?tipo=directorio' : '';
    api<{ name: string; html: string }>(`/cuponera/public/page/${encodeURIComponent(slug)}${q}`)
      .then((p) => { setPagina(p); if (p?.name) document.title = p.name; })
      .catch(() => setError(true));
  }, [slug, tipo]);

  if (error) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Esta página no existe o todavía no está publicada.</div>;
  }
  if (!pagina) return <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Cargando…</div>;

  return (
    <iframe
      title={pagina.name}
      srcDoc={pagina.html}
      sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 'none', background: '#fff' }}
    />
  );
}
