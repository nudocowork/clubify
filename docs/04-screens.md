# Pantallas principales — Clubify

Diseño: limpio, premium, paleta verde Clubify (`#0F3D2E` principal, `#2E7D5B` secundario, `#F5F1E8` fondo crema, `#1B1B1B` texto). Tipografía sans (Inter) + display (Fraunces para titulares).

## Públicas

### `/` — Landing
Hero con valor + tipos de tarjeta + CTA "Solicitar acceso". Footer con `/refer`.

### `/login`
Email + password. Detecta rol y redirige.

### `/refer`
Form de solicitud de código de referido (nombre, whatsapp, email). Devuelve código + link copiable.

### `/w/[passId]` — Wallet público
- Preview de la tarjeta con colores del tenant.
- Estado actual (sellos / puntos / recompensa).
- Botones grandes "Add to Apple Wallet" / "Save to Google Wallet".
- En desktop: QR para abrir en móvil.

### `/signup/[tenantSlug]`
Form para que el cliente final se registre y reciba su pase. Branded con colores del tenant.

## Super Admin (`/admin/*`)

### `/admin` — Dashboard
- KPIs: tenants activos, MRR, pases emitidos globales, comisiones pendientes.
- Gráfica de altas por mes.
- Tabla "Tenants recientes".

### `/admin/tenants`
Tabla con filtros (status, plan, búsqueda). Acciones: ver, editar, suspender, ampliar ubicaciones, login-as.

### `/admin/tenants/new` & `/admin/tenants/[id]`
Form: brandName, email, phone, logo, plan, primaryColor, secondaryColor, maxLocationsOverride, status.

### `/admin/plans`
CRUD de planes (límites, precios).

### `/admin/referrals`
Tabla `referral_codes`, drill-down a usos y comisiones. Botón "Marcar pagada".

### `/admin/settings`
Branding global, configuración Apple Pass Type / Google Issuer ID, SMTP, S3.

## Tenant (`/app/*`)

### `/app` — Dashboard
- KPIs: tarjetas activas, clientes, pases instalados, sellos del mes, redenciones.
- Gráfica de actividad últimos 30 días.
- Lista "Últimos escaneos".

### `/app/cards`
Grid de tarjetas con preview visual. Botón "Crear tarjeta".

### `/app/cards/new` y `/app/cards/[id]`
Constructor con preview en tiempo real lado a lado:
- Tab **Tipo** (sellos, puntos, descuento, membresía, cupón, regalo, múltiple).
- Tab **Diseño** (logo, colores, hero, icon).
- Tab **Contenido** (nombre, descripción, condiciones, recompensa).
- Tab **Reglas** (sellos requeridos, validez, multi-ubicación).
- Tab **Compartir** (link público, QR, embeber botón en sitio web).

### `/app/customers`
Tabla con búsqueda y filtros (con/sin pase, activos últimos 30d). Drill-down a `/app/customers/[id]` con historial.

### `/app/customers/[id]`
Datos personales, lista de pases activos, historial de stamps, botón "Emitir pase" y "Enviar push individual".

### `/app/locations`
Mapa + lista de ubicaciones (max 3 o el override). Form con autocompletar (Mapbox/Google) + radio.

### `/app/notifications`
Composer con preview Apple/Google. Selector de tarjeta o segmento. Historial con stats.

### `/app/automations`
Lista de reglas + builder (evento → condición → acción).

### `/app/referrals`
Resumen de comisiones generadas como tenant referente.

### `/app/settings`
Branding, dominio personalizado (futuro), staff (invitar TENANT_STAFF).

## Scanner (`/scan`)

PWA instalable. Login del staff. Vista cámara fullscreen + overlay con caja del QR. Tras leer:
- Card del cliente con foto/iniciales, nombre, balance.
- Botones grandes: `+1`, `+5`, `Redimir`, `Historial`.
- Confirmación visual con haptic feedback.

## Wallet (Apple/Google)

El pase mismo es una "pantalla":
- Front: logo, nombre tarjeta, sellos visuales (10 círculos rellenos), recompensa.
- Back: condiciones, contacto, redes, ubicaciones.
- QR del cliente.
