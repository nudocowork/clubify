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

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

/** El id que acepta Meta: solo dígitos. Filtra un pegado con espacios o texto. */
function idValido(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  return /^\d{6,20}$/.test(v) ? v : null;
}

/**
 * El script base, tal cual lo entrega Meta.
 *
 * Va en el `<head>` y **lo más arriba posible**: si un `fbq('track', …)` se
 * ejecuta antes de que exista la cola, se pierde el evento.
 */
export function codigoBaseDelPixel(pixelId: string): string {
  return `!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${pixelId}');
fbq('track', 'PageView');`;
}

export { idValido as pixelIdValido };

/**
 * Los eventos que el script base no cubre.
 *
 * - `PageView` en cada cambio de ruta (SPA).
 * - `Contact` al pulsar cualquier enlace de WhatsApp. Por delegación en el
 *   documento y no botón por botón: así no hay nada que mantener cuando se
 *   añadan más enlaces, que en esta plataforma pasa cada semana.
 * - `ViewContent` en la página de precios.
 *
 * `Purchase` NO está aquí a propósito: el cobro lo procesa Hotmart fuera de
 * este sitio, así que no hay una página de gracias propia donde el importe sea
 * un dato del sistema. Dispararlo con un número fijo contaría compras que no
 * ocurrieron; ver la nota del brief.
 */
export default function MetaPixel({ pixelId }: { pixelId: string | null }) {
  const pathname = usePathname();
  const primeraCarga = useRef(true);

  // PageView por cambio de ruta.
  useEffect(() => {
    if (!idValido(pixelId)) return;
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
    if (!idValido(pixelId)) return;

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
    if (!idValido(pixelId)) return;
    // El brief avisa de esto: si «precios» es una sección de la portada y no
    // una ruta propia, esto no dispara y hay que hacerlo por visibilidad del
    // bloque. Se deja escrito para que quien lo vea sepa por qué no salta.
    if (pathname && pathname.includes('precios')) {
      window.fbq?.('track', 'ViewContent', { content_name: 'pagina_precios' });
    }
  }, [pathname, pixelId]);

  return null;
}
