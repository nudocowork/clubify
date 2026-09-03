'use client';
import { isNativeApp } from './native';

/**
 * Login con Google DENTRO de la app, sin SDK de Google.
 *
 * Por qué no el botón web: Google BLOQUEA su OAuth en webviews embebidos
 * (`disallowed_useragent`). El botón de la web se queda cargando para siempre
 * dentro de la app — comprobado en el iPhone.
 *
 * Por qué no un plugin: el de Capacitor más usado fija `GoogleSignIn 6.2.4`,
 * que exige `GTMSessionFetcher < 3.0`; MLKit (el escáner) ya trae la 3.5.0 y
 * las restricciones son incompatibles. La alternativa mantenida arrastra el
 * SDK de Facebook entero, con su carga de declaraciones de privacidad en la
 * App Store. Ninguna de las dos vale la pena por un botón de login.
 *
 * Lo que queda es el flujo que Google documenta para apps nativas: abrir el
 * NAVEGADOR DEL SISTEMA y volver por un esquema de URL propio. Solo usa
 * plugins que ya teníamos (Browser y App).
 *
 * Va con PKCE porque un cliente de iOS es PÚBLICO: el client ID viaja dentro
 * del binario y no hay secreto que guardar. PKCE es lo que impide que otra
 * app registre el mismo esquema y se quede con el código de autorización.
 */

const CLIENT_ID =
  '889594710451-6417l00bclupda5q8b3eir9l1rlc5hle.apps.googleusercontent.com';
// El esquema inverso del client ID: así vuelve el control a la app.
const REDIRECT_URI =
  'com.googleusercontent.apps.889594710451-6417l00bclupda5q8b3eir9l1rlc5hle:/oauth2redirect';

type BrowserPlugin = { open: (o: { url: string }) => Promise<void>; close: () => Promise<void> };
type AppPlugin = {
  addListener: (
    e: 'appUrlOpen',
    cb: (d: { url: string }) => void,
  ) => Promise<{ remove: () => Promise<void> }>;
};

function plugin<T>(nombre: string): T | null {
  if (typeof window === 'undefined') return null;
  const p = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } })
    .Capacitor?.Plugins;
  return (p?.[nombre] as T) ?? null;
}

/** base64url sin relleno, que es lo que pide el RFC de PKCE. */
function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generarPkce() {
  const verificador = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verificador),
  );
  return { verificador, desafio: base64url(new Uint8Array(hash)) };
}

export function hayGoogleNativo(): boolean {
  return isNativeApp() && !!plugin<BrowserPlugin>('Browser') && !!plugin<AppPlugin>('App');
}

/**
 * Abre Google en el navegador del sistema y devuelve el `id_token`.
 * Lanza si el usuario cancela o si algo falla, con mensaje ya redactado.
 */
export async function loginGoogleNativo(): Promise<string> {
  const browser = plugin<BrowserPlugin>('Browser');
  const app = plugin<AppPlugin>('App');
  if (!browser || !app) throw new Error('El login con Google no está disponible aquí.');

  const { verificador, desafio } = await generarPkce();
  // `state` ata la respuesta a ESTA petición: sin él, otra app podría
  // dispararnos el esquema con un código suyo.
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)));

  const url =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email profile',
      code_challenge: desafio,
      code_challenge_method: 'S256',
      state,
    }).toString();

  const codigo = await new Promise<string>((resolve, reject) => {
    let oyente: { remove: () => Promise<void> } | null = null;
    // Si el usuario cierra el navegador sin terminar, nadie resolvería nunca.
    const tope = setTimeout(() => {
      oyente?.remove();
      reject(new Error('Se agotó el tiempo para iniciar sesión con Google.'));
    }, 180_000);

    app
      .addListener('appUrlOpen', ({ url: vuelta }) => {
        if (!vuelta?.startsWith(REDIRECT_URI.split(':')[0])) return;
        const q = new URLSearchParams(vuelta.split('?')[1] ?? '');
        clearTimeout(tope);
        oyente?.remove();
        browser.close().catch(() => null);
        if (q.get('state') !== state) return reject(new Error('Respuesta de Google inesperada.'));
        const c = q.get('code');
        if (!c) return reject(new Error(q.get('error') ?? 'Google no devolvió autorización.'));
        resolve(c);
      })
      .then((o) => {
        oyente = o;
        return browser.open({ url });
      })
      .catch(reject);
  });

  // Canje del código por tokens. Sin `client_secret`: un cliente de iOS es
  // público y Google lo rechaza si se manda.
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      code: codigo,
      code_verifier: verificador,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }).toString(),
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok || !datos.id_token) {
    throw new Error(datos.error_description ?? 'No se pudo completar el login con Google.');
  }
  return datos.id_token as string;
}
