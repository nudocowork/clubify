/* READ-ONLY. Estado del afiliado "Nicolas TeamClosers" (código BGXM2QWQ) para
 * diagnosticar por qué no puede acceder al panel ni crear contraseña. Solo SELECT. */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // Buscar por código Y por nombre (por si el código cambió).
  const codes = await prisma.referralCode.findMany({
    where: {
      OR: [
        { code: 'BGXM2QWQ' },
        { ownerName: { contains: 'TeamClosers', mode: 'insensitive' } },
        { ownerName: { contains: 'Nicolas', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true, code: true, ownerName: true, ownerEmail: true, ownerUserId: true,
      role: true, isActive: true, createdAt: true,
    },
  });
  console.log('=== ReferralCodes que matchean Nicolas/TeamClosers ===');
  for (const c of codes) {
    console.log(`\n• ${c.ownerName} · code=${c.code} · role=${c.role} · active=${c.isActive}`);
    console.log(`  email=${c.ownerEmail} · ownerUserId=${c.ownerUserId ?? 'NULL'}`);
    // ¿Existe User con ese email? ¿qué rol?
    if (c.ownerEmail) {
      const u = await prisma.user.findUnique({
        where: { email: c.ownerEmail.toLowerCase().trim() },
        select: { id: true, email: true, role: true, isActive: true, tenantId: true },
      });
      if (!u) {
        console.log(`  → NO existe User con ese email → CREABLE (el botón 🔑 debería crear la cuenta)`);
      } else {
        console.log(`  → User existe: id=${u.id} · role=${u.role} · isActive=${u.isActive} · tenantId=${u.tenantId ?? 'null'}`);
        console.log(`     ${u.role.startsWith('AFFILIATE_') ? 'LINKEABLE (afiliado) — impersonate lo auto-vincula' : '⚠️ CONFLICTO: User NO-afiliado → inviteAffiliate tira ConflictException, no linkea ni crea pass'}`);
        console.log(`     ¿ownerUserId coincide con este User? ${c.ownerUserId === u.id ? 'SÍ (ya vinculado)' : 'NO'}`);
      }
    }
  }
  console.log('\n======== FIN (read-only) ========');
  await prisma.$disconnect();
})().catch(async (e) => { console.error('ERROR:', e.message); await prisma.$disconnect(); process.exit(1); });
