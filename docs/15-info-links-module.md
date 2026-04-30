# Módulo de Links Informativos — Clubify

> **Estado:** planeado para futuro (no en MVP v2). Quedar reservado en la arquitectura.

## Concepto

Cada negocio puede crear **mini-páginas visuales e interactivas** para compartir información sin necesidad de tener una web completa. Pensado para:

- Presentar un espacio (ej. cowork mostrando sus salas)
- Mostrar servicios o paquetes
- Compartir una promoción específica
- Crear una "carta visual" temática
- Galerías de fotos del negocio
- Experiencias interactivas para clientes

**Referencia visual:** [nudocowork.com/7819](https://nudocowork.com/7819) — formato de mini-landing con título, hero image, secciones, botones.

## Estructura de un Link Informativo

| Campo | Tipo | Descripción |
|---|---|---|
| `title` | text | Título principal grande |
| `subtitle` | text? | Bajada / descripción |
| `slug` | text unique | URL pública corta (ej. `/i/[slug]`) |
| `heroImageUrl` | text? | Imagen de cabecera |
| `gallery` | jsonb | array de URLs de imágenes |
| `sections` | jsonb | array de bloques (heading, paragraph, image, divider) |
| `buttons` | jsonb | array de CTAs (label, url, type [WHATSAPP, IG, MAPS, MENU, CARD, PROMO, EXTERNAL], style) |
| `theme` | jsonb | colores y tipografía |
| `isActive` | bool | toggle de visibilidad |
| `stats` | jsonb | `{views, clicksByButton, qrScans}` |
| `createdAt` | timestamptz | |

**Footer obligatorio:** "Desarrollado por Clubify" (con link a clubify.app, no removible en plan Free, removible en planes pagos).

## Schema Prisma sugerido

```prisma
model InfoLink {
  id            String   @id @default(uuid())
  tenantId      String
  tenant        Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  slug          String
  title         String
  subtitle      String?
  heroImageUrl  String?
  gallery       Json     @default("[]")
  sections      Json     @default("[]")
  buttons       Json     @default("[]")
  theme         Json     @default("{}")
  isActive      Boolean  @default(true)
  stats         Json     @default("{}")
  createdAt     DateTime @default(now())

  @@unique([tenantId, slug])
  @@index([tenantId, isActive])
}

model InfoLinkEvent {
  id         String   @id @default(uuid())
  infoLinkId String
  infoLink   InfoLink @relation(fields: [infoLinkId], references: [id], onDelete: Cascade)
  type       String   // "view", "click_button", "qr_scan"
  metadata   Json     @default("{}")
  createdAt  DateTime @default(now())

  @@index([infoLinkId, type, createdAt])
}
```

## Tipos de bloques en `sections`

```ts
type Section =
  | { type: 'heading'; text: string; level: 1 | 2 | 3 }
  | { type: 'paragraph'; text: string }
  | { type: 'image'; url: string; caption?: string }
  | { type: 'gallery'; images: string[] }
  | { type: 'divider' }
  | { type: 'embed_menu' }            // muestra el menú del tenant
  | { type: 'embed_promotions' }      // muestra promos activas
  | { type: 'embed_card' }            // muestra tarjeta de fidelización
  | { type: 'video'; url: string };
```

## Tipos de botones

```ts
type Button = {
  label: string;
  type: 'WHATSAPP' | 'INSTAGRAM' | 'MAPS' | 'MENU' | 'CARD' | 'PROMO' | 'EXTERNAL';
  url: string;            // o auto-resuelto según type
  icon?: string;
  style?: 'primary' | 'secondary' | 'outline';
};
```

## URL pública

- Formato: `clubify.app/i/[slug]` o `clubify.app/m/[tenantSlug]/i/[slug]`
- Recomendado el segundo: queda asociado al tenant para branding consistente
- Ejemplo: `clubify.app/i/cafe-del-dia/eventos-junio`

## QR del link

- En el panel, botón "Descargar QR" que descarga PNG/SVG del QR de la URL del link
- QR estilo Apple Wallet (negro sobre blanco, esquinas posicionales)

## Panel del tenant

Nueva sección en sidebar bajo "Tu sitio":
```
🌐 Mi sitio
🔗 Links informativos      ← NUEVO
📍 Ubicaciones
🎁 Referidos
```

### Lista `/app/info-links`
- Grid de cards con preview en miniatura iPhone, título, # vistas
- Botón "+ Nuevo link"
- Botón QR + Botón Compartir + Toggle activo/inactivo

### Editor `/app/info-links/[id]`
- Layout dos columnas: editor de bloques (izq) + preview iPhone (der)
- Estilo similar al **Storefront editor** que ya existe
- Drag para reordenar bloques
- Botón "Vista pública" abre `/i/[slug]` en nueva tab
- Botón "Descargar QR"

### Estadísticas
Card en el detalle del link:
- **Visitas únicas** (último 30 días)
- **Clics por botón** (gráfica de barras)
- **Escaneos QR** vs **clics directos** (donut)

## Endpoints API

```
GET    /api/info-links                     list (privado)
POST   /api/info-links                     create
GET    /api/info-links/:id                 detail
PATCH  /api/info-links/:id                 update
DELETE /api/info-links/:id

GET    /api/info-links/:id/stats           métricas

GET    /api/public/i/:tenantSlug/:slug     vista pública (sin auth)
POST   /api/public/i/:id/track             registrar evento (view/click/qr_scan)
```

## Diseño público

- Mobile-first (ancho máx 480px en mobile, 720px en desktop)
- Hero con imagen full-width, título serif grande, subtitle
- Bloques renderizados en orden, espaciado generoso
- Botones grandes redondeados (pill), color del theme
- Footer minimalista: "Desarrollado por **Clubify**" con logo pequeño + link

## Roadmap dentro del módulo

| Versión | Alcance |
|---|---|
| v1 (post-MVP) | Editor básico de bloques + botones, plantillas predefinidas, QR descargable, métricas básicas |
| v2 | Plantillas premium temáticas (cowork, restaurante, gym), animaciones suaves, video embed |
| v3 | A/B testing de variantes, integración con automations (ej: "si X visitas → enviar promo"), forms embebidos (lead capture) |
| v4 | Dominio custom por link, edición visual drag-drop avanzada |

## Diferenciación vs Linktree / Beacons

| Eje | Linktree | Clubify Info Links |
|---|---|---|
| Botones simples | ✓ | ✓ |
| Galería de imágenes | parcial | ✓ |
| Embed menú propio | ✗ | ✓ (módulo Catalog) |
| Embed tarjeta fidelidad | ✗ | ✓ (módulo Loyalty) |
| Embed promos activas | ✗ | ✓ (módulo Promotions) |
| QR del link | upgrade | ✓ incluido |
| Branded sin Clubify | upgrade | upgrade plan Pro+ |
| Métricas integradas con CRM | ✗ | ✓ |

## Pricing sugerido

- **Free:** 1 link informativo, footer Clubify visible
- **Pro:** 5 links, footer removible
- **Business:** ilimitados, dominio custom, A/B testing
