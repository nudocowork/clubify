/**
 * Sustituye el teléfono de Sellea en los sitios donde de verdad se usa.
 *
 * El viejo `+1 786-583-2760` estaba en 19 celdas de producción. Este script
 * toca SOLO las que sirven a alguien hoy:
 *
 *   · `WhiteLabel.demoButtonWhatsApp` — el que lee la landing. Ninguna
 *     pantalla lo escribe, y por eso el cambio desde el panel no llegó: la
 *     casilla del panel guarda en `notifyPhone`, que es otra cosa (los SMS de
 *     créditos). Ese es el fallo de fondo; aquí se corrige el dato.
 *   · `WhiteLabel.notifyPhone` — donde sí cayó el cambio, pero truncado.
 *   · `Tenant.whatsappPhone` del negocio de pruebas de la marca.
 *   · La plantilla de correo «Te presentamos SELLEA» — lleva el `wa.me`
 *     escrito a mano en el botón, en `blocks` y en `html`.
 *   · El contacto de marketing, en sus tres normalizaciones.
 *
 * NO toca el histórico —`Order.whatsappLink`, `MessageLog`, `AuditLog`—:
 * son fotos de lo que pasó ese día y reescribirlas sería falsear el registro.
 *
 * Idempotente: si ya está el nuevo, no hace nada. Imprime antes y después.
 *
 * Uso:  railway run node scripts/sustituir-telefono-sellea.cjs [--aplicar]
 *       Sin `--aplicar` solo ENSEÑA lo que haría.
 */
const { PrismaClient } = require('@prisma/client');

const VIEJO_DIGITOS = '17865832760';
const NUEVO = '+13053107130';
const NUEVO_DIGITOS = '13053107130';
const APLICAR = process.argv.includes('--aplicar');

const p = new PrismaClient();
const cambios = [];

/** Cualquier forma de escribir el viejo: espacios, guiones, puntos, paréntesis. */
function tieneElViejo(txt) {
  if (!txt) return false;
  return String(txt).replace(/[^0-9]/g, '').includes(VIEJO_DIGITOS);
}

/** Sustituye el viejo por el nuevo respetando el formato del enlace wa.me. */
function sustituir(txt) {
  return String(txt)
    .replace(/\+?1[\s.\-()]*786[\s.\-()]*583[\s.\-()]*2760/g, NUEVO)
    .replace(/wa\.me\/17865832760/g, `wa.me/${NUEVO_DIGITOS}`)
    .replace(/phone=17865832760/g, `phone=${NUEVO_DIGITOS}`);
}

(async () => {
  const wl = await p.whiteLabel.findFirst({
    where: { slug: 'sellea' },
    select: { id: true, name: true, demoButtonWhatsApp: true, notifyPhone: true },
  });
  if (!wl) throw new Error('no encuentro la marca sellea');
  console.log(`Marca: ${wl.name} · ${wl.id}\n`);

  // ── 1 y 2. Los dos campos de la marca ────────────────────────────────
  for (const campo of ['demoButtonWhatsApp', 'notifyPhone']) {
    const actual = wl[campo];
    if (actual === NUEVO) {
      console.log(`  ${campo.padEnd(22)} ya está en ${NUEVO}`);
      continue;
    }
    cambios.push({
      donde: `WhiteLabel.${campo}`,
      antes: actual ?? '(vacío)',
      despues: NUEVO,
      aplicar: () =>
        p.whiteLabel.update({ where: { id: wl.id }, data: { [campo]: NUEVO } }),
    });
  }

  // ── 3. El negocio de pruebas de la marca ─────────────────────────────
  const tenants = await p.tenant.findMany({
    where: { whiteLabelId: wl.id },
    select: { id: true, brandName: true, whatsappPhone: true, whatsappOrdersPhone: true },
  });
  for (const t of tenants) {
    for (const campo of ['whatsappPhone', 'whatsappOrdersPhone']) {
      if (!tieneElViejo(t[campo])) continue;
      cambios.push({
        donde: `Tenant «${t.brandName}».${campo}`,
        antes: t[campo],
        despues: NUEVO,
        aplicar: () =>
          p.tenant.update({ where: { id: t.id }, data: { [campo]: NUEVO } }),
      });
    }
  }

  // ── 4. Las plantillas de correo de la marca ──────────────────────────
  const plantillas = await p.mktEmailTemplate.findMany({
    where: { whiteLabelId: wl.id },
    select: { id: true, name: true, blocks: true, html: true },
  });
  for (const pl of plantillas) {
    const blocksTxt = JSON.stringify(pl.blocks ?? null);
    const tocaBlocks = blocksTxt.includes(VIEJO_DIGITOS);
    const tocaHtml = pl.html && pl.html.includes(VIEJO_DIGITOS);
    if (!tocaBlocks && !tocaHtml) continue;
    const data = {};
    if (tocaBlocks) data.blocks = JSON.parse(sustituir(blocksTxt));
    if (tocaHtml) data.html = sustituir(pl.html);
    cambios.push({
      donde: `MktEmailTemplate «${pl.name}» (${tocaBlocks ? 'blocks' : ''}${tocaBlocks && tocaHtml ? '+' : ''}${tocaHtml ? 'html' : ''})`,
      antes: `wa.me/${VIEJO_DIGITOS}`,
      despues: `wa.me/${NUEVO_DIGITOS}`,
      aplicar: () => p.mktEmailTemplate.update({ where: { id: pl.id }, data }),
    });
  }

  // ── 5. Los contactos de marketing de la marca ────────────────────────
  const contactos = await p.mktContact.findMany({
    where: { whiteLabelId: wl.id },
    select: { id: true, name: true, phone: true, phoneKey: true, phoneNorm: true },
  });
  for (const c of contactos) {
    if (!tieneElViejo(c.phone) && !tieneElViejo(c.phoneKey) && !tieneElViejo(c.phoneNorm)) {
      continue;
    }
    cambios.push({
      donde: `MktContact «${c.name}» (phone, phoneKey, phoneNorm)`,
      antes: c.phone,
      despues: NUEVO,
      aplicar: () =>
        p.mktContact.update({
          where: { id: c.id },
          data: { phone: NUEVO, phoneKey: NUEVO_DIGITOS, phoneNorm: NUEVO_DIGITOS },
        }),
    });
  }

  // ── Informe ──────────────────────────────────────────────────────────
  if (!cambios.length) {
    console.log('\nNo hay nada que cambiar. Todo está ya en el número nuevo.');
    return p.$disconnect();
  }

  console.log(`\n${cambios.length} cambio(s):\n`);
  for (const c of cambios) {
    console.log(`  ${c.donde}`);
    console.log(`     antes:   ${c.antes}`);
    console.log(`     después: ${c.despues}`);
  }

  if (!APLICAR) {
    console.log('\n(ensayo — nada se ha escrito. Repite con --aplicar)');
    return p.$disconnect();
  }

  console.log('\nAplicando…');
  for (const c of cambios) {
    await c.aplicar();
    console.log(`  ✓ ${c.donde}`);
  }

  // ── Comprobación ─────────────────────────────────────────────────────
  const wl2 = await p.whiteLabel.findUnique({
    where: { id: wl.id },
    select: { demoButtonWhatsApp: true, notifyPhone: true },
  });
  console.log(`\nComprobación:`);
  console.log(`  demoButtonWhatsApp → ${wl2.demoButtonWhatsApp}  (es el que lee la landing)`);
  console.log(`  notifyPhone        → ${wl2.notifyPhone}`);
  await p.$disconnect();
})().catch(async (e) => {
  console.error('Falló:', e.message);
  await p.$disconnect();
  process.exit(1);
});
