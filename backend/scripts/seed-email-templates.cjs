/**
 * Seed de PLANTILLAS DE FÁBRICA del editor de correos (pestaña Plantillas).
 *
 * Crea/actualiza unas plantillas `isPreset: true` bien diseñadas, en español
 * natural: bienvenida, promoción, novedades, recordatorio de cita y
 * agradecimiento post-compra. Se listan para TODAS las marcas; la API no deja
 * editarlas ni borrarlas (al usarlas se duplican en la marca), así que este
 * script es el ÚNICO dueño de su contenido.
 *
 * Idempotente: la clave lógica es (isPreset, name). Si la plantilla ya existe
 * se ACTUALIZA su contenido; si no, se crea. Correrlo dos veces no duplica.
 *
 * REGLA DURA (la misma del servicio): ninguna imagen incrustada. Solo URLs; los
 * huecos de imagen van con url vacía para que cada negocio suba la suya por
 * `POST /api/media/upload`. El script se auto-verifica antes de escribir.
 *
 * Uso:  railway run node scripts/seed-email-templates.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

// Paleta neutra que no pelea con ninguna marca (la copia de cada marca se
// recolorea en el editor). Un solo acento, tipografías seguras de correo.
const C = {
  fondo: '#f1f5f9',
  tarjeta: '#ffffff',
  tinta: '#334155',
  suave: '#64748b',
  acento: '#4f46e5',
  acentoTexto: '#ffffff',
  borde: '#e2e8f0',
};

// ── Bloques en el formato del EDITOR ────────────────────────────────────────
// `blocks` guarda el documento del editor visual (frontend/src/lib/
// email-blocks.ts): { version: 1, settings, rows: [{ columns: [{ widthPct,
// blocks: [{ type, props }] }] }] }. Los ids y el widthPct se omiten a
// propósito: coerceDoc() los completa al abrir, y así el seed no inventa ids.
// Solo se declaran las props que difieren de los defaults del editor.
const SETTINGS = {
  backgroundColor: C.fondo,
  contentBackground: C.tarjeta,
  contentWidth: 600,
  fontFamily: 'Arial, Helvetica, sans-serif',
  textColor: C.tinta,
  linkColor: C.acento,
};
const doc = (...rows) => ({ version: 1, settings: SETTINGS, rows });
const row = (...cols) => ({ columns: cols.map((blocks) => ({ blocks })) });
const b = (type, props = {}) => ({ type, props });
const titulo = (html) => b('text', { html: `<b>${html}</b>`, align: 'center', fontSize: 22 });
const nota = (html) => b('text', { html, fontSize: 13, color: C.suave });
// Hueco de imagen: url vacía a propósito, cada negocio sube la suya a S3.
const imagenHueco = (alt) => b('image', { url: '', alt });

// ── HTML listo para enviar ──────────────────────────────────────────────────
// Armazón común: tarjeta centrada de 600 px, tablas y estilos inline (los
// clientes de correo ignoran <style>). Es el fallback enviable; al guardar
// desde el editor, este HTML se regenera con su propio render.
function layout({ preheader, contenido }) {
  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:0;background-color:${C.fondo};">
    <div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.fondo};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:${C.tarjeta};border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:${C.tinta};">
${contenido}
          </table>
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
            <tr>
              <td align="center" style="padding:20px 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:${C.suave};">
                Recibiste este correo porque estás en nuestra lista de contactos.<br>
                Si ya no deseas recibir estos mensajes, responde con la palabra BAJA.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Celda de texto estándar. */
const texto = (html, extra = '') =>
  `            <tr><td style="padding:8px 40px;font-size:16px;line-height:26px;${extra}">${html}</td></tr>`;

/** Botón bulletproof (enlace con padding; funciona en todos los clientes). */
const boton = (etiqueta, url) =>
  `            <tr><td align="center" style="padding:24px 40px;">
              <a href="${url}" style="display:inline-block;background-color:${C.acento};color:${C.acentoTexto};text-decoration:none;font-size:16px;font-weight:600;padding:14px 32px;border-radius:8px;">${etiqueta}</a>
            </td></tr>`;

const divisor = () =>
  `            <tr><td style="padding:8px 40px;"><hr style="border:none;border-top:1px solid ${C.borde};margin:0;"></td></tr>`;

/** Cabecera de color con el titular (sin logotipo: ese es el hueco). */
const cabecera = (t) =>
  `            <tr><td align="center" style="background-color:${C.acento};padding:28px 40px;">
              <span style="font-size:22px;font-weight:700;color:${C.acentoTexto};letter-spacing:.3px;">${t}</span>
            </td></tr>`;

const espacio = (px) => `            <tr><td style="height:${px}px;line-height:${px}px;font-size:0;">&nbsp;</td></tr>`;

