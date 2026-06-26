# Handoff: Panel Super Admin (Plataforma White Label) + Sistema de Créditos

> **Nombre de la plataforma (Super Admin):** "Fidelia · Software de Fidelización" — es un **placeholder**, cámbialo por el nombre real de la plataforma. NO debe ser "Clubify": Clubify es una de las marcas blancas que vende el servicio.

## Overview
Este paquete contiene el diseño de alta fidelidad del **Panel SUPER ADMIN / MasterAdmin** (Nivel 1): el panel de control global desde el que un Super Administrador **crea y administra empresas / marcas blancas** (Nivel 2), su sistema de créditos, módulos, cobros e integraciones.

El objetivo del handoff es que **Claude Code recree estas pantallas dentro del código real existente**, reutilizando el stack, componentes y convenciones que ya existen en el proyecto (mismo router, misma capa de datos, mismo sistema de UI). El diseño está calcado de la identidad visual de los paneles actuales (sidebar verde, tarjetas blancas sobre gris claro, acentos verde/azul), por lo que debe encajar de forma natural.

---

## ⚠️ CRÍTICO — Leer antes de implementar

**1. Esto es un NIVEL SUPERIOR NUEVO (SUPER ADMIN).**
El MasterAdmin se sitúa **POR ENCIMA** de todo lo que ya existe. Es el panel del dueño de la plataforma, desde el que se **crean empresas/marcas blancas** — **Clubify es UNA de esas empresas**, no el tope de la jerarquía. Mañana pueden crearse otras empresas distintas a Clubify, y todas se gestionan desde aquí.

Jerarquía completa:
- **Nivel 1 — Super Admin / Plataforma** *(este diseño, p. ej. "Fidelia")*: el dueño del SaaS; crea y controla todas las empresas/marcas blancas. **Nunca se llama Clubify.**
- **Nivel 2 — Marca Blanca / Empresa** (p. ej. Clubify, y futuras): opera bajo su propia marca, vende sus planes, administra sus clientes.
- **Nivel 3 — Negocios / Subcuentas** (p. ej. "Wok Explosivo" dentro de Clubify): los clientes finales de cada marca blanca.

**2. NO se debe dañar ni modificar lo ya construido.**
La integración debe ser **estrictamente aditiva y aislada**:
- **Clubify ya está en producción y tiene varios negocios, clientes y tarjetas funcionando. NADA de su funcionamiento interno cambia.** El Super Admin NO modifica ni los datos ni las funcionalidades internas de Clubify (ni de ninguna otra marca existente). Solo gestiona a **nivel de marca** (crear, suspender/reactivar, asignar créditos, activar/desactivar módulos) y **lee/agrega** métricas. Las tarjetas de fidelización, negocios, clientes y paneles internos de cada marca se conservan tal cual.
- **No** alterar, refactorizar ni romper los paneles existentes de Nivel 2/3 (p. ej. el dashboard de cuenta tipo "Wok Explosivo"). Deben seguir funcionando exactamente igual.
- Crear el MasterAdmin como una **zona/área nueva** (nuevo conjunto de rutas + guard de rol `superadmin`, p. ej. `/superadmin/*`), con su propio acceso. No mezclar sus rutas, permisos ni datos con los de las empresas.
- Reutilizar componentes compartidos (tablas, botones, badges, layout con sidebar) **sin modificar su API** de forma que afecte a las pantallas actuales. Si necesitas extender un componente, hazlo de forma retrocompatible o crea una variante.
- **Aislamiento de datos:** una empresa/marca blanca **nunca** debe ver datos de otra (clientes, negocios, créditos, comisiones, configuraciones, admins, branding, integraciones). El Super Admin es el único que ve todo de forma agregada.
- Ante cualquier duda sobre tocar código existente, **preguntar primero** en vez de modificar.

## About the Design Files
Los archivos de este bundle son **referencias de diseño creadas en HTML** — un prototipo navegable que muestra el aspecto y comportamiento deseados, **no código de producción para copiar literalmente**.

- El archivo `MasterAdmin.dc.html` es un "Design Component": un único HTML con su lógica (clase JS) y plantilla. Usa estilos inline y un pequeño runtime propio del entorno de diseño.
- **NO** copies el HTML ni su runtime al proyecto. **Recrea** cada pantalla con la tecnología real del proyecto (p. ej. React + el sistema de componentes existente). Reutiliza los componentes que ya tengas (tablas, badges, botones, modales, drawers) antes de crear nuevos.
- Si una pantalla ya tiene un equivalente en el código (p. ej. el layout con sidebar de las cuentas existentes), **extiende ese patrón** en lugar de inventar uno nuevo.

## Fidelity
**Alta fidelidad (hifi).** Colores, tipografía, espaciados y estados son finales y deben respetarse al recrear la UI con las librerías del proyecto. Los datos mostrados (marcas, números, fechas) son de ejemplo: deben venir del backend real.

