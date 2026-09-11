# Onboarding → Clubify — Sync API (contrato de integración)

> **Estado:** Fases A (diccionario) + B (token) + C (endpoints) + **D (webhook `business.activated`) — TODAS LIVE.**
> El onboarding se adapta a estos nombres/endpoints; Clubify NO se reestructura.
> Fuente de verdad: `backend/prisma/schema.prisma`. Nombres y tipos copiados **tal cual** existen hoy.

---

## Modelo mental (leer primero)

- **Un negocio = una fila `Tenant`.** Su id único es **`Tenant.id`** (`uuid`) y su identificador público de URL es **`Tenant.slug`** (`@unique`).
- Casi toda fila de un negocio lleva un escalar **`tenantId`** (FK a `Tenant`, `onDelete: Cascade`): `Card.tenantId`, `Product.tenantId`, `Category.tenantId`, `Location.tenantId`, `Promotion.tenantId`, etc. **Ese `tenantId` es la clave de aislamiento** que la Sync API fija en cada escritura.
- Encima del negocio está la marca: `Tenant.whiteLabelId → WhiteLabel` (negocio → marca). La config de marca (branding fallback, módulos) vive en `WhiteLabel`/`WhiteLabelModule`, **no** por negocio.
- `Setting` es un key-value **global** (no tenant-scoped por columna). La config del negocio NO vive ahí.

---

## FASE A — Diccionario de campos (entregable #1)

### 1. Negocio / cuenta
| Concepto | Modelo | Campo (exacto) | Tipo | Notas |
|---|---|---|---|---|
| Nombre interno | `Tenant` | `name` | `String` | |
| Nombre de marca (público) | `Tenant` | `brandName` | `String` | Se muestra al cliente / en el wallet |
| Slug (id público) | `Tenant` | `slug` | `String @unique` | Identificador URL |
| Categoría | `Tenant` | `businessCategorySlug` | `String?` | Slug de `common/business-categories.ts` (`restaurant`, `barbershop`…). No es FK. Fallback runtime `'restaurant'`. |
| Descripción | `Storefront` | `description` | `String @default("")` | **Tenant NO tiene descripción.** Vive en el storefront. |
| Dirección | `Location` | `address` | `String @default("")` | **Por sede, no en Tenant.** Un negocio puede tener varias `Location`. |
| Ciudad | — | — | — | **No hay `city` de primera clase.** Cercanos: `Tenant.trialCity` (captura de prospecto), `Location.state`. |
| País | `Tenant` | `country` | `String @default("CO")` | ISO 3166-1 alpha-2 |
| **Teléfono del negocio** | **`Tenant`** | **`phone`** | **`String?`** | **Este es el teléfono.** Distinto de los `whatsapp*`. |
| WhatsApp general | `Tenant` | `whatsappPhone` | `String?` | |
| WhatsApp pedidos | `Tenant` | `whatsappOrdersPhone` | `String?` | Cae a `whatsappPhone` |
| WhatsApp domicilios | `Tenant` | `whatsappDeliveryPhone` | `String?` | |
| WhatsApp reservas | `Tenant` | `whatsappReservationsPhone` | `String?` | |
| Correo | `Tenant` | `email` | `String` | Requerido |
| Sitio web | — | — | — | **No existe campo `website` en Tenant.** |

### 2. Branding
| Concepto | Modelo | Campo | Tipo | Notas |
|---|---|---|---|---|
| Logo | `Tenant` | `logoUrl` | `String?` | |
| Logo wallet | `Tenant` | `walletLogoUrl` | `String?` | Cae a `logoUrl` |
| Logo push | `Tenant` | `pushLogoUrl` | `String?` | Cae a `walletLogoUrl → logoUrl` |
| Color primario | `Tenant` | `primaryColor` | `String @default("#22C55E")` | |
| Color secundario | `Tenant` | `secondaryColor` | `String @default("#15803D")` | |
| Imagen de portada | `Storefront` | `heroImageUrl` | `String?` | Tenant no tiene portada |
| Colores de texto (storefront) | `Storefront` | `titleColor`, `descriptionColor`, `logoBgColor` | `String?` | |
| Color de botones | — | `Storefront.theme` (`Json`) / por-popup | — | No hay "color de botón" global en Tenant |
| Favicon / ícono | `WhiteLabel` | `faviconUrl`, `iconUrl` | `String?` | **Favicon es a nivel MARCA, no por negocio.** |

