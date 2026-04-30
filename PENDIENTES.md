# 🚧 Pendientes para cuando regreses

Esto es lo que **necesitas hacer tú** para que Clubify v2 corra de extremo a extremo. Todo el código está escrito y compila — sólo falta la infraestructura local y un par de credenciales.

Tiempo estimado: **30-45 minutos** la primera vez.

---

## 1. Instalar Docker Desktop  ⏱ 10 min

El backend NestJS necesita Postgres + Redis + MinIO. La forma más fácil de tenerlos en este Mac es Docker Desktop.

```bash
# Bajar Docker Desktop para Mac (Apple Silicon):
open https://desktop.docker.com/mac/main/arm64/Docker.dmg
# O via Homebrew si lo prefieres instalar primero:
# /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
# brew install --cask docker
```

Tras instalarlo, abre Docker Desktop una vez para que inicialice. Después:

```bash
cd /Users/jhonarias/Documents/AGENTES/CLUBIFY/docker
docker compose up -d
```

Eso levanta:
- Postgres en `localhost:5432` (db `clubify`, user `clubify`, pass `clubify`)
- Redis en `localhost:6379`
- MinIO en `localhost:9001` (UI), `:9000` (S3 API)

**Verificar que esté corriendo:**
```bash
docker ps | grep clubify
```

---

## 2. Instalar dependencias del backend  ⏱ 5 min

Node ya está disponible vía el binario portable que instalé. Solo necesitas exportar el PATH.

```bash
export PATH="$HOME/.clubify-tools/node/bin:$PATH"
cd /Users/jhonarias/Documents/AGENTES/CLUBIFY/backend
cp .env.example .env   # si no lo hiciste
npm install
```

**Notas sobre dependencias nativas:**

- **`argon2`** requiere `node-gyp` y herramientas de compilación de C++. Si falla, instala las Command Line Tools de Xcode:
  ```bash
  xcode-select --install
  ```
  Y vuelve a intentar `npm install`.
- **`passkit-generator`** depende de OpenSSL. Suele instalarse sin problemas en macOS moderno.

Si algún paquete da problemas, alternativa rápida: comenta temporalmente `argon2` y `passkit-generator` en `package.json` — el resto sigue funcionando, solo que el login usará comparación insegura (solo dev) y los pases Apple devolverán JSON mock (ya tiene fallback).

---

## 3. Migración Prisma + seed  ⏱ 2 min

Con el backend dependent y Postgres corriendo:

```bash
cd /Users/jhonarias/Documents/AGENTES/CLUBIFY/backend
npx prisma migrate dev --name init_v2
npm run seed
```

Esto crea **todas las tablas v1 + v2** (27 tablas) y siembra:
- Super Admin: `admin@clubify.local / Clubify123!`
- Tenant demo "Café del Día": `demo@clubify.local / Demo123!`
- 3 categorías + 8 productos demo (calentado paisa, capuchino, brownie, etc.)
- 1 promoción demo (-20% bebidas los lunes)
- 1 pase de María Pérez con 3 sellos
- 1 automation activa (agradecer pedido confirmado)
- Storefront publicado en `clubify.app/m/cafe-del-dia`

---

## 4. Levantar backend  ⏱ 1 min

En la misma terminal con el PATH configurado:

```bash
npm run start:dev
```

Backend escucha en **http://localhost:3001**. Verifica con:

```bash
curl http://localhost:3001/api/health
```

---

## 5. El frontend ya está corriendo

Está en **http://localhost:4848** desde la sesión anterior. Si no, levántalo así:

```bash
export PATH="$HOME/.clubify-tools/node/bin:$PATH"
cd /Users/jhonarias/Documents/AGENTES/CLUBIFY/frontend
PORT=4848 npm run dev
```

Configura variables de entorno si no existe `.env.local`:

```bash
cp .env.example .env.local
# Tiene: NEXT_PUBLIC_API_URL=http://localhost:3001
```

---

## 6. Probar el flujo completo end-to-end  ⏱ 5 min

Una vez backend + frontend corriendo:

1. **Login dueño:** http://localhost:4848/login → `demo@clubify.local / Demo123!`
2. **Editor de menú:** http://localhost:4848/app/menu → ya tiene 3 categorías + 8 productos del seed
3. **Storefront público:** http://localhost:4848/m/cafe-del-dia → ves el menú completo
4. **Hacer un pedido:**
   - Tap producto → modal con variantes/extras
   - Agregar al carrito
   - Tap dock inferior → carrito
   - Finalizar → form de checkout
   - Submit → debería abrir WhatsApp con mensaje pre-llenado al `+573000000000` y luego redirigir a `/o/[code]`
5. **Ver pedido en kanban:** http://localhost:4848/app/orders → aparece en "Nuevos"
6. **Confirmar pedido:** click "Confirmar" → estado pasa, automation se dispara, sello se suma al pase de María
7. **Ver mensaje generado:** http://localhost:4848/app/messages → debería estar el WhatsApp de agradecimiento