---

## Design Tokens

### Colores
| Token | Hex | Uso |
|---|---|---|
| `sidebar-grad` | `linear-gradient(176deg, #1a5c38 0%, #11442a 46%, #0a2c1a 100%)` | Fondo del sidebar |
| `green-500` (acento principal) | `#22c55e` | Ítem de nav activo, toggles ON, FAB |
| `green-600` | `#16a34a` | Etiquetas de stat, números primarios, links |
| `green-700` | `#15803d` | Texto sobre fondos verdes claros |
| `green-grad-btn` | `linear-gradient(180deg, #28c95f, #16a34a)` | Botones primarios |
| `green-50` | `#f0fdf4` | Fondos suaves (chips, hover de "Entrar") |
| `green-100` | `#dcfce7` | Fondo de badge "Activa" / "Sugerencia" |
| `green-200` | `#bbf7d0` | Bordes de tarjetas insight positivas |
| `blue-600` (acento secundario) | `#2563eb` | Métricas secundarias (créditos en red, comprometidos) |
| `blue-50` | `#eff6ff` / `#eff6ff` | Fondo de tarjeta "comprometidos" en drawer |
| `amber-warning` | `#b45309` (texto), `#f59e0b` (borde/acento), `#fef3c7` (fondo badge) | Alertas, créditos bajos, "en gracia" |
| `red-danger` | `#b91c1c` (texto), `#fee2e2` (fondo badge) | "Suspendida", "Pendiente" |
| `bg-app` | `#f4f5f7` | Fondo del área principal |
| `card-bg` | `#ffffff` | Fondo de tarjetas |
| `card-border` | `#e7e9ec` | Borde de tarjetas |
| `row-divider` | `#eef0f2` | Separadores de tabla |
| `row-hover` | `#f7fbf8` | Hover de fila de tabla |
| `table-head-bg` | `#fafbfc` | Cabecera de tabla |
| `text-primary` | `#16241c` | Títulos (verde muy oscuro) |
| `text-body` | `#2b3a30` | Texto de cuerpo |
| `text-muted` | `#6b7785` | Texto secundario |
| `text-faint` | `#9aa4af` | Labels, placeholders |
| `input-border` | `#d7dbe0` | Bordes de inputs y botones secundarios |

Colores de marca (avatares de cada Marca Blanca, ejemplo): `#16a34a`, `#2563eb`, `#7c3aed`, `#ea580c`, `#0891b2`, `#db2777`, `#ca8a04`.

### Tipografía
- **Familia:** `Figtree` (Google Fonts), pesos 400/500/600/700/800. Fallback `system-ui, sans-serif`. *(Si el proyecto ya usa otra sans neutra, usar la del proyecto y conservar pesos/tamaños.)*
- Título de página (H1): **26px / 800**, `letter-spacing: -.6px`, color `#16241c`.
- Subtítulo de página: 14px / 500, `#9aa4af`.
- Stat — número grande: **30px / 800**, `letter-spacing: -1px`.
- Stat — número pequeño (grids de 6): **24px / 800**.
- Stat — etiqueta: **11.5px / 700**, `letter-spacing: .5px`, UPPERCASE, color verde o azul.
- Título de tarjeta/sección interna: 15px / 700, `#18221d`.
- Encabezado de sección (gris): 12px / 700, `letter-spacing: .8px`, UPPERCASE, `#9aa4af`.
- Cabecera de tabla (th): 11px / 700, `letter-spacing: .5px`, UPPERCASE, `#9aa4af`.
- Celda de tabla (td): 13.5px, peso según columna (600 nombres/números, 500–600 secundarios).
- Nav item: 13.5px / 500 (activo 600).
- Encabezado de grupo de nav: 10.5px / 700, `letter-spacing: 1px`, UPPERCASE, `rgba(255,255,255,.4)`.

### Espaciado, radios y sombras
- Padding del área principal: `26px 32px 60px`. Ancho máximo del contenido: 1320–1500px según vista.
- Radio de tarjeta: **14px**. Radio de botón: 10px. Radio de input: 9px. Radio de badge: 7px. Radio de avatar cuadrado: 10–13px. Radio de píldora de nav activa: 10px.
- Gap entre stat cards: 16px. Gap en grid de 6 métricas: 14px.
- Sombra de tarjeta: `0 1px 2px rgba(16,24,40,.04)`.
- Sombra de botón primario: `0 2px 6px rgba(22,163,74,.35)`.
- Sombra de nav activo: `0 6px 14px rgba(34,197,94,.35)`.
- Sombra de drawer: `-12px 0 40px rgba(0,0,0,.14)`. Sombra de modal: `0 24px 70px rgba(0,0,0,.28)`.

