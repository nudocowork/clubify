/* READ-ONLY. Prueba /admin/commissions/company-report EN VIVO con token de un
 * SUPER_ADMIN de Clubify (whiteLabelId null), comparando from+to vs from-only.
 * Confirma si el BACKEND aplica el límite `to`. No escribe nada. */
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const prisma = new PrismaClient();

(async () => {
  const u =
    (await prisma.user.findFirst({
      where: { role: 'SUPER_ADMIN', whiteLabelId: null },
      select: { id: true, email: true, role: true, tenantId: true, whiteLabelId: true },
    })) ||
    (await prisma.user.findFirst({
      where: { role: 'SUPER_ADMIN' },
      select: { id: true, email: true, role: true, tenantId: true, whiteLabelId: true },
    }));
  if (!u) { console.error('no SUPER_ADMIN'); return; }
  console.log(`token de: ${u.email} · role=${u.role} · whiteLabelId=${u.whiteLabelId ?? 'null(Clubify)'}`);
  const token = jwt.sign(
    { sub: u.id, email: u.email, role: u.role, tenantId: u.tenantId, whiteLabelId: u.whiteLabelId },
    process.env.JWT_SECRET,
    { expiresIn: '10m' },
  );
  const bs = 'https://api.soyclubify.com/api/admin/commissions/company-report';
  async function hit(qs) {
    const r = await fetch(`${bs}${qs ? `?${qs}` : ''}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return `HTTP ${r.status}`;
    const j = await r.json();
    const rows = j.rows ?? [];
    const arepas = rows.some((x) => JSON.stringify(x).toLowerCase().includes('arepas'));
    return `rows=${rows.length} · incluyeArepas(ago6)=${arepas}`;
  }
  console.log('sin filtro       :', await hit(''));
  console.log('from=jun15 solo  :', await hit('from=2026-06-15'));
  console.log('from+to jun15-30 :', await hit('from=2026-06-15&to=2026-06-30'));
  await prisma.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