> La **tarjeta de sellos** tiene su propio branding (ver §3): `Card.primaryColor`, `Card.logoUrl`, `Card.heroImageUrl`, `Card.iconUrl`, `Card.stampIcon`.

### 3. Programa de sellos / lealtad → `model Card` (NO existe `LoyaltyProgram`)
`Card.type` ∈ `CardType { STAMPS, POINTS, DISCOUNT, MEMBERSHIP, COUPON, GIFT, MULTI, CASHBACK, VISITS, HYBRID }`. Varias por tenant.
| Concepto | Campo | Tipo |
|---|---|---|
| Nombre | `name` | `String` |
| Sellos requeridos | `stampsRequired` | `Int?` |
| Premio | `rewardText` | `String @default("")` |
| Descripción del premio | `rewardDescText` | `String @default("")` |
| Descripción | `description` | `String @default("")` |
| Mensaje al completar | `rewardEarnedMessage` | `String @default("")` |
| Mensaje al sellar | `stampEarnedMessage` | `String @default("")` (`[#]`=restantes) |
| Color tarjeta | `primaryColor` / `secondaryColor` | `String` |
| Ícono del sello (emoji) | `stampIcon` | `String @default("☕")` |
| Logo / portada / ícono | `logoUrl?`, `heroImageUrl?`, `iconUrl?` | `String?` |
| Términos | `terms` / `termsEnabled` | `String` / `Boolean` |
| Monto mínimo por sello | `minAmountPerStamp` | `Decimal?` |
| Vigencia | `validFrom?`, `validUntil?`, `validDaysAfterIssue?` | `Date?`/`Int?` |
| Activa | `isActive` | `Boolean @default(true)` |

Instancia por cliente = `Pass` (`stampsCount`, `status PassStatus{ACTIVE,COMPLETED,REVOKED}`). Evento de sello = `Stamp`.

### 4. Cupones → **también `model Card`** (`type = COUPON | DISCOUNT | GIFT`)
No hay modelo `Coupon`. **Sí soporta múltiples por negocio** (Tenant 1→N Card).
| Concepto | Campo en `Card` | Notas |
|---|---|---|
| Nombre | `name` | |
| Descripción | `description` | |
| Imagen | `heroImageUrl`/`logoUrl`/`iconUrl` | |
| **Código** | — | **`Card` NO tiene campo `code`.** Se redime por QR del pase (`Pass.qrToken`). |
| Cantidad disponible | — | No hay `availableQuantity` en Card (sí en `Promotion.maxRedemptions`). |
| Fecha inicio/fin | `validFrom` / `validUntil` (o `validDaysAfterIssue`) | |
| Condiciones | `terms` | Texto libre |

> **`model Promotion`** es el mejor match si "cupón" significa descuento con cantidad/condiciones: `type PromotionType{DISCOUNT_PCT, DISCOUNT_AMOUNT, BUY_X_GET_Y, COMBO, FREE_ITEM}`, `value Decimal`, `originalPrice Decimal?`, `conditions Json`, `maxRedemptions Int?`, `maxRedemptionsPerCustomer Int?`, `validFrom/validUntil`, `isActive`. **Tampoco tiene `code`.** El descuento se aplica al carrito solo si `conditions.productIds` está seteado (ver fix PDF454).

### 5. Menú digital → `Category` → `Product` (+ `ProductVariant`, `ProductExtra`, `Adicional`)
| Modelo | Campo | Notas |
|---|---|---|
| `Category` | `tenantId`, `parentId?` (subcats), `name`, `slug` (`@@unique[tenantId,parentId,slug]`), `description?`, `imageUrl?`, `position`, `isActive` | |
| `Product` | `tenantId`, `categoryId?` (**FK `onDelete: SetNull`**), `name`, `description`, `basePrice Decimal(10,2)`, `imageUrl?`, `isAvailable Boolean`, `isRecommended Boolean` (destacado), `availableForMesa/Delivery`, `position`, `stock?` | Precio = `basePrice` |
| `ProductVariant` | `productId`, `groupName`, `name`, `priceDelta`, `isDefault`, `position` | |
| `ProductExtra` | `productId`, `name`, `price`, `maxQty`, `isAvailable` | |

Cadena: `Tenant 1→N Category 1→N Product 1→N Variant/Extra`.

