# Configurar Apple Wallet (.pkpass) para Clubify

Esta guía te lleva paso a paso desde cero hasta tener tarjetas de fidelización
instalables en iPhones reales.

## Requisitos previos

- **Apple Developer Program** activo (USD 99/año en https://developer.apple.com)
- Mac con Keychain Access (no funciona desde Windows/Linux para exportar el cert)
- Acceso al panel Railway de Clubify para subir secrets

> **Sin Apple Developer**: el código de Clubify funciona igual pero los `.pkpass`
> generados son JSON sin firmar — no instalan en iPhone real. Google Wallet
> sigue funcionando perfecto sin esto.

---

## 1. Crear el Pass Type ID

1. Entra a https://developer.apple.com/account/resources/identifiers/list/passTypeId
2. Click **+** → **Pass Type IDs** → **Continue**
3. Description: `Clubify Loyalty`
4. Identifier: `pass.com.clubify.loyalty` (o el reverse-DNS de tu dominio)
5. Continue → Register
6. **Apunta el Identifier** — lo necesitas como `APPLE_PASS_TYPE_ID`

## 2. Generar el Pass Type ID Certificate

1. En la lista de Pass Type IDs, click el que acabas de crear
2. Click **Create Certificate**
3. En tu Mac abre **Keychain Access** → menú **Keychain Access** → **Certificate
   Assistant** → **Request a Certificate from a Certificate Authority...**
4. Email: tu email Apple Developer
5. Common Name: `Clubify Pass Cert`
6. CA Email: dejar vacío
7. Selecciona **Saved to disk** + **Let me specify key pair information**
8. Continue → guardar `CertificateSigningRequest.certSigningRequest`
9. Key Size: 2048, Algorithm: RSA → Continue → guarda
10. Volvé a developer.apple.com → **Choose File** → sube el `.certSigningRequest`
11. Continue → Download `pass.cer`
12. Doble-click `pass.cer` para importarlo a Keychain
13. En Keychain busca `Pass Type ID: pass.com.clubify.loyalty`
14. Click derecho → **Export** → formato `.p12` (Personal Information Exchange)
15. Guarda como `pass.p12` con contraseña (la necesitas como `APPLE_PASS_CERT_PASSWORD`)

## 3. Convertir el .p12 a .pem

passkit-generator necesita formato PEM, no PKCS12.

```bash
# Cert + key combinados en un solo .pem (más simple para nuestro caso)
openssl pkcs12 -in pass.p12 -out pass.pem -nodes -passin pass:TU_PASSWORD
```

Si querés cert y key en archivos separados:

```bash
openssl pkcs12 -in pass.p12 -clcerts -nokeys -out pass-cert.pem -passin pass:TU_PASSWORD
openssl pkcs12 -in pass.p12 -nocerts -nodes -out pass-key.pem -passin pass:TU_PASSWORD
```

## 4. Descargar el Apple WWDR Intermediate Certificate

1. Ve a https://www.apple.com/certificateauthority/
2. Descarga **Apple Worldwide Developer Relations Certificate Authority (G4)**
   o la versión más reciente (`AppleWWDRCAG4.cer`)
3. Doble-click para importar a Keychain
4. En Keychain busca el cert WWDR → click derecho → **Export** → formato `.pem`
5. Guarda como `wwdr.pem`

## 5. Generar la APNs Auth Key (para push de actualizaciones)

Esto permite que cuando un cliente acumule un sello, su iPhone se entere y
muestre el pase actualizado.

1. https://developer.apple.com/account/resources/authkeys/list
2. **+** → **Apple Push Notifications service (APNs)** → Continue
3. Key Name: `Clubify APNs`
4. Continue → Register → Download (solo se descarga una vez!)
5. Guardás `AuthKey_<KEY_ID>.p8`
6. **Apunta el Key ID** y el **Team ID** (visible arriba a la derecha del panel)

## 6. Subir certs a Railway

Opción A — variable env con contenido del archivo (recomendado):

```bash
# En Railway dashboard → backend service → Variables
APPLE_PASS_CERT_PEM=<pegar contenido de pass.pem aquí>
APPLE_WWDR_PEM=<pegar contenido de wwdr.pem aquí>
APNS_AUTH_KEY=<pegar contenido de AuthKey_XXX.p8 aquí>
```

Para esto el código necesita un pequeño ajuste: en lugar de leer de archivo,
escribir el contenido a `/tmp/*.pem` al boot. (Si preferís este modo, avísame
y lo arreglo.)

Opción B — montar archivos vía Railway Volume:

1. Crear volumen en Railway → mount path `/app/certs`
2. Conectar via Railway CLI y subir los archivos:
   ```bash
   railway run bash
   # dentro del container:
   mkdir -p /app/certs
   # subir archivos via SCP / Railway upload UI
   ```
3. Setear env vars apuntando a paths:
   ```
   APPLE_PASS_CERT_PATH=/app/certs/pass.pem
   APPLE_WWDR_PATH=/app/certs/wwdr.pem
   APNS_KEY_PATH=/app/certs/AuthKey_XXX.p8
   ```

**Más simple**: copiar los certs a `backend/certs/` localmente y subirlos en el
Dockerfile como build artifacts. Pero los certs son secretos, mejor no
commitearlos al repo.

## 7. Setear las env vars en Railway

```bash
APPLE_PASS_TYPE_ID=pass.com.clubify.loyalty
APPLE_TEAM_ID=ABC123XYZ4   # del panel Apple Developer arriba a la derecha
APPLE_PASS_CERT_PATH=/app/certs/pass.pem
APPLE_PASS_CERT_PASSWORD=tu_password_del_p12
APPLE_WWDR_PATH=/app/certs/wwdr.pem

APNS_KEY_PATH=/app/certs/AuthKey_XXX.p8
APNS_KEY_ID=XXXXXXXXXX
APNS_TEAM_ID=ABC123XYZ4   # mismo que APPLE_TEAM_ID

API_URL=https://api.soyclubify.com   # ya seteado, requerido para webServiceURL
```

Después de setear, Railway redeploya automático.

## 8. Probar end-to-end

1. Como TENANT_OWNER, emite una tarjeta a un cliente: `/app/cards/[id]` →
   "Emitir a cliente"
2. El cliente recibe link `/w/[passId]` → click "Add to Apple Wallet"
3. Safari descarga `<id>.pkpass` → iPhone abre Wallet → "Agregar"
4. En el panel: agrega un sello al cliente
5. En 1-3 segundos, el iPhone muestra el pase actualizado (silent push)

## 9. Troubleshooting

| Síntoma | Causa probable | Solución |
|---|---|---|
| Safari descarga pero "no se puede instalar" | Cert mal firmado o WWDR caducado | Renovar WWDR + verificar passwords |
| Pase instala pero no actualiza al cambiar sellos | APNs no configurado | Verificar APNS_KEY_PATH + Topic = APPLE_PASS_TYPE_ID |
| `passkit-generator` tira error de imágenes | Faltan icon.png/logo.png/strip.png | Las defaults vienen en `backend/certs/wallet-defaults/` |
| Apple Wallet abre pase con logo gris | logo.png muy chico (<160px) o mal aspect ratio | Re-generar con sharp 320×100 |
| `getAsBuffer()` error WWDR | Cert WWDR no es G4 | Descargar el más nuevo de apple.com/certificateauthority |

## 10. Personalización por tenant (futuro)

Hoy todas las tarjetas usan las imágenes default de Clubify. Para que cada
tenant tenga su logo en el `.pkpass`:

1. Tenant sube logo en `/app/storefront` (ya lo hace) → guarda en `tenant.logoUrl`
2. En `WalletService.generateApplePass`, descargar `tenant.logoUrl` con `sharp`
   y resize a 160×50 / 320×100 / 480×150 antes de armar el .pkpass
3. Cachear por tenant para no descargar en cada generación

Esto es V2. Por ahora todos los pases muestran el logo Clubify verde.