const TEMPLATES = [
  {
    name: 'Bienvenida',
    subject: '¡Qué gusto tenerte por aquí!',
    blocks: doc(
      row([
        b('logo'),
        titulo('¡Qué gusto tenerte por aquí!'),
        b('text', {
          html: 'Gracias por unirte. A partir de ahora vas a recibir por aquí las novedades, los beneficios y algún detalle que tenemos preparado para ti.',
        }),
        b('text', {
          html: 'Para empezar con el pie derecho, visita nuestro sitio y descubre todo lo que tenemos para ti.',
        }),
        b('button', { label: 'Descubrir más', href: '' }),
        b('divider'),
        nota('Si tienes cualquier duda, responde a este correo: lo leemos de verdad.'),
        b('footer'),
      ]),
    ),
    html: layout({
      preheader: 'Gracias por unirte: esto es lo que viene ahora.',
      contenido: [
        cabecera('¡Bienvenido!'),
        espacio(24),
        texto('<strong style="font-size:20px;">Qué gusto tenerte por aquí</strong>'),
        texto(
          'Gracias por unirte. A partir de ahora vas a recibir por aquí las novedades, los beneficios y algún detalle que tenemos preparado para ti.',
        ),
        texto('Para empezar con el pie derecho, visita nuestro sitio y descubre todo lo que tenemos para ti.'),
        boton('Descubrir más', 'https://ejemplo.com'),
        divisor(),
        texto('Si tienes cualquier duda, responde a este correo: lo leemos de verdad.', `color:${C.suave};font-size:14px;`),
        espacio(24),
      ].join('\n'),
    }),
  },
  {
    name: 'Promoción',
    subject: 'Una oferta pensada para ti',
    blocks: doc(
      row([
        b('logo'),
        imagenHueco('Imagen del producto o la promoción'),
        titulo('Solo por unos días'),
        b('text', {
          html: 'Preparamos una promoción especial para nuestros clientes. Es por tiempo limitado, así que no la dejes pasar.',
          align: 'center',
        }),
        b('text', { html: '<b>Usa el código BIENVENIDO al pagar y llévate tu descuento.</b>', align: 'center' }),
        b('button', { label: 'Quiero mi descuento', href: '', fontSize: 17, paddingV: 14, paddingH: 36 }),
        b('spacer', { height: 8 }),
        nota('La promoción es válida hasta agotar existencias. Aplican términos y condiciones.'),
        b('footer'),
      ]),
    ),
    html: layout({
      preheader: 'Por tiempo limitado: aprovecha tu descuento.',
      contenido: [
        cabecera('Solo por unos días'),
        espacio(24),
        texto('<strong style="font-size:20px;">Una oferta pensada para ti</strong>'),
        texto(
          'Preparamos una promoción especial para nuestros clientes. Es por tiempo limitado, así que no la dejes pasar.',
        ),
        texto(`<span style="display:inline-block;background-color:#eef2ff;color:${C.acento};font-weight:700;padding:10px 18px;border-radius:8px;letter-spacing:1px;">CÓDIGO: BIENVENIDO</span>`),
        boton('Quiero mi descuento', 'https://ejemplo.com'),
        divisor(),
        texto('La promoción es válida hasta agotar existencias. Aplican términos y condiciones.', `color:${C.suave};font-size:13px;`),
        espacio(24),
      ].join('\n'),
    }),
  },
  {
    name: 'Novedades',
    subject: 'Esto es lo nuevo que tenemos para contarte',
    blocks: doc(
      row([b('logo'), titulo('Novedades del mes'), b('divider')]),
      // Dos columnas al estilo boletín: cada una con su hueco de imagen.
      row(
        [
          imagenHueco('Imagen de la primera novedad'),
          b('text', { html: '<b>Lo más destacado</b><br>Cuéntale a tus clientes la noticia principal: un producto nuevo, un cambio de horario, una apertura…' }),
        ],
        [
          imagenHueco('Imagen de la segunda novedad'),
          b('text', { html: '<b>También te puede interesar</b><br>Un segundo tema, más breve. Dos o tres líneas bastan.' }),
        ],
      ),
      row([b('spacer', { height: 16 }), b('button', { label: 'Ver todas las novedades', href: '' }), b('footer')]),
    ),
    html: layout({
      preheader: 'Un resumen rápido de lo que ha pasado y lo que viene.',
      contenido: [
        cabecera('Novedades del mes'),
        espacio(24),
        texto('Un resumen rápido de lo que ha pasado por aquí y lo que viene.'),
        divisor(),
        texto('<strong>Lo más destacado</strong><br>Cuéntale a tus clientes la noticia principal: un producto nuevo, un cambio de horario, una apertura…'),
        divisor(),
        texto('<strong>También te puede interesar</strong><br>Un segundo tema, más breve. Dos o tres líneas bastan.'),
        boton('Ver todas las novedades', 'https://ejemplo.com'),
        espacio(24),
      ].join('\n'),
    }),
  },
  {
    name: 'Recordatorio de cita',
    subject: 'Te esperamos: recuerda tu cita',
    blocks: doc(
      row([
        b('logo'),
        titulo('¡No se te olvide!'),
        b('text', { html: 'Te escribimos para recordarte tu próxima cita con nosotros:' }),
        b('text', { html: '<b>📅 Fecha:</b> [día y hora]<br><b>📍 Lugar:</b> [dirección]' }),
        b('text', { html: 'Si no puedes asistir, avísanos con tiempo y la reagendamos sin problema.' }),
        b('button', { label: 'Confirmar asistencia', href: '' }),
        b('footer'),
      ]),
    ),
    html: layout({
      preheader: 'Recuerda tu próxima cita: aquí están los datos.',
      contenido: [
        cabecera('¡No se te olvide!'),
        espacio(24),
        texto('Te escribimos para recordarte tu próxima cita con nosotros:'),
        texto(
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;border:1px solid ${C.borde};border-radius:8px;"><tr><td style="padding:16px 20px;font-size:16px;line-height:28px;"><strong>📅 Fecha:</strong> [día y hora]<br><strong>📍 Lugar:</strong> [dirección]</td></tr></table>`,
        ),
        texto('Si no puedes asistir, avísanos con tiempo y la reagendamos sin problema.'),
        boton('Confirmar asistencia', 'https://ejemplo.com'),
        espacio(24),
      ].join('\n'),
    }),
  },
  {
    name: 'Agradecimiento post-compra',
    subject: '¡Gracias por tu compra!',
    blocks: doc(
      row([
        b('logo'),
        titulo('¡Mil gracias!'),
        b('text', { html: 'Tu compra ya está confirmada. Nos hace muy felices que nos hayas elegido.' }),
        b('text', { html: 'Si algo no llega como esperabas o tienes cualquier duda, respóndenos y lo resolvemos.' }),
        b('divider'),
        b('text', { html: '¿Nos regalas un minuto? Tu opinión ayuda a que más personas nos conozcan.' }),
        b('button', { label: 'Dejar mi opinión', href: '' }),
        b('social'),
        b('footer'),
      ]),
    ),
    html: layout({
      preheader: 'Tu compra está confirmada. Gracias por elegirnos.',
      contenido: [
        cabecera('¡Mil gracias!'),
        espacio(24),
        texto('Tu compra ya está confirmada. Nos hace muy felices que nos hayas elegido.'),
        texto('Si algo no llega como esperabas o tienes cualquier duda, respóndenos y lo resolvemos.'),
        divisor(),
        texto('¿Nos regalas un minuto? Tu opinión ayuda a que más personas nos conozcan.'),
        boton('Dejar mi opinión', 'https://ejemplo.com'),
        espacio(24),
      ].join('\n'),
    }),
  },
];