### 6. Horarios → `model ServiceAvailability` (solo módulo de citas)
**No hay modelo de "horario de apertura" general del storefront.** Una fila por intervalo abierto.
| Campo | Tipo | Notas |
|---|---|---|
| `tenantId` | `String` | |
| `providerId` | `String?` | null = a nivel negocio |
| `weekday` | `Int` | **0=domingo … 6=sábado** |
| `startMin` / `endMin` | `Int` | **Minutos desde medianoche** (540=09:00) en TZ del tenant |

Día sin filas = cerrado. Overrides por fecha = `ServiceException` (`date @db.Date`, `closed`, `startMin?`, `endMin?`, `@@unique[tenantId,date]`).
> Slots de reserva de MESA = `Tenant.reservationSlots String[]` (array `"HH:MM"`), distinto.

### 7. Google Reviews
| Modelo | Campo | Notas |
|---|---|---|
| `Tenant` | `googleReviewUrl` (`String?`) | URL de "pide más reseñas". `/r/{slug}`: 4-5★→Google, <4★→feedback privado |

Relacionados: `Tenant.mapsUrl`, `Location.mapsUrl`.

### 8. Redes / contacto
| Concepto | Modelo.Campo | Notas |
|---|---|---|
| WhatsApp | `Tenant.whatsappPhone` (+ `whatsappOrders/Delivery/Reservations Phone`) | ver §1 |
| Instagram | `Tenant.instagramUrl` | |
| Facebook | `Tenant.facebookUrl` | |
| **TikTok** | — | **No existe campo TikTok.** |
| Web | — | **No existe campo web.** |
| Correo | `Tenant.email` | |
| Maps | `Tenant.mapsUrl` | |

### 9. Módulos / funcionalidades activables (4 capas)
**(A) Flags booleanos en `Tenant`:** `reservationsEnabled` (mesa), `serviceReservationsEnabled` (citas), `reviewAlertsEnabled`, `billingAlertsEnabled` (default true), `deliveryAlertsEnabled`, `whatsappFeedbackEnabled`, `tutorialsEnabled`, `academyEnabled`.
**(B) Flags en `Storefront`:** `ordersEnabled`, `ordersDeliveryEnabled`, `digitalMenuEnabled`, `bookMenuEnabled`, `whatsappButtonEnabled`, `isPublished`.
**(C) Marca → `WhiteLabelModule` + enum `ModuleKey`:** valores exactos **`REFERRALS, ORDERS, GROW_BUSINESS_SMS, REVIEWS, SERVICE_RESERVATIONS, COMMUNITY`**. `getMine` deriva `reviewsEnabled`/`referralsEnabled`/`communityEnabled`.
**(D) Categoría implica secciones:** `BusinessCategory.modules[]` (`cards|customers|scanner|push|menu|orders|analytics|staff|info_links|services`), estático por `businessCategorySlug`.
> No hay un booleano único de wallet/geopush/promos/beneficios: wallet siempre on (Pass), geopush por `Location` (lat/lng/radius), promos = existencia de `Promotion`, beneficios = subsistema Cuponera (`BenefitCampaign`).

### 10. Identificador único + activación
- **business_id = `Tenant.id`** (`uuid`); identificador público = `Tenant.slug`.
- **Estado de activación = `Tenant.status`** → `TenantStatus { ACTIVE, SUSPENDED, TRIAL }` (`@default(TRIAL)`).
- Otros: `isLocked/lockedAt/lockedReason` (lock demo), `deletedAt` (soft-delete), `suspendedAt`, `trialStartedAt/trialEndsAt/gracePeriodDays`, `currentPeriodEnd`, gateway (`stripeCustomerId`, `hotmartSubscriberCode`), `isCampaignHost` (tenant "de sistema").
- **Publicación del menú** (aparte del status): `Storefront.isPublished`.
- **Dónde se togglea:** admin/super-admin vía `tenants.controller` (`UpdateTenantDto`: `status`, `reservationsEnabled`, `serviceReservationsEnabled`…); dueño vía `PATCH /tenants/me` (`UpdateMyBody`) — el dueño **no** cambia `status`/`slug`/`name`.

### Gotchas clave para el sync
1. **Teléfono del negocio = `Tenant.phone`** (≠ `whatsappPhone`).
2. **Dirección/ciudad NO están en Tenant** (dirección = `Location.address`; no hay `city`/`website`).
3. **Cupones y sellos = el MISMO modelo `Card`** (discriminado por `type`); sin campo `code`.
4. **Horarios = solo `ServiceAvailability`** (minutos-desde-medianoche, weekday 0=domingo).
5. **Módulos repartidos** en Tenant + Storefront + WhiteLabelModule + categoría.

