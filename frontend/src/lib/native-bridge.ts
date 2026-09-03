'use client';
import { isNativeApp, nativePlatform, type NativePlatform } from './native';

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

type OyenteEscaneo = { remove: () => Promise<void> };

type BarcodeScannerPlugin = {
  scan: (opts?: { formats?: string[] }) => Promise<{ barcodes?: Array<{ rawValue?: string }> }>;
  startScan: (opts?: { formats?: string[] }) => Promise<void>;
  stopScan: () => Promise<void>;
  addListener: (
    evento: 'barcodeScanned',
    cb: (r: { barcode?: { rawValue?: string } }) => void,
  ) => Promise<OyenteEscaneo>;
  checkPermissions: () => Promise<{ camera: PermissionState }>;
  requestPermissions: () => Promise<{ camera: PermissionState }>;
  isGoogleBarcodeScannerModuleAvailable?: () => Promise<{ available: boolean }>;
  installGoogleBarcodeScannerModule?: () => Promise<void>;
};

type SplashScreenPlugin = {
  hide: (opts?: { fadeOutDuration?: number }) => Promise<void>;
};

type PushPlugin = {
  requestPermissions: () => Promise<{ receive: PermissionState }>;
  register: () => Promise<void>;
  addListener: (
    evento: 'registration' | 'registrationError' | 'pushNotificationActionPerformed',
    cb: (dato: any) => void,
  ) => Promise<{ remove: () => Promise<void> }>;
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

async function asegurarPermisoCamara(scanner: BarcodeScannerPlugin): Promise<void> {
  let permiso = (await scanner.checkPermissions()).camera;
  if (permiso === 'prompt' || permiso === 'prompt-with-rationale') {
    permiso = (await scanner.requestPermissions()).camera;
  }
  if (permiso !== 'granted' && permiso !== 'limited') {
    throw new ErrorEscaner(
      'Sin permiso de cámara. Actívalo en los ajustes del teléfono para poder escanear.',
    );
  }
}

/**
 * Abre el escáner NATIVO (MLKit) y devuelve el contenido del código.
 * Devuelve null si el usuario cerró el escáner sin leer nada — eso no es un
 * error y no debe pintar una alerta.
 */
export async function escanearNativo(): Promise<string | null> {
  const scanner = plugin<BarcodeScannerPlugin>('BarcodeScanner');
  if (!scanner) throw new ErrorEscaner('El escáner nativo no está disponible.');

  await asegurarPermisoCamara(scanner);

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

/**
 * Escaneo nativo CON MIRA PROPIA.
 *
 * scan() abre la pantalla del sistema, que trae un recuadro cuadrado y no se
 * puede cambiar. Los pases de wallet llevan un código de barras ANCHO
 * (PDF417), así que apuntar con un cuadrado es incómodo y confunde: la gente
 * cree que tiene que encajar la tarjeta entera dentro.
 *
 * startScan() en cambio pone la cámara DETRÁS del WebView y deja que la mira
 * la dibujemos nosotros en HTML, con la proporción real del código. A cambio
 * hay que poner la página transparente mientras dura (clase en el <body>) y
 * acordarse de limpiar SIEMPRE: si esto se queda a medias, el usuario queda
 * con un panel invisible y la cámara encendida.
 */
export const CLASE_ESCANEO = 'escaner-nativo-activo';

let detenerActual: (() => Promise<void>) | null = null;

export async function iniciarEscaneoNativo(
  alLeer: (texto: string) => void,
): Promise<void> {
  const scanner = plugin<BarcodeScannerPlugin>('BarcodeScanner');
  if (!scanner?.startScan) throw new ErrorEscaner('El escáner nativo no está disponible.');

  await asegurarPermisoCamara(scanner);

  const oyente = await scanner.addListener('barcodeScanned', (r) => {
    const valor = r?.barcode?.rawValue;
    if (typeof valor === 'string' && valor.length > 0) alLeer(valor);
  });

  document.body.classList.add(CLASE_ESCANEO);

  detenerActual = async () => {
    detenerActual = null;
    document.body.classList.remove(CLASE_ESCANEO);
    try {
      await oyente.remove();
    } catch {
      /* ya removido */
    }
    try {
      await scanner.stopScan();
    } catch {
      /* ya detenido */
    }
  };

  try {
    await scanner.startScan({ formats: FORMATOS });
  } catch (e) {
    // Si startScan falla hay que deshacer la transparencia igual, o la
    // pantalla queda en blanco sin cámara detrás.
    await detenerEscaneoNativo();
    throw e;
  }
}

/** Cierra el escaneo en curso. Seguro de llamar aunque no haya ninguno. */
export async function detenerEscaneoNativo(): Promise<void> {
  await detenerActual?.();
}

/**
 * Registra el teléfono para notificaciones push y manda el token al backend.
 *
 * Se llama DESPUÉS del login, no al abrir la app: pedir el permiso en el
 * primer arranque, antes de que la persona sepa qué es esto, es la forma
 * segura de que lo niegue para siempre — y en iOS no se puede volver a
 * preguntar, hay que mandarla a Ajustes.
 *
 * Silenciosa ante cualquier fallo: quedarse sin push es un problema, pero
 * romper el arranque del panel por eso sería peor.
 */
export async function registrarPush(
  enviarToken: (token: string, plataforma: NativePlatform) => Promise<unknown>,
): Promise<void> {
  const plataforma = nativePlatform();
  const push = plugin<PushPlugin>('PushNotifications');
  if (!plataforma || !push) return;

  try {
    const { receive } = await push.requestPermissions();
    if (receive !== 'granted') return;

    await push.addListener('registration', (dato: { value?: string }) => {
      const token = dato?.value;
      if (token) enviarToken(token, plataforma).catch(() => null);
    });

    await push.addListener('registrationError', () => {
      // Sin entitlement de push o sin red. No hay nada que el usuario pueda
      // hacer, así que no se le muestra nada.
    });

    await push.register();
  } catch {
    /* push es opcional: nunca debe tumbar el arranque */
  }
}