---

## Layout general (shell)
- **Sidebar fijo** a la izquierda: ancho **250px**, alto 100vh, degradado verde, no hace scroll el shell completo; el `<nav>` interno sí scrollea. Estructura: cabecera de la PLATAFORMA (logo 40px + nombre del SaaS, p. ej. "Fidelia" / "Software de Fidelización · Super Admin" — NO "Clubify") / "MasterAdmin · Control Global") → grupos de navegación → pie con usuario y logout.
- **Main**: `flex: 1`, scroll vertical propio.
- **Drawer** y **modal**: overlays con `position: fixed`, animación de entrada (slide-in 0.22s `cubic-bezier(.2,.8,.2,1)` para drawer; fade 0.15s para overlay/modal).

### Navegación (grupos)
- **GENERAL:** Dashboard · Marcas Blancas (con badge contador)
- **OPERACIÓN:** Centro de Créditos · Centro de Cobros (badge "5") · Módulos
- **PLATAFORMA:** Integraciones · Historial · Configuración

Ítem activo: fondo `#22c55e`, texto blanco, peso 600, sombra verde. Hover de ítem inactivo: `background: rgba(255,255,255,.07)`.

---

## Screens / Views

### 1. Dashboard (global)
- **Propósito:** visión general de toda la plataforma.
- **Layout:** franja de 2 tarjetas insight (grid 1fr/1fr) → encabezado "Panel Super Admin / fecha" + botones (Historial, Crear Marca Blanca) → grid de 4 stat cards (RESUMEN DE LA PLATAFORMA) → grid de 6 stat cards pequeñas (CRÉDITOS Y RENOVACIONES) → grid 1.15fr/1fr con "Top marcas blancas · 30 días" (lista con barras de progreso verdes) y "Actividad reciente" (timeline con íconos coloreados).
- **Insight cards:** borde 1.5px (ámbar `#f5b545` para ALERTA, verde `#bbf7d0` para SUGERENCIA), ícono en cuadro redondeado, badge en píldora, título 15.5px/700, subtítulo, link verde "Ver … →".
- **Métricas (datos reales del backend):** nº de Marcas Blancas, negocios activos, créditos en red, facturación 30d; y créditos vendidos/consumidos/comprometidos, renovaciones 7d, en gracia, pendientes.

### 2. Marcas Blancas / Empresas (FASE 15)
- **Propósito:** listar y administrar todas las empresas/marcas blancas que revenden el servicio. **Clubify aparece aquí como una marca más** (p. ej. dominio `clubify.app`, con su negocio "Wok Explosivo" en Nivel 3).
- **Layout:** encabezado + botón "Crear Marca Blanca" → barra de búsqueda (input con ícono lupa) + filtros (Todas/Activas/Suspendidas) → tarjeta con tabla (scroll horizontal, min-width 1180px).
- **Columnas:** Marca (avatar con inicial en color de marca + nombre + dominio) · Estado (badge con punto) · Admins · Créditos disp. (ámbar si `disponibles < comprometidos`) · Comprometidos · Neg. activos · Neg. susp. · Creada · Acciones (botones "Entrar" y "Suspender/Activar").
- **Búsqueda:** filtra en vivo por nombre o dominio.
- Clic en la fila o en "Entrar" abre el **Drawer de detalle**.

### 3. Drawer de detalle de Marca Blanca
- Panel derecho 440px, slide-in. Cabecera (avatar + nombre + dominio + botón cerrar). Body: badge de estado + fecha de creación → bloque **Créditos** (3 tarjetas: Disponibles verde, Comprometidos azul, Usados gris) → **Branding** (dominio principal, dominio app, swatches de color) → **Módulos activos** (lista con estado Activo/Inactivo) → **Administradores** (lista con avatar de iniciales, email y rol). Footer: botones "Entrar como empresa" (primario), "Suspender/Activar", y editar.

### 4. Centro de Créditos (FASE 3 / 8)
- 4 stat cards (Disponibles, Comprometidos, Consumidos del mes, Pendientes). Subtítulo recordatorio: "1 crédito = 30 días de servicio · los créditos no vencen y son acumulativos".
- Grid 1.3fr/1fr: "Créditos por marca blanca" (barra por marca, ámbar si está bajo lo comprometido) y "Links de compra · Hotmart" (4 filas: 1/5/10/20 créditos con etiqueta, URL en monospace y precio; "pago único, sin recurrencia"). Botón "Editar links".

### 5. Módulos (FASE 2)
- Tabla matriz: filas = marcas blancas; columnas = Referidos, Pedidos, GrowBusiness SMS. Cada celda es un **toggle** (track 42×24, knob 20px; ON = verde `#22c55e` con knob a la derecha, OFF = gris `#cbd5e1` a la izquierda). Cambiar el toggle activa/desactiva el módulo para esa marca.

