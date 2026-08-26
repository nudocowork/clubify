/**
 * Definición de las PLANTILLAS DE FÁBRICA del editor de correos y su
 * verificación. Sin base de datos: solo compone documentos de bloques y los
 * renderiza, para que lo usen tanto el seed (escribe en la base) como el
 * generador de la hoja de previsualización (escribe un HTML).
 *
 * REGLA DURA 1 — ninguna imagen incrustada. Solo URLs; los huecos de imagen
 * van con url vacía para que cada negocio suba la suya por
 * `POST /api/media/upload`.
 *
 * REGLA DURA 2 — el HTML se RENDERIZA con el mismo motor que usa el editor
 * (frontend/src/lib/email-blocks.ts), nunca se maqueta a mano aquí. Antes se
 * escribían las dos versiones por separado y divergían: el editor regenera
 * `html` desde los bloques en cada guardado, así que la versión maquetada a
 * mano desaparecía en cuanto alguien abría la copia y la guardaba. Con un solo
 * motor, lo que se previsualiza, lo que se edita y lo que se envía coinciden.
 *
 * Para añadir una plantilla nueva: docs/plantillas-correo/README.md
 */
// El motor vive en el frontend (es quien manda: el editor regenera el HTML con
// él). `skipProject` evita cargar el tsconfig del backend, que no cubre ese
// archivo; `transpileOnly` porque aquí no se comprueban tipos, solo se ejecuta.
require('ts-node').register({
  transpileOnly: true,
  skipProject: true,
  compilerOptions: { module: 'commonjs', target: 'es2020', moduleResolution: 'node' },
});
const path = require('node:path');
const {
  EMAIL_TOKENS: T,
  emptyDoc,
  newBlock,
  newRow,
  renderEmailHtml,
  renderEmailText,
} = require(path.resolve(__dirname, '../../../frontend/src/lib/email-blocks.ts'));


// ── Atajos de composición ───────────────────────────────────────────────────
const b = newBlock;
const row = (widths, cols, props) => newRow(widths, cols, props);
/** Fila con fondo de acento: los textos que van dentro se ponen en blanco. */
const banda = (cols, extra = {}) =>
  newRow([100], cols, { background: T.color.acento, paddingV: 36, ...extra });
const bandaSuave = (cols, extra = {}) =>
  newRow([100], cols, { background: T.color.acentoSuave, paddingV: 28, ...extra });
const BLANCO = '#ffffff';

/** Pie común: la baja por respuesta es el opt-out que sí existe hoy. */
const pie = () =>
  b('footer', {
    html:
      'Recibiste este correo porque estás en nuestra lista de contactos.<br>' +
      'Si ya no deseas recibir estos mensajes, responde con la palabra BAJA.',
  });

const redes = () => b('social');

function doc(preheader, rows) {
  const d = emptyDoc();
  d.settings.preheader = preheader;
  d.rows = rows;
  return d;
}

