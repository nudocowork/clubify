# Sync API — Diccionario campo-a-campo (respuesta a ju1053)

**Auth (sin cambios):** `Authorization: Bearer clbf_...` — el mismo token por negocio de `/sync/*`. Todo se scopea al tenant del token (nunca del body). **Upsert no destructivo:** cada endpoint actualiza SOLO los campos presentes en el body (excepto `hours`, que es set completo).

**Prefijo:** todas las rutas van bajo `/api` (ej. `PATCH /api/sync/business`).

---

## 1) Fase D — Webhook `business.activated` — ✅ ACTIVO en prod

- **Emite:** `POST https://onboarding.soyclubify.lat/api/integrations/clubify-activated` cuando el negocio se activa (`/sync/activate` o activación desde el panel).
- **Headers:** `X-Clubify-Event: business.activated` · `X-Clubify-Signature: sha256=<hmac_sha256(SECRET, rawBody)>` (hex).
- **Body:** `{ event, business_id, name, phone, slug, activated_at, sent_at }` (incluye lo pedido: `business_id`, `activated_at`).
- **Reintentos:** 3 in-process (inmediato, +30s, +2min) con el MISMO payload/firma → **dedupliquen por `business_id`**.
- **SECRET:** entregado por canal privado. Configúrenlo de su lado y acepten `event: "business.activated"`.

---

## 2) Endpoints y campos ACEPTADOS hoy

### `PATCH /sync/business`
| Campo | Tipo | Notas |
|---|---|---|
| name, brandName, email | string | solo se setean si no vienen vacíos |
| businessCategorySlug | string | se slugifica |
| country | string(2) | uppercase |
| phone, whatsappPhone | string | |
| **whatsappOrdersPhone** | string | ← **orders_phone** (WhatsApp que recibe pedidos) |
| whatsappDeliveryPhone, whatsappReservationsPhone | string | |
| **city** 🆕 | string | ciudad del negocio |
| **description** 🆕 | string | descripción corta → se guarda en la vitrina (Storefront) |

### `PATCH /sync/branding`
| Campo | Tipo | Notas |
|---|---|---|
| logoUrl, walletLogoUrl, pushLogoUrl | string | |
| primaryColor, secondaryColor | string(hex) | |
| **heroImageUrl** | string(url) | ← **photo_menu_banner** (cabecera del menú) |
| **menuLayout** 🆕 | string | estilo del menú (ver mapeo abajo) |
| **popupImageUrl** 🆕 | string(url) | ← **photo_popup** (imagen del popup del menú) |

**Mapeo `menuLayout` (manden cualquiera de los 8 nombres suyos):**
`classic→CLASSIC · grid→GRID · hero→CAROUSELS · clean→CLEAN · compact→COMPACT · dark→CLUVI · premium→SECTIONS · flipbook→FLIPBOOK`

### `PATCH /sync/contact`
| Campo | Tipo |
|---|---|
| instagramUrl, facebookUrl, mapsUrl, whatsappPhone | string |
| **tiktokUrl** 🆕, **websiteUrl** 🆕 | string(url) |

### `PATCH /sync/reviews`  *(ahora parcial: no pisa lo que no mandan)*
| Campo | Tipo | Notas |
|---|---|---|
| googleReviewUrl | string | |
| **reviewAlertsPhone** 🆕 | string | ← **alert_phone** (aviso reseñas 1-3★). Se acepta también `alertPhone`. Al mandar número se activa el aviso; al vaciarlo se desactiva |
| **reviewAlertsThreshold** 🆕 | int(1-5) | umbral (default 3 = avisa 1,2,3★) |

> El flujo de reseñas **lo maneja Clubify**: 4-5★ → Google, 1-3★ → feedback interno + aviso al `reviewAlertsPhone`.

### `PUT /sync/loyalty-card`  *(tarjeta STAMPS del negocio)*
| Campo | Tipo | Notas |
|---|---|---|
| name | string | requerido al crear |
| stampsRequired | int | |
| rewardText, rewardDescText, description, rewardEarnedMessage, stampEarnedMessage, stampIcon | string | |
| primaryColor, secondaryColor | string(hex) | |
| **stampBgImageUrl** 🆕 | string(url) | ← **photo_card_android** (fondo tras los sellos; activa modo imagen) |

### `PUT /sync/location`
`address, mapsUrl, latitude, longitude, name` (name solo al crear). Actualiza/crea la primera sede.

