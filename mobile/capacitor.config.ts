import type { CapacitorConfig } from '@capacitor/cli';

// El shell nativo NO empaqueta la web: carga el panel de producción dentro de
// un WebView. Es deliberado —el panel es Next.js con SSR y middleware, que no
// se puede exportar estático— y trae dos ventajas: el origen del WebView es el
// dominio real (las cookies de sesión funcionan igual que en el navegador) y
// cada release de producto sale por Vercel sin pasar por revisión de tienda.
//
// Lo que justifica que sea una app y no un marcador —y lo que Apple exige por
// la guideline 4.2— es la capa nativa: escáner MLKit, notificaciones push,
// biometría y enlaces universales.
const APP_URL = process.env.CLUBIFY_APP_URL ?? 'https://app.soyclubify.com';

// Marcador que la web lee en frontend/src/lib/native.ts para saber que corre
// dentro de la app. Mantener sincronizado con NATIVE_UA_MARKER.
const UA = 'ClubifyApp/1.0.0';

const config: CapacitorConfig = {
  // OJO: el bundle id es PERMANENTE una vez publicado en las tiendas.
  appId: 'com.soyclubify.app',
  appName: 'Clubify',
  // Sin bundle propio (cargamos remoto), pero Capacitor exige un webDir:
  // public/ solo lleva la pantalla de "sin conexión".
  webDir: 'public',
  server: {
    url: APP_URL,
    hostname: 'app.soyclubify.com',
    androidScheme: 'https',
    // Sólo estos dominios se abren DENTRO del WebView. Cualquier otro
    // (pasarelas, Hotmart, enlaces de clientes) sale al navegador del
    // sistema: Apple rechaza checkouts de terceros embebidos, y el usuario
    // debe ver la barra de direcciones al pagar.
    allowNavigation: ['app.soyclubify.com', 'soyclubify.com'],
    // Página local que se muestra si el panel no responde.
    errorPath: 'error.html',
  },
  ios: {
    appendUserAgent: `${UA} (ios)`,
    // La web ya maneja sus propios safe areas (env(safe-area-inset-*)).
    contentInset: 'never',
    backgroundColor: '#0B1F14',
  },
  android: {
    appendUserAgent: `${UA} (android)`,
    backgroundColor: '#0B1F14',
    // El WebView de Android no permite contenido mixto: todo por https.
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false, // la oculta la app cuando el panel terminó de cargar
      backgroundColor: '#0B1F14',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
