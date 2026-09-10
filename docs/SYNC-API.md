# Sync API — diccionario de campos

Lo que el Onboarding puede mandarle a Clubify, endpoint por endpoint.

> **Por qué existe este archivo.** El 2026-09-10 el equipo del Onboarding pidió
> como «graves» tres cosas que ya existían desde hacía meses (el módulo de push
> entero, el de infolink entero y el estilo del menú), y su mapeo lleva
> comentarios que dicen «no existe en Clubify» sobre campos que sí están
> (`tiktok`, `web`, `photo_popup`, `orders_phone`, `alert_phone`). Nadie mentía:
> **el contrato no estaba escrito en ningún sitio** y cada lado recordaba una
> versión distinta. Este archivo es la versión única.
>
> Si añades un campo a `onboarding-sync.service.ts`, añádelo aquí. Si no, dentro
> de tres meses alguien vuelve a pedir lo que ya tiene.

Todo va autenticado con el token del negocio:
`Authorization: Bearer <token>`, y el negocio sale del token, nunca del body.

Base: `https://api.soyclubify.com/api`

---

## Regla general

**Upsert no destructivo.** Un campo que no llega **no se toca** — no se borra.
La excepción es `/sync/hours`, que es un set completo a propósito.

Lo que no se manda nunca se pierde: el negocio pudo escribirlo a mano en el
panel y un formulario a medias no puede llevárselo por delante.

---

## `PATCH /sync/business` — datos del negocio

| Campo | Notas |
|---|---|
| `name`, `brandName` | El onboarding no separa nombre interno y marca; manda el mismo en los dos. |
| `email` | |
| `businessCategorySlug` | El servidor lo slugifica. |
| `country` | ISO-3166-1 alfa-2 (`CO`, `MX`…). |
| `city` | |
| `description` | |
| `phone` | Teléfono del negocio (≠ WhatsApp). |
| `whatsappPhone` | |
| `whatsappOrdersPhone` | **El que recibe los pedidos.** Es el `orders_phone` del onboarding. |
| `whatsappDeliveryPhone` | Domicilios. |
| `whatsappReservationsPhone` | Reservas. |

## `PATCH /sync/branding` — identidad visual

| Campo | Notas |
|---|---|
| `logoUrl`, `walletLogoUrl`, `pushLogoUrl` | Solo URLs descargables; nunca `data:` en base64. |
| `primaryColor`, `secondaryColor` | Hex. Un texto que no sea color **se descarta**: sin validar rompía la interfaz en silencio. |
| `heroImageUrl` | Portada / cabecera del menú (`photo_menu_banner`). |
| `popupImageUrl` | Imagen del pop-up (`photo_popup`). |
| `menuLayout` | **El estilo del menú.** Acepta los ocho nombres del onboarding: `classic`, `grid`, `hero`, `clean`, `compact`, `dark`, `premium`, `flipbook` (y los valores nativos). Desconocido = se ignora, no rompe. |

> `menuLayout` vive aquí por historia, no por diseño: es un dato del módulo
> **Menú** que hay que mandar desde **Branding**. Si el cliente nunca guarda
> Branding, no se manda nunca. Está pendiente moverlo a su sitio.

## `PATCH /sync/contact` — redes

`instagramUrl`, `facebookUrl`, `tiktokUrl`, `websiteUrl`, `whatsappPhone`, `mapsUrl`.

> TikTok y web **sí existen**. El mapeo del onboarding dice lo contrario.

## `PATCH /sync/reviews` — Google Reviews

| Campo | Notas |
|---|---|
| `googleReviewUrl` | |
| `alertPhone` (o `reviewAlertsPhone`) | **A dónde llega el aviso de una reseña mala.** Es el `alert_phone` del onboarding. |
| `reviewAlertsThreshold` | Estrellas por debajo de las cuales avisa. |

## `PUT /sync/location` — una sede

`name`, `address`, `latitude`, `longitude`, `mapsUrl`. Actualiza **la primera**
sede del negocio. Para varias, usar el plural.

## `PUT /sync/locations` — varias sedes

Arreglo (o `{ items: [...] }`) de:
`externalId`, `name`, `address`, `latitude`, `longitude`, `mapsUrl`, `state`,
`ordersWhatsappPhone`.

- **Casa por `externalId`** (vuestro id) y, de respaldo, por nombre. Con el id,
  renombrar una sede es un cambio de nombre y no una sede nueva.
- **No borra.** Las que no vengan salen en `sobrantes`.

## `PUT /sync/loyalty-card` — una tarjeta de sellos

## `PUT /sync/loyalty-cards` — varias (preferir esta)

Arreglo de tarjetas. Upsert **por nombre**, no borra las que no vengan.

| Campo | Notas |
|---|---|
| `name` | Requerido. Es la llave del upsert. |
| `stampsRequired` | Mínimo 1. |
| `rewardText`, `rewardDescText`, `description` | |
| `rewardEarnedMessage`, `stampEarnedMessage` | |
| `stampIcon` | |
| `primaryColor`, `secondaryColor` | Hex validado. |
| `stampBgImageUrl` | Fondo de la tarjeta (`photo_card_android`). Ponerlo activa el modo imagen. |

> El singular pisa siempre la primera tarjeta: mandar la segunda borraba la
> primera. Con varias tarjetas, usar el plural.

## `PUT /sync/hours` — horario

