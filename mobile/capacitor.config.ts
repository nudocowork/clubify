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
// Se entra por /hub, no por la raíz: la raíz es la landing de marketing con
// planes y precios, justo lo que Apple rechaza dentro de la app (3.1.1).
// /hub manda al login si no hay sesión y al módulo que toque si la hay.
const APP_URL = process.env.CLUBIFY_APP_URL ?? 'https://app.soyclubify.com/hub';

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
    // Sin esto un pellizco accidental deja el panel ampliado y desplazado: se
    // ve todo cortado por los bordes y el usuario no sabe cómo deshacerlo.
    // Capacitor ya lo trae en false por defecto; se declara explícito porque
    // pasamos horas persiguiendo un "desbordamiento" que resultó ser esto.
    // En el NAVEGADOR el zoom sigue disponible (accesibilidad).
    zoomEnabled: false,
    // La web ya maneja sus propios safe areas (env(safe-area-inset-*)).
    contentInset: 'never',
    backgroundColor: '#0B1F14',
  },
  android: {
    appendUserAgent: `${UA} (android)`,
    zoomEnabled: false,
    backgroundColor: '#0B1F14',
    // El WebView de Android no permite contenido mixto: todo por https.
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      // La oculta la web al terminar de pintar (NativeSplashGate), pero con
      // TOPE: si esa llamada no llega —sin red, error de carga— el splash se
      // quedaría pegado para siempre. Pasó en la primera prueba con
      // launchAutoHide:false y nadie llamando a hide().
      launchAutoHide: true,
      launchShowDuration: 3000,
      backgroundColor: '#0B1F14',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    GoogleAuth: {
      // Google BLOQUEA su OAuth dentro de webviews embebidos, así que el
      // botón web no puede funcionar aquí por diseño: hay que pasar por el
      // SDK nativo, que abre una vista de Safari del sistema.
      //
      // Este client ID es el de iOS y NO es un secreto: viaja dentro del
      // binario y cualquiera puede extraerlo. Lo que protege la cuenta es que
      // Apple firma el bundle id, no que el ID esté oculto.
      iosClientId:
        '889594710451-6417l00bclupda5q8b3eir9l1rlc5hle.apps.googleusercontent.com',
      scopes: ['profile', 'email'],
    },
  },
};

export default config;
