# Configurar Google Wallet (Loyalty Card) para Clubify

## ¿Qué vas a obtener?

Dos cosas que se pegan en el `.env` del backend:
- `GOOGLE_WALLET_ISSUER_ID` — número de 16 dígitos
- `GOOGLE_WALLET_SA_JSON` — ruta a un archivo `.json` (Service Account)

Sin estas dos cosas, el botón "Save to Google Wallet" devuelve un link MOCK
que no agrega nada al teléfono.

---

## Paso 1 — Crear cuenta de Issuer en Google Wallet (gratis, 5 min)

1. Abre https://pay.google.com/business/console
2. Inicia sesión con tu cuenta Google personal o de trabajo.
3. Si te pregunta país, elige **Colombia** (o tu país de operación).
4. Te aparece un panel "Welcome to Google Wallet". Click en **"Get started"**.
5. Llena los datos del issuer:
   - **Issuer name**: `Clubify` (es lo que verán los usuarios al guardar la tarjeta)
   - **Email**: tu email
6. Acepta términos y crea el issuer.
7. Una vez creado, en la esquina superior derecha verás el **Issuer ID**
   (un número de 16 dígitos tipo `3388000000022123456`). Cópialo —
   ese es `GOOGLE_WALLET_ISSUER_ID`.

> Mientras estés en modo "demo / sandbox" (sin publicar), las tarjetas que
> emites solo las puede ver tu cuenta Google y los emails que agregues como
> testers. Para abrir al público hay que pedir review (gratis, ~3 días).

---

## Paso 2 — Crear un Service Account en Google Cloud (gratis, 5 min)

Esto es lo que firma los JWTs que generan las tarjetas.

1. Abre https://console.cloud.google.com/projectcreate
2. Crea un proyecto nuevo: nombre `clubify-wallet`. Espera 30s a que se cree.
3. Asegúrate de tener seleccionado ese proyecto arriba a la izquierda.
4. Ve a https://console.cloud.google.com/iam-admin/serviceaccounts
5. Click **"+ CREATE SERVICE ACCOUNT"**
   - Service account name: `clubify-wallet-signer`
   - Description: `Firma JWTs de Google Wallet`
   - Click **CREATE AND CONTINUE**
6. **Roles**: salta este paso (no le des ningún rol). Click **CONTINUE** y luego **DONE**.
7. En la lista de Service Accounts, click sobre el que acabas de crear.
8. Pestaña **KEYS** → **ADD KEY** → **Create new key** → **JSON** → **CREATE**.
9. Se descarga un archivo `clubify-wallet-XXXXXX.json`. Guárdalo bien — es la llave privada.

---

## Paso 3 — Vincular el Service Account al Issuer

1. Abre el JSON que descargaste con un editor de texto.
2. Busca el campo `client_email` — algo como
   `clubify-wallet-signer@clubify-wallet.iam.gserviceaccount.com`. Cópialo.
3. Vuelve a https://pay.google.com/business/console
4. Menú lateral → **Users** (o "Usuarios").
5. **+ Invite a user**:
   - Email: pega el `client_email` del Service Account
   - Access level: **Developer** (o "Desarrollador")
6. Acepta y guarda. **Importante**: el SA tarda hasta 5 minutos en propagarse.

---

## Paso 4 — Subir el JSON al servidor del backend

### Opción A — Desarrollo local (este Mac)

```bash
mkdir -p /Users/jhonarias/Documents/AGENTES/CLUBIFY/backend/certs
mv ~/Downloads/clubify-wallet-XXXXXX.json /Users/jhonarias/Documents/AGENTES/CLUBIFY/backend/certs/google-wallet-sa.json
```

Edita `backend/.env` y agrega al final:

```
GOOGLE_WALLET_ISSUER_ID=3388000000022123456
GOOGLE_WALLET_SA_JSON=/Users/jhonarias/Documents/AGENTES/CLUBIFY/backend/certs/google-wallet-sa.json
```

Reinicia el backend:

```bash
# kill el proceso actual y vuelve a arrancar
pkill -f "nest start"
cd /Users/jhonarias/Documents/AGENTES/CLUBIFY/backend
PATH=$HOME/.clubify-tools/node/bin:$PATH npm run start:dev
```

### Opción B — Railway (producción)

Subir el JSON como variable de entorno multilínea no es trivial.
Recomendado: codificar en base64 y decodificar al arranque.

```bash
base64 -i /tmp/google-wallet-sa.json | pbcopy
```

En Railway → tu servicio → Variables, agrega:
- `GOOGLE_WALLET_ISSUER_ID` = el número
- `GOOGLE_WALLET_SA_BASE64` = pega el contenido (Cmd+V)

(En este caso hay que ajustar `wallet.service.ts` para que lea
`GOOGLE_WALLET_SA_BASE64` y lo decodifique a un tmpfile en `/tmp/google-wallet-sa.json`
al boot. Te lo agrego cuando vayas a deploy.)

---

## Paso 5 — Probar

1. Asegúrate de que `/api/health` del backend devuelva 200.
2. Asegúrate de estar logueado en tu iPhone con la **misma cuenta Google**
   que es Owner del Issuer (sino dirá "Pass not available" o "Class not found").
3. Abre el link de la tarjeta demo en tu iPhone (Safari):
   `https://attacked-princess-understand-racks.trycloudflare.com/w/60c415f6-56fe-4a8a-b7a9-91310eb80e4a`
4. Tap en **"Save to Google Wallet"**.
5. Te abre `pay.google.com`, te pide confirmar, y te agrega la tarjeta.

---

## Troubleshooting

**"Pass not available" / "Something went wrong"**
- El Service Account no está vinculado todavía al Issuer (Paso 3). Espera 5 min más.
- O estás probando con una cuenta Google que no es la del Issuer y tu
  Issuer está en sandbox. Solución: agrega tu email personal como tester
  en `pay.google.com/business/console → Test cards → Test Account`.

**"Class not found"**
- El `classId` que envío en el JWT no coincide. El código actual hace
  `${issuerId}.card_${pass.cardId}` y crea la class inline.
  Si Google rechaza la class inline, pídeme que la pre-cree via REST.

**"Invalid issuer"**
- El Issuer ID en el `.env` no es el correcto. Doble-chequea en
  `pay.google.com/business/console`.
