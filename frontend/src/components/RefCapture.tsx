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
    } catch {}
  }, []);
  return null;
}