---

## FASE B — Token por negocio (plan, sin construir)

**Objetivo:** que sea imposible escribir en el negocio equivocado. Nunca una API key global.

**Schema (migración nueva):**
```prisma
model OnboardingToken {
  id         String    @id @default(uuid())
  tenantId   String                       // ← el token SOLO puede tocar este negocio
  tokenHash  String    @unique            // sha-256 del token; el claro se muestra 1 sola vez
  label      String    @default("Onboarding")
  createdAt  DateTime  @default(now())
  lastUsedAt DateTime?
  revokedAt  DateTime?
  tenant     Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@index([tenantId])
}
```
- **Generación:** en la config del negocio, botón **"Conectar con Onboarding"** → `POST /tenants/me/onboarding-token` genera 32 bytes random, guarda `sha256(token)`, devuelve el token en claro **una vez** + el `business_id` (`tenant.id`).
- **Revocar:** `DELETE /tenants/me/onboarding-token/:id` (set `revokedAt`).
- **Autenticación:** header `Authorization: Bearer <token>`. Un `OnboardingAuthGuard` hace `sha256(token)`, busca `OnboardingToken` con `revokedAt=null`, resuelve `tenantId` y lo inyecta en el request. **Todo endpoint de sync opera SOLO sobre ese `tenantId`** (nunca acepta tenantId del body).

## FASE C — Endpoints de sincronización (plan)

**LIVE.** Base `https://api.soyclubify.com/api/sync/*`. **Auth:** header `Authorization: Bearer <token>` (el token de Fase B). El `tenantId` SIEMPRE sale del token — ningún endpoint acepta un id de negocio en el body. Content-Type `application/json`.

**Semántica:** upsert **NO destructivo** (crea o actualiza, nunca borra lo que el negocio agregó a mano), EXCEPTO `/hours` que reemplaza el set completo de horarios a nivel negocio. Solo se tocan los campos presentes en el body (omitir un campo = no cambiarlo; enviarlo en `null`/`""` = limpiarlo, salvo los no-nulos como name/color que se ignoran si van vacíos). **Idempotencia** por llaves estables: categorías por `slug(name)`, productos por `(name, categoría)`, cupones por `name`. (Si el onboarding renombra, se crea una fila nueva — mantener nombres estables o pedir `externalId` en una iteración futura.)

| Endpoint | Body (campos → destino real) | Respuesta |
|---|---|---|
| `PATCH /sync/business` | `name, brandName, email` (se ignoran si vacíos) · `businessCategorySlug` (se slugifica) · `country` (2 letras) · `phone, whatsappPhone, whatsappOrdersPhone, whatsappDeliveryPhone, whatsappReservationsPhone` → **`Tenant.*`** | `{ok, updated:[...campos]}` |
| `PATCH /sync/branding` | `logoUrl, walletLogoUrl, pushLogoUrl, primaryColor, secondaryColor` → `Tenant.*` · `heroImageUrl` → **`Storefront.heroImageUrl`** (upsert) | `{ok}` |
| `PATCH /sync/contact` | `instagramUrl, facebookUrl, mapsUrl, whatsappPhone` → `Tenant.*` | `{ok, updated}` |
| `PATCH /sync/reviews` | `googleReviewUrl` → `Tenant.googleReviewUrl` | `{ok}` |
| `PUT /sync/location` | `address, mapsUrl, latitude, longitude, name` → la **primera `Location`** del negocio (crea si no hay; lat/lng default 0) | `{ok, location_id, created}` |
| `PUT /sync/loyalty-card` | `name` (req. al crear), `stampsRequired, rewardText, rewardDescText, description, rewardEarnedMessage, stampEarnedMessage, stampIcon, primaryColor, secondaryColor, stampBgImageUrl` · **`freeRewards`** (premios intermedios — ver abajo) → la **`Card` type=STAMPS** del negocio (crea si no hay) | `{ok, card_id, created}` |
| `PUT /sync/club-plan` | plan de CLUB (cupo mensual): `name*`, `beneficiosPorMes*` (al crear), `unidad, description, precioCents, currency, periodicidad, maxPorDia, minutosEntreConsumos, tramosAlta[]` → **`ClubPlan`** (upsert por nombre). Ver sección propia | `{ok, plan_id, created}` |
| `PUT /sync/convenio` | ALIANZA con una empresa: `name*`, `logoUrl, description, contact*, verificacion, codigo, endsAt, cupones[]` → **`Convenio`** (upsert por nombre; los cupones solo al crear). Ver sección propia | `{ok, convenio_id, created, cupones}` |
| `PUT /sync/hours` | arreglo (o `{items:[...]}`) de `{weekday(0=dom…6=sáb), startMin, endMin}` (minutos-desde-medianoche) → **reemplaza** las `ServiceAvailability` a nivel negocio (providerId null) | `{ok, count}` |
| `PATCH /sync/modules` | `digitalMenu, orders, ordersDelivery, published` → `Storefront.*Enabled`/`isPublished` · `reservations, serviceReservations` → `Tenant.*Enabled` (booleans) | `{ok}` |
| `POST /sync/categories` | arreglo (o `{items}`) de `{name*, description, imageUrl, position}` → **`Category`** (upsert por slug, parent nivel raíz) | `{ok, categories:[{name,slug,id,created}]}` |
| `POST /sync/products` | arreglo de `{name*, basePrice* (al crear), description, imageUrl, isAvailable, isRecommended, position, categorySlug\|categoryName}` → **`Product`** (upsert por name+categoría; resuelve categoría por slug) | `{ok, products:[{name,id,created}]}` |
| `POST /sync/coupons` | arreglo de `{name*, description, terms, imageUrl(→heroImageUrl), validFrom, validUntil (ISO)}` → **`Card` type=COUPON** (upsert por name) | `{ok, coupons:[{name,id,created}]}` |
| `POST /sync/activate` | (sin body) → `Tenant.status=ACTIVE` + `Storefront.isPublished=true` · Fase D disparará el webhook aquí | `{ok, business_id, name, phone, slug, status}` |
| `GET /sync/whoami` | (sin body) verifica el token | `{business_id, name, brandName, slug, status}` |

