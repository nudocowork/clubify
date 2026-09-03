'use client';
import { useEffect, useState } from 'react';
import { isImpersonating } from '@/lib/api';

/**
 * TEMPORAL — diagnóstico de desbordamiento horizontal.
 *
 * Solo señala culpables REALES. Un elemento más ancho que la pantalla no es
 * un bug si vive dentro de un contenedor con scroll horizontal propio: eso es
 * justo el patrón correcto para tablas y pestañas. Lo que rompe la página es
 * el elemento que la estira, y eso solo pasa si NINGÚN ancestro puede
 * contenerlo. Sin este filtro el informe salía lleno de ruido.
 */
export function OverflowDebug() {
  const [lineas, setLineas] = useState<string[]>([]);

  useEffect(() => {
    // Se enciende también con una impersonación activa: es el único estado
    // en el que hace falta medir el panel del negocio, y ningún cliente real
    // puede estar ahí — impersonar es exclusivo de un admin. Así el
    // diagnóstico sobrevive a navegar sin arrastrar ?dbg=1 en cada URL.
    //
    // NUNCA en la app nativa: este es un overlay de diagnóstico TEMPORAL y no
    // puede aparecer en la build de la App Store (antes se encendía siempre en
    // nativo). En web sigue disponible con ?dbg=1 o impersonando.
    const forzado =
      typeof window !== 'undefined' &&
      (window.location.search.includes('dbg=1') || isImpersonating());
    if (!forzado) return;

    // Se mide REPETIDAMENTE: el panel carga sus datos por fetch, así que a los
    // 1.8s del montaje todavía faltan tarjetas por pintar. Una sola medida
    // decía "sin desbordamiento" en pantallas que sí desbordaban al terminar
    // de cargar. Guarda el PEOR caso visto.
    let peor = 0;
    const medir = () => {
      const ancho = document.documentElement.clientWidth;
      const doc = document.documentElement.scrollWidth;
      const exceso = doc - ancho;

      if (exceso <= peor) return; // ya reportamos algo igual o peor
      peor = Math.max(peor, exceso);

      const cabecera = [
        exceso > 1
          ? `⚠ DESBORDA +${exceso}px (doc=${doc} viewport=${ancho})`
          : `✓ SIN DESBORDAMIENTO (${ancho}px) · vigilando…`,
      ];

      if (exceso <= 1) {
        setLineas(cabecera);
        return;
      }

      /** True si algún ancestro puede contener el desbordamiento por su cuenta. */
      const contenido = (el: Element) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
        }
        return false;
      };

      const fuera: Array<{ el: Element; prof: number; r: number; w: number }> = [];
      document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.right <= ancho + 1 && r.width <= ancho + 1) return;
        if (contenido(el)) return;
        let prof = 0;
        for (let p = el.parentElement; p; p = p.parentElement) prof++;
        fuera.push({ el, prof, r: Math.round(r.right), w: Math.round(r.width) });
      });

      // Los más profundos primero: el ancestro solo se desborda por arrastre.
      fuera.sort((a, b) => b.prof - a.prof);
      setLineas([
        ...cabecera,
        ...fuera.slice(0, 5).map((f) => {
          const cls = (f.el.getAttribute('class') || '').slice(0, 65);
          return `${f.el.tagName.toLowerCase()} w=${f.w} r=${f.r} · ${cls}`;
        }),
      ]);
    };

    // Arranca pronto y sigue vigilando 20s: cubre la carga inicial, los
    // fetches encadenados y lo que se pinte al hacer scroll.
    const primeros = setTimeout(medir, 1200);
    const intervalo = setInterval(medir, 1500);
    const alto = setTimeout(() => clearInterval(intervalo), 20000);

    return () => {
      clearTimeout(primeros);
      clearInterval(intervalo);
      clearTimeout(alto);
    };
  }, []);

  if (lineas.length === 0) return null;
  return (
    <div
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 99999,
        background: 'rgba(0,0,0,.92)', color: '#7CFF9B', font: '11px/1.4 ui-monospace,monospace',
        padding: '8px 8px calc(8px + env(safe-area-inset-bottom))', maxHeight: '40vh', overflow: 'auto',
      }}
    >
      {lineas.map((l, i) => (
        <div key={i} style={{ marginBottom: 3, wordBreak: 'break-all' }}>{l}</div>
      ))}
    </div>
  );
}
