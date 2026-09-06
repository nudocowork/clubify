# Clubify — apps iOS / Android

Shell nativo (Capacitor) que carga el panel de producción
(`https://app.soyclubify.com`) dentro de un WebView y le agrega funciones
nativas. Lee primero [`capacitor.config.ts`](capacitor.config.ts): ahí está el
porqué de cada decisión.

**No forma parte del build de Vercel.** `mobile/` vive fuera de `frontend/`
justo para eso: sus dependencias no entran al bundle del panel.

---

## Estado

| | |
|---|---|
| Proyecto Capacitor + config | ✅ |
| Proyecto Android (`android/`) | ✅ generado, sin compilar |
| Proyecto iOS (`ios/`) | ✅ pods instalados, compila (verificado en simulador) |
| Lanzador por rol (`/hub` en el panel) | ✅ desplegable |
| Escáner nativo, push, biometría | ⛔ pendiente (fase 3) |
| Fichas de tienda | ⛔ pendiente |

---

## Requisitos de la máquina que compila

Ninguno de estos estaba instalado cuando se creó el proyecto:

```bash
# iOS — Xcode desde la App Store (~10 GB), luego:
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
sudo gem install cocoapods

# Android — Android Studio + JDK 17
brew install --cask android-studio temurin@17
```

Con eso listo, completar el proyecto iOS:

```bash
cd mobile
npx cap sync            # instala los Pods y enlaza los 8 plugins
npm run ios             # abre Xcode
npm run android         # abre Android Studio
```

---

## Flujo de trabajo

El contenido de las apps es la web de producción: **un deploy del frontend ya
actualiza las dos apps**, sin pasar por revisión de tienda. Solo hay que
recompilar y volver a subir el binario cuando cambia algo del shell nativo
(plugins, permisos, iconos, versión).

```bash
npx cap sync            # tras tocar capacitor.config.ts o agregar plugins
CLUBIFY_APP_URL=http://192.168.1.X:3000 npx cap sync   # apuntar a tu máquina para probar
```

---

## Antes de enviar a revisión

**Apple 3.1.1 — compras.** Si dentro de la app iOS se puede comprar o renovar
plan, comprar créditos o pagar el PRO de Infolinks, Apple exige su compra
in-app (30%) o rechaza. Hay que ocultar esos flujos en iOS con
`useHidesPurchases()` de `frontend/src/lib/native.ts` (el helper ya existe;
falta aplicarlo). Incluye: `/pagar`, checkout de Hotmart, "Mejorar plan",
"Comprar créditos" y el checkout Stripe de Sellea Infolinks.

**Apple 4.2 — funcionalidad mínima.** Una app que solo abre un sitio se
rechaza. El argumento son el escáner MLKit, las notificaciones push, la
biometría y los enlaces universales: hasta que estén, no conviene enviar.

**Apple 4.3 — clones.** Las marcas blancas (Sellea, Fideliso…) **no** se
publican como apps separadas desde la cuenta de Clubify: Apple las marca como
spam. Siguen usando la PWA instalable, que ya sirve manifest e iconos por
marca. Si alguna quiere app propia, se publica desde SU cuenta de
desarrollador.

**Cuenta demo para el revisor.** Apple siempre la pide. Debe ser un negocio de
prueba con datos realistas y acceso a todos los módulos que se ven en las
capturas.

**Política de privacidad.** Ya existe en `/legal`; hay que declarar en la
ficha qué datos se recogen (cámara, notificaciones, cuenta).

---

## Parche de MLKit (ITMS-91061 — manifiesto de privacidad)

`patches/@capacitor-mlkit+barcode-scanning+6.2.0.patch` sube el pin de MLKit de
`5.0.0` a `6.0.0` en el podspec del plugin. **No es cosmético: sin él Apple
rechaza el binario.**

La cadena era:

```
@capacitor-mlkit/barcode-scanning 6.2.0
  └─ GoogleMLKit/BarcodeScanning 5.0.0   (pin exacto en el podspec)
       └─ MLKitCommon 10.0.0
            └─ GoogleToolboxForMac ~> 2.1  →  2.3.2  ← SIN PrivacyInfo.xcprivacy
```

GoogleToolboxForMac está en la lista de SDKs de terceros que Apple obliga a
llevar manifiesto de privacidad, y no lo incluyó hasta la **4.2.1**. La 2.x
nunca lo va a tener. `MLKitCommon 11.0.0` es la primera versión que exige
`GoogleToolboxForMac >= 4.2.1`, y llega vía `GoogleMLKit 6.0.0`.

No se puede arreglar desde el `Podfile`: el podspec del plugin fija la versión
con `=`, así que CocoaPods rechaza cualquier override. Por eso el parche, que
se reaplica solo con `postinstall` (`patch-package`).

La 6.2.0 es la última del plugin para Capacitor 6, y el código Swift que toca
MLKit (`MLKitBarcodeScanner.barcodeScanner(options:)`, `BarcodeScannerOptions`,
`BarcodeFormat`) es idéntico al de la 7.0.0 — por eso compila sin tocar nada
más. **Al subir a Capacitor 7/8 el parche sobra:** el plugin 7.x ya pide
GoogleMLKit 7.0.0 y hay que borrar `patches/`.

Verificación de que quedó bien, tras `npx cap sync ios`:

```bash
grep "GoogleToolboxForMac/Logger (" ios/App/Podfile.lock   # debe decir 4.2.1
# y en el .app compilado:
find <ruta>.app/Frameworks/GoogleToolboxForMac.framework -name "*.xcprivacy"
```

## Identidad de la app

- **Bundle id:** `com.soyclubify.app` — es **permanente** una vez publicado.
- **Nombre:** Clubify
- **Icono y splash:** poner `resources/icon.png` (1024×1024) y
  `resources/splash.png` (2732×2732) y correr `npm run assets`.
