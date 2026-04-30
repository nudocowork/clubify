# MVP v2 y Roadmap — Clubify OS

## Filosofía del MVP

Cortar todo lo "nice to have" y entregar **el flujo completo de extremo a extremo**:

> Un negocio puede crear su menú, recibir un pedido por WhatsApp, sumarle un sello al cliente y ver la métrica del día.

Si ese flujo funciona, ya hay producto vendible. Todo lo demás (pagos, automation visual avanzada, multi-sucursal compleja) es upsell.

---

## MVP v2 — alcance

### Sprint 1 — Catálogo y Pedidos (4 semanas)

**Backend:**
- Módulo Catalog: CRUD `categories`, `products`, `variants`, `extras`
- Módulo Orders: CRUD `carts`, `orders`, `order_events`
- Endpoint público `GET /m/[slug]/menu` (sin auth, cacheado)
- Endpoint público `POST /api/public/orders` (anti-spam con captcha simple + rate limit)
- Generación del link `wa.me` con mensaje pre-llenado
- Subida de fotos de productos a S3/MinIO

**Frontend tenant:**
- Editor de menú: lista de categorías + drag-drop, drawer de producto con foto/precio/variantes/extras
- Pedidos: vista kanban en vivo (polling cada 5s o WebSocket si entra rápido)
- Acciones: confirmar, marcar listo, marcar entregado, cancelar
- Notificación sonora + browser push al recibir nuevo pedido

**Frontend cliente final:**
- Storefront `/m/[slug]` con tabs Menú/Tarjeta/Promos
- Modal de producto con variantes/extras/qty
- Carrito flotante (bottom sheet)
- Checkout (nombre, teléfono, fulfillment, notas)
- Página de orden `/o/[code]` con estado en vivo
- Redirect a wa.me al finalizar

**Demo de aceptación:** un dueño nuevo puede registrarse, crear 5 productos en 10 minutos, mostrarle su QR a un cliente, el cliente arma un pedido y se le abre WhatsApp con el mensaje listo para enviar.

---

### Sprint 2 — Loyalty integrada (3 semanas)

**Backend:**
- Match automático de `customer` por teléfono al crear orden
- Si el customer existe y tiene pase activo → al evento `order.confirmed` le suma 1 sello
- Si no existe → lo crea on-the-fly y opcionalmente le emite pase automáticamente
- Cron diario para recalcular `lastOrderAt`, `totalOrdersCount`
- Endpoint `GET /m/[slug]/my-card?phone=X` para que el cliente vea su tarjeta sin login

**Frontend:**
- Tab "Mi tarjeta" en storefront público (input de teléfono → muestra tarjeta + botón Wallet)
- Banner en `/o/[code]`: "🎉 Sumaste 1 sello"
- Wizard de onboarding (5 pasos): branding, WhatsApp, primer producto, primera tarjeta, imprimir QR
- Dashboard del dueño con KPIs reales: pedidos hoy, ingresos estimados, sellos sumados, top productos

**Demo de aceptación:** el cliente del demo anterior confirma su pedido y al volver al storefront ve "Llevas 1/10 sellos" + botón para guardar en Apple Wallet.

---

### Sprint 3 — Automatizaciones + Channels (3 semanas)

**Backend:**
- Módulo Channels (adapter pattern): `WhatsAppLinkAdapter` (genera wa.me), `WalletPushAdapter` (ya existe)
- Módulo Automations: tabla `automation_rules`, motor de evaluación en BullMQ worker
- Triggers MVP: `ORDER_CONFIRMED`, `INACTIVITY_7D`, `BIRTHDAY`, `PASS_COMPLETED`
- Acciones MVP: `SEND_WHATSAPP_LINK` (genera link y lo guarda como mensaje OUT pendiente, en MVP el dueño lo abre y manda manual), `ADD_STAMPS`, `WALLET_PUSH`
- Cron diario para evaluar inactividad y cumpleaños

**Frontend tenant:**
- `/app/automations`: lista con templates pre-armados
- Builder de 3 pasos (cuando / si / entonces) con dropdowns
- 5 "recetas" pre-armadas listas para activar con 1 click
- Histórico de ejecuciones en `automation_runs`

**Demo de aceptación:** el dueño activa la receta "Agradecer pedido". El cliente hace pedido, el dueño confirma. La regla genera automáticamente un mensaje de WhatsApp listo para enviar al cliente.

---

### Sprint 4 — Promociones + Mini-sitio (2 semanas)

**Backend:**
- Módulo Promotions: tipos `DISCOUNT_PCT`, `BUY_X_GET_Y`
- Aplicación automática en cart si cumple `conditions`
- `promotion_redemptions` registra cada uso

**Frontend:**
- `/app/promos` CRUD simple
- Storefront muestra promos activas en tab "Promos" + chips visibles en menú
- Editor de mini-sitio: bloques (hero, botones sociales, menú embed, tarjetas, promos)
- Color picker, tipografía, hero image, preview en iPhone frame

**Demo de aceptación:** el dueño crea promo "−20% en bebidas los lunes". Un cliente arma pedido un lunes y ve el descuento aplicado automáticamente en el carrito.

---

### Lo que NO está en MVP v2 (intencionalmente)