`*` = requerido al **crear**. Errores → `400` con `{message}`; token inválido/ausente → `401`.

**Ejemplo:**
```bash
curl -X POST https://api.soyclubify.com/api/sync/products \
  -H "Authorization: Bearer clbf_xxxxx" -H "Content-Type: application/json" \
  -d '[{"name":"Latte","basePrice":12000,"categoryName":"Bebidas","isRecommended":true}]'
```

### Premios intermedios de la tarjeta de sellos (`freeRewards`)

Son los premios que el cliente gana **antes** del premio final: el café al
sello 3, la galleta al 5. En la tarjeta se dibujan **dentro del círculo del
sello** que les toca, con un badge 🎁 en la esquina.

Van dentro del body de `PUT /sync/loyalty-card` (y de cada elemento de
`PUT /sync/loyalty-cards`), en el campo **`freeRewards`**.

```jsonc
{
  "name": "Tarjeta de sellos",
  "stampsRequired": 10,
  "rewardText": "Café gratis",
  "freeRewards": [
    { "pos": 3, "text": "Café",   "emoji": "☕", "circleColor": "#F59E0B", "textColor": "#111827" },
    { "pos": 5, "text": "Cookie", "emoji": "🍪" },
    { "pos": 8, "text": "2x1",    "emoji": "🎁", "active": false }
  ]
}
```

**Los campos de cada premio**

| Campo | Tipo | Obligatorio | Qué es |
|---|---|---|---|
| `pos` | entero | **sí** | En qué sello se gana. `1..stampsRequired`. |
| `text` | string | no | Texto corto dentro del círculo. Se recorta a 24 caracteres; con 1-2 palabras se lee bien. |
| `emoji` | string | no | Un emoji. Se recorta a 8 caracteres. |
| `circleColor` | hex | no | Color del círculo (`#F59E0B` o `#FA0`). Otra cosa → el de por defecto. |
| `textColor` | hex | no | Color del texto. Mismas reglas. |
| `active` | boolean | no | Por defecto `true`. `false` lo deja configurado pero apagado. |
| `id` | string | no | Si no viene, Clubify le pone uno. Mándalo solo si quieres conservar el mismo entre sincronizaciones. |

**Reglas que aplica Clubify al recibirlos** — conviene replicarlas en el
formulario del Onboarding para que el cliente vea el error ahí y no descubra
después que su premio desapareció:

1. **`pos` fuera de `1..stampsRequired` se descarta.** Un premio en el sello 12
   de una tarjeta de 10 no se dibuja nunca. El máximo se toma del
   `stampsRequired` **del mismo envío**.