// ── Las plantillas ──────────────────────────────────────────────────────────
// Cada una estrena un layout distinto a propósito: si solo cambia el texto, el
// negocio no percibe que tiene una galería, percibe que tiene una plantilla.
const TEMPLATES = [
  {
    name: 'Bienvenida',
    subject: '¡Qué gusto tenerte por aquí!',
    doc: doc('Gracias por unirte: esto es lo que viene ahora.', [
      row([100], [[b('logo')]], { paddingV: 24 }),
      banda([
        [
          b('heading', {
            kicker: 'Bienvenido',
            title: 'Qué gusto tenerte por aquí',
            subtitle: 'Desde hoy te vamos a contar lo bueno antes que a nadie.',
            level: 'h1',
            align: 'center',
            color: BLANCO,
            kickerColor: BLANCO,
          }),
        ],
      ]),
      row(
        [100],
        [
          [
            b('text', {
              html:
                'Gracias por unirte. A partir de ahora vas a recibir por aquí las novedades, los ' +
                'beneficios y algún detalle que tenemos preparado para ti.',
              align: 'center',
            }),
          ],
        ],
        { paddingV: 24 },
      ),
      row(
        [33.33, 33.34, 33.33],
        [
          [
            b('feature', {
              icon: '🎁',
              layout: 'stacked',
              title: 'Beneficios',
              text: 'Promociones que solo salen por correo.',
            }),
          ],
          [
            b('feature', {
              icon: '⚡',
              layout: 'stacked',
              title: 'Primero tú',
              text: 'Te enteras antes de cada novedad.',
            }),
          ],
          [
            b('feature', {
              icon: '💬',
              layout: 'stacked',
              title: 'Trato directo',
              text: 'Respondes a este correo y te leemos.',
            }),
          ],
        ],
        { paddingV: 8 },
      ),
      row([100], [[b('button', { label: 'Descubrir más' })]]),
      row([100], [[b('divider'), redes(), pie()]]),
    ]),
  },

  {
    name: 'Agradecimiento post-compra',
    subject: '¡Gracias por tu compra!',
    doc: doc('Tu compra está confirmada. Aquí tienes el resumen.', [
      row([100], [[b('logo')]], { paddingV: 24 }),
      row([100], [
        [
          b('heading', {
            title: '¡Mil gracias!',
            subtitle: 'Tu compra ya está confirmada. Nos hace muy felices que nos hayas elegido.',
            level: 'h1',
            align: 'center',
          }),
        ],
      ]),
      row([100], [
        [
          b('order', {
            title: 'Resumen de tu pedido',
            items: [
              { name: 'Producto o servicio', qty: '1', price: '' },
              { name: 'Otro concepto', qty: '1', price: '' },
            ],
            totals: [
              { label: 'Subtotal', value: '', strong: false },
              { label: 'Total', value: '', strong: true },
            ],
            note: 'Si algo no llega como esperabas, respóndenos a este correo y lo resolvemos.',
          }),
        ],
      ]),
      bandaSuave([
        [
          b('rating', { stars: 5, label: '¿Nos regalas un minuto?' }),
          b('text', {
            html: 'Tu opinión ayuda a que más personas nos conozcan — y a que mejoremos lo que haga falta.',
            align: 'center',
          }),
          b('button', { label: 'Dejar mi opinión' }),
        ],
      ]),
      row([100], [[redes(), pie()]]),
    ]),
  },

  {
    name: 'Promoción',
    subject: 'Una oferta pensada para ti',
    doc: doc('Por tiempo limitado: aprovecha tu descuento.', [
      banda(
        [
          [
            b('heading', {
              kicker: 'Solo por unos días',
              title: 'Una oferta difícil de ignorar',
              level: 'h1',
              align: 'center',
              color: BLANCO,
              kickerColor: BLANCO,
            }),
          ],
        ],
        { paddingV: 40 },
      ),
      row([100], [[b('image', { alt: 'Imagen de la promoción' })]], { paddingV: 0, paddingH: 0 }),
      row(
        [100],
        [
          [
            b('text', {
              html:
                'Preparamos una promoción especial para nuestros clientes. Es por tiempo limitado, ' +
                'así que no la dejes pasar.',
              align: 'center',
            }),
          ],
        ],
        { paddingV: 24 },
      ),
      row([50, 50], [
        [
          b('product', {
            alt: 'Foto del primer producto',
            title: 'Primer producto',
            description: 'Una línea diciendo qué es.',
            price: '',
            label: 'Ver',
          }),
        ],
        [
          b('product', {
            alt: 'Foto del segundo producto',
            title: 'Segundo producto',
            description: 'Una línea diciendo qué es.',
            price: '',
            label: 'Ver',
          }),
        ],
      ]),
      row([100], [
        [
          b('coupon', {
            code: 'BIENVENIDO',
            label: 'Usa este código al pagar',
            note: 'Válido hasta agotar existencias.',
          }),
          b('button', { label: 'Quiero mi descuento' }),
          b('text', {
            html: 'Aplican términos y condiciones. La promoción no es acumulable con otras.',
            align: 'center',
            fontSize: 13,
            color: T.color.tintaSuave,
          }),
        ],
      ]),
      row([100], [[b('divider'), redes(), pie()]]),
    ]),
  },

  {
    name: 'Novedades',
    subject: 'Esto es lo nuevo que tenemos para contarte',
    doc: doc('Un resumen rápido de lo que ha pasado y lo que viene.', [
      row([100], [[b('logo')]], { paddingV: 24 }),
      row([100], [
        [
          b('heading', {
            kicker: 'Boletín',
            title: 'Novedades del mes',
            subtitle: 'Lo que ha pasado por aquí y lo que viene, en dos minutos.',
            level: 'h1',
          }),
          b('divider'),
        ],
      ]),
      row([50, 50], [
        [
          b('image', { alt: 'Imagen de la primera novedad', radius: 8 }),
          b('heading', { title: 'Lo más destacado' }),
          b('text', {
            html: 'La noticia principal: un producto nuevo, un cambio de horario, una apertura…',
          }),
        ],
        [
          b('image', { alt: 'Imagen de la segunda novedad', radius: 8 }),
          b('heading', { title: 'También te interesa' }),
          b('text', { html: 'Un segundo tema, más breve. Dos o tres líneas bastan.' }),
        ],
      ]),
      row([100], [[b('divider')]]),
      row([100], [
        [
          b('quote', {
            text: 'Vengo cada semana desde que abrieron. El trato es lo que marca la diferencia.',
            author: 'Un cliente de siempre',
            role: '',
            stars: 5,
          }),
        ],
      ]),
      row([100], [[b('button', { label: 'Ver todas las novedades' })]]),
      row([100], [[redes(), pie()]]),
    ]),
  },

  {
    name: 'Recordatorio de cita',
    subject: 'Te esperamos: recuerda tu cita',
    doc: doc('Recuerda tu próxima cita: aquí están los datos.', [
      newRow(
        [100],
        [
          [
            b('heading', {
              kicker: 'Recordatorio',
              title: '¡No se te olvide!',
              subtitle: 'Te escribimos para recordarte tu próxima cita con nosotros.',
              level: 'h1',
              align: 'center',
              color: BLANCO,
              kickerColor: BLANCO,
            }),
          ],
        ],
        { background: T.color.tinta, paddingV: 36 },
      ),
      row(
        [100],
        [
          [
            b('feature', { icon: '📅', title: 'Fecha y hora', text: 'Escribe aquí el día y la hora.' }),
            b('feature', { icon: '📍', title: 'Dónde', text: 'Escribe aquí la dirección exacta.' }),
            b('feature', { icon: '⏱️', title: 'Cuánto dura', text: 'Escribe aquí la duración aproximada.' }),
          ],
        ],
        { paddingV: 24 },
      ),
      row([100], [
        [
          b('buttons', {
            label: 'Confirmar asistencia',
            label2: 'Necesito cambiarla',
          }),
        ],
      ]),
      row([100], [
        [
          b('text', {
            html: 'Si no puedes asistir, avísanos con tiempo y la reagendamos sin problema.',
            align: 'center',
            fontSize: 13,
            color: T.color.tintaSuave,
          }),
          b('divider'),
          pie(),
        ],
      ]),
    ]),
  },

  {
    name: 'Te extrañamos',
    subject: 'Hace tiempo que no te vemos',
    doc: doc('Hace tiempo que no te vemos: tenemos algo para que vuelvas.', [
      row([100], [[b('logo')]], { paddingV: 24 }),
      row(
        [100],
        [
          [
            b('heading', {
              title: 'Hace tiempo que no te vemos',
              subtitle: 'Y se nota. Queremos que vuelvas, así que te lo ponemos fácil.',
              level: 'h1',
              align: 'center',
            }),
          ],
        ],
        { paddingV: 16 },
      ),
      row([100], [
        [
          b('quote', {
            text: 'Volví después de meses y seguía siendo igual de bueno. Me alegró el día.',
            author: 'Otro cliente que volvió',
            stars: 5,
          }),
        ],
      ]),
      bandaSuave([
        [
          b('coupon', {
            code: 'VUELVE',
            label: 'Un motivo para pasarte',
            note: 'Enséñalo al llegar. Válido durante los próximos 30 días.',
          }),
        ],
      ]),
      row([100], [
        [
          b('button', { label: 'Quiero volver' }),
          b('text', {
            html: 'Si prefieres que dejemos de escribirte, respóndenos con la palabra BAJA y listo.',
            align: 'center',
            fontSize: 13,
            color: T.color.tintaSuave,
          }),
        ],
      ]),
      row([100], [[b('divider'), redes(), pie()]]),
    ]),
  },

  {
    name: 'Cumpleaños',
    subject: '🎉 Feliz cumpleaños',
    doc: doc('Es tu día y tenemos un detalle esperándote.', [
      bandaSuave(
        [
          [
            b('heading', {
              kicker: 'Hoy es tu día',
              title: '¡Feliz cumpleaños!',
              level: 'h1',
              align: 'center',
            }),
            b('text', {
              html: 'Queríamos ser de los primeros en desearte un buen día. Y no venimos con las manos vacías.',
              align: 'center',
            }),
          ],
        ],
        { paddingV: 34 },
      ),
      row([100], [
        [
          b('coupon', {
            code: 'CUMPLE',
            label: 'Tu regalo de cumpleaños',
            note: 'Válido durante todo el mes. Solo tienes que enseñarlo.',
          }),
        ],
      ]),
      row([100], [
        [
          b('feature', {
            icon: '🎂',
            title: 'Cómo usarlo',
            text: 'Enséñanos este correo cuando vengas y nosotros nos encargamos del resto.',
          }),
        ],
      ]),
      row([100], [[b('button', { label: 'Ver dónde estamos' })]]),
      row([100], [[b('divider'), redes(), pie()]]),
    ]),
  },

  {
    name: 'Recompensa lista para canjear',
    subject: 'Tu recompensa ya te está esperando',
    doc: doc('Completaste tu tarjeta: tu recompensa te espera.', [
      banda([
        [
          b('heading', {
            kicker: 'Lo lograste',
            title: 'Tu recompensa está lista',
            subtitle: 'Completaste tu tarjeta. Ahora toca disfrutarla.',
            level: 'h1',
            align: 'center',
            color: BLANCO,
            kickerColor: BLANCO,
          }),
        ],
      ]),
      row(
        [100],
        [
          [
            b('feature', {
              icon: '🎁',
              layout: 'stacked',
              align: 'center',
              title: 'Escribe aquí tu recompensa',
              text: 'Un renglón describiendo exactamente qué se lleva el cliente.',
            }),
          ],
        ],
        { paddingV: 28 },
      ),
      row([100], [
        [
          b('text', {
            html: 'Solo tienes que enseñar tu tarjeta al llegar. Nosotros hacemos el resto.',
            align: 'center',
          }),
          b('buttons', { label: 'Ver mi tarjeta', label2: 'Cómo llegar' }),
          b('text', {
            html: 'Tu recompensa no caduca, pero está más rica hoy.',
            align: 'center',
            fontSize: 13,
            color: T.color.tintaSuave,
          }),
        ],
      ]),
      row([100], [[b('divider'), redes(), pie()]]),
    ]),
  },

  {
    name: 'Pide tu reseña',
    subject: '¿Nos regalas un minuto?',
    doc: doc('Una opinión tuya nos ayuda más de lo que parece.', [
      row([100], [[b('logo')]], { paddingV: 24 }),
      row([100], [
        [
          b('heading', {
            title: '¿Cómo nos fue?',
            subtitle: 'Un minuto tuyo nos ayuda más de lo que parece.',
            level: 'h1',
            align: 'center',
          }),
          b('rating', { stars: 5, size: 32, label: 'Toca las estrellas para contarnos' }),
          b('button', { label: 'Dejar mi opinión' }),
        ],
      ]),
      row([100], [[b('divider')]]),
      row([100], [
        [
          b('heading', { title: 'Lo que dicen otros clientes', align: 'center' }),
          b('quote', {
            text: 'Servicio rápido y gente amable. Vuelvo seguro.',
            author: 'Una clienta reciente',
            stars: 5,
          }),
        ],
      ]),
      row([100], [
        [
          b('text', {
            html: '¿Algo no salió bien? Respóndenos a este correo antes de calificarnos: lo arreglamos.',
            align: 'center',
            fontSize: 13,
            color: T.color.tintaSuave,
          }),
        ],
      ]),
      row([100], [[redes(), pie()]]),
    ]),
  },
];

