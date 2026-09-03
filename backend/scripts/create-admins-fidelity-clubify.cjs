/**
 * Crea (o actualiza, idempotente por email) 2 usuarios administradores:
 *
 *   1) jhon@fidelity.com  → PLATFORM_OWNER (master admin de plataforma,
 *      entra en soyfidelity.com/login → /superadmin). Sin tenant ni marca.
 *
 *   2) jhon@clubify.com   → SUPER_ADMIN de la marca Clubify (whiteLabelId=clubify,
 *      entra en soyclubify.com/login → /admin).
 *
 * Contraseña hasheada con argon2id (igual que auth.service.ts).
 *
 * Correr con las credenciales de producción inyectadas por Railway:
 *   railway run node scripts/create-admins-fidelity-clubify.cjs
 *
 * NO imprime secretos — solo email / rol / id.
 */
const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');

const PASSWORD = 'Jhon12345';

const USERS = [
  {
    email: 'jhon@fidelity.com',
    fullName: 'Jhon (Fidelity)',
    role: 'PLATFORM_OWNER',
    brandSlug: null, // sin marca → scope global
  },
  {
    email: 'jhon@clubify.com',
    fullName: 'Jhon (Clubify)',
    role: 'SUPER_ADMIN',
    brandSlug: 'clubify', // admin de la marca Clubify
  },
];

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('❌ No hay DATABASE_URL / DATABASE_PUBLIC_URL en el entorno.');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

    for (const u of USERS) {
      let whiteLabelId = null;
      if (u.brandSlug) {
        const wl = await prisma.whiteLabel.findUnique({
          where: { slug: u.brandSlug },
          select: { id: true, name: true },
        });
        if (!wl) {
          console.error(
            `❌ WhiteLabel slug="${u.brandSlug}" no encontrada — se omite ${u.email}`,
          );
          continue;
        }
        whiteLabelId = wl.id;
      }

      const email = u.email.trim().toLowerCase();
      const saved = await prisma.user.upsert({
        where: { email },
        create: {
          email,
          passwordHash,
          fullName: u.fullName,
          role: u.role,
          whiteLabelId,
          tenantId: null,
          isActive: true,
        },
        update: {
          passwordHash, // resetea la contraseña a la definida arriba
          fullName: u.fullName,
          role: u.role,
          whiteLabelId,
          tenantId: null,
          isActive: true,
        },
        select: { id: true, email: true, role: true, whiteLabelId: true },
      });

      console.log(
        `✅ ${saved.email} · role=${saved.role} · whiteLabelId=${saved.whiteLabelId ?? 'null'} · id=${saved.id}`,
      );
    }

    console.log('\nListo. Contraseña de ambos: (la definida en el script)');
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
