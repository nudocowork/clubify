// Backfill CURADO de Commission.businessDate: congela SOLO los negocios de los
// que tenemos la fecha real de compra (capturas del dueño / brief Soft 11). El
// resto de las comisiones NO se tocan (businessDate queda null → el panel sigue
// usando la heurística; se corrigen luego con la UI de edición).
//
// Por qué curado: las fechas de la DB (purchasedAt del backfill viejo, y los
// createdAt de comisiones con fechas corruptas B6) NO reproducen la fecha real
// → el backfill automático fallaba 6/7 el test de aceptación. La verdad solo
// está en las capturas del dueño → se ingresa a mano acá.
//
// Setea la fecha en las comisiones de PRIMER CICLO del negocio (las que empatan
// el mínimo effectiveAvailableAt = lo que el panel muestra como "la 1ª").
// Guarda a las 12:00 America/Bogota (17:00 UTC) para que el día calendario no
// se corra por zona horaria.
//
// DRY-RUN por defecto; --apply para escribir (updateMany write-once).
// Usage: railway run --service Postgres-Nq8w node scripts/backfill-commission-business-date-curated.cjs [--apply]
const { PrismaClient } = require('@prisma/client');

const HOLD_DAYS = 15;
const DAY = 86400000;

// Fecha REAL de compra por negocio (del brief Soft 11: B1 + corte 31/07).
// Editá/añadí acá con las fechas que confirme el dueño.
const CURATED = {
  'licores el amanecer': '2026-07-16',
  'wok explosivo': '2026-07-05',
  'sugar & kiss': '2026-07-02',
  'motilart': '2026-06-22',
  'cafe macondo': '2026-06-21',
  'essentrix': '2026-07-28',
  'top man': '2026-07-28',
  'altieri specialty coffee': '2026-07-06',
  'extreme house': '2026-07-10',
  'bien maracucho': '2026-07-10',
};

const norm = (s) =>
  (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const effAvail = (c) =>
  c.availableAt ? new Date(c.availableAt).getTime()
                : new Date(c.createdAt).getTime() + HOLD_DAYS * DAY;
const bogotaDay = (d) =>
  new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
// medianoche-segura: 12:00 Bogotá = 17:00 UTC del mismo día calendario.
const atBogotaNoon = (ymd) => new Date(`${ymd}T17:00:00.000Z`);

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const APPLY = process.argv.includes('--apply');

  const all = await prisma.commission.findMany({
    select: {
      id: true, status: true, businessDate: true, availableAt: true, createdAt: true,
      referralUse: { select: { tenant: { select: { id: true, brandName: true } } } },
    },
  });

  const firstMsByTenant = new Map();
  for (const c of all) {
    if (c.status === 'REJECTED') continue;
    const tid = c.referralUse?.tenant?.id;
    if (!tid) continue;
    const ms = effAvail(c);
    const cur = firstMsByTenant.get(tid);
    if (cur === undefined || ms < cur) firstMsByTenant.set(tid, ms);
  }

  const matchKey = (brand) => {
    const n = norm(brand);
    return Object.keys(CURATED).find((k) => n.includes(k));
  };

  // Comisiones de primer ciclo de negocios curados.
  const targets = [];
  for (const c of all) {
    const t = c.referralUse?.tenant;
    if (!t?.id || c.status === 'REJECTED') continue;
    const key = matchKey(t.brandName);
    if (!key) continue;
    if (effAvail(c) !== firstMsByTenant.get(t.id)) continue; // solo la 1ª
    targets.push({ id: c.id, brand: t.brandName, key, date: atBogotaNoon(CURATED[key]), had: c.businessDate });
  }

  console.log(`\nComisiones totales: ${all.length}`);
  console.log(`Negocios curados: ${Object.keys(CURATED).length}`);
  console.log(`Comisiones de 1er ciclo a congelar: ${targets.length}`);

  console.log(`\n== Verificación por negocio curado ==`);
  for (const k of Object.keys(CURATED)) {
    const rows = targets.filter((t) => t.key === k);
    if (!rows.length) { console.log(`  • ${k}: (sin comisión de 1er ciclo encontrada)`); continue; }
    const days = [...new Set(rows.map((r) => bogotaDay(r.date)))];
    const ok = days.length === 1 && days[0] === CURATED[k];
    console.log(`  ${ok ? '✓' : '✗'} ${rows[0].brand}: ${rows.length} comisión(es) → ${days.join(', ')} (esperado ${CURATED[k]})`);
  }

  if (!APPLY) {
    console.log(`\n[DRY-RUN] No se escribió NADA. El resto de comisiones (no curadas) quedan intactas (null → heurística).`);
    console.log(`Para aplicar: agregá --apply`);
    await prisma.$disconnect();
    return;
  }

  let written = 0, skipped = 0;
  for (const t of targets) {
    const res = await prisma.commission.updateMany({
      where: { id: t.id, businessDate: null },
      data: { businessDate: t.date },
    });
    if (res.count) written++; else skipped++;
  }
  console.log(`\n✅ Congeladas ${written} comisiones curadas${skipped ? ` · ${skipped} ya tenían businessDate` : ''}.`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
