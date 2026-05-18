# Clubify — Guía rápida

## ¿Qué es Clubify?

Clubify es el sistema operativo de tu negocio local. En un solo lugar:

- **Fidelización** con tarjetas wallet (Apple/Google Wallet) tipo sellos o cashback
- **Menú digital** público con QR (sirve para mostrar productos y para tomar pedidos)
- **Pedidos por WhatsApp** — el cliente arma su pedido en el menú, lo envía a tu WhatsApp y vos lo gestionás
- **CRM y analítica** — base de clientes, scanner para staff, automatizaciones de mensajes
- **Marketing** — carteles QR, programa de referidos, promociones

## Plan y precio

- **Elite** — $50 USD/mes
- Incluye TODO el sistema: tarjetas ilimitadas, menú, pedidos, automatizaciones por WhatsApp, CRM, analytics
- Sin trial. Pagás al activar la cuenta vía Hotmart
- Podés cancelar cuando quieras desde tu panel

## Cómo arrancar (primeros pasos)

1. **Registrate y pagá** desde [soyclubify.com](https://soyclubify.com)
2. Apenas pagás, te llegan credenciales por email
3. Entrá al panel y completá el onboarding (5 minutos):
   - Datos del negocio (nombre, dirección, logo, color de marca)
   - Categoría (cafetería, restaurante, retail, etc.)
   - Foto de portada y descripción
4. Creá tu primer producto en `/app/menu` para que el menú público funcione
5. Creá tu primera tarjeta de fidelización en `/app/cards`
6. Pegá el QR del menú o de la tarjeta en tu local

## Tarjetas de fidelización

### Tipos disponibles

- **STAMPS (sellos)** — el cliente acumula sellos por cada compra hasta llegar al premio. Ej: 10 sellos = 1 café gratis
- **COUPON (cupón)** — un beneficio único de bienvenida (descuento, regalo, etc.). Cuando el cliente lo canjea, automáticamente se le crea su tarjeta de sellos

### Cómo funciona el scanner

Tu staff abre `/scan` desde su celular (PWA, se instala como app):
1. Escanea el QR del cliente (Apple Wallet o Google Wallet)
2. Marca el sello / valida la compra
3. Si el cliente completó la tarjeta, le aparece el premio para canjear

Hay PIN multi-stamp si querés sumar varios sellos de una compra grande.

### Anti-abuso

- 1 sello máximo por día por cliente (configurable)
- Monto mínimo de compra por sello (configurable)
- Login del scanner expira a las 6 horas

## Menú digital y pedidos

### Layouts del menú

Hay 8 layouts visuales para el menú. Los más usados:
- **CLASSIC** — listado tradicional con categorías
- **SECTIONS** — secciones premium con banners e imágenes destacadas
- **CARRUSELES** — productos en sliders por categoría
- **CLEAN** / **COMPACT** — para menús con muchos productos

Lo cambiás desde `/app/storefront`.

### Pedidos por WhatsApp

Si activás "Pedidos delivery" en `/app/storefront`:
1. El cliente abre tu menú público (`tunegocio.soyclubify.com` o `/m/[slug]`)
2. Arma su carrito
3. Toca "Enviar pedido" → se abre WhatsApp con el detalle preformateado
4. Vos recibís el mensaje y confirmás

Para vista mesa (con `?mesa=N`) el menú siempre es informativo (no abre WhatsApp), por diseño.

### Idiomas

El menú se traduce automáticamente al inglés y portugués cuando un cliente extranjero abre el link con `?locale=en` o `?locale=pt`. Las traducciones se hacen con Claude Haiku + cache, así no se cobra de nuevo por el mismo texto. Podés revisar y editar traducciones en `/app/translations`.

## Wallet (Apple + Google)

Cada cliente que enrolla recibe un pase wallet con:
- Tu logo y colores de marca
- Foto hero (banner principal de la tarjeta)
- Sus sellos / saldo actualizado en tiempo real
- QR para escanear al pagar
- Push notification cuando se le suman sellos o gana premio

Apple Wallet y Google Wallet funcionan independiente — el cliente elige. Ambos se actualizan al instante cuando el staff escanea.

## Marketing

### Carteles QR

En `/app/marketing` podés diseñar carteles QR personalizados:
- 4 tipos: tarjeta fidelización, menú, pedidos, info link
- 12 templates de diseño
- Editor visual (mover textos, logos, formas)
- Export PDF 300 DPI listo para imprimir

### Programa de referidos para tus clientes

Tu negocio puede tener su propio programa de "cliente trae cliente":
- Un cliente recomienda otro → ambos ganan beneficio (descuento, sello extra, etc.)
- Configurás recompensas y reglas desde el panel
- Cada cliente recibe un link único para compartir
- Vos ves quién trajo a quién en analytics

## Automatizaciones

Mensajes automáticos por WhatsApp:
- **Bienvenida** cuando un cliente enrolla
- **Cumpleaños** — saludo + premio especial
- **Inactividad** — si un cliente no vuelve en 30 días
- **Tarjeta lista** cuando completa todos los sellos

Se configuran en `/app/automations` con plantillas pre-armadas.

## Preguntas frecuentes

### ¿Necesito un punto de venta especial?
No. El scanner corre en cualquier celular del staff (Android o iPhone) vía PWA.

### ¿Funciona offline?
El scanner funciona si tenés internet aunque sea débil. Para offline total no — necesita verificar el QR contra el servidor.

### ¿Qué pasa si cancelo?
Tu cuenta queda inactiva pero los datos no se borran. Si reactivás dentro de 90 días retomás todo. Después de 90 días se borran datos sensibles.

### ¿Puedo migrar de otra plataforma?
Sí, podés importar clientes (CSV) y productos (CSV o configuración manual). Te ayudamos desde soporte.

### ¿Tienen integración con [X]?
- Hotmart (billing) — sí, nativo
- WhatsApp Business — usamos enlaces directos (no API oficial)
- Stripe / PayU / MercadoPago — vía Hotmart
- Google Maps — sí, para mostrar ubicación
- Instagram — sí, link directo desde el menú

### ¿Cómo recibo soporte?
Por este widget IA (lo más rápido), por email a hola@soyclubify.com, o WhatsApp desde el panel.