### `PUT /sync/hours`  *(set completo)*
Array de `{ weekday: 0-6, startMin: 0-1440, endMin: 0-1440 }`. Reemplaza TODO el horario.

### `PATCH /sync/modules`
Booleans: `digitalMenu, orders, ordersDelivery, published, reservations, serviceReservations`.

### `POST /sync/categories`
Array `{ name*, description, imageUrl, position }`. Idempotente por slug(name).

### `POST /sync/products`
Array `{ name*, categorySlug|categoryName, description, basePrice*, imageUrl, isAvailable, isRecommended, position }`. Idempotente por (name, categoría).

### `POST /sync/coupons`
Array de cupones (Card tipo COUPON), idempotente por `name`:
| Campo | Tipo | Notas |
|---|---|---|
| name | string | requerido (llave) |
| description, terms | string | |
| imageUrl | string(url) | |
| validFrom, validUntil | ISO date | |
| **couponCode** 🆕 | string | ← **code** (también se acepta `code`) |
| **couponQuantity** 🆕 | int | ← **quantity** (también `quantity`). null = sin límite |

### `POST /sync/activate`
Sin body. Activa el negocio + publica la vitrina + dispara el webhook `business.activated`.

---

## 3) Imágenes — destino confirmado
| Su campo | Clubify |
|---|---|
| photo_menu_banner | `heroImageUrl` (`/sync/branding`) ✅ |
| photo_card_android | `stampBgImageUrl` (`/sync/loyalty-card`) ✅ |
| photo_popup | `popupImageUrl` (`/sync/branding`) ✅ |
| favicon | ⛔ **local-only** (no hay favicon por-negocio, solo por marca/global) |

---

## 4) Lo que queda LOCAL-ONLY (Clubify NO lo almacena hoy — déjenlo de su lado)
- **buttonColor** y **textColor** de branding (solo hay primary/secondary).
- **Color de texto de la tarjeta** de sellos (hay primary/secondary + colores de sello, no textColor).
- **favicon** por-negocio.
- **Toggles de módulos** sellos / cupones / wallet / geopush / promociones / beneficios (Clubify los infiere por existencia de tarjetas/promos; no hay on/off por API).

## 5) Endpoints de link-in-bio y automatizaciones — ✅ disponibles

### `PUT /sync/infolink`  *(upsert del link-in-bio principal del negocio; reemplaza los botones)*
Actualiza el infolink más antiguo del negocio, o crea uno (slug `infolink`).
| Campo | Tipo | Mapea a |
|---|---|---|
| title | string | `title` |
| description | string | `subtitle` |
| cover | string(url) | `heroImageUrl` |
| buttons[] | array | reemplaza la lista completa |

**Botón:** `{ label, type, url | popup_message }`. Mapeo de los 8 tipos → Clubify:
| type (ustedes) | Clubify | Nota |
|---|---|---|
| link, reviews, social, reserva | EXTERNAL | usa el `url` que manden (lo respetamos tal cual) |
| whatsapp | WHATSAPP | extraemos el teléfono del `url`; si no hay, cae a EXTERNAL |
| menu | MENU (sin url) / EXTERNAL (con url) | sin url usa el menú nativo del negocio |
| maps | MAPS (sin url) / EXTERNAL (con url) | |
| popup | POPUP | `popup_message` → texto del modal |

> Recomendación: manden siempre `url` en link/reviews/social/reserva/maps. Solo `popup` usa `popup_message`.

### `PUT /sync/automations`  *(push automáticas por evento)*
Por cada evento presente en el body: `{ enabled: boolean, message: string }`. Se sincroniza como una regla de automatización real (el motor que ya envía estos push). `enabled`=on/off, `message`=cuerpo del push (si va vacío usamos un texto por defecto). Variables disponibles en el mensaje: `{{customerName}}`, `{{businessName}}`, `{{cardName}}`, `{{rewardText}}`.
| Evento | Se dispara | Nota |
|---|---|---|
| welcome | al registrarse (primera tarjeta) | ✅ activo |
| birthday | día del cumpleaños (cron 8am) | ✅ activo |
| reward | al completar la tarjeta / premio listo | ✅ activo |
| inactivity | 30 días sin visita (cron 9am) | ✅ activo |
| stamp | al sumar un sello | ✅ se envía si `enabled` |

> El onboarding es la fuente de verdad de estos mensajes: si el negocio ya tenía una regla para ese evento, la actualizamos (no duplicamos).
