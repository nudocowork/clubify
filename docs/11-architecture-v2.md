# Arquitectura v2 — Clubify OS

## Vista general

Mantenemos el stack base (NestJS + Next.js + Postgres + Redis + S3) pero el sistema crece de **3 a 10 módulos** organizados alrededor de un **event bus** central. Es lo que conecta todo: cuando algo pasa en un módulo (pedido nuevo, sello sumado, cliente inactivo), publica un evento; otros módulos lo consumen.

```
                    ┌──────────────────────────────────────────────────┐
                    │              FRONTENDS                           │
                    │  /admin · /app · /scan · /m/[slug] (storefront)  │
                    │  /w/[passId] (wallet) · /o/[code] (order status) │
                    └──────────────────┬───────────────────────────────┘
                                       │ HTTPS / JWT
                    ┌──────────────────▼───────────────────────────────┐
                    │              API GATEWAY (NestJS)                │
                    └─┬────────────────────────────────────────────────┘
                      │
      ┌───────────────┼─────────────────┬─────────────────┬─────────────────┐
      ▼               ▼                 ▼                 ▼                 ▼
  ┌─────────┐    ┌─────────┐       ┌─────────┐      ┌─────────┐       ┌─────────┐
  │Identity │    │ Loyalty │       │ Catalog │      │ Orders  │       │ Promos  │
  │+Tenants │    │ +Wallet │       │         │      │ +Cart   │       │         │
  └─────────┘    └─────────┘       └─────────┘      └─────────┘       └─────────┘
       └────────────┬─────────────┬───────┴──────────┬──────┴───────────┬──────┘
                    │             │                  │                  │
                    ▼             ▼                  ▼                  ▼
              ┌─────────────────────────────────────────────────────────────┐
              │              EVENT BUS  (Redis Streams + BullMQ)            │
              │  pass.completed · order.created · customer.inactive · ...   │
              └─────────────────────────────────────────────────────────────┘
                    ▲             ▲                  ▲                  ▲
                    │             │                  │                  │
              ┌─────┴───┐    ┌────┴────┐        ┌────┴────┐       ┌────┴─────┐
              │Automat. │    │Channels │        │Storefnt │       │Analytics │
              │engine   │    │WhatsApp │        │mini-web │       │funnels   │
              │         │    │SMS·Push │        │         │       │          │
              └─────────┘    └─────────┘        └─────────┘       └──────────┘
                                  │
                       ┌──────────┼──────────┐
                       ▼          ▼          ▼
                  ┌────────┐ ┌────────┐ ┌────────┐
                  │wa.me   │ │Meta WA │ │Twilio  │
                  │link    │ │Cloud   │ │SMS     │
                  └────────┘ └────────┘ └────────┘
```

## Módulos (10)

### 1. Identity + Tenants  *(existe)*
Auth JWT, RBAC, multi-tenant aware, planes y límites.

### 2. Loyalty + Wallet  *(existe, integrarlo)*
Cards, passes, stamps, Apple/Google Wallet generation, wallet devices, geofence push.
**Integración nueva:** se suscribe al evento `order.confirmed` para sumar sellos automáticamente al cliente del pedido.

### 3. Catalog  *(NUEVO)*
- `categories` (jerárquicas: categoría → subcategoría)
- `products` con descripción, precio base, foto, etiquetas, disponibilidad
- `product_variants` (tamaño, sabor, etc., con `priceDelta`)
- `product_extras` (queso, salsa, con precio adicional, opcional)
- Drag-to-reorder, soft-delete, búsqueda

