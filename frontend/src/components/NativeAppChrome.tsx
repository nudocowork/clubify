'use client';
import { useEffect } from 'react';
import { nativePlatform } from '@/lib/native';
import { ocultarSplashNativo, registrarPush } from '@/lib/native-bridge';
import { api, getUser } from '@/lib/api';

/**
 * Ajustes que solo aplican dentro de la app instalada:
 *
 *  1. Marca <html data-native="ios|android">. El CSS cuelga de ahí las
 *     márgenes seguras (isla dinámica, notch, barra de inicio). Se hace por
 *     atributo y no por media query porque en el NAVEGADOR no hay que tocar
 *     nada: Safari ya reserva ese espacio con su propia interfaz.
 *
 *  2. Oculta el splash cuando el panel ya pintó.
 *
 * Por qué reintenta: Capacitor inyecta window.Capacitor de forma ASÍNCRONA.
 * Leerlo una sola vez al montar es una carrera que se pierde a veces — y
 * cuando se perdía, la app quedaba sin márgenes seguras y el header se metía
 * bajo la isla. Se comprobó en dos arranques seguidos: uno bien, otro mal.
 * Reintentar unos instantes cuesta nada y quita el no-determinismo.
 */
export function NativeAppChrome() {
  useEffect(() => {
    let intentos = 0;
    let timer: ReturnType<typeof setTimeout>;

    const aplicar = () => {
      const plataforma = nativePlatform();
      if (plataforma) {
        document.documentElement.setAttribute('data-native', plataforma);
        ocultarSplashNativo();
        // Solo con sesión: pedir el permiso de notificaciones en la pantalla
        // de login, antes de que la persona sepa qué es la app, es la forma
        // segura de que lo niegue — y en iOS no se puede volver a preguntar.
        if (getUser()) {
          registrarPush((token, platform) =>
            api('/devices', { method: 'POST', body: JSON.stringify({ token, platform }) }),
          );
        }
        return;
      }
      // ~3s de margen (30 × 100ms). Si al final no hay puente es que
      // corremos en un navegador de verdad y no hay nada que hacer.
      if (++intentos < 30) timer = setTimeout(aplicar, 100);
    };

    aplicar();
    return () => clearTimeout(timer);
  }, []);

  return null;
}
