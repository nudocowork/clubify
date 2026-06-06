'use client';
import { useEffect } from 'react';

/**
 * Captura `?ref=CODIGO`, `?via=slug` y los UTM params desde la URL y los
 * persiste en localStorage para que el signup posterior pueda enviarlos
 * al backend y crear el ReferralUse con atribución completa.
 *
 * Vive en cualquier página pública por la que pueda entrar un referido.
 *
 * Llaves:
 *   - clubify:ref       → código directo (cuando viene /?ref=ABCD1234)
 *   - clubify:via       → slug del link corto /ref/<slug>
 *   - clubify:utm       → JSON {source, medium, campaign}
 *   - clubify:referer   → URL completa del referer original
 */
export function RefCapture() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const sp = new URLSearchParams(window.location.search);

      const ref = sp.get('ref');
      if (ref && ref.length >= 4 && ref.length <= 20) {
        localStorage.setItem('clubify:ref', ref.toUpperCase());
      }

      const via = sp.get('via');
      if (via && via.length >= 1 && via.length <= 80) {
        localStorage.setItem('clubify:via', via.toLowerCase());
      }

      const utm = {
        source: sp.get('utm_source')?.slice(0, 80) ?? null,
        medium: sp.get('utm_medium')?.slice(0, 80) ?? null,
        campaign: sp.get('utm_campaign')?.slice(0, 80) ?? null,
      };
      if (utm.source || utm.medium || utm.campaign) {
        localStorage.setItem('clubify:utm', JSON.stringify(utm));
      }

      // Captura del primer referer (no se sobreescribe en navegaciones
      // posteriores dentro del mismo dominio).
      if (document.referrer && !localStorage.getItem('clubify:referer')) {
        try {
          const r = new URL(document.referrer);
          if (r.host !== window.location.host) {
            localStorage.setItem('clubify:referer', document.referrer.slice(0, 500));
          }
        } catch {}
      }

      // quoteToken (?qt=) del CTA de /q/<token> → closed-loop de
      // conversión. Lo persistimos en sessionStorage para que /activar lo
      // mande en el signup final, y disparamos el beacon de CTA-click una
      // sola vez (cuando viene del URL, no de cache).
      const qt = sp.get('qt');
      if (qt && qt.length >= 8 && qt.length <= 64) {
        try {
          sessionStorage.setItem('clubify:qt', qt);
        } catch {}
        const API =
          process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';
        fetch(`${API}/api/public/quote/${encodeURIComponent(qt)}/cta-click`, {
          method: 'POST',
          keepalive: true,
        }).catch(() => null);
      }
    } catch {}
  }, []);
  return null;
}
