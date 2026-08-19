/* Fase 3 backfill (auditoría facturación). Setea Tenant.lastChargeAt = businessDate
 * de la comisión MÁS ANTIGUA del tenant, SOLO para los tenants que tienen comisión
 * no-rechazada pero lastChargeAt = NULL (cobros invisibles al panel).
 *
 * SALVAGUARDAS (brief PASO 3/Fase 3):
 *  - Idempotente: solo actualiza si lastChargeAt IS NULL (nunca pisa una fecha real).
 *  - NO crea/modifica/anula NINGUNA comisión — solo escribe Tenant.lastChargeAt.
 *  - Corre la auditoría de duplicados ANTES y DESPUÉS y compara (debe ser igual).
 *  - Dry-run por defecto. Escribe SOLO con `--commit`.
 * Usage:
 *   dry-run: railway run --service backend node scripts/backfill-lastchargeat-from-commission.cjs
 *   commit : railway run --service backend node scripts/backfill-lastchargeat-from-commission.cjs --commit
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const COMMIT = process.argv.includes('--commit');
const d = (x) => (x ? new Date(x).toISOString().slice(0, 10) : '—');

// Heurística de duplicados = misma que /admin/commissions/audit: mismo
// (referralUseId, recipientCodeId), createdAt dentro de 25 días, status != REJECTED.
async function countDuplicatePairs() {
  const rows = await prisma.commission.findMany({
    where: { status: { not: 'REJECTED' } },
    select: { referralUseId: true, recipientCodeId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.referralUseId}::${r.recipientCodeId}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(new Date(r.createdAt).getTime());
  }
  let dups = 0;
  for (const times of groups.values()) {
    for (let i = 1; i < times.length; i++) {
      if ((times[i] - times[i - 1]) / 86400000 < 25) dups++;
    }
  }
  return dups;
}

(async () => {
  const comms = await prisma.commission.findMany({
    where: { status: { not: 'REJECTED' } },
    select: {
      businessDate: true, createdAt: true,
      referralUse: { select: { tenant: { select: { id: true, brandName: true, lastChargeAt: true } } } },
    },
  });
  const targets = new Map(); // tenantId -> { name, earliest }
  for (const c of comms) {
    const t = c.referralUse?.tenant;
    if (!t || t.lastChargeAt) continue; // solo los null
    const dt = new Date(c.businessDate || c.createdAt);
    const cur = targets.get(t.id);
    if (!cur || dt < cur.earliest) targets.set(t.id, { name: t.brandName, earliest: dt });
  }

  console.log(`\n=== BACKFILL lastChargeAt (${COMMIT ? 'COMMIT' : 'DRY-RUN'}) ===`);
  console.log(`Tenants a rellenar: ${targets.size}`);
  for (const [id, v] of targets) {
    console.log(`  • ${v.name}  →  lastChargeAt = ${d(v.earliest)}  (id ${id})`);
  }
  if (targets.size === 0) { console.log('Nada que hacer.'); await prisma.$disconnect(); return; }

  const dupBefore = await countDuplicatePairs();
  console.log(`\nDuplicados de comisiones ANTES: ${dupBefore}`);

  if (!COMMIT) {
    console.log('\n(DRY-RUN — no se escribió nada. Correr con --commit para aplicar.)');
    await prisma.$disconnect();
    return;
  }

  let n = 0;
  for (const [id, v] of targets) {
    // Guard write-once: solo si sigue null (por si algo lo seteó en el ínterin).
    const res = await prisma.tenant.updateMany({
      where: { id, lastChargeAt: null },
      data: { lastChargeAt: v.earliest },
    });
    n += res.count;
  }
  const dupAfter = await countDuplicatePairs();
  console.log(`\n✅ Tenants actualizados: ${n}`);
  console.log(`Duplicados de comisiones DESPUÉS: ${dupAfter} ${dupAfter === dupBefore ? '(igual ✓)' : '⚠️ CAMBIÓ — revisar/revertir'}`);
  await prisma.$disconnect();
})().catch(async (e) => { console.error('ERROR:', e.message); await prisma.$disconnect(); process.exit(1); });
