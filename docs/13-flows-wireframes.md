# Flujos y wireframes — Clubify OS

## Parte 1 — Flujos

### Flujo del cliente final (público)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  1. Cliente escanea QR en mesa / cartel / Instagram                     │
│     └─→ Abre clubify.app/m/[slug] (storefront del negocio)              │
│                                                                         │
│  2. Storefront                                                          │
│     ├─ Hero (logo, nombre, descripción)                                 │
│     ├─ Botones: WhatsApp · Instagram · Cómo llegar                      │
│     └─ Tabs: [Menú] [Mi Tarjeta] [Promos]                               │
│                                                                         │
│  3. Tap "Menú"                                                          │
│     ├─ Categorías scroll horizontal (chips)                             │
│     └─ Lista productos con foto + precio                                │
│                                                                         │
│  4. Tap producto                                                        │
│     └─→ Modal: variantes (Tamaño), extras (Queso +$2K), qty             │
│        [Agregar al carrito $X]                                          │
│                                                                         │
│  5. Carrito flotante (bottom sheet)                                     │
│     ├─ Lista de items con qty editable                                  │
│     ├─ Promo aplicada automáticamente si cumple                         │
│     └─ [Finalizar pedido]                                               │
│                                                                         │
│  6. Checkout (mínimo)                                                   │
│     ├─ Nombre                                                           │
│     ├─ Teléfono (clave: matchea con customer existente)                 │
│     ├─ ¿Para llevar? / Mesa # / Domicilio                               │
│     └─ Notas                                                            │
│     [Enviar pedido por WhatsApp]                                        │
│                                                                         │
│  7. POST /api/orders                                                    │
│     ├─ Crea order con code "#A4F2"                                      │
│     ├─ Match o crea customer por teléfono                               │
│     ├─ Si tiene tarjeta activa → marca para sumar sello al confirmar    │
│     └─ Devuelve waLink: wa.me/57300XXX?text=...                         │
│                                                                         │
│  8. Browser hace window.location = waLink                               │
│     └─→ Abre WhatsApp con mensaje pre-llenado:                          │
│         "Hola! Pedido #A4F2                                             │
│          Juan Pérez                                                     │
│          • 2x Hamburguesa Doble — $24.000                               │
│          • 1x Coca Cola 350ml — $4.500                                  │
│          Subtotal: $28.500                                              │
│          Para llevar.                                                   │
│          Pedido en clubify.app/o/A4F2"                                  │
│                                                                         │
│  9. Cliente envía mensaje. El dueño recibe en su WhatsApp.              │
│                                                                         │
│  10. (Paralelo) Cliente queda en página /o/A4F2 viendo:                 │
│      ├─ "✅ Pedido enviado"                                             │
│      ├─ Estado en vivo (PENDING → CONFIRMED → READY)                    │
│      ├─ "🎉 Sumaste 1 sello en tu tarjeta" (si aplica)                  │
│      └─ [Ver mi tarjeta] → /w/[passId]                                  │
│                                                                         │
│  11. Dueño confirma manualmente en panel (o desde notificación push)    │
│      └─→ Triggers:                                                      │
│           • event order.confirmed                                       │
│           • Loyalty: +1 sello al pase del customer                      │
│           • Channels: WhatsApp al cliente "Confirmado, listo en 15min"  │
│           • Wallet: actualiza pkpass con nuevo balance                  │
│           • Push silencioso al iPhone del cliente                       │
└─────────────────────────────────────────────────────────────────────────┘
```

### Flujo de onboarding del dueño

Wizard de 5 pasos (cada uno < 60s):

1. **Cuenta** — email, password, nombre del negocio
2. **Branding** — sube logo, elige color principal, descripción 1 línea
3. **WhatsApp** — número del negocio, mensaje de bienvenida (template)
4. **Primer producto** — categoría rápida ("Comida"), 1 producto demo (nombre, precio, foto)
5. **Tarjeta** — tipo sellos (default 10), recompensa, "Imprimir QR de mesa"

Al terminar: dashboard con tour guiado de 3 dots para mostrarle dónde están las cosas.

### Flujo de operación diaria del dueño

```
[Mañana]
1. Abre app → Dashboard
2. Ve KPIs: pedidos hoy, ventas estimadas, sellos sumados ayer
3. Pestaña Pedidos: kanban en vivo
   - Al llegar nuevo → suena bell + vibra
   - Tap "Confirmar" → cliente recibe WhatsApp + se le suma sello
   - Tap "Listo" → cliente recibe WhatsApp "Tu pedido está listo"

