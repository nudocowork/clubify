'use client';
import { useEffect } from 'react';

export function PWARegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    let reloaded = false;
    // Cuando el SW activo cambia (porque se instaló uno nuevo y tomó control),
    // recargamos UNA VEZ para que la página corra contra los assets nuevos.
    // El flag `reloaded` evita el bucle de reload-loop si el SW se rota
    // varias veces seguidas (raro pero posible).
    const onControllerChange = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };

    const onLoad = () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          // Forzar update check al cargar — así detectamos versión nueva
          // sin esperar al heartbeat de 24h del browser.
          reg.update().catch(() => {});
        })
        .catch(() => {});
      navigator.serviceWorker.addEventListener(
        'controllerchange',
        onControllerChange,
      );
    };

    if (document.readyState === 'complete') onLoad();
    else window.addEventListener('load', onLoad, { once: true });

    return () => {
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        onControllerChange,
      );
    };
  }, []);
  return null;
}
