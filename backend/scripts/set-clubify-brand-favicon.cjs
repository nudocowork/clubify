// Da a la marca 'clubify' su favicon/branding para que el GENERADOR de iconos
// (?slug=clubify) lo sirva cuadrado y opaco (símbolo verde sobre fondo blanco
// → visible a 16/32px). Toma el favicon custom del Setting branding (la flecha)
// como fuente. Idempotente. Correr una vez.
// Usage: railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/set-clubify-brand-favicon.cjs
const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  // Favicon/logo actuales de Clubify (los que sirve /api/branding). Fuente
  // primaria: el Setting; si no se puede leer, fallback a las URLs conocidas
  // (R2 inmutable). Así el script garantiza la flecha aunque el esquema del
  // Setting cambie.
  const FALLBACK_FAVICON =
    'https://pub-6de3a37544604346a69b9836aed1c6cf.r2.dev/branding/AkXaqJXHJCxPamgz.png';
  const FALLBACK_LOGO =
    'https://pub-6de3a37544604346a69b9836aed1c6cf.r2.dev/branding/UczDGgvIcjIB0xjT.png';
  let favicon = FALLBACK_FAVICON;
  let logo = FALLBACK_LOGO;
  try {
    const settings = await prisma.setting.findMany({
      where: { key: { in: ['branding.faviconUrl', 'branding.appLogoUrl'] } },
    });
    const get = (k) => settings.find((s) => s.key === k)?.value || null;
    favicon = get('branding.faviconUrl') || FALLBACK_FAVICON;
    logo = get('branding.appLogoUrl') || FALLBACK_LOGO;
  } catch (e) {
    console.log('• No pude leer Setting (uso fallback):', e.message);
  }
  console.log('faviconUrl:', favicon);
  console.log('logoUrl:', logo);

  const wl = await prisma.whiteLabel.findFirst({ where: { slug: 'clubify' } });
  if (!wl) {
    console.error('No existe la marca clubify.');
    process.exit(1);
  }

  await prisma.whiteLabel.update({
    where: { id: wl.id },
    data: {
      // El generador usa faviconUrl → iconUrl → logoUrl. La flecha como favicon.
      faviconUrl: favicon || wl.faviconUrl,
      iconUrl: favicon || wl.iconUrl,
      logoUrl: logo || wl.logoUrl,
      // Fondo blanco → los propósitos opacos (apple/maskable y el favicon que
      // servimos opaco) muestran el símbolo verde sobre blanco, visible.
      backgroundColor: wl.backgroundColor || '#ffffff',
    },
  });

  console.log('✅ Marca clubify actualizada (faviconUrl/iconUrl/logoUrl/backgroundColor).');
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