2. **Una posición, un premio.** Si llegan dos en el mismo sello, gana el
   primero de la lista: dos en el mismo círculo se pintarían encima.
3. **Sin tope de cantidad.** Puede haber tantos como sellos.
4. Se guardan **ordenados por posición**, llegue como llegue la lista.
5. Un color que no sea hex se cae al de por defecto, no rompe la tarjeta.

**Omitir el campo NO es lo mismo que mandarlo vacío** — y esto importa:

| Lo que mandas | Lo que hace Clubify |
|---|---|
| `freeRewards` ausente | **No toca nada.** Los premios que el negocio ya tuviera se quedan. |
| `"freeRewards": []` | **Los borra todos.** Es una orden explícita. |

Un sync que solo cambia el color de la tarjeta **no debe mandar el campo**: si
manda `[]`, borra los premios que el negocio haya configurado a mano en el
panel de Clubify.

**Puede estar apagado por marca.** Si la marca blanca del negocio desactivó
«Premios Free» en Wallet Avanzado, Clubify los ignora aunque lleguen bien
formados — y responde `{ok:true}` igual, sin error. No es un fallo del envío:
es un permiso. Si hace falta saberlo de antemano, preguntarlo al equipo de
Clubify para ese negocio.

**Ejemplo completo**

```bash
curl -X PUT https://api.soyclubify.com/api/sync/loyalty-card \
  -H "Authorization: Bearer clbf_xxxxx" -H "Content-Type: application/json" \
  -d '{
        "name": "Tarjeta de sellos",
        "stampsRequired": 10,
        "rewardText": "Café gratis",
        "freeRewards": [
          {"pos": 3, "text": "Café", "emoji": "☕"},
          {"pos": 5, "text": "Cookie", "emoji": "🍪"}
        ]
      }'
```

Respuesta: `{"ok":true,"card_id":"...","created":false}`.

**Cómo comprobar que quedó**: abrir en Clubify el panel del negocio →
*Tarjetas* → la tarjeta de sellos → «Premios Free (intermedios)». Ahí tienen
que salir en la misma posición. Y en la tarjeta del cliente, dentro del círculo
del sello correspondiente.


## Tarjeta de CLUB y tarjeta de ALIANZA (convenio)

> **Estado: LIVE.** Los dos endpoints ya existen y aceptan datos.
> `PUT /sync/club-plan` y `PUT /sync/convenio`.

Las dos son **tarjetas de sellos por dentro** (`Card type=STAMPS`), pero no se
parecen en nada a la de fidelización y **no se pueden crear por
`/sync/loyalty-card`**: ese endpoint ignora a propósito las tarjetas de club y
de alianza (filtra por `clubPlanId: null, convenioId: null`) porque si no, el
branding de fidelización caería encima de ellas y en la alianza pisaría el logo
del aliado.

---

### 1. Tarjeta de CLUB — la membresía de cupo mensual

**Qué es.** El cliente paga una cuota y recibe **N beneficios al mes** que va
consumiendo: «10 cafés al mes», «4 lavadas al mes». El cupo **se reinicia** el
día 1; no se acumula. El cobro de la cuota es **manual y por fuera de
Clubify** — aquí solo se configura y se descuenta.

**Endpoint:** `PUT /sync/club-plan` → `{ok, plan_id, created}`

**Upsert por NOMBRE.** Mandar el mismo `name` dos veces actualiza el plan, no
crea otro. Un negocio puede tener varios planes, así que se casa por nombre y
no por «el primero».

```jsonc
{
  "name": "Plan Café",                  // requerido
  "description": "Un café al día, todos los días",
  "beneficiosPorMes": 10,               // requerido. A cuánto se REINICIA cada mes
  "unidad": "café",                     // singular: sale en el pase («te queda 1 café»)
  "precioCents": 4900000,               // lo que paga el socio, en la unidad menor
  "currency": "COP",
  "periodicidad": "MENSUAL",            // MENSUAL | ANUAL — solo cambia qué significa el precio
  "maxPorDia": 1,                       // opcional. null = sin tope diario
  "minutosEntreConsumos": 120,          // opcional. null = sin espera
  "tramosAlta": [                       // opcional, ver abajo
    { "desdeDia": 1,  "hastaDia": 15, "beneficios": 10 },
    { "desdeDia": 16, "hastaDia": 24, "beneficios": 5  },
    { "desdeDia": 25, "hastaDia": 31, "beneficios": 3  }
  ]
}
```

**Los campos, uno por uno**

