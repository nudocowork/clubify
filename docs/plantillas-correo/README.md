# Plantillas de correo (Email Marketing de la marca)

Las plantillas de la pestaña **Plantillas** del Email Marketing. No confundir
con los correos del ciclo de vida de la suscripción, que son texto plano dentro
del marco de marca y viven en `backend/src/email/brand-email-templates.ts`.

## Dónde vive cada cosa

| Qué | Dónde |
| --- | --- |
| Motor: tipos de bloque, tokens y render a HTML | `frontend/src/lib/email-blocks.ts` |
| Editor visual (lienzo + inspector) | `frontend/src/components/marketing/EmailTemplateEditor.tsx` |
| Galería, miniaturas y previsualización | `frontend/src/components/marketing/EmailTemplatesPanel.tsx` |
| Definición de las plantillas de fábrica | `backend/scripts/lib/email-presets.cjs` |
| Seed que las escribe en la base | `backend/scripts/seed-email-templates.cjs` |
| Hoja de previsualización | `backend/scripts/preview-email-templates.cjs` → `preview.html` |
| Reglas del HTML, en tests | `backend/test/email-render.test.ts` |

## La regla que explica todo lo demás

**`renderEmailHtml()` es la única fuente del HTML de una plantilla.** El editor
regenera el campo `html` desde los bloques **en cada guardado**. Cualquier HTML
escrito a mano en otro sitio sobrevive hasta que alguien abre la plantilla y la
guarda; entonces desaparece sin avisar.

Por eso el seed de las plantillas de fábrica compone bloques y renderiza con el
mismo motor en vez de maquetar aparte. Lo que se previsualiza, lo que se edita y
lo que se envía son el mismo HTML.

## Añadir una plantilla de fábrica

Se edita `backend/scripts/lib/email-presets.cjs` y se añade una entrada al array
`TEMPLATES`:

```js
{
  name: 'Recordatorio de pago',           // clave lógica: no la cambies luego
  subject: 'Tu pago está por vencer',
  doc: doc('Un aviso amable antes de que se te pase la fecha de pago.', [
    row([100], [[b('logo')]], { paddingV: 24 }),

    // Banda de color: el fondo va en la FILA, y los textos de dentro en blanco.
    banda([[
      b('heading', {
        kicker: 'Recordatorio',
        title: 'Tu pago está por vencer',
        level: 'h1',
        align: 'center',
        color: '#ffffff',
        kickerColor: '#ffffff',
      }),
    ]]),

    row([100], [[
      b('order', {
        title: 'Lo que está pendiente',
        items: [{ name: 'Mensualidad', qty: '1', price: '' }],
        totals: [{ label: 'Total', value: '', strong: true }],
      }),
      b('button', { label: 'Pagar ahora' }),
    ]]),

    row([100], [[b('divider'), redes(), pie()]]),
  ]),
}
```

Después:

```bash
cd backend
node scripts/seed-email-templates.cjs --dry     # verifica, no toca la base
node scripts/preview-email-templates.cjs        # regenera preview.html
npx vitest run src/marketing test/email-render.test.ts   # reglas del HTML
```

Y para escribirla de verdad (**esto sí toca producción**):

```bash
railway run node scripts/seed-email-templates.cjs
```

El seed es idempotente por `(isPreset, name)`: si ya existe la actualiza, si no
la crea. Correrlo dos veces no duplica nada. Y **verifica antes de escribir**: si
una sola plantilla falla, no se escribe ninguna.

### Lo que comprueba la verificación

- Ni un `data:image` en bloques ni en HTML.
- Preheader de 40 a 90 caracteres.
- Texto alternativo en todo bloque de imagen o producto.
- Al menos 5 tipos de bloque distintos por plantilla.
- El pie explica cómo darse de baja.
- Nada de flexbox, grid ni `position`.
- El fallback de texto plano dice algo.

## Los bloques

Se componen con `b(tipo, props)` dentro de columnas, y las columnas dentro de
`row(anchos, columnas, propsDeFila)`.

| Bloque | Para qué | Props que se usan más |
| --- | --- | --- |
| `heading` | Título con antetítulo y bajada | `kicker`, `title`, `subtitle`, `level` (`h1`\|`h2`), `align`, `color`, `kickerColor` |
| `text` | Párrafo (acepta HTML sencillo) | `html`, `align`, `fontSize`, `color` |
| `image` | Imagen o hero | `url`, `alt`, `width`, `radius`, `href` |
| `logo` | Logotipo de la marca | `url`, `alt`, `width` |
| `button` | Llamada a la acción | `label`, `href`, `background`, `radius` |
| `buttons` | CTA doble (el 2.º con contorno) | `label`, `href`, `label2`, `href2` |
| `feature` | Icono + título + texto | `icon`, `title`, `text`, `layout` (`row`\|`stacked`) |
| `product` | Tarjeta de producto | `url`, `alt`, `title`, `description`, `price`, `oldPrice`, `label`, `href` |
| `order` | Resumen de pedido | `title`, `items[]`, `totals[]`, `note` |
| `quote` | Testimonio con estrellas | `text`, `author`, `role`, `stars` |
| `rating` | Estrellas sueltas | `stars`, `label`, `size` |
| `coupon` | Código de descuento | `code`, `label`, `note` |
| `divider` `spacer` | Ritmo vertical | `color`/`thickness` · `height` |
| `social` | Redes | `networks[]` (las que no tienen URL no salen) |
| `footer` | Pie legal | `html`, `address`, `unsubscribeUrl` |
| `html` | Escotilla de escape | `html` |

**Filas** (`row(anchos, columnas, props)`): `background`, `paddingV`,
`paddingH`. Anchos disponibles: `[100]`, `[50,50]`, `[33.33,33.34,33.33]`,
`[33.33,66.67]`, `[66.67,33.33]`. En móvil las columnas se apilan solas.

## Tokens

Todo el color y el ritmo salen de `EMAIL_TOKENS` en `email-blocks.ts`. El
**acento** es el único color que cambia por marca: vive en
`settings.linkColor`, lo heredan botones, antetítulos, iconos y cupones, y se
cambia de una vez desde **Ajustes → Color de acento** en el editor.

Las de fábrica usan un índigo neutro a propósito: se listan para **todas** las
marcas, así que no pueden parecerse a ninguna en concreto. Cada negocio recolorea
su copia.

## Imágenes: nunca en la base

Los huecos de imagen de las plantillas de fábrica van con `url` **vacía**. El
render omite la imagen si no hay URL, así que el correo no sale con un roto: sale
sin ese bloque, y cada negocio sube la suya con `POST /api/media/upload`.

No es una manía: la tabla `QrPoster` llegó a pesar el 77 % de la base entera por
incrustar imágenes en base64 dentro de un JSON. El backend rechaza con 400
cualquier guardado con `data:image`, y el editor avisa antes de intentarlo.

## Variables

La sintaxis es `{{campo}}`, con los campos en español:
`{{nombre}}`, `{{email}}`, `{{telefono}}`, `{{empresa}}`, `{{marca}}`.

Se sustituyen al enviar, por contacto, en el **asunto y en el cuerpo**. Un token
sin valor queda vacío — nunca se queda el `{{…}}` a la vista, y `{{marca}}` que
no se puede resolver queda vacío en vez de decir «Clubify», que en una marca
blanca sería una fuga.

Las plantillas de fábrica **no llevan variables**: son puntos de partida para
cualquier negocio y un `{{nombre}}` sin contacto detrás no aporta nada. Añádelas
en tu copia.