(async () => {
  // Auto-verificación de la regla dura ANTES de escribir nada: si alguien
  // edita este script y mete un data:image, no llega a la base.
  for (const t of TEMPLATES) {
    const todo = JSON.stringify(t.blocks) + (t.html || '');
    if (/data:\s*image/i.test(todo)) {
      throw new Error(`La plantilla "${t.name}" contiene data:image. Las imágenes van por URL (S3).`);
    }
  }

  // Las de fábrica cuelgan de la marca Clubify (el modelo exige whiteLabelId),
  // pero `isPreset: true` es lo que las hace visibles para todas las marcas.
  const clubify = await p.whiteLabel.findUnique({ where: { slug: 'clubify' }, select: { id: true } });
  if (!clubify) throw new Error('No existe la marca "clubify"; no hay dónde colgar las plantillas de fábrica.');

  for (const t of TEMPLATES) {
    const existing = await p.mktEmailTemplate.findFirst({
      where: { isPreset: true, name: t.name },
      select: { id: true },
    });
    if (existing) {
      await p.mktEmailTemplate.update({
        where: { id: existing.id },
        data: { subject: t.subject, blocks: t.blocks, html: t.html },
      });
      console.log(`≈ Actualizada: ${t.name}`);
    } else {
      await p.mktEmailTemplate.create({
        data: {
          whiteLabelId: clubify.id,
          name: t.name,
          subject: t.subject,
          blocks: t.blocks,
          html: t.html,
          isPreset: true,
        },
      });
      console.log(`+ Creada: ${t.name}`);
    }
  }

  const total = await p.mktEmailTemplate.count({ where: { isPreset: true } });
  console.log(`\nPlantillas de fábrica en la base: ${total}`);
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
