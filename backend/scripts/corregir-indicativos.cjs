/**
 * Pone el indicativo del país a los teléfonos de negocios guardados sin él
 * («3225998240» → «+573225998240»). Sin indicativo, Grow Business les ponía
 * un «+» delante y los SMS salían a otro país (La Burguesía → Bélgica,
 * 2026-10-27). También el teléfono de los usuarios del negocio.
 * Simula sin --aplicar. Misma regla que src/common/telefono-con-indicativo.ts.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const IND = { CO: '57', MX: '52', AR: '54', CL: '56', PE: '51', EC: '593', VE: '58', BO: '591', PY: '595', UY: '598', CR: '506', PA: '507', GT: '502', HN: '504', SV: '503', NI: '505', BZ: '501', DO: '1', PR: '1', US: '1', CA: '1', ES: '34', BR: '55', PT: '351', IT: '39', FR: '33', DE: '49', GB: '44' };
const CAMPOS = ['phone', 'whatsappPhone', 'whatsappOrdersPhone', 'whatsappDeliveryPhone', 'whatsappReservationsPhone', 'ownerOrderAlertsPhone', 'reviewAlertsPhone', 'billingAlertsPhone', 'whatsappFeedbackNumber'];
const DUDOSO = Symbol('dudoso');
function arreglar(raw, pais) {
  if (raw == null) return raw;
  const t = String(raw).trim();
  if (!t || t.startsWith('+')) return raw;
  const d = t.replace(/\D/g, '');
  if (!d) return raw;
  const ind = IND[(pais || '').toUpperCase()];
  if (d.startsWith('00')) return `+${d.slice(2)}`;
  // Con más de 10 cifras, solo si empieza por el indicativo de su país; si no,
  // no se adivina (93333296800 en México no es Afganistán).
  if (d.length > 10) return ind && d.startsWith(ind) ? `+${d}` : DUDOSO;
  if (!ind) return raw;
  const nacional = d.replace(/^0+/, '');
  // Colombia: celular de 10 cifras que empieza por 3, o fijo 60x. Lo demás
  // (8057128866, 316150313) se deja para revisar a mano.
  if ((pais || '').toUpperCase() === 'CO' && !/^(3\d{9}|60\d{8})$/.test(nacional)) return DUDOSO;
  return `+${ind}${nacional}`;
}
(async () => {
  const aplicar = process.argv.includes('--aplicar');
  const ts = await prisma.tenant.findMany({ where: { deletedAt: null }, select: { id: true, name: true, country: true, ...Object.fromEntries(CAMPOS.map((c) => [c, true])), users: { select: { id: true, phone: true } } } });
  let n = 0, sinPais = 0;
  const revisar = [];
  for (const t of ts) {
    const data = {};
    const dudosos = [];
    for (const c of CAMPOS) { const v = arreglar(t[c], t.country); if (v === DUDOSO) dudosos.push(`${c} ${t[c]}`); else if (v !== t[c]) data[c] = v; }
    const usuarios = [];
    for (const u of t.users) { const v = arreglar(u.phone, t.country); if (v === DUDOSO) dudosos.push(`usuario ${u.phone}`); else if (v !== u.phone) usuarios.push({ id: u.id, antes: u.phone, despues: v }); }
    if (dudosos.length) { revisar.push(`${t.name} (${t.country}): ${dudosos.join(', ')}`); }
    if (!Object.keys(data).length && !usuarios.length) continue;
    if (!t.country) sinPais++;
    n++;
    console.log(`${t.name} (${t.country ?? 'sin país'}): ${Object.entries(data).map(([k, v]) => `${k} ${t[k]} → ${v}`).join(' · ')}${usuarios.length ? ` · usuarios: ${usuarios.map((u) => `${u.antes} → ${u.despues}`).join(', ')}` : ''}`);
    if (aplicar) {
      if (Object.keys(data).length) await prisma.tenant.update({ where: { id: t.id }, data });
      for (const u of usuarios) await prisma.user.update({ where: { id: u.id }, data: { phone: u.despues } }).catch((e) => console.log('   usuario no actualizado:', e.message.slice(0, 80)));
    }
  }
  console.log(`\n${aplicar ? 'APLICADO' : 'SIMULACIÓN'}: ${n} negocios con teléfonos sin indicativo.`);
  if (revisar.length) { console.log(`
PARA REVISAR A MANO (no se tocan): ${revisar.length}`); revisar.forEach((r) => console.log('  ' + r)); }
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
