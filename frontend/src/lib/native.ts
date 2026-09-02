'use client';
import { useEffect, useState } from 'react';

// Detección del contenedor NATIVO (apps de App Store / Play Store).
//
// Las apps son un shell Capacitor que carga esta misma web, así que el código
// es el mismo en navegador y en app: lo que cambia es lo que se muestra.
// Dos motivos concretos para saber dónde corremos:
//
//  1. iOS + guideline 3.1.1 de Apple: si dentro de la app se puede comprar o
//     renovar plan, comprar créditos o pagar el PRO de Infolinks, Apple exige
//     cobrarlo por su compra in-app (30%) o rechaza la app. Por eso en iOS
//     esos flujos se ocultan y el negocio los hace desde la web.
//  2. El lanzador /hub es la pantalla de entrada de la app; en el navegador
//     el login sigue entrando directo al panel de siempre.
//
// El shell se identifica de dos formas y basta cualquiera: el bridge de
// Capacitor (window.Capacitor) y un marcador en el User-Agent que agrega la
// app. El marcador es el que permite detectarlo también desde el servidor.

export const NATIVE_UA_MARKER = 'ClubifyApp';

export type NativePlatform = 'ios' | 'android';

type CapacitorBridge = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

/** Plataforma nativa actual, o null si esto corre en un navegador normal. */
export function nativePlatform(): NativePlatform | null {
  if (typeof window === 'undefined') return null;

  const cap = (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor;
  if (cap?.isNativePlatform?.()) {
    const p = cap.getPlatform?.();
    if (p === 'ios' || p === 'android') return p;
  }

  // Fallback por User-Agent: `ClubifyApp/<versión> (ios)`. Sirve si el bridge
  // todavía no inyectó (primeros ms del arranque) o en un WebView sin él.
  const ua = window.navigator?.userAgent ?? '';
  if (!ua.includes(NATIVE_UA_MARKER)) return null;
  return /\bandroid\b/i.test(ua) ? 'android' : 'ios';
}

/** True si corremos dentro de la app instalada (iOS o Android). */
export function isNativeApp(): boolean {
  return nativePlatform() !== null;
}

/**
 * True cuando hay que OCULTAR compras, checkouts y enlaces a pagar.
 * Hoy solo aplica a iOS — Google sí permite pagos externos para herramientas
 * de negocio, y Clubify cobra a negocios (B2B), no contenido de consumo.
 */
export function hidesPurchases(): boolean {
  return nativePlatform() === 'ios';
}

/**
 * Versión hook de nativePlatform(). Devuelve null en el PRIMER render (SSR e
 * hidratación) y el valor real después de montar: leer el UA durante el
 * render rompería la hidratación al no coincidir servidor y cliente.
 */
export function useNativePlatform(): NativePlatform | null {
  const [platform, setPlatform] = useState<NativePlatform | null>(null);
  useEffect(() => {
    setPlatform(nativePlatform());
  }, []);
  return platform;
}

/**
 * Hook para esconder compras en iOS. Empieza en false, así que el primer
 * paint muestra la UI normal y en la app desaparece al montar. Si algún día
 * hace falta que NO parpadee, la vía es el marcador de UA leído en el
 * servidor, no adivinar en el render.
 */
export function useHidesPurchases(): boolean {
  return useNativePlatform() === 'ios';
}