| Campo | Req. | Qué es y qué preguntar en el formulario |
|---|---|---|
| `name` | **sí** | Nombre del plan, como lo ve el cliente. |
| `beneficiosPorMes` | **sí** | «¿Cuántos ___ recibe al mes?». Entero ≥ 1. |
| `unidad` | no | **En singular**: «café», «lavada», «clase». Sale literal en el pase. Por defecto «beneficio», que se lee mucho peor. |
| `precioCents` | no | En la **unidad menor** de la moneda. En pesos colombianos no hay decimales: `49000` son 49.000 COP, no 490. Es informativo — Clubify no cobra esto. |
| `currency` | no | `COP` por defecto. |
| `periodicidad` | no | `MENSUAL` o `ANUAL`. **Solo cambia qué significa el precio.** El cupo se repone el día 1 en los dos casos: quien paga el año por adelantado recibe sus beneficios mes a mes igual. Por eso el anual se puede vender más barato. |
| `maxPorDia` | no | «¿Cuántos como mucho en un día?». Sin esto, con 10 al mes se los puede llevar los 10 de una sentada. |
| `minutosEntreConsumos` | no | Espera mínima entre uno y el siguiente. Es la forma de decir «uno por visita» sin definir qué es una visita. |
| `tramosAlta` | no | Ver abajo. |

**Los tramos de alta** responden a: «alguien se inscribe el día 20, ¿cuántos
beneficios recibe ese primer mes?». El negocio parte el mes por días y le pone
precio a cada tramo. **Es solo para el primer período**; desde el mes siguiente
recibe el cupo completo. Sin tramos, el alta recibe el cupo entero.

En el formulario: una tabla de «del día X al día Y → Z beneficios». Validar que
los tramos **no se solapen** y que cubran del 1 al 31.

**⚠️ Cuidado con encender los topes en un plan que ya tiene socios.**
`maxPorDia` y `minutosEntreConsumos` nacen vacíos a propósito: ponerlos de
oficio le cambia las reglas a alguien que ya pagó.

---

### 2. Tarjeta de ALIANZA (convenio) — el beneficio para los empleados de una empresa

**Qué es.** El negocio acuerda con una **empresa aliada** (ej. una caja de
compensación) un beneficio permanente para sus empleados, para atraerlos como
clientes. **No hay venta, no hay saldo, no hay sellos**: es un descuento que se
puede usar repetidamente mientras el negocio lo tenga encendido.

> No confundir con la **Cuponera**, que va al revés: allí la plataforma monta la
> campaña, los negocios son los aliados que dan el beneficio, y el miembro paga
> una membresía. Aquí el negocio monta el convenio, el aliado es una empresa
> cuyos empleados reciben, y es **gratis**.

**Endpoint:** `PUT /sync/convenio` → `{ok, convenio_id, created, cupones}`

**Upsert por NOMBRE de la empresa aliada.**

⚠️ **Los cupones solo se crean al CREAR el convenio.** En uno que ya existe se
ignoran, y la respuesta lo dice en `cupones_ignorados`. Es a propósito: sus
cupones llevan canjes colgando y topes por persona ya consumidos, así que
rehacerlos desde el formulario le borraría al negocio el histórico sin avisar.
Para cambiar los beneficios de un convenio vivo, se hace desde el panel.

```jsonc
{
  "name": "Confenalco",                 // requerido: la EMPRESA aliada
  "logoUrl": "https://…/confenalco.png",// se muestra junto al del negocio
  "description": "Beneficio para afiliados",
  "contactName":  "Ana Ruiz",           // responsable EN la empresa aliada
  "contactEmail": "ana@confenalco.com",
  "contactPhone": "+57300…",
  "verificacion": "CODIGO",             // ABIERTO | CODIGO | LISTA
  "codigo": "CONFE2026",                // requerido si verificacion = CODIGO
  "endsAt": "2026-12-31T23:59:59Z",     // opcional: se apaga solo al llegar
  "cupones": [
    {
      "name": "20% en cafetería",
      "tipo": "PERCENT_OFF",            // PERCENT_OFF | AMOUNT_OFF | FREEBIE | TWO_FOR_ONE | OTHER
      "valor": 20,                      // % si PERCENT_OFF, importe si AMOUNT_OFF
      "description": "Sobre el total de la cuenta",
      "terms": "No acumulable con otras promociones",
      "maxPorPersona": 1,               // opcional
      "periodo": "MES"                  // SIEMPRE | DIA | SEMANA | MES | ANIO
    }
  ]
}
```

