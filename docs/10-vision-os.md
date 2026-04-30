# Clubify v2 — Vision: el SO del negocio local

## Tagline

> **Una sola herramienta para vender, fidelizar y automatizar tu negocio local.**

## Posicionamiento

Clubify deja de ser "una herramienta de tarjetas de fidelización" y pasa a ser **el sistema operativo del negocio local**: un único panel donde un restaurante, cafetería, bar, tienda o cowork puede **atraer clientes, vender y retenerlos** sin pegar 6 herramientas distintas.

### Quién es nuestro cliente
- Restaurantes, cafeterías, bares, panaderías, food trucks
- Tiendas de barrio, fruterías, licoreras
- Salones de belleza, barberías, spas
- Coworks, gimnasios pequeños
- En general: negocios físicos con < 10 empleados, dueño operativo, no tienen IT

### Qué problema resolvemos
Hoy el dueño usa:
- Canva o Cluvi para el menú digital
- Google Forms o Wix para pedidos
- Excel o cuaderno para registrar clientes
- Una libreta de sellos físicos
- WhatsApp manual para promociones
- Instagram para anunciar
- Mailchimp si es ambicioso

**Cinco cuentas, cinco contraseñas, ningún dato conectado.** Cuando un cliente pide, no sabe si ya pidió antes. Cuando lanza una promo, no sabe a quién mandársela. La tarjeta de sellos se le perdió al cliente.

Clubify une eso en un panel.

## Principios de producto

1. **Mobile-first del dueño.** El dueño opera el negocio desde el celular detrás del mostrador, no desde una laptop en oficina.
2. **Setup en 10 minutos.** Wizard guiado de 5 pasos. Si el dueño se demora más, perdimos.
3. **WhatsApp como canal principal**, no email. En LATAM el cliente no abre email, abre WhatsApp.
4. **El cliente final no descarga app.** Todo es link/QR/Wallet. La fricción de instalar app mata la conversión.
5. **Pedidos a WhatsApp en MVP, pago online después.** Empezar con el comportamiento que el dueño ya tiene (recibe pedidos por WhatsApp). Solo después le quitamos el WhatsApp del flujo cuando tenga pago integrado.
6. **Cada cliente es UNO.** Un cliente que escanea el menú, pide, y luego suma sellos es la misma persona en la base de datos. Ese hilo es el activo más valioso.
7. **Pricing por uso, no por features.** Plan Free generoso. Pro se cobra cuando el negocio realmente vende (pedidos confirmados, mensajes WhatsApp enviados).

## Diferenciación vs. los demás

| Competidor | Qué hace | Por qué Clubify gana |
|---|---|---|
| **GoHighLevel** | CRM + automation completo | Demasiado complejo, no piensa en negocios físicos, sin Wallet ni menú |
| **Boomerangme** | Tarjetas digitales | Sólo fidelización, sin menú ni pedidos |
| **Cluvi / Mio Salto** | Menú digital + pedidos a WhatsApp | Sólo pedidos, sin fidelización ni automatización |
| **Square / Toast** | POS completo | Requiere hardware, caro, sólo USA |
| **Linktree** | Bio link | No procesa pedidos ni guarda clientes |

**Clubify = (Cluvi + Boomerangme + Linktree + Mailchimp) ÷ 5x más simple.**

## Tres pilares del producto

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          CLUBIFY OS                                      │
│                                                                          │
│   ┌──────────────┐      ┌──────────────┐      ┌──────────────┐           │
│   │   VENDER     │      │  FIDELIZAR   │      │ AUTOMATIZAR  │           │
│   │              │      │              │      │              │           │
│   │ Menú digital │      │ Tarjetas     │      │ Reglas IF→   │           │
│   │ Pedidos      │      │ Sellos/Pts   │      │ WhatsApp/SMS │           │
│   │ Promos       │      │ Wallet       │      │ Recordatorios│           │
│   │ QR           │      │ Geo push     │      │ Triggers     │           │
│   └──────┬───────┘      └──────┬───────┘      └──────┬───────┘           │
│          │                     │                     │                   │
│          └─────────────────────┼─────────────────────┘                   │
│                                ▼                                         │
│                  ┌────────────────────────────┐                          │
│                  │   CUSTOMER (mismo cliente  │                          │
│                  │   en los 3 pilares)        │                          │
│                  └────────────────────────────┘                          │
└──────────────────────────────────────────────────────────────────────────┘
```

El **customer** es la entidad puente. Todo lo que hace queda registrado y dispara automatizaciones.

## Modelo mental para el dueño

> "Pongo un QR en la mesa. El cliente escanea, ve mi menú, pide. El pedido me llega a WhatsApp. El cliente recibe automáticamente su tarjeta de sellos en el iPhone. La próxima vez que venga, ya sé quién es y qué le gusta. Si no vuelve en 2 semanas, le mando una promo automática."

Eso es Clubify. Punto.

## Métricas de éxito (North Star)

- **GMV procesado** (pedidos × valor)
- **Tasa de retención de clientes finales** del negocio (clientes que vuelven a pedir o sumar sello en 30 días)
- **Activación de tenants** (% de tenants que en su primer mes hacen ≥10 pedidos + ≥10 sellos)

No medimos "logins" ni "tarjetas creadas". Medimos **dinero real que el negocio mueve gracias a Clubify**.
