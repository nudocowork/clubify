'use client';
import { useEffect } from 'react';
import { isNativeApp } from '@/lib/native';

export function PWARegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    // DENTRO DE LA APP NO se usa service worker, y si hay uno viejo se
    // desregistra y se purgan sus caches.
    //
    // El SW existe para la PWA del navegador: cachea la shell para que el
    // escáner siga funcionando sin señal en el mostrador. Pero la app nativa
    // ya trae su propia pantalla de error y su contenedor, así que no lo
    // necesita — y sí sufre su peor efecto: servía JS de agosto después de
    // una docena de despliegues. Perseguimos durante días bugs que ya
    // estaban corregidos en producción pero no llegaban al teléfono.
    if (isNativeApp()) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const r of regs) r.unregister().catch(() => {});
      });
      if ('caches' in window) {
        caches.keys().then((ks) => ks.forEach((k) => caches.delete(k).catch(() => {})));
      }
      return;
    }

    let reloaded = false;
    // CRÍTICO (M8 2026-06-05): solo recargamos cuando el SW se ACTUALIZA
    // (ya había un controller previo controlando esta página). En la
    // PRIMERA instalación — típico cuando el cliente abre `/c/<id>` desde
    // un QR sin haber visitado antes el dominio — el controllerchange
    // dispararía un reload mientras el cliente está tocando el input,
    // perdiendo el primer keystroke. Skipear el reload-on-first-install
    // es seguro porque la página YA está corriendo con los assets recién
    // bajados de network (el SW no existía cuando se hizo el fetch).
    const wasControlled = !!navigator.serviceWorker.controller;
    const onControllerChange = () => {
      if (reloaded) return;
      if (!wasControlled) return; // first install — la página ya es fresh
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