**Cómo se verifica que quien activa pertenece al aliado** — es la decisión más
importante del formulario:

| `verificacion` | Cómo funciona | Cuándo usarlo |
|---|---|---|
| `ABIERTO` | Cualquiera con el enlace obtiene la tarjeta. | Convenios amplios o de bajo impacto. **Avisar del riesgo en el formulario**: no hay nada que impida que el enlace circule. |
| `CODIGO` | El aliado reparte un código y se pide al activar. Requiere `codigo`. | Lo habitual. Los 4 convenios en producción usan esto. |
| `LISTA` | Solo los documentos/correos que el aliado cargó pueden activar. | Cuando importa de verdad quién entra. La lista **no se carga por aquí**: la sube el negocio o el aliado desde su portal. |

**Los cupones del convenio.** `maxPorPersona` + `periodo` son el tope: «1 por
persona **al mes**». `periodo: SIEMPRE` = una sola vez en la vida. Sin
`maxPorPersona` no hay tope.

**Lo que NO se manda por aquí, y conviene saberlo:**

- **Las sedes donde aplica.** Vacío = todas. Se eligen desde el panel.
- **Los tokens del aliado.** Clubify genera dos: el del **informe** (solo
  agregados, nunca datos personales de los empleados) y el del **portal**,
  donde el aliado enciende y apaga sus beneficios y da de baja a quien salió de
  la empresa. Van separados a propósito: el informe se reenvía por correo sin
  pensarlo, el mando no.
- **Las tarjetas de los empleados.** Se emiten solas cuando cada persona
  activa; no se crean desde el Onboarding.

---

### Reglas comunes a los dos

- **Omitir un campo ≠ mandarlo vacío.** Ausente = **no se toca**; `null` en
  `maxPorDia`/`minutosEntreConsumos` = **quitar el tope**. Un sync que solo
  cambia el nombre no debe mandar los topes, o se lleva por delante lo que el
  negocio configuró a mano.
- **El módulo tiene que estar encendido en el negocio.** Si no, Clubify
  responde **403** con un mensaje claro (`La Tarjeta de Club no está habilitada
  para este negocio`). A diferencia de otros campos, esto **no se ignora en
  silencio**: es un error que el Onboarding debe mostrar.
- **Las validaciones de fondo las hace Clubify**, no este contrato: tramos que
  se solapan, un tope diario mayor que el cupo del mes, un nombre de empresa de
  una sola letra. Devuelve **400** con el motivo en español, listo para
  enseñárselo al cliente.


## FASE D — Webhook de activación (LIVE)

Cuando un negocio pasa a `ACTIVE` — vía **`POST /sync/activate`** o al **activarlo desde el panel/simulador** (Master Admin) — Clubify hace un `POST` firmado a una URL configurable:

```json
{
  "event": "business.activated",
  "business_id": "<Tenant.id>",
  "name": "<brandName>",
  "phone": "<Tenant.phone>",
  "slug": "<Tenant.slug>",
  "activated_at": "<ISO>",
  "sent_at": "<ISO>"
}
```

**Headers:** `Content-Type: application/json` · `X-Clubify-Event: business.activated` · `X-Clubify-Signature: sha256=<hmac_sha256(secret, rawBody)>`.

**Verificar la firma** (ejemplo Node): `crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex')` y comparar con el valor tras `sha256=`.

**Configuración (Master Admin → `/superadmin/integraciones` → "Webhook de Onboarding"):** URL destino + secreto de firma + toggle "Activo" + botón **Probar** (envía un `webhook.test`). También por API (`@Roles PLATFORM_OWNER`): `GET/PUT /onboarding-webhook`, `POST /onboarding-webhook/test`. Config global en `Setting` (`onboarding.webhook.url|secret|enabled`).

- **Best-effort:** el envío es fire-and-forget con timeout de 6 s; si falla, **nunca** rompe ni retrasa la activación (solo queda un warning en logs).
- Clubify solo **emite**; el onboarding reacciona con su propia mensajería.
- Si el toggle está apagado o no hay URL, no se envía nada.

---

**Estado del build:** A (diccionario) ✅ · B (token+guard) ✅ · C (endpoints por entidad) ✅ · D (webhook `business.activated`) ✅ — **TODO LIVE.** Se dispara desde `POST /sync/activate` y desde la activación por panel/simulador; se configura en `/superadmin/integraciones`.
