'use client';
import { useEffect } from 'react';
import { ocultarSplashNativo } from '@/lib/native-bridge';

/**
 * Oculta el splash de la app cuando el panel ya pintó.
 *
 * El shell nativo carga la web de producción, así que el splash tiene que
 * quedarse hasta que ESA página esté lista: si se fuera antes, el usuario
 * vería un rectángulo en blanco mientras carga. Por eso se oculta desde aquí
 * y no por tiempo fijo. La config nativa igual trae un tope por si esta
 * llamada nunca ocurre (sin red, error de carga) y el splash se quedaría
 * pegado para siempre.
 *
 * Fuera de la app no hace absolutamente nada.
 */
export function NativeSplashGate() {
  useEffect(() => {
    ocultarSplashNativo();
  }, []);
  return null;
}
