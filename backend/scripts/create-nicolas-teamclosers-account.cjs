/* WRITE (autorizado por el dueño). Crea la cuenta de login del afiliado
 * "Nicolas ¡TeamClosers!" (código BGXM2QWQ) con la contraseña "Nico1234",
 * replicando setAffiliatePasswordByCode → inviteAffiliate (rama !user):
 *   - crea User (AFFILIATE_INFLUENCER, isActive) con hash argon2id
 *   - linkea ReferralCode.ownerUserId
 * Pre-checks de seguridad: aborta si el código ya tiene cuenta o si el email
 * ya pertenece a un User (para no pisar/duplicar nada). NO toca comisiones.
 */
const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');
const prisma = new PrismaClient();

const CODE = 'BGXM2QWQ';
const PASSWORD = 'Nico1234';

(async () => {
  const code = await prisma.referralCode.findUnique({
    where: { code: CODE },
    select: { id: true, code: true, ownerName: true, ownerEmail: true, ownerWhatsapp: true, ownerUserId: true, role: true },
  });
  if (!code) { console.error(`❌ No existe el código ${CODE}`); return; }
  console.log(`Código ${code.code} · ${code.ownerName} · ${code.ownerEmail} · role=${code.role} · ownerUserId=${code.ownerUserId ?? 'NULL'}`);

  if (code.role !== 'INFLUENCER') { console.error(`❌ role inesperado (${code.role}), aborto`); return; }
  if (code.ownerUserId) { console.error('❌ Ya tiene ownerUserId (cuenta existente) — aborto para no pisar.'); return; }

  const email = code.ownerEmail.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });
  if (existing) { console.error(`❌ Ya existe un User con ${email} (role=${existing.role}) — aborto (usar flujo de link/reset).`); return; }

  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        fullName: code.ownerName || email,
        phone: code.ownerWhatsapp || undefined,
        passwordHash,
        role: 'AFFILIATE_INFLUENCER',
        isActive: true,
      },
      select: { id: true, email: true, role: true, isActive: true },
    });
    await tx.referralCode.update({ where: { id: code.id }, data: { ownerUserId: user.id } });
    return user;
  });

  console.log('\n✅ CUENTA CREADA Y VINCULADA');
  console.log(`   userId:   ${result.id}`);
  console.log(`   email:    ${result.email}`);
  console.log(`   password: ${PASSWORD}`);
  console.log(`   role:     ${result.role} · isActive=${result.isActive}`);
  console.log(`   login:    ${process.env.APP_URL || 'https://soyclubify.com'}/login`);
  await prisma.$disconnect();
})().catch(async (e) => { console.error('ERROR:', e.message); await prisma.$disconnect(); process.exit(1); });
