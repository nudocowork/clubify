'use client';
import { useEffect } from 'react';
import { nativePlatform } from '@/lib/native';
import { ocultarSplashNativo } from '@/lib/native-bridge';

/**
 * Ajustes que solo aplican dentro de la app instalada:
 *
 *  1. Marca <html data-native="ios|android">. El CSS cuelga de ahí las
 *     márgenes seguras (isla dinámica, notch, barra de inicio). Se hace por
 *     atributo y no por media query porque en el NAVEGADOR no hay que tocar
 *     nada: Safari ya reserva ese espacio con su propia interfaz, y meterle
 *     el padding también le abriría un hueco en blanco arriba.
 *
 *  2. Oculta el splash cuando el panel ya pintó. Con contenido remoto hay que
 *     esperar a que la página esté lista; ocultarlo por tiempo fijo enseñaría
 *     un rectángulo en blanco mientras carga.
 *
 * Fuera de la app no hace absolutamente nada.
 */
export function NativeAppChrome() {
  useEffect(() => {
    const plataforma = nativePlatform();
    if (!plataforma) return;
    document.documentElement.setAttribute('data-native', plataforma);
    ocultarSplashNativo();
  }, []);
  return null;
}