// ── Auto-verificación ANTES de escribir nada ────────────────────────────────
/** Recorre todos los bloques del documento. */
function* everyBlock(d) {
  for (const r of d.rows) for (const c of r.columns) for (const bl of c.blocks) yield bl;
}

function verificar(t, html, texto) {
  const fallos = [];
  // 1. Regla dura: ni un data:image llega a la base.
  if (/data:\s*image/i.test(JSON.stringify(t.doc) + html)) {
    fallos.push('contiene data:image (las imágenes van por URL a S3)');
  }
  // 2. Preheader útil: sin él el cliente enseña las primeras palabras del
  //    cuerpo en la bandeja, que casi nunca es lo que uno quiere que se lea.
  const pre = (t.doc.settings.preheader || '').trim();
  if (pre.length < 40 || pre.length > 90) {
    fallos.push(`preheader de ${pre.length} caracteres (debe estar entre 40 y 90)`);
  }
  // 3. Con las imágenes bloqueadas —lo normal hasta que el lector las activa—
  //    el alt es lo único que se lee.
  for (const bl of everyBlock(t.doc)) {
    if ((bl.type === 'image' || bl.type === 'product') && !String(bl.props.alt || '').trim()) {
      fallos.push(`un bloque «${bl.type}» sin texto alternativo`);
    }
  }
  // 4. Variedad real: la galería pierde el sentido si todas son la misma.
  const tipos = new Set([...everyBlock(t.doc)].map((bl) => bl.type));
  if (tipos.size < 5) fallos.push(`solo usa ${tipos.size} tipos de bloque (mínimo 5)`);
  // 5. Pie con la vía de baja: es lo que evita que los reportes de spam
  //    tumben la reputación de la subcuenta que transporta.
  if (!/BAJA|baja/.test(html)) fallos.push('el pie no explica cómo darse de baja');
  // 6. Nada de flexbox/grid/position: los clientes de correo no los soportan.
  if (/display:\s*(flex|grid)|position:\s*(absolute|fixed)/i.test(html)) {
    fallos.push('el HTML usa flexbox, grid o position');
  }
  // 7. El fallback de texto plano tiene que decir algo.
  if (!texto || texto.length < 80) fallos.push('el fallback de texto plano está vacío o es muy corto');
  return fallos;
}

/** Renderiza todas las plantillas y aborta si alguna no pasa la verificación. */
function renderAll() {
  const problemas = [];
  const listas = TEMPLATES.map((t) => {
    const html = renderEmailHtml(t.doc, { title: t.subject || t.name });
    const texto = renderEmailText(t.doc);
    const fallos = verificar(t, html, texto);
    if (fallos.length) problemas.push(`• ${t.name}: ${fallos.join('; ')}`);
    return { name: t.name, subject: t.subject, doc: t.doc, html, texto };
  });
  if (problemas.length) {
    throw new Error(`Las plantillas no pasan la verificación:\n${problemas.join('\n')}`);
  }
  return listas;
}

module.exports = { TEMPLATES, renderAll, verificar, EMAIL_TOKENS: T };