Arreglo de `{ weekday, startMin, endMin }`. `weekday`: 0 = domingo.
Minutos desde medianoche.

**Reemplaza el set completo.** Un día sin filas = cerrado. Por eso no se manda
si el cliente no tocó nada: un PUT vacío le borraba el horario que ya tenía.

## `PATCH /sync/modules` — funcionalidades

`digitalMenu`, `orders`, `ordersDelivery`, `reservations`, `serviceReservations`,
`club`, `convenios`, `sedeMenu`, `published`.

- **`sedeMenu: true` hay que mandarlo ANTES que los productos** de un negocio
  multisede, o las sedes de cada producto se ignoran (y la respuesta de
  `/sync/products` lo dice en `sedes.aplicado: false`).
- Sellos, cupones, wallet, geopush, promos y beneficios **no tienen campo**: en
  Clubify no existe ese interruptor por negocio. No es un olvido; sería esquema
  nuevo.

## `POST /sync/categories`

Arreglo de `{ name, description, imageUrl, position }`. Upsert por slug del
nombre.

## `POST /sync/products`

Arreglo de:

| Campo | Notas |
|---|---|
| `name` | Requerido. Llave del upsert junto con la categoría. |
| `basePrice` | Requerido al crear. |
| `description`, `imageUrl`, `position` | |
| `isAvailable`, `isRecommended` | |
| `categoryName` o `categorySlug` | |
| `locationMode` | `TODAS` \| `SELECCIONADAS`. Omitirlo = no se toca. |
| `locationExternalIds` | Dónde se vende. Si vienen, los nombres se ignoran. |
| `locationNames` | Respaldo cuando no hay ids. |
| `locationOverrides` | `[{ externalId \| name, price, imageUrl, description, isAvailable }]` — lo que cambia **en esa sede**. |

### Variantes y adiciones (los dos ejes)

| Campo | Notas |
|---|---|
| `variants` | `[{ name, price (o priceDelta), groupName, isDefault }]`. El orden que mandes es el que se ve. |
| `variantPriceMode` | `ABSOLUTE` (por defecto) o `DELTA`. |
| `maxVariantsTotal` | Cuántas puede elegir el cliente. Null o 1 = una sola. |
| `extras` | `[{ name, price, maxQty, isAvailable }]`. |
| `maxExtrasTotal` | Tope de adiciones en total. |

**El precio de la variante es el PRECIO FINAL**, no lo que suma sobre el base:
es lo que pide el formulario («Torre pequeña $34.900»). Por eso el modo por
defecto es `ABSOLUTE`. Mandarlo como `DELTA` cobraría base + variante.

Variantes y adiciones **se reemplazan** cuando llegan, como en el panel. Que no
lleguen no es lo mismo que que lleguen vacías: **sin la clave no se toca nada**
(un onboarding viejo no puede borrar los tamaños que el negocio configuró a
mano); con la clave vacía se quitan a propósito.

`locationOverrides` **solo escribe lo que llega con valor**: un reenvío no vacía
el precio que el negocio puso en el panel.

## `POST /sync/coupons`

`name` (llave), `description`, `terms`, `imageUrl`, `code`/`couponCode`,
`quantity`/`couponQuantity`, `validFrom`, `validUntil`.

## `PUT /sync/infolink` — link-in-bio

`title`, `subtitle`, `description`, `cover` (o `heroImageUrl`), `buttons`.

Reemplaza la lista de botones entera.

### Forma de cada botón

`{ label, type, url, popupMessage }` (también vale `popup_message`).

| `type` | Qué hace |
|---|---|
| `link`, `reviews`, `social`, `reserva` | Botón externo con la `url`. |
| `whatsapp` | Saca el teléfono de la `url`. Si no encuentra ninguno, cae a externo. |
| `menu` | **Sin `url`** = botón nativo al menú. **Con `url`** = externo. |
| `maps` | Igual: sin `url`, botón nativo de ubicación. |
| `popup` | Usa `popupMessage`. No necesita `url`. |

Sin `label` se pone «Ver». **Un botón sin URL válida que no sea `popup`,
`menu` ni `maps` se descarta** — no se puede pintar. Los descartados salen en
la respuesta:

```json
{ "ok": true, "infolink_id": "...", "botones_descartados": ["Reservar mesa"] }
```

Antes se iban en silencio: el cliente escribía cinco botones, le llegaban tres
y nadie sabía cuáles ni por qué.

> El **estilo** del infolink no tiene campo. `InfoLink.theme` guarda el tema
> desmenuzado (`background`, `fontFamily`, `logoContainer`, `text`,
> `bannerConfig`), no un nombre de estilo: mapear los cinco estilos exige
> definir cinco presets. Es diseño, no un campo.

## `PUT /sync/automations` — notificaciones automáticas

Objeto con hasta cinco llaves, cada una `{ enabled, message }`:

`welcome`, `birthday`, `stamp`, `reward`, `inactivity`.

Crea o actualiza la regla de ese evento sin duplicar. El onboarding es la fuente
de verdad de esos mensajes.

## `POST /sync/activate`

Publica el negocio.

---

## Orden para un negocio multisede

```
PATCH /sync/modules   { sedeMenu: true }
PUT   /sync/locations [...]
POST  /sync/categories [...]
POST  /sync/products   [...]   ← con locationExternalIds / locationOverrides
```

El orden no es estético: cada llamada depende de la anterior.
