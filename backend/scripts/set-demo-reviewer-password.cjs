/**
 * Fija la contraseña de la cuenta DEMO que se le entrega al revisor de Apple.
 *
 * Apple exige credenciales para poder entrar y ver la app funcionando; sin
 * ellas rechaza la revisión. La cuenta va sobre el negocio "DEMO CLUBIFY",
 * que tiene datos suficientes (clientes, pedidos, tarjetas) para que la app
 * no se vea vacía.
 *
 * El hash es argon2id, igual que auth.service.hashPassword.
 *
 * Uso:  railway run node scripts/set-demo-reviewer-password.cjs
 */
const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');
const p = new PrismaClient();

const EMAIL = process.env.DEMO_EMAIL || 'clubifydemo@gmail.com';
const PASS = process.env.DEMO_PASS || 'AppleReview2026!';

(async () => {
  const u = await p.user.findUnique({
    where: { email: EMAIL },
    select: { id: true, email: true, fullName: true, role: true, isActive: true, tenantId: true },
  });
  if (!u) {
    console.error(`No existe ${EMAIL}.`);
    process.exit(1);
  }

  const tenant = u.tenantId
    ? await p.tenant.findUnique({
        where: { id: u.tenantId },
        select: { name: true, slug: true, status: true },
      })
    : null;

  await p.user.update({
    where: { id: u.id },
    data: { passwordHash: await argon2.hash(PASS, { type: argon2.argon2id }), isActive: true },
  });

  console.log('Cuenta para el revisor de Apple');
  console.log(`  usuario:    ${u.email}`);
  console.log(`  contraseña: ${PASS}`);
  console.log(`  rol:        ${u.role}`);
  console.log(`  negocio:    ${tenant ? `${tenant.name} (${tenant.slug}) · ${tenant.status}` : '(sin negocio)'}`);
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
