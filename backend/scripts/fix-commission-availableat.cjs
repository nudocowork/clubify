// Corrige B6: comisiones con availableAt ANTES que createdAt (imposible; el hold
// es +15d → availableAt debe ser DESPUÉS). Causa: path de renovación/reconcile
// usó un lastChargeAt viejo (ene/abr) → availableAt en el pasado, lo que además
// jalaba el mínimo de la heurística de FECHA y saltaba el hold real.
//
// Fix: availableAt = createdAt + 15d SOLO en las filas rotas (availableAt <
// createdAt). createdAt está sano (diagnóstico A2/A4/A5 = 0) → es la
// reconstrucción correcta. NO toca filas con availableAt >= createdAt (legítimas).
//
// DRY-RUN por defecto; --apply para escribir.
// Usage: railway run --service Postgres-Nq8w node scripts/fix-commission-availableat.cjs [--apply]
const { PrismaClient } = require('@prisma/client');

const HOLD_DAYS = 15;
const DAY = 86400000;
const d = (x) => (x ? new Date(x).toISOString().slice(0, 10) : '—');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const APPLY = process.argv.includes('--apply');

  const all = await prisma.commission.findMany({
    where: { availableAt: { not: null } },
    select: {
      id: true, status: true, createdAt: true, availableAt: true, paidAt: true,
      referralUse: { select: { tenant: { select: { brandName: true } } } },
    },
  });

  const broken = all.filter(
    (c) => new Date(c.availableAt).getTime() < new Date(c.createdAt).getTime(),
  );

  const byStatus = {};
  const fixes = broken.map((c) => {
    byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    return {
      id: c.id,
      brand: c.referralUse?.tenant?.brandName ?? '(grupo/—)',
      status: c.status,
      created: d(c.createdAt),
      oldAvail: d(c.availableAt),
      newAvail: d(new Date(new Date(c.createdAt).getTime() + HOLD_DAYS * DAY)),
      newAvailDate: new Date(new Date(c.createdAt).getTime() + HOLD_DAYS * DAY),
    };
  });

  console.log(`\nComisiones con availableAt: ${all.length}`);
  console.log(`ROTAS (availableAt < createdAt): ${fixes.length}`);
  console.log(`Por estado: ${JSON.stringify(byStatus)}`);
  console.log(`\n== Corrección propuesta (availableAt = createdAt + 15d) ==`);
  for (const f of fixes) {
    console.log(`  ${f.brand} [${f.status}]: ${f.oldAvail} → ${f.newAvail}  (created ${f.created})`);
  }

  if (!APPLY) {
    console.log(`\n[DRY-RUN] No se escribió NADA. Con --apply corrige las ${fixes.length} filas.`);
    console.log(`Nota: solo cambia availableAt de filas IMPOSIBLES; no toca las sanas.`);
    console.log(`Efecto: hold correcto en las PENDING + el mínimo-heurística deja de irse a fechas fantasma.`);
    await prisma.$disconnect();
    return;
  }

  let written = 0;
  for (const f of fixes) {
    await prisma.commission.update({ where: { id: f.id }, data: { availableAt: f.newAvailDate } });
    written++;
  }
  console.log(`\n✅ Corregidas ${written} filas (availableAt = createdAt + 15d).`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