### 6. Centro de Cobros (FASE 6 / 9)
- 4 stat cards (Próximas renovaciones, Pendientes de renov., En gracia, Suspendidos). Tabla "Próximas renovaciones": Cliente/Negocio · Marca Blanca · Vencimiento · Créditos req. · Estado (badge: Por renovar verde / Pendiente rojo / En gracia ámbar).

### 7. Integraciones (FASE 13)
- Tarjeta de **GrowBusiness** (no es marca blanca, es integración global): ícono, nombre, badge "Conectado", descripción, campos API Key (oculta con "Mostrar") y Estado de conexión, botones "Probar conexión" y "Configurar".

### 8. Crear Marca Blanca (modal)
- Modal 520px centrado. Campos (FASE 1): Nombre comercial, Dominio principal, Dominio app, Color corporativo (swatches), Admin principal (email). Footer: Cancelar / Crear marca.

### 9. Historial y Configuración
- Placeholders. Pendientes de especificar contenido con el cliente.

---

## Interactions & Behavior
- **Navegación:** clic en ítem de sidebar cambia la vista activa (SPA, sin recargar). El ítem activo se resalta.
- **Búsqueda (Marcas Blancas):** filtrado en vivo por nombre/dominio (case-insensitive).
- **Suspender / Activar:** alterna el estado de la marca; actualiza el badge al instante y muestra un **toast** inferior centrado ("<Marca> suspendida/reactivada", auto-oculta ~2.4s). Las marcas **no se eliminan**, solo se suspenden/reactivan (regla del PRD).
- **Toggles de módulos:** alternan el módulo por marca; si un módulo está OFF no debe aparecer en la marca ni en sus negocios.
- **Drawer:** abre desde fila/"Entrar"; cierra con la X o clic en el overlay.
- **Modal Crear:** abre desde botones "Crear Marca Blanca"; cierra con X, Cancelar o clic en overlay (clic dentro NO cierra → `stopPropagation`).
- **Animaciones:** drawer slide-in 0.22s; overlay/modal fade 0.15s; toast slide-up 0.2s.

## State Management
Variables de estado en el prototipo (recrear con el manejo de estado del proyecto):
- `view`: vista activa (`dashboard | brands | credits | billing | modules | integrations | history | settings`).
- `query`: texto de búsqueda de marcas.
- `drawerId`: id de la marca abierta en el drawer (o null).
- `createOpen`: boolean del modal de creación.
- `toast`: mensaje de toast actual (o null), con timeout de ~2.4s.
- `brands[]`: colección principal (id, nombre, inicial, color, dominio, dominioApp, estado, nº admins, créditos disponibles, comprometidos, usados, negocios activos/suspendidos, fecha creación, módulos {ref, ped, sms}).
- Colecciones de apoyo: `renewals[]`, `hotmart[]` (links), `activity[]`.

**Reglas de negocio a respetar (del PRD):**
- 1 crédito = 30 días. Mensual 1 / Trimestral 3 / Semestral 6 / Anual 12.
- Créditos: no vencen, no se transfieren entre marcas, acumulativos, se descuentan automáticamente, devolución posible en cancelación autorizada.
- Sin créditos suficientes → negocio "Pendiente de Activación". Al vencer con créditos → renovación automática; sin créditos → 5 días de gracia + SMS; agotada la gracia → suspensión automática.
- **Aislamiento total entre marcas:** clientes, negocios, créditos, comisiones, configuraciones, admins, branding e integraciones nunca son visibles entre marcas blancas.

## Assets
- **Fuente:** Figtree (Google Fonts).
- **Iconos:** SVG inline tipo línea (stroke 2). Reemplazar por el set de iconos del proyecto si existe (Lucide/Heroicons/etc.).
- **Logos/favicons de marca:** placeholders (avatar con inicial sobre color). En producción vienen del branding de cada marca blanca.
- No se usan imágenes externas ni assets de marca propietarios.

## Files
- `MasterAdmin.dc.html` — prototipo completo (todas las vistas, lógica e interacciones). Es la referencia principal; ábrelo en un navegador para ver el comportamiento real.
- `screenshots/` — capturas de referencia de cada vista:
  - `01-dashboard.png` — Dashboard global (Super Admin)
  - `02-marcas-blancas.png` — Listado de marcas blancas / empresas (FASE 15)
  - `03-centro-creditos.png` — Centro de Créditos + Links Hotmart
  - `04-modulos.png` — Matriz de módulos por marca
  - `05-centro-cobros.png` — Renovaciones, gracia y suspendidos
  - `06-integraciones.png` — GrowBusiness
  - *(El drawer de detalle y el modal "Crear Marca Blanca" están descritos en la sección "Screens / Views"; verlos en vivo abriendo el `.html`.)*
