'use client';
import { isNativeApp, nativePlatform } from './native';

// Puente hacia los plugins de Capacitor SIN importar sus paquetes npm.
//
// El shell nativo carga esta misma web, y Capacitor inyecta su bridge en la
// página: los plugins quedan colgando de window.Capacitor.Plugins. Llamarlos
// por ahí evita meter @capacitor/* como dependencia del frontend, que
// engordaría el bundle de Vercel para los 99% de usuarios que entran por
// navegador y encima rompería el SSR (los paquetes tocan window al importarse).
//
// El precio es que perdemos los tipos del paquete, así que los declaramos
// aquí a mano y todo lo que entra se valida antes de usarse.

type PermissionState = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' | 'limited';

type BarcodeScannerPlugin = {
  scan: (opts?: { formats?: string[] }) => Promise<{ barcodes?: Array<{ rawValue?: string }> }>;
  checkPermissions: () => Promise<{ camera: PermissionState }>;
  requestPermissions: () => Promise<{ camera: PermissionState }>;
  isGoogleBarcodeScannerModuleAvailable?: () => Promise<{ available: boolean }>;
  installGoogleBarcodeScannerModule?: () => Promise<void>;
};

type SplashScreenPlugin = {
  hide: (opts?: { fadeOutDuration?: number }) => Promise<void>;
};

type HapticsPlugin = {
  impact: (opts: { style: 'HEAVY' | 'MEDIUM' | 'LIGHT' }) => Promise<void>;
  notification: (opts: { type: 'SUCCESS' | 'WARNING' | 'ERROR' }) => Promise<void>;
};

function plugin<T>(nombre: string): T | null {
  if (typeof window === 'undefined') return null;
  const plugins = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } })
    .Capacitor?.Plugins;
  return (plugins?.[nombre] as T) ?? null;
}

/** True si el escáner nativo está disponible en este dispositivo. */
export function hayEscanerNativo(): boolean {
  return isNativeApp() && !!plugin<BarcodeScannerPlugin>('BarcodeScanner');
}

/** Error con mensaje ya redactado para mostrarle al usuario. */
export class ErrorEscaner extends Error {}

// Mismos formatos que acepta el escáner web, en la nomenclatura de MLKit.
// PDF417 primero por la misma razón que en /scan: es el de los pases de
// wallet y conviene que gane cuando hay varios códigos en cámara.
const FORMATOS = ['Pdf417', 'QrCode', 'Code128', 'Ean13', 'Code39', 'Aztec', 'DataMatrix'];

/**
 * Abre el escáner NATIVO (MLKit) y devuelve el contenido del código.
 * Devuelve null si el usuario cerró el escáner sin leer nada — eso no es un
 * error y no debe pintar una alerta.
 */
export async function escanearNativo(): Promise<string | null> {
  const scanner = plugin<BarcodeScannerPlugin>('BarcodeScanner');
  if (!scanner) throw new ErrorEscaner('El escáner nativo no está disponible.');

  let permiso = (await scanner.checkPermissions()).camera;
  if (permiso === 'prompt' || permiso === 'prompt-with-rationale') {
    permiso = (await scanner.requestPermissions()).camera;
  }
  if (permiso !== 'granted' && permiso !== 'limited') {
    throw new ErrorEscaner(
      'Sin permiso de cámara. Actívalo en los ajustes del teléfono para poder escanear.',
    );
  }

  // Android baja el módulo de escaneo desde Google Play la primera vez. Sin
  // esto, el primer escaneo del día de instalación falla con un error opaco.
  if (nativePlatform() === 'android' && scanner.isGoogleBarcodeScannerModuleAvailable) {
    try {
      const { available } = await scanner.isGoogleBarcodeScannerModuleAvailable();
      if (!available) await scanner.installGoogleBarcodeScannerModule?.();
    } catch {
      // Si la descarga falla seguimos: scan() dará un error más concreto.
    }
  }

  const { barcodes } = await scanner.scan({ formats: FORMATOS });
  const valor = barcodes?.[0]?.rawValue;
  return typeof valor === 'string' && valor.length > 0 ? valor : null;
}

/** Vibración de confirmación. Silenciosa si el plugin no está. */
export async function vibrar(tipo: 'ok' | 'error'): Promise<void> {
  try {
    await plugin<HapticsPlugin>('Haptics')?.notification({
      type: tipo === 'ok' ? 'SUCCESS' : 'ERROR',
    });
  } catch {
    /* la vibración nunca debe romper un escaneo */
  }
}

/**
 * Oculta el splash nativo. Se llama cuando el panel ya está pintado — ver
 * NativeSplashGate. Silenciosa fuera de la app.
 */
export async function ocultarSplashNativo(): Promise<void> {
  try {
    await plugin<SplashScreenPlugin>('SplashScreen')?.hide({ fadeOutDuration: 200 });
  } catch {
    /* si el plugin no responde, el tope de launchShowDuration lo cubre */
  }
}
