# Arquitectura técnica — Clubify

## Vista general

Clubify es una plataforma SaaS **multi-tenant** donde un Super Admin gestiona múltiples negocios (tenants), y cada negocio gestiona sus propias tarjetas digitales y clientes finales.

```
                    ┌──────────────────────────────────────────────┐
                    │              Frontend (Next.js)              │
                    │  /admin   /app   /scan   /w/[passId]         │
                    └────────────────────┬─────────────────────────┘
                                         │ HTTPS / JWT
                    ┌────────────────────▼─────────────────────────┐
                    │           Backend (NestJS API)               │
                    │  Auth · Tenants · Cards · Customers ·        │
                    │  Stamps · Locations · Notifications ·        │
                    │  Referrals · Wallet · Webhooks               │
                    └──┬────────────┬─────────────┬────────────────┘
                       │            │             │
                  ┌────▼───┐   ┌────▼────┐   ┌────▼────┐
                  │Postgres│   │  Redis  │   │   S3    │
                  │  +     │   │ + Bull  │   │  (logos │
                  │Prisma  │   │  MQ     │   │  pases) │
                  └────────┘   └─────────┘   └─────────┘
                                    │
                          ┌─────────▼──────────┐
                          │  Workers asíncronos│
                          │  - PassKit signer  │
                          │  - APNs push       │
                          │  - Google Wallet   │
                          │  - Geofence eval   │
                          │  - Auto reglas     │
                          └────────────────────┘
```

## Multi-tenancy

- **Modelo:** Single database, shared schema, fila por `tenantId` (cada tabla tenant-aware tiene `tenantId`).
- Toda consulta del backend pasa por un `TenantGuard` + un Prisma middleware que inyecta `tenantId` automáticamente para usuarios no-superadmin.
- El Super Admin puede operar **cross-tenant**.

## Roles (RBAC)

| Rol | Scope | Permisos |
|---|---|---|
| `SUPER_ADMIN` | global | CRUD tenants, planes, límites, ver todo |
| `TENANT_OWNER` | tenant | CRUD tarjetas, clientes, ubicaciones, push, referidos, ver métricas |
| `TENANT_STAFF` | tenant | scanner, sumar sellos, redimir, sin admin |
| `END_USER` | público | wallet, pases, referidos como invitado |

JWT incluye: `sub`, `role`, `tenantId?`, `iat`, `exp`. Refresh token rotativo en cookie httpOnly.

## Módulos backend

```
src/
  auth/              login, refresh, JWT strategy, guards
  tenants/           CRUD negocios, límites, planes
  users/             usuarios del sistema (admins, staff)
  cards/             constructor de tarjetas (templates)
  customers/         clientes finales por tenant
  passes/            instancias emitidas (1 customer × 1 card)
  stamps/            transacciones de sellos/puntos/redenciones
  locations/         sucursales con lat/lng + radio
  notifications/     push manual y reglas
  automations/       reglas event-driven
  referrals/         códigos, comisiones, payouts
  wallet/            generación PKPass + Google Wallet objects
  scanner/           validación de QR firmado
  webhooks/          callbacks Apple (registrations) y Google
  metrics/           agregaciones para dashboards
  common/            guards, interceptors, prisma service, dto base
```

## Frontend (Next.js 14 App Router)

```
src/app/
  (marketing)/            landing pública
  (auth)/login            login unificado (detecta rol)
  admin/                  panel super admin
    tenants/
    referrals/
    settings/
  app/                    panel tenant
    cards/
    customers/
    locations/
    notifications/
    automations/
    referrals/
    settings/
  scan/                   PWA scanner
  w/[passId]/             página pública para añadir a Wallet
```

- **Estado:** Server Components + React Query para mutaciones.
- **UI:** Tailwind + shadcn/ui, paleta Clubify (verde oscuro `#0F3D2E`, verde medio `#2E7D5B`, crema `#F5F1E8`, grafito `#1B1B1B`).
- **Auth en cliente:** cookies httpOnly seteadas por el backend; middleware de Next.js redirige según rol.

## Generación de pases

### Apple Wallet (.pkpass)
1. Cliente final hace clic en "Add to Apple Wallet" en `/w/[passId]`.
2. Backend genera `pass.json` (campos primarios: sellos actuales / puntos / saldo), añade imágenes (logo, icon, strip) y firma con el certificado del **Pass Type ID** del tenant (o de Clubify si el tenant no tiene el suyo).
3. Devuelve `application/vnd.apple.pkpass`.
4. Apple registra el dispositivo en `POST /v1/devices/.../registrations/...` → guardamos `pushToken`.
5. Cuando un sello cambia → `bull` job → `PUT pass.json` + APNs silent push → iOS hace `GET pass.json`.

### Google Wallet
1. Backend tiene una **LoyaltyClass** por `card` (template).
2. Por cada `pass`, crea un **LoyaltyObject** vía API.
3. Genera un JWT firmado con la cuenta de servicio → link `https://pay.google.com/gp/v/save/{jwt}`.
4. Updates posteriores → `PATCH loyaltyObject` (puntos/sellos) → Google envía push automáticamente.

Ver detalle en [06-wallet-integration.md](06-wallet-integration.md).

## QR firmado y scanner

- Cada `pass` tiene un `qrToken` (JWT corto firmado con HMAC, sin expiración o con rotación opcional, contiene `passId` + `tenantId`).
- El QR codifica `https://app.clubify.local/scan?t={qrToken}` o solo `{qrToken}` para que el scanner del tenant lo lea.
- El scanner web verifica el token, llama a `POST /stamps` con la acción (`STAMP`, `REDEEM`, `REFUND`).

## Geolocalización

- `locations` (max 3 por defecto, configurable por tenant). Cada una con `lat/lng/radiusM` (100/300/500).
- En generación de pase, se incluye `locations[]` en el `pass.json`. iOS dispara una notificación local cuando el dispositivo entra en el radio.
- Para Android (Google Wallet) se usa `LocationsRequest` análogo.

## Automatizaciones

Motor sencillo basado en eventos:
- Eventos: `stamp.added`, `pass.redeemed`, `customer.inactive`, `geo.entered`, `pass.created`.
- Reglas: `IF event AND condition THEN action(notification|email)`.
- Procesado en BullMQ workers desacoplados del request.

## Referidos

- Tabla `referral_codes` con código único Base32 de 8 chars.
- `referral_uses` registra cada conversión (click → signup → conversion).
- Comisiones calculadas según plan del tenant invitado y marcadas como `pending|paid`.
- Super Admin tiene panel de payouts.

## Seguridad

- Argon2id para passwords.
- Rate limit (NestJS Throttler) en `/auth/*`.
- Helmet, CORS estricto.
- CSP en frontend.
- Audit log en `audit_logs` para acciones sensibles.
- Rotación de refresh tokens, blacklist en Redis.
- Secret management vía env (Doppler/AWS SM en prod).

## Observabilidad

- Logs estructurados (Pino).
- Métricas Prometheus expuestas en `/metrics`.
- Sentry en frontend y backend.
- Health checks `/health` (db, redis, s3).
