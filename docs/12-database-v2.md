# Modelo de datos v2 — extensión Clubify OS

Mantenemos las 13 tablas existentes (ver [02-database-model.md](02-database-model.md)) y agregamos 14 nuevas para soportar Catálogo, Pedidos, Promociones, Automatizaciones, Canales, Storefront y Analytics.

## Nuevas entidades

### `categories`
Jerárquicas (categoría → subcategoría) por tenant.

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| tenantId | uuid FK | |
| parentId | uuid? FK categories | self-ref para subcategorías |
| name | text | |
| slug | text | |
| description | text? | |
| imageUrl | text? | |
| position | int | order drag-to-reorder |
| isActive | bool | |
| createdAt | timestamptz | |

Único `(tenantId, parentId, slug)`.

### `products`

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| tenantId | uuid FK | |
| categoryId | uuid FK | |
| name | text | |
| description | text | |
| basePrice | decimal(10,2) | en moneda del tenant |
| imageUrl | text? | |
| tags | text[] | "popular", "nuevo", "veggie" |
| isAvailable | bool | toggle rápido sin borrar |
| position | int | |
| timesOrdered | int | denorm para top productos |
| createdAt | timestamptz | |

Índice `(tenantId, categoryId, position)`, GIN en `tags`, full-text en `name + description`.

### `product_variants`
Tamaño, sabor, color. Una variante puede tener `priceDelta` que se suma al base.

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| productId | uuid FK | |
| groupName | text | "Tamaño", "Sabor" |
| name | text | "Mediano" |
| priceDelta | decimal(10,2) | +2000, 0, -500 |
| isDefault | bool | |
| position | int | |

### `product_extras`
Extras opcionales que se cobran extra (queso, salsa, doble carne).

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| productId | uuid FK | |
| name | text | |
| price | decimal(10,2) | |
| maxQty | int | default 1 |
| isAvailable | bool | |

### `carts`
Sesión efímera mientras el cliente arma el pedido. Se convierte en `order` al checkout. Limpiar diariamente los > 24h sin actividad.

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| tenantId | uuid FK | |
| customerId | uuid? FK | null si no tiene cuenta todavía |
| sessionId | text | cookie del navegador |
| items | jsonb | `[{productId, variantId?, extras[], qty, unitPrice, lineTotal}]` |
| subtotal | decimal(10,2) | |
| discount | decimal(10,2) | |
| appliedPromos | jsonb | |
| total | decimal(10,2) | |
| status | enum(`OPEN`,`CHECKED_OUT`,`ABANDONED`) | |
| updatedAt | timestamptz | |
| createdAt | timestamptz | |

### `orders`
Cuando el cliente confirma el carrito, snapshot inmutable.

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| tenantId | uuid FK | |
| customerId | uuid FK | (creado on-the-fly si no existe) |
| code | text unique | "A4F2", legible para el dueño |
| items | jsonb | snapshot completo |
| subtotal | decimal(10,2) | |
| discount | decimal(10,2) | |
| total | decimal(10,2) | |
| status | enum(`PENDING`,`CONFIRMED`,`READY`,`DELIVERED`,`CANCELLED`) | |
| channel | enum(`WHATSAPP_LINK`,`IN_APP`,`POS`) | |
| fulfillment | enum(`PICKUP`,`DINE_IN`,`DELIVERY`) | |
| tableNumber | text? | si es DINE_IN |
| deliveryAddress | jsonb? | si es DELIVERY |
| customerNote | text? | "sin cebolla" |
| locationId | uuid? FK locations | sucursal que atiende |
| confirmedAt | timestamptz? | |
| readyAt | timestamptz? | |
| deliveredAt | timestamptz? | |
| createdAt | timestamptz | |

Índice `(tenantId, status, createdAt)`, `(customerId, createdAt)`.

### `order_events`
Bitácora de cambios de estado del pedido (kanban audit log).

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| orderId | uuid FK | |
| type | enum(`CREATED`,`CONFIRMED`,`STATUS_CHANGED`,`MESSAGE_SENT`,`PAYMENT`,`NOTE`) | |
| metadata | jsonb | |
| actorId | uuid? FK users | |
| createdAt | timestamptz | |

### `promotions`

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| tenantId | uuid FK | |
| name | text | |
| description | text | |
| type | enum(`DISCOUNT_PCT`,`DISCOUNT_AMOUNT`,`BUY_X_GET_Y`,`COMBO`,`FREE_ITEM`) | |
| value | decimal(10,2) | depende del type |
| conditions | jsonb | `{minSubtotal, productIds, categoryIds, customerSegment, daysOfWeek, hourFrom, hourTo}` |
| validFrom | timestamptz | |
| validUntil | timestamptz | |
| maxRedemptions | int? | global cap |
| maxRedemptionsPerCustomer | int? | |
| isActive | bool | |
| createdAt | timestamptz | |

### `promotion_redemptions`

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| promotionId | uuid FK | |
| orderId | uuid FK | |
| customerId | uuid FK | |
| amountSaved | decimal(10,2) | |
| createdAt | timestamptz | |