### 4. Orders  *(NUEVO)*
- `carts` (efímero, sessionId-based hasta que el cliente da contacto)
- `orders` (creado al checkout) con `code` legible (ej. `#A4F2`)
- Items snapshot en JSONB (precios congelados al momento del pedido)
- Status: `PENDING → CONFIRMED → READY → DELIVERED | CANCELLED`
- Channel: `WHATSAPP_LINK` (MVP) | `IN_APP` (futuro)
- Notas, ubicación (mesa # / pickup / delivery), método de entrega

### 5. Promotions  *(NUEVO)*
- Tipos: `DISCOUNT_PCT`, `DISCOUNT_AMOUNT`, `BUY_X_GET_Y`, `COMBO`, `FREE_ITEM`
- Conditions: minimum subtotal, time window, customer segment, product applies-to
- Auto-aplicación en carrito si cumple condiciones
- `promotion_redemptions` para tracking

### 6. Automations  *(NUEVO)*
Motor de reglas event-driven simple:
- **Trigger** (1 evento): `order.created`, `order.confirmed`, `pass.completed`, `customer.inactive_Nd`, `customer.birthday`, `customer.geo_entered`
- **Conditions** (opcionales): `order.total > 50000`, `customer.tags contains "VIP"`, etc.
- **Actions** (1 o N): enviar `WHATSAPP`, `SMS`, `WALLET_PUSH`, `ADD_STAMPS`, `APPLY_PROMO`
- Templates pre-armados para que el dueño no parta de cero
- Ejecución en BullMQ workers desacoplados del request

### 7. Channels  *(NUEVO — abstracción de mensajería)*
Adapter pattern con 3 backends:
- **WhatsApp Link (`wa.me/...`)** — MVP, sin API, sólo abre WhatsApp pre-llenado
- **Meta Cloud API** — fase 3, mensajes 2-way con plantillas aprobadas
- **Twilio SMS / WhatsApp** — alternativa
- **Apple/Google Wallet push** — ya existe en Loyalty

`messages` table guarda histórico (OUT + IN cuando habilitemos 2-way).
`templates` con variables `{nombre}`, `{order_code}`, `{stamps}`, etc.

### 8. Storefront  *(NUEVO)*
Mini-sitio público por tenant en `clubify.app/m/[slug]` o dominio custom.
- Hero con logo + descripción
- Bloques editables: Botones (WA, IG, Maps), Menú embed, Tarjetas embed, Promos
- Tema: colores, tipografía
- Renderizado SSR para SEO

### 9. Analytics  *(NUEVO)*
- Eventos crudos en `events` table (todo dispara aquí)
- Vistas materializadas para dashboards rápidos
- Métricas:
  - Visitas al menú (uniq visitors / día)
  - Conversión menú → pedido
  - Productos más pedidos (top 10)
  - Clientes recurrentes (≥2 pedidos en 30d)
  - Uso de tarjetas (sellos sumados, redenciones)
  - Clicks en WhatsApp / Instagram / Maps
  - Funnel: vio menú → agregó al carrito → finalizó → confirmado

### 10. Public API + Webhooks  *(NUEVO, fase futura)*
Para integraciones POS, Zapier, Make.

## Event Bus — eventos canónicos

Todos llevan `tenantId` y `customerId?`.

| Evento | Producido por | Consumidores típicos |
|---|---|---|
| `customer.created` | Catalog (al primer pedido) | Loyalty (auto-emitir pase), Channels (welcome msg) |
| `cart.abandoned` | Orders (tras 30 min sin checkout) | Automations (recordatorio) |
| `order.created` | Orders | Channels (WA al dueño), Analytics |
| `order.confirmed` | Orders (manual del dueño o auto) | Loyalty (sumar sellos), Channels (gracias al cliente), Analytics |
| `order.ready` | Orders | Channels (avisar al cliente) |
| `order.delivered` | Orders | Loyalty (sello extra opcional), Analytics |
| `pass.created` | Loyalty | Channels (link a Wallet) |
| `pass.stamp_added` | Loyalty | Channels (push), Analytics |
| `pass.completed` | Loyalty | Channels ("recompensa lista") |
| `customer.inactive` | Daily cron en Analytics | Automations |
| `customer.birthday` | Daily cron | Automations |
| `customer.geo_entered` | Wallet webhook | Channels |
| `promo.redeemed` | Promotions | Analytics |

## Multi-tenancy y datos

Continuamos con **single DB, shared schema, fila por `tenantId`**. Las tablas nuevas siguen la misma convención.

`Customer` ahora es el activo central — agrega columnas:
- `lastOrderAt`, `firstOrderAt`
- `totalOrdersCount`, `totalOrdersAmount`
- `tags TEXT[]` (segmentación: "VIP", "veggie", "delivery_only")
- `marketingOptIn boolean`

## Stack actualizado

| Capa | Antes | Ahora |
|---|---|---|
| Frontend | Next.js 14 | Next.js 14 + componentes de menú/order/storefront |
| Backend | NestJS modular | NestJS + 7 módulos nuevos |
| DB | Postgres + Prisma | + ~12 tablas nuevas |
| Cola/eventos | BullMQ para wallet | BullMQ + Redis Streams para event bus |
| Storage | S3/MinIO | + bucket `media/products/` para fotos de menú |
| Búsqueda | — | Postgres full-text en productos (luego Meilisearch) |
| WhatsApp | — | Adapter: wa.me (MVP) → Meta Cloud API (fase 3) |
| Pagos | — | Stripe/MercadoPago (fase 2) |

## Decisiones técnicas clave

1. **No microservicios todavía.** Módulos NestJS dentro del mismo monolito modular. Microservicios cuando GMV justifique la complejidad operativa.
2. **Event bus interno (Redis Streams).** Postgres LISTEN/NOTIFY como fallback.
3. **wa.me en MVP, Meta Cloud API en fase 3.** Cero costo de aprobación de plantillas en MVP, cero riesgo de rechazo de Meta. Cuando el cliente ya valida el producto, escalamos.
4. **Storefront SSR.** SEO matters: el dueño quiere que su menú aparezca en Google.
5. **Analytics: eventos crudos + materialized views.** Sin meter ClickHouse hasta tener miles de tenants.