[Tarde]
4. Ve cuántos clientes inactivos tiene → 38 sin venir hace +14 días
5. Tap "Activar promoción" → wizard:
   - Elegir descuento: -20% en bebidas
   - Vigencia: hoy hasta fin de día
   - Notificar a quién: clientes inactivos 14d
   - Canal: WhatsApp
   - [Enviar] → 38 mensajes en cola

[Noche]
6. Ve métricas del día
7. Cierra app
```

### Flujo de automatización (configuración)

```
/app/automations/new
  ▶ Wizard:
     1. CUANDO ocurra...
        [Seleccionar trigger]
        - Pedido confirmado
        - Cliente cumple años
        - Cliente sin venir 7 días
        - Cliente sin venir 30 días
        - Cliente cerca del local
        - Tarjeta completada (10/10 sellos)
        - Sin actividad 90 días

     2. SI cumple... (opcional)
        [Agregar condición]
        - Total pedido > $X
        - Cliente tiene tag "VIP"
        - Es lunes/martes/etc
        - Hora entre X y Y

     3. ENTONCES haz...
        [Agregar acción]
        - Enviar WhatsApp con template "..."
        - Sumar N sellos al pase
        - Aplicar descuento N% en su próximo pedido
        - Enviar push a Wallet

     4. Preview + activar

Templates pre-armados ("Recetas"):
  ✅ "Agradecer pedido"
  ✅ "Recuperar inactivo 7d"
  ✅ "Cumpleaños con regalo"
  ✅ "Avisar promoción a frecuentes"
  ✅ "Cerca del local → ven hoy"
  ✅ "Recompensa lista para retirar"