### `automation_rules`

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| tenantId | uuid FK | |
| name | text | |
| description | text | |
| trigger | jsonb | `{type:'ORDER_CONFIRMED'}` o `{type:'INACTIVITY', days:7}` |
| conditions | jsonb | array de condiciones AND |
| actions | jsonb | array de acciones |
| stats | jsonb | `{runs, success, failed, lastRunAt}` |
| isActive | bool | |
| createdAt | timestamptz | |

### `automation_runs`
Bitácora para debug.

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| ruleId | uuid FK | |
| eventPayload | jsonb | |
| status | enum(`SUCCESS`,`FAILED`,`SKIPPED`) | |
| error | text? | |
| executedAt | timestamptz | |

### `channel_configs`
Configuración por tenant del canal (WhatsApp, SMS).

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| tenantId | uuid FK | |
| type | enum(`WHATSAPP_LINK`,`WHATSAPP_CLOUD`,`SMS_TWILIO`,`PUSH`) | |
| config | jsonb | `{phone, businessAccountId, accessToken, twilioSid, ...}` (encriptado) |
| isActive | bool | |
| isDefault | bool | |

### `messages`
Histórico de mensajes enviados (y recibidos cuando habilitemos 2-way).

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| tenantId | uuid FK | |
| customerId | uuid? FK | |
| channel | enum(`WHATSAPP`,`SMS`,`PUSH`) | |
| direction | enum(`OUT`,`IN`) | |
| templateId | uuid? FK templates | |
| body | text | |
| mediaUrl | text? | |
| ruleId | uuid? FK | si lo disparó una automation |
| status | enum(`QUEUED`,`SENT`,`DELIVERED`,`READ`,`FAILED`) | |
| error | text? | |
| externalId | text? | id en Meta/Twilio |
| createdAt | timestamptz | |

### `templates`

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| tenantId | uuid FK | |
| name | text | |
| channel | enum(`WHATSAPP`,`SMS`,`PUSH`,`EMAIL`) | |
| body | text | con placeholders `{{nombre}}`, `{{order_code}}`, `{{stamps}}` |
| variables | text[] | declarados |
| metaTemplateId | text? | si está aprobado en Meta |
| isActive | bool | |
| createdAt | timestamptz | |

### `storefronts`

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| tenantId | uuid FK unique | |
| slug | text unique | usado en `/m/[slug]` |
| customDomain | text? unique | "menu.cafedeldia.co" |
| theme | jsonb | `{primaryColor, secondaryColor, font, heroImage}` |
| blocks | jsonb | array ordenado: `[{type:'hero', ...}, {type:'menu'}, {type:'cards'}, {type:'social', ...}]` |
| isPublished | bool | |
| createdAt | timestamptz | |

### `events`
Tabla de auditoría / event sourcing minimalista. Útil para Analytics y debug.

| campo | tipo | nota |
|---|---|---|
| id | uuid PK | |
| tenantId | uuid? FK | |
| customerId | uuid? FK | |
| type | text | "order.created", etc. |
| payload | jsonb | |
| createdAt | timestamptz | |

Particionar por `createdAt` mensual cuando crezca.

## Modificaciones a tablas existentes

### `customers` (extender)
Agregar:
- `firstOrderAt timestamptz?`
- `lastOrderAt timestamptz?`
- `totalOrdersCount int default 0`
- `totalOrdersAmount decimal(12,2) default 0`
- `tags text[] default '{}'`
- `marketingOptIn bool default true`
- `whatsappVerified bool default false`

### `tenants` (extender)
- `whatsappPhone text?` — número público del negocio
- `currency text default 'COP'`
- `timezone text default 'America/Bogota'`
- `instagramUrl text?`, `facebookUrl text?`, `mapsUrl text?`

### `notifications` (renombrar a `wallet_notifications`)
Para no confundir con `messages` (que es el histórico unificado de canales).

## Diagrama lógico extendido

```
tenants ─┬── users
         ├── locations
         ├── customers ──┬── orders ──┬── order_events
         │               │            └── messages (out)
         │               ├── carts
         │               ├── passes ──── stamps
         │               └── messages
         ├── categories ── products ──┬── product_variants
         │                            └── product_extras
         ├── promotions ──── promotion_redemptions
         ├── cards ──── passes ──── wallet_devices
         ├── automation_rules ──── automation_runs
         ├── channel_configs
         ├── templates
         ├── storefronts (1:1)
         ├── events (sink)
         └── referral_codes ──── referral_uses ──── commissions
```

## Volúmenes esperados (12 meses, 1000 tenants activos)

| Tabla | Filas estimadas | Comentario |
|---|---|---|
| customers | ~500K | promedio 500 por tenant |
| products | ~30K | 30 productos por tenant |
| orders | ~10M | 10K por tenant/año |
| messages | ~30M | 3 mensajes por order + automatizaciones |
| events | ~100M | particionar mensual |
| stamps | ~5M | |

Postgres aguanta sin sweat. Migrar `events` y `messages` a tabla particionada desde el inicio.