- ❌ Pagos online (todo va por WhatsApp)
- ❌ WhatsApp 2-way (Meta Cloud API requiere aprobación de plantillas)
- ❌ Multi-sucursal con inventario por sede
- ❌ App nativa
- ❌ Integración POS
- ❌ Dominio custom (sólo `clubify.app/m/[slug]`)
- ❌ Editor visual avanzado del storefront (Linktree-like es suficiente)
- ❌ Email marketing
- ❌ Reportes exportables a PDF
- ❌ Multiusuario complejo dentro del tenant (sólo OWNER + STAFF en MVP)

**MVP total: ~12 semanas de un equipo de 2 devs (1 full-stack + 1 frontend) + diseñador parcial.**

---

## Roadmap de evolución (post-MVP)

### Fase 1 — MVP Lanzamiento (mes 1-3)
Lo descrito arriba.
**Métrica de éxito:** 50 tenants pagando $29/mes en mes 6.

### Fase 2 — Pagos online + WhatsApp 2-way (mes 4-6)
- Stripe + Mercado Pago + PSE Colombia
- Pago al checkout (sin pasar por WhatsApp para confirmar)
- Comisión 2% sobre transacciones (revenue adicional)
- Meta Cloud API integrada
- Inbox bidireccional WhatsApp
- Aprobación de templates en Meta
- Bot básico (tomar pedido por chat con menú interactivo)

**Métrica de éxito:** 30% de pedidos pagados online, 200 tenants activos.

### Fase 3 — POS Lite + Operación (mes 7-9)
- Tablet del negocio toma pedidos en mesa (offline-first PWA)
- Sincroniza con online cuando hay conexión
- Comanda a cocina (impresión Bluetooth térmica)
- Caja simple: cuadre diario
- Roles: cajero, mesero, cocina

**Métrica de éxito:** 30% de tenants usando POS Lite, $50/mes upgrade.

### Fase 4 — App nativa cliente (mes 10-12)
- iOS + Android (React Native o Flutter)
- Pedidos sin pasar por wa.me
- Notificaciones nativas
- Wallet integrado
- Programa de referidos cliente-a-cliente
- Login con Google/Apple
- Pago guardado

**Métrica de éxito:** 20% de pedidos vienen de la app, NPS 40+.

### Fase 5 — CRM completo + Multi-sucursal (mes 13-18)
- Inventario por sucursal
- Reportes consolidados / por sede
- CRM completo: segments dinámicos, customer journeys multi-step
- Email marketing
- A/B testing de promos
- Dominio custom + SSL automático
- Integraciones POS terceros (Square, Toast, Loyverse)
- Public API + Webhooks
- Marketplace de plantillas / automatizaciones

**Métrica de éxito:** 1000 tenants activos, ARR $1M.

### Fase 6 — Internacional + Ecosistema (mes 19-24)
- Multi-idioma (es, en, pt)
- Multi-moneda
- Métodos de pago locales (Pix, Yappy, Nequi en cuenta interna)
- Programa de partners / agencias revendedoras
- App móvil del dueño (no solo web)
- Marketplace de productos (cross-tenant promos en zona geográfica)

---

## Pricing inicial sugerido

| Plan | Precio | Límites | Para quién |
|---|---|---|---|
| **Free** | $0 | 3 ubicaciones, 50 pedidos/mes, 100 sellos/mes, 0 automatizaciones, branding Clubify visible | Pruebas |
| **Pro** | $29/mes | 5 ubicaciones, 500 pedidos/mes, sin tope de sellos, 5 automatizaciones, sin branding | Café/restaurante chico |
| **Business** | $79/mes | 15 ubicaciones, pedidos ilimitados, automatizaciones ilimitadas, dominio custom | Cadena pequeña |
| **Enterprise** | $299+/mes | Todo + cuenta dedicada, SLA, integración POS | Cadenas medianas |

**Add-ons:**
- WhatsApp Cloud API: $0.05 por mensaje saliente OUT marketing (Free: 1000/mes)
- Pagos online: 2% sobre transacciones procesadas
- SMS: $0.04 por mensaje
- Custom domain: $5/mes incluido en Business

---

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| **Meta rechaza templates de WhatsApp** | MVP usa wa.me link (no requiere aprobación). Migración a Meta Cloud API es gradual, con templates probados. |
| **El dueño no entiende la diferencia con Cluvi** | Demo de 90s en landing mostrando los 3 pilares + comparativa visual con competencia. |
| **Cliente final no confía en checkout sin pago** | Mostrar logo + verificación del negocio. En fase 2, agregar pago online opcional para los que sí confían. |
| **Apple Wallet certificate expira** | Cron + Sentry alerta a 30 días de expiración. Auto-renew si Apple lo permite. |
| **Volumen de mensajes WhatsApp dispara costos** | Límites por plan + alertas al dueño. Throttle automático cuando se acerca al límite. |
| **Adopción lenta de fidelización** | Onboarding obliga a crear primera tarjeta. Auto-emisión de pase al primer pedido (configurable). |
| **Competencia (Boomerangme, Cluvi) lanzan funciones similares** | Velocidad de iteración + foco geográfico LATAM + integración profunda entre módulos como diferenciador. |

---

## Métricas de salud del producto

### Por tenant (mostrar al dueño)
- Pedidos esta semana / semana pasada
- Ingresos estimados
- Clientes nuevos vs recurrentes
- Top 5 productos
- Tarjetas activas / pases en Wallet
- Tasa de conversión menú → pedido

### Globales (Super Admin)
- Tenants activos (login + ≥1 pedido en últimos 30d)
- GMV procesado
- Mensajes enviados
- Churn mensual
- NPS dueño
- LTV vs CAC
- Tiempo de activación (desde signup hasta primer pedido confirmado)