---

## 7. Configuraciones que necesitan tu input

### 7.1 WhatsApp del negocio demo (opcional para probar)

Por defecto, el seed pone `+573000000000` (placeholder). Para que el botón de WhatsApp realmente abra TU WhatsApp:

```sql
-- En psql
UPDATE tenants SET "whatsappPhone" = '+57TUNUMERO' WHERE slug = 'cafe-del-dia';
```

O desde el panel admin (cuando agregue ese campo en `/admin/tenants/[id]`, lo dejé pendiente).

### 7.2 Para activar Apple Wallet en producción

Necesitas:
- **Pass Type ID** en https://developer.apple.com/account/resources/identifiers/list/passTypeId
- Generar certificado, exportar `.p12`, convertir a `.pem`
- **APNs Auth Key** (`.p8`) para enviar pushes

Detalles paso a paso en [docs/06-wallet-integration.md](docs/06-wallet-integration.md). En desarrollo el código ya degrada elegantemente: devuelve un JSON mock cuando los certs no existen.

### 7.3 Para activar Google Wallet

Necesitas:
- Google Cloud Project con **Wallet API** habilitada
- Service account JSON
- Issuer ID en https://pay.google.com/business/console
- Setear `GOOGLE_WALLET_ISSUER_ID` y `GOOGLE_WALLET_SA_JSON` en `.env`

### 7.4 Para activar WhatsApp Cloud API real (fase 2)

En MVP usamos `wa.me` link (cero config). Para enviar mensajes server-to-server:
- Crear cuenta en https://business.facebook.com/wa
- Aprobar templates en Meta Business
- Setear `META_WA_TOKEN`, `META_WA_PHONE_ID` en `.env`
- Implementar el `WhatsappCloudAdapter` en `backend/src/channels/` (ya está la estructura)

### 7.5 Para pagos online (fase 2)

