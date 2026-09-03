# Ficha de App Store — Clubify

Borrador para revisión. Los límites de caracteres son los de Apple; el número
entre paréntesis es lo que ocupa el texto propuesto.

---

## Identidad

| Campo | Valor |
|---|---|
| Nombre (30) | **Clubify** (7) |
| Subtítulo (30) | **Fideliza clientes y vende más** (30) |
| Bundle ID | `com.soyclubify.app` |
| Categoría primaria | Negocios |
| Categoría secundaria | Productividad |
| Idioma principal | Español (México) — cubre LATAM |
| Clasificación | 4+ |

## Texto promocional (170)

> Escanea la tarjeta de tus clientes, recibe los pedidos al instante y llévate
> el negocio en el bolsillo. Ahora también desde tu iPhone.

*(Se puede cambiar sin volver a pasar por revisión — úsalo para promociones.)*

## Descripción

> **Clubify es el sistema operativo de tu negocio local.**
>
> Tarjetas de fidelización en el celular de tus clientes, pedidos por WhatsApp,
> reservas, catálogo digital y toda tu operación en un solo lugar. Ya lo usan
> restaurantes, cafeterías, barberías y gimnasios en toda Latinoamérica.
>
> **Escáner integrado**
> Registra sellos, visitas y compras apuntando la cámara al pase del cliente.
> Lee tanto los códigos de Apple Wallet como los QR de la tarjeta digital, y
> funciona con poca luz gracias al lector nativo del iPhone.
>
> **Pedidos en tiempo real**
> Recibe una notificación en cuanto entra un pedido. Confírmalo, márcalo listo
> o pásalo a domicilio sin salir de la app.
>
> **Tus clientes, siempre a mano**
> Consulta el historial de compras, los cumpleaños de la semana y quiénes
> llevan tiempo sin volver. La información que necesitas para que regresen.
>
> **Fidelización que sí se usa**
> Tarjetas de sellos, puntos, cupones y membresías que viven en Apple Wallet.
> Sin plásticos, sin apps que tus clientes tengan que instalar.
>
> **Varios negocios, una sola cuenta**
> Si administras más de un local o trabajas con varias marcas, la app te
> muestra al entrar solo lo que te corresponde según tu cuenta.
>
> ---
>
> Clubify es una herramienta para negocios que ya tienen una cuenta activa. La
> contratación del servicio se gestiona desde el panel web.
>
> Soporte: soyclubify.com

## Palabras clave (100)

```
fidelizacion,sellos,wallet,pedidos,restaurante,cafeteria,negocio,clientes,QR,puntos,delivery,pymes
```
(99 caracteres. Sin espacios tras las comas — Apple los cuenta.)

## URLs

| Campo | Valor |
|---|---|
| Soporte | https://soyclubify.com |
| Marketing | https://soyclubify.com |
| Privacidad | https://soyclubify.com/legal |

---

## Notas para el revisor de Apple

Esto va en el campo *App Review Information → Notes*. **Es lo que evita el
rechazo por 3.1.1**: hay que decir explícitamente que no se vende nada dentro
de la app.

> Clubify is a business management tool (B2B) for local businesses in Latin
> America — restaurants, cafés, barber shops, gyms. Users are business owners
> and their staff, who manage their own customers, orders and loyalty cards.
>
> **The app is for existing account holders only.** No digital goods or
> subscriptions are sold or unlocked inside the app: sign-up and billing are
> handled entirely on the web dashboard and are not reachable from the app.
> Payments visible inside the app relate to physical goods and in-person
> services sold by the business to its own customers (food orders, table
> reservations), which are outside the scope of in-app purchase.
>
> **Demo account:**
> user: clubifydemo@gmail.com
> password: AppleReview2026!
>
> The demo account belongs to a sample business with realistic (anonymized)
> data: customers, orders and loyalty cards.
>
> **Testing the scanner:** the Scanner module needs a loyalty pass barcode to
> read. A sample QR code is attached in the review attachments; opening it on
> another screen and pointing the camera at it will register a stamp.
>
> Camera access is used only to scan customer loyalty passes at the counter.
> Push notifications are used to alert the business of new orders.

---

## Pendientes antes de enviar

- [ ] Capturas 6.9" (iPhone 16 Pro Max) — **con la cuenta demo**, no con
      cuentas reales: las primeras que se tomaron mostraban clientes reales de
      Nudo Cowork con teléfonos y correos.
- [ ] Adjuntar al revisor un QR de un pase de prueba, para que pueda usar el
      escáner. Sin eso no puede probar la función que justifica la app.
- [ ] Icono 1024×1024 — ya generado en `mobile/resources/icon.png`.
- [ ] Declaración de privacidad (App Privacy) en App Store Connect:
      - Datos de contacto (correo) — vinculados a la identidad, para la cuenta
      - Identificadores (token de dispositivo) — para notificaciones
      - Uso de la cámara — no se almacena nada, solo lectura de códigos
- [ ] Subir a TestFlight y probar la build firmada de producción: el
      entitlement pasa de `development` a `production` y los tokens de push
      cambian de entorno.
