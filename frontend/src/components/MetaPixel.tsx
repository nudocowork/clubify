'use client';

/**
 * El píxel de Meta de una marca.
 *
 * Lo pidió Humberto para Sellea (brief del 2026-09-08, píxel
 * 1393034506278228, cuenta 2563125017522499). Hay campaña corriendo hacia
 * WhatsApp, así que cada día sin medir es tráfico pagado sin rastro.
 *
 * EL ID VIENE DE LA MARCA, NUNCA ESCRITO A MANO
 * ---------------------------------------------
 * Un id fijo en el layout se le colaría a TODAS las marcas: el tráfico de
 * Clubify acabaría en la cuenta publicitaria de Sellea, y el de Sellea en la
 * de quien viniera después. Sin marca resuelta no se pinta nada — la misma
 * regla que el logo y el remitente.
 *
 * POR QUÉ HACE FALTA ESTE COMPONENTE Y NO BASTA EL SCRIPT DEL BRIEF
 * ----------------------------------------------------------------
 * El código base de Meta dispara `PageView` UNA vez, al cargar. Esto es una
 * SPA: quien entra por la portada y navega a precios no genera ninguna carga
 * nueva, así que Meta ve una sola visita de una sesión entera y el retargeting
 * se queda sin la mitad de la gente. Aquí se dispara un `PageView` por cada
 * cambio de ruta — saltándose el primero, que ya lo mandó el script base.
 */

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
// Las dos funciones puras viven FUERA de este archivo a propósito: este lleva
// `'use client'`, y lo que exporta un módulo cliente no se puede llamar desde
// el servidor. Ver `lib/meta-pixel.ts`.
import { pixelIdValido } from '@/lib/meta-pixel';

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}


/**
 * Los eventos que el script base no cubre.
 *
 * - `PageView` en cada cambio de ruta (SPA).
 * - `Contact` al pulsar cualquier enlace de WhatsApp. Por delegación en el
 *   documento y no botón por botón: así no hay nada que mantener cuando se
 *   añadan más enlaces, que en esta plataforma pasa cada semana.
 * - `ViewContent` en la página de precios.
 *
 * `Purchase` NO está aquí a propósito. En Sellea el cobro va por **STRIPE**
 * (Payment Links alojados en stripe.com), no por Hotmart — Hotmart es la
 * pasarela de Clubify y de Fideliso, y confundirlas ya costó un SMS erróneo el
 * 2026-09-10. El checkout ocurre FUERA de este sitio, así que no hay página de
 * gracias propia donde el importe sea un dato del sistema, y dispararlo con un
 * número fijo contaría compras que no ocurrieron.
 *
 * El camino bueno es la **API de Conversiones** desde el webhook de Stripe
 * (`billing/stripe.service.ts`), que ya recibe `checkout.session.completed` con
 * el correo y el importe. Falta el token de acceso del píxel, que lo genera el
 * dueño de la cuenta publicitaria.
 */
export default function MetaPixel({ pixelId }: { pixelId: string | null }) {
  const pathname = usePathname();
  const primeraCarga = useRef(true);

  // PageView por cambio de ruta.
  useEffect(() => {
    if (!pixelIdValido(pixelId)) return;
    // La carga inicial ya la mandó el script base del `<head>`. Repetirla aquí
    // duplicaría TODA visita de entrada, y Meta las cuenta.
    if (primeraCarga.current) {
      primeraCarga.current = false;
      return;
    }
    window.fbq?.('track', 'PageView');
  }, [pathname, pixelId]);

  // Contact (clic a WhatsApp) y ViewContent (precios).
  useEffect(() => {
    if (!pixelIdValido(pixelId)) return;

    const alPulsar = (e: MouseEvent) => {
      const destino = e.target as HTMLElement | null;
      const a = destino?.closest?.(
        'a[href*="wa.me"], a[href*="api.whatsapp.com"], a[href^="whatsapp:"]',
      );
      if (!a) return;
      window.fbq?.('track', 'Contact', {
        content_name: 'whatsapp',
        source_url: window.location.pathname,
      });
    };
    document.addEventListener('click', alPulsar);
    return () => document.removeEventListener('click', alPulsar);
  }, [pixelId]);

  useEffect(() => {
    if (!pixelIdValido(pixelId)) return;
    // El brief avisa de esto: si «precios» es una sección de la portada y no
    // una ruta propia, esto no dispara y hay que hacerlo por visibilidad del
    // bloque. Se deja escrito para que quien lo vea sepa por qué no salta.
    if (pathname && pathname.includes('precios')) {
      window.fbq?.('track', 'ViewContent', { content_name: 'pagina_precios' });
    }
  }, [pathname, pixelId]);

  return null;
}