```

---

## Parte 2 — Wireframes (descripción)

### Storefront público — `/m/[slug]`

```
┌────────────────────────────────────────┐
│ ← (status bar nativo)                  │
├────────────────────────────────────────┤
│   [LOGO]                               │
│   Café del Día                         │
│   Café de especialidad · Bogotá        │
│                                        │
│   [📞 WhatsApp] [📷 IG] [📍 Maps]      │
├────────────────────────────────────────┤
│   ┌──────┬──────┬──────┐               │
│   │ Menú │Tarjeta│Promos│               │
│   └──────┴──────┴──────┘               │
├────────────────────────────────────────┤
│   PROMOS ACTIVAS                       │
│   ┌──────────────┐ ┌──────────────┐    │
│   │ -20% bebidas │ │ 2x1 postres  │    │
│   │ hasta hoy    │ │ Lunes-jue    │    │
│   └──────────────┘ └──────────────┘    │
│                                        │
│   CATEGORÍAS                           │
│   [Desayunos] [Almuerzos] [Bebidas]   │
│   [Postres] [Brunch]                   │
│                                        │
│   DESAYUNOS                            │
│   ┌────────────────────────────────┐   │
│   │ [📷] Calentado paisa           │   │
│   │      Huevos, frijoles, arepa…  │   │
│   │      $18.000     [Popular] ➕  │   │
│   ├────────────────────────────────┤   │
│   │ [📷] Avena con frutas          │   │
│   │      Nueva opción saludable    │   │
│   │      $12.000     [Nuevo]   ➕  │   │
│   └────────────────────────────────┘   │
│                                        │
│   ┌──────────────────────────────────┐ │
│   │ 🛒 3 items · $42.500    [Pedir] │ │ ← bottom dock
│   └──────────────────────────────────┘ │
└────────────────────────────────────────┘
```

### Modal de producto

```
┌────────────────────────────────────────┐
│            [foto producto]             │
│                                        │
│   Calentado paisa            $18.000  │
│   Huevos, frijoles, arepa, chicharrón, │
│   chocolate                            │
│                                        │
│   TAMAÑO                               │
│   ○ Personal        +$0                │
│   ● Grande          +$4.000            │
│                                        │
│   EXTRAS                               │
│   ☐ Aguacate        +$3.000            │
│   ☐ Doble huevo     +$2.000            │
│                                        │
│   Cantidad: [-] 1 [+]                  │
│                                        │
│   NOTAS (opcional)                     │
│   [_______________________]            │
│                                        │
│   [Agregar al carrito · $22.000]       │
└────────────────────────────────────────┘
```

### Carrito (bottom sheet)

```
┌────────────────────────────────────────┐
│   Tu pedido                       ✕    │
├────────────────────────────────────────┤
│   Calentado paisa (Grande)             │
│   $22.000              [-] 1 [+]    🗑 │
│                                        │
│   Capuchino                            │
│   $7.500               [-] 2 [+]    🗑 │
│                                        │
│   ─────────────────────────────────    │
│   Subtotal              $37.000        │
│   Promo bebidas -20%   -$3.000         │
│   ─────────────────────────────────    │
│   Total                $34.000         │
│                                        │
│   [Finalizar pedido por WhatsApp]      │
└────────────────────────────────────────┘
```

### Checkout

```
┌────────────────────────────────────────┐
│   ← Tu pedido · $34.000                │
├────────────────────────────────────────┤
│   ¿Cómo te llamas?                     │
│   [Juan Pérez____________]             │
│                                        │
│   WhatsApp                             │
│   [+57 300 111 2222____]               │
│                                        │
│   ¿Es para...?                         │
│   ● 🍽 Comer aquí (mesa #_____)        │
│   ○ 🥡 Llevar                          │
│   ○ 🛵 Domicilio                       │
│                                        │
│   Notas adicionales (opcional)         │
│   [_______________________]            │
│                                        │
│   [Enviar pedido por WhatsApp]         │
└────────────────────────────────────────┘
```

### Confirmación post-pedido — `/o/[code]`

```
┌────────────────────────────────────────┐
│            ✅                          │
│   Pedido #A4F2 enviado                 │
│   El negocio te confirmará en breve.   │
├────────────────────────────────────────┤
│   ESTADO                               │
│   ●━━━○━━━○━━━○                        │
│   Enviado · Confirmado · Listo · Entregado │
│                                        │
│   🎉 ¡Sumaste 1 sello!                 │
│   Llevas 4/10 en Café del Día          │
│   [Ver mi tarjeta →]                   │
│                                        │
│   TU PEDIDO                            │
│   2x Calentado paisa                   │
│   1x Capuchino                         │
│   Total $34.000                        │
└────────────────────────────────────────┘
```

---

### Panel del dueño — Dashboard

Manteniendo el lenguaje visual del demo actual (sidebar oscuro + main claro + brand violeta).

Sidebar agrega items nuevos:
```
PRINCIPAL
  ▣ Dashboard
  📋 Pedidos      ← NUEVO (con badge contador rojo)
  🍽 Menú         ← NUEVO
  💳 Tarjetas
  👥 Clientes

ENGAGEMENT
  💬 Mensajes    ← NUEVO
  ⚡ Automatizaciones ← NUEVO
  🎯 Promociones ← NUEVO

CANALES
  🔔 Notificaciones
  🌐 Mi sitio    ← NUEVO

OPERACIÓN
  🔲 Escáner
  📍 Ubicaciones
  📊 Métricas
  🎁 Referidos
```

### Pedidos (kanban en vivo)

```
┌───────────────────────────────────────────────────────────────┐
│  Pedidos · Hoy 28 abr         [🔔] [Sonido]  [+ Manual]       │
├───────────────────────────────────────────────────────────────┤
│ NUEVOS (3)    │ CONFIRMADOS(5) │ LISTOS (2)   │ ENTREGADOS(12)│
│ ┌───────────┐ │ ┌───────────┐  │ ┌───────────┐│               │
│ │ #A4F2 🆕  │ │ │ #B7K1     │  │ │ #C2N9     ││               │
│ │ Juan P.   │ │ │ María R.  │  │ │ Carlos M. ││               │
│ │ 2 items   │ │ │ 4 items   │  │ │ 1 item    ││               │
│ │ $34.000   │ │ │ $58.500   │  │ │ $12.000   ││               │
│ │ 2:30 PM   │ │ │ 2:25 PM   │  │ │ 2:10 PM   ││               │
│ │[Confirmar]│ │ │ [Listo]   │  │ │[Entregado]││               │
│ └───────────┘ │ └───────────┘  │ └───────────┘│               │
│ ┌───────────┐ │ ...           │  │             │               │
│ │ #A4G3 🆕  │ │                │  │             │               │
│ ...           │                │  │             │               │
└───────────────────────────────────────────────────────────────┘
```

### Editor de menú

```
┌────────────────────────────────────────────────────────────────┐
│  Menú          [Vista pública ↗]    [+ Categoría][+ Producto]  │
├────────────────────────────────────────────────────────────────┤
│  CATEGORÍAS              │  PRODUCTOS · Desayunos               │
│  [≡] Desayunos     ●     │  ┌─────────────────────────────────┐ │
│  [≡] Almuerzos           │  │ [📷] Calentado paisa            │ │
│  [≡] Bebidas             │  │      $18.000  [Popular] [✓]  ⋮  │ │
│  [≡] Postres             │  ├─────────────────────────────────┤ │
│  [≡] Brunch              │  │ [📷] Avena con frutas           │ │
│                          │  │      $12.000  [Nuevo]    [✓]  ⋮ │ │
│  [+ Subcategoría]        │  ├─────────────────────────────────┤ │
│                          │  │ [📷] Pancakes de banano         │ │
│                          │  │      $14.000             [✓]  ⋮ │ │
│                          │  └─────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

### Editor de producto (drawer)

```
┌─────────────────────────────────────────┐
│  Editar producto                    ✕   │
├─────────────────────────────────────────┤
│  [📷 Cambiar foto]                       │
│                                         │
│  NOMBRE        Calentado paisa          │
│  CATEGORÍA     Desayunos ▼              │
│  PRECIO BASE   $18.000                  │
│  DESCRIPCIÓN   Huevos, frijoles, arepa…│
│                                         │
│  ETIQUETAS     [Popular] [+]            │
│  DISPONIBLE    [✓] Visible              │
│                                         │
│  VARIANTES                              │
│  Tamaño                                 │
│   • Personal    $0    [✓ default]       │
│   • Grande      +$4.000                 │
│   [+ Variante]                          │
│                                         │
│  EXTRAS                                 │
│   • Aguacate    +$3.000                 │
│   • Doble huevo +$2.000                 │
│   [+ Extra]                             │
│                                         │
│  [Eliminar]                  [Guardar]  │
└─────────────────────────────────────────┘
```

### Automatizaciones — builder

```
┌─────────────────────────────────────────────────────────┐
│  Nueva automatización                                   │
├─────────────────────────────────────────────────────────┤
│  PASO 1 — CUANDO OCURRA...                              │
│  ┌─────────────────────────────────────────────────┐    │
│  │ ⚡ Pedido confirmado            ▼               │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  PASO 2 — SI CUMPLE... (opcional)                       │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Total > $50.000      [✕]                        │    │
│  │ + agregar condición                             │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  PASO 3 — ENTONCES HAZ...                               │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 💬 Enviar WhatsApp                              │    │
│  │    "Gracias {{nombre}} por tu pedido #         │    │
│  │     {{order_code}}! 🎉 Te ganaste un sello."   │    │
│  ├─────────────────────────────────────────────────┤    │
│  │ ⭐ Sumar 1 sello extra al pase                  │    │
│  └─────────────────────────────────────────────────┘    │
│  + agregar acción                                       │
│                                                         │
│  [Cancelar]                       [Guardar y activar]   │
└─────────────────────────────────────────────────────────┘
```

### Mensajes (inbox simple)

```
┌─────────────────────────────────────────────────────────┐
│  Mensajes                                               │
│  [Todos] [WhatsApp] [SMS] [Push]                        │
├─────────────────────────────────────────────────────────┤
│  HOY                                                    │
│  💬 Juan Pérez · pedido #A4F2 · 2:32 PM                 │
│     "Gracias por tu pedido! Te confirmamos en breve."   │
│     ↓ Entregado · Leído                                 │
│                                                         │
│  💬 María Rodríguez · auto: cumpleaños · 9:00 AM        │
│     "🎉 Feliz cumpleaños! Ven hoy y te invitamos…"      │
│     ↓ Entregado                                         │
│                                                         │
│  [Ver historial completo]                               │
└─────────────────────────────────────────────────────────┘
```

### Mi sitio (storefront editor)

```
┌─────────────────────────────────────────────────────────────┐
│  Mi sitio              clubify.app/m/cafe-del-dia  [Copiar] │
├─────────────────────────────────────────────────────────────┤
│  BLOQUES                       │  PREVIEW (iPhone)          │
│  [+ Bloque]                    │  ┌──────────────────────┐  │
│                                │  │  [LOGO]              │  │
│  ◉ Hero                        │  │  Café del Día        │  │
│    [editar] [↕]                │  │                      │  │
│                                │  │  [WA] [IG] [📍]      │  │
│  ◉ Botones sociales            │  │                      │  │
│    [editar] [↕]                │  │  [Menú] [Card][Promo]│  │
│                                │  │                      │  │
│  ◉ Menú embed                  │  │  ...                 │  │
│    [editar] [↕]                │  │                      │  │
│                                │  └──────────────────────┘  │
│  ◉ Tarjetas embed              │                            │
│    [editar] [↕]                │  TEMA                       │
│                                │  Color principal [████]    │
│  + Promos / Galería /Mapa…     │  Tipografía Inter ▼        │
│                                │  Hero image [subir]        │
│                                │                            │
│                                │  [Publicar cambios]        │
└─────────────────────────────────────────────────────────────┘
```

### Métricas

```
┌─────────────────────────────────────────────────────────────┐
│  Métricas · Últimos 30 días                                 │
├─────────────────────────────────────────────────────────────┤
│  [Visitas menú]  [Pedidos]  [Conversión]  [Ticket prom]     │
│      1,247          287         23%        $34.500          │
│      +18%           +42%        +5pp       +$2.300          │
│                                                             │
│  ┌───────────────────────────────┐  ┌─────────────────────┐ │
│  │  Pedidos por día (gráfico)    │  │  Top productos      │ │
│  │                               │  │  1. Calentado paisa │ │
│  │  ▆▇▆▇▆▆█▆▇▇▇█▇▇▇█▆▇▇▆█▇▆▇▇    │  │     142 pedidos     │ │
│  │                               │  │  2. Capuchino  98   │ │
│  └───────────────────────────────┘  │  3. Pancakes   76   │ │
│                                     └─────────────────────┘ │
│  EMBUDO                                                     │
│  Visitas      ████████████████████████  1,247               │
│  Ven menú     ███████████████████        967  77%           │
│  Agregan      █████████                  402  32%           │
│  Finalizan    ███████                    287  23%           │
│  Confirmados  ██████                     261  21%           │
└─────────────────────────────────────────────────────────────┘
```
