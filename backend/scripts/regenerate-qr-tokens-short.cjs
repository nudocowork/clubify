/**
 * Regenera el `qrToken` de los pases que todavía llevan el JWT largo (fix #1
 * 2026-06-16) o un placeholder, al formato corto e inforjable `QR-<nanoid>`
 * (fix 2026-06-17). El JWT de ~200 chars dejaba el PDF417 del pase tan denso
 * que costaba escanearlo; el token corto lo deja limpio como el modelo
 * original sin reabrir el agujero de seguridad (sigue siendo inadivinable y
 * el scanner lo busca por `qrToken` @unique).
 *
 * SEGURO / idempotente: NO toca pases que ya tienen el formato corto ni los
 * que solo tienen serial plano (esos los cubre el fallback del scanner).
 *
 * Uso (read-only primero):
 *   DRY=1 node backend/scripts/regenerate-qr-tokens-short.cjs
 * Aplicar:
 *   node backend/scripts/regenerate-qr-tokens-short.cjs
 * Acotar a tenants puntuales (substring de brandName, coma-separado):
 *   NAMES=amont,revent node backend/scripts/regenerate-qr-tokens-short.cjs
 *
 * Después de correrlo, gatillar el refresh global de wallets por tenant
 * (POST /api/passes/refresh-all/:tenantId, SUPER_ADMIN) para que los pases
 * YA instalados re-fetcheen y muestren el barcode corto nuevo.
 */
const { PrismaClient } = require('@prisma/client');
const { customAlphabet } = require('nanoid');

// Mismo alfabeto/longitud que genQrToken() en passes.service.ts.
const nano = customAlphabet(
  'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict',
  20,
);
const genQrToken = () => `QR-${nano()}`;

const DRY = process.env.DRY === '1';

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  // Filtro opcional por tenant.
  let tenantIds = null;
  if (process.env.NAMES) {
    const names = process.env.NAMES.split(',').map((s) => s.trim()).filter(Boolean);
    const tenants = await prisma.tenant.findMany({
      where: { OR: names.map((n) => ({ brandName: { contains: n, mode: 'insensitive' } })) },
      select: { id: true, brandName: true },
    });
    tenantIds = tenants.map((t) => t.id);
    console.log(`Acotado a ${tenants.length} tenant(s): ${tenants.map((t) => t.brandName).join(', ')}`);
    if (!tenantIds.length) { console.log('Sin tenants que coincidan. Saliendo.'); process.exit(0); }
  }

  const passes = await prisma.pass.findMany({
    where: { status: { not: 'REVOKED' }, ...(tenantIds ? { tenantId: { in: tenantIds } } : {}) },
    select: { id: true, qrToken: true, tenantId: true },
  });

  // Un qrToken hay que regenerarlo si: es JWT (3 partes con puntos),
  // es el placeholder, o está vacío. Si ya empieza con 'QR-' está OK.
  const needsFix = passes.filter((p) => {
    const t = p.qrToken || '';
    if (t.startsWith('QR-')) return false;
    return t.split('.').length === 3 || t === 'placeholder' || t === '';
  });

  console.log(`Pases totales en alcance: ${passes.length}`);
  console.log(`A regenerar (JWT/placeholder/vacío): ${needsFix.length}`);

  // Desglose por tenant (informativo).
  const byTenant = {};
  for (const p of needsFix) byTenant[p.tenantId] = (byTenant[p.tenantId] || 0) + 1;
  console.log(`Tenants afectados: ${Object.keys(byTenant).length}`);

  if (DRY) { console.log('DRY=1 → no se aplica nada.'); process.exit(0); }

  let done = 0;
  for (const p of needsFix) {
    // Reintento por colisión improbable del índice @unique.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await prisma.pass.update({ where: { id: p.id }, data: { qrToken: genQrToken() } });
        done += 1;
        break;
      } catch (e) {
        if (e?.code === 'P2002' && attempt < 4) continue;
        throw e;
      }
    }
    if (done % 200 === 0) console.log(`  ...${done}/${needsFix.length}`);
  }

  console.log(`Listo. Regenerados: ${done}`);
  console.log('Siguiente paso: refresh global de wallets por cada tenant afectado.');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
