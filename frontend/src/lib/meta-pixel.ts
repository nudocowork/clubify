/**
 * El píxel de Meta: las dos piezas que corren en el SERVIDOR.
 *
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ---------------------------
 * Estaban dentro de `components/MetaPixel.tsx`, que lleva `'use client'`. En
 * el App Router, TODO lo que exporta un módulo cliente se convierte en una
 * referencia cuando lo importa un componente de servidor: no es la función, es
 * un puntero que el cliente resolverá luego. Llamarla desde el layout no da un
 * error de tipos —TypeScript ve la firma buena— sino un 500 en cada página.
 *
 * Pasó el 2026-09-10 y tumbó producción entera hasta el rollback. La regla que
 * queda: una función que necesite el servidor NO vive en un archivo con
 * `'use client'`, aunque sea pura y aunque el editor no se queje.
 */

/** El id que acepta Meta: solo dígitos. Filtra un pegado con espacios o texto. */
export function pixelIdValido(raw: string | null | undefined): string | null {
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
