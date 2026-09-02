'use client';
import { useEffect, useState } from 'react';
import { isNativeApp } from '@/lib/native';

/**
 * TEMPORAL — diagnóstico de desbordamiento horizontal dentro de la app.
 * Lista los elementos MÁS PROFUNDOS que se salen del ancho de la pantalla
 * (los ancestros se desbordan solo por arrastre, no sirven para el arreglo).
 * Quitar en cuanto esté identificado.
 */
export function OverflowDebug() {
  const [lineas, setLineas] = useState<string[]>([]);

  useEffect(() => {
    const forzado =
      typeof window !== 'undefined' && window.location.search.includes('dbg=1');
    if (!forzado && !isNativeApp()) return;
    const t = setTimeout(() => {
      const ancho = document.documentElement.clientWidth;
      const fuera: Array<{ el: Element; prof: number; r: number; w: number }> = [];
      document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.right > ancho + 1 || r.width > ancho + 1) {
          let prof = 0;
          for (let p = el.parentElement; p; p = p.parentElement) prof++;
          fuera.push({ el, prof, r: Math.round(r.right), w: Math.round(r.width) });
        }
      });
      // Los más profundos primero: ahí está la causa real.
      fuera.sort((a, b) => b.prof - a.prof);
      setLineas([
        `viewport=${ancho} doc=${document.documentElement.scrollWidth} body=${document.body.scrollWidth} inner=${window.innerWidth}`,
        `UA: ${navigator.userAgent.slice(-70)}`,
        `bridge=${!!(window as any).Capacitor} native=${isNativeApp()}`,
        ...fuera.slice(0, 6).map((f) => {
          const cls = (f.el.getAttribute('class') || '').slice(0, 70);
          return `${f.el.tagName.toLowerCase()} w=${f.w} r=${f.r} · ${cls}`;
        }),
      ]);
    }, 1500);
    return () => clearTimeout(t);
  }, []);

  if (lineas.length === 0) return null;
  return (
    <div
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 99999,
        background: 'rgba(0,0,0,.92)', color: '#7CFF9B', font: '10px/1.35 ui-monospace,monospace',
        padding: '8px 8px calc(8px + env(safe-area-inset-bottom))', maxHeight: '45vh', overflow: 'auto',
      }}
    >
      {lineas.map((l, i) => (
        <div key={i} style={{ marginBottom: 3, wordBreak: 'break-all' }}>{l}</div>
      ))}
    </div>
  );
}