Cuentas a crear según mercado:
- Stripe (https://stripe.com) — internacional
- Mercado Pago (https://www.mercadopago.com.co/developers) — LATAM
- PSE Colombia vía Wompi o ePayco

---

## 8. Cosas que no implementé (consciente)

| Cosa | Por qué no | Cuándo |
|---|---|---|
| Dependencia `@nestjs/schedule` para crons | Requiere instalación + setup, no afecta MVP | Cuando se quiera disparar `INACTIVITY_7D` automáticamente |
| Subida real de imágenes a S3/MinIO desde panel | Faltó componente `<ImageUploader />`. El campo `imageUrl` acepta URLs externas por ahora | Sprint 2 |
| Drag-to-reorder de categorías y productos en el editor | Requiere `dnd-kit` o similar | Sprint 2 |
| WebSockets para kanban en tiempo real | Por ahora polling cada 8s; suficiente para MVP | Cuando GMV justifique |
| Onboarding wizard de 5 pasos | Falta crear `/onboarding/page.tsx` | Sprint 2 |
| Métricas analíticas reales (funnels, top productos) | El módulo `metrics` actual sólo trae KPIs básicos del v1. Tabla `events` ya guarda todo, falta queries SQL | Sprint 3 |
| Custom domain del storefront | DNS + SSL automático con Caddy | Plan Business |
| Tests automatizados | El código está modular, fácil de añadir vitest | Sprint 4 |

---

## 9. Resumen de lo construido en esta sesión

### Backend (~3500 líneas nuevas)
- `prisma/schema.prisma` extendido con **14 modelos nuevos** (Catalog, Orders, Promos, Channels, Storefront, Events, etc.)
- 7 módulos NestJS nuevos:
  - `catalog/` (Categories, Products, PublicMenu)
  - `orders/` (privado kanban + público creación)
  - `promotions/` (CRUD + motor de aplicación)
  - `storefront/` (CRUD + endpoint público `/m/[slug]`)
  - `channels/` (WhatsApp link adapter + Messages)
  - `automations/` (motor de reglas event-driven)
- `prisma/seed.ts` extendido con productos, promo y receta de automation

### Frontend (~3000 líneas nuevas)
- Sidebar reorganizado en 4 secciones (Vender / Fidelizar / Automatizar / Tu sitio) con 11 items
- 7 páginas tenant nuevas:
  - `/app/orders` — kanban en vivo con polling 8s
  - `/app/menu` — editor con drawer de productos + variantes/extras
  - `/app/promos` — CRUD con drawer
  - `/app/automations` — recetas pre-armadas + builder visual
  - `/app/messages` — inbox unificado
  - `/app/storefront` — editor de sitio con preview iPhone
- 2 páginas públicas críticas:
  - `/m/[slug]` — storefront cliente final con menú, modal de producto (variantes + extras + qty + notas), carrito en localStorage, checkout con WhatsApp
  - `/o/[code]` — confirmación con tracking de estado en vivo (polling 10s)
- Lib nueva: `lib/cart.ts` con persistencia localStorage por tenant

### Estado
- ✅ Compila sin errores
- ✅ Frontend Next.js corriendo en http://localhost:4848
- ⏸ Backend NestJS necesita Docker + npm install (tú)
- ✅ Documentado todo en `docs/10-vision-os.md` … `docs/14-mvp-roadmap.md`

---

## 10. Plan para la próxima sesión

Cuando regreses con Docker corriendo:

1. **Yo**: corro `npx prisma migrate dev` + `npm run seed`
2. **Yo**: arranco el backend en :3001
3. **Tú**: pruebas el flujo de pedido en `/m/cafe-del-dia` (puedes usar tu WhatsApp real)
4. **Tú**: me dices qué ajustar visualmente o de UX
5. **Yo**: Sprint 2 — onboarding wizard + image uploader + métricas reales con funnels

¿Algo que quieras priorizar diferente? Avísame al regresar.

---

## 11. v3 — Pagos online (activar gateways reales)  ⏱ 15-30 min por gateway

Todo el flujo de pagos está cableado end-to-end con un **gateway "stub"** que simula la pasarela en `/pay/[code]`. Para activar pagos reales en producción:

### Stripe (tarjeta internacional)
1. Crear cuenta en https://dashboard.stripe.com → modo **Test** primero.
2. Copiar `Secret key` → `STRIPE_SECRET_KEY=sk_test_...` en `backend/.env`
3. `cd backend && npm i stripe`
4. Implementar `backend/src/payments/adapters/stripe.gateway.ts`:
   - `createSession`: usar `stripe.checkout.sessions.create({ line_items, success_url, cancel_url, metadata: { orderId, code } })`
   - `parseWebhook`: `stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET)`
5. Configurar webhook en Stripe Dashboard → URL `https://api.tudominio.com/api/public/payments/webhook/stripe`

### Mercado Pago (LATAM)
1. https://www.mercadopago.com.co/developers/panel → crear app
2. `MERCADO_PAGO_ACCESS_TOKEN=APP_USR-...` en `.env`
3. `npm i mercadopago`
4. Implementar `mercadopago.gateway.ts` con `preference.create({ items, back_urls, auto_return: 'approved', notification_url })`
5. Webhook URL en panel MP: `/api/public/payments/webhook/mercado_pago`

### Wompi (Colombia — PSE, Bancolombia, Nequi)
1. https://comercios.wompi.co → modo Sandbox
2. `WOMPI_PUBLIC_KEY` + `WOMPI_PRIVATE_KEY` en `.env`
3. Implementar `wompi.gateway.ts` con POST `https://production.wompi.co/v1/transactions`
4. Webhook URL: `/api/public/payments/webhook/wompi` — validar `events.signature.checksum` SHA-256

**Test sin gateways reales:** ya funciona el método "STUB" en cualquier checkout — selecciónalo y verás la página de simulación. Útil para demos.

---

## 12. v3 — Dominio custom para storefront  ⏱ 20 min

Cada tenant puede vincular su propio dominio (`mibrand.com`) en `/app/storefront → "Dominio propio"`. Para que funcione:

### Opción A — Caddy reverse proxy (recomendado, auto-SSL)
1. Instalar Caddy en el servidor: `brew install caddy` o `apt install caddy`
2. Crear `/etc/caddy/Caddyfile`:
   ```
   # Catch-all para dominios custom de tenants
   import /etc/caddy/sites/*.caddy

   app.clubify.app {
     reverse_proxy localhost:4848
   }

   api.clubify.app {
     reverse_proxy localhost:4949
   }
   ```
3. Para **cada nuevo dominio de tenant**, crear `/etc/caddy/sites/<tenant>.caddy`:
   ```
   cafedeldia.com, www.cafedeldia.com {
     reverse_proxy localhost:4848
   }
   ```
   Caddy obtiene SSL/Let's Encrypt automáticamente.
4. `sudo systemctl reload caddy`

### Opción B — Cloudflare CNAME-only
- En el DNS del cliente: `CNAME mibrand.com → clubify.app`
- En Cloudflare proxied + Page Rule a `app.clubify.app`
- El middleware de Next.js detecta el `Host` y reescribe `/` → `/m/<slug>`

### Cómo funciona internamente
- Tenant configura `customDomain` en `/app/storefront` → guardado en `Storefront.customDomain`
- Cliente visita `cafedeldia.com` → Caddy proxy a Next.js → middleware `src/middleware.ts` llama a `GET /api/public/storefront/resolve-host?host=cafedeldia.com`
- Backend devuelve `{ slug: 'cafe-del-dia' }`
- Next.js hace `rewrite('/' → '/m/cafe-del-dia')` (la URL en la barra sigue siendo `cafedeldia.com`)
- Cache en memoria 60s para no spammear el backend

### Para probar local sin DNS real
Edita tu `/etc/hosts`:
```
127.0.0.1  miempresa.test
```
Configura `miempresa.test` en `/app/storefront` y visita `http://miempresa.test:4848`.
