#!/usr/bin/env node
/**
 * Aplica el layout SECTIONS al tenant NudoCowork:
 * 1. Cambia Storefront.menuLayout = 'SECTIONS'
 * 2. Para cada Category existente, aplica un cover template apropiado
 *    + tagline + imagen de fondo Unsplash temática.
 *
 * Idempotente: si ya tienen coverConfig, no lo pisa (skip). Si quiere
 * resetear, primero limpiar manualmente.
 *
 * Uso:
 *   railway run --service Postgres -- bash -c \
 *     'DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/seed-nudocowork-sections.mjs'
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TENANT_SLUG = 'nudocowork';

// Imagen Unsplash 800px (placeholder hasta que NudoCowork suba la propia)
const IMG = (id) =>
  `https://images.unsplash.com/${id}?w=1200&q=80&auto=format&fit=crop`;

// Cada entry: { slugMatch: regex/string, template: <id>, tagline, bgImg }
const SECTION_TEMPLATES = [
  {
    slugMatch: /caliente|bebidas-calientes/,
    template: 'vintage-cafe',
    tagline: 'Espressos, americanos y especialidades',
    bgImg: IMG('photo-1495474472287-4d71bcdd2085'),
  },
  {
    slugMatch: /frio|frias/,
    template: 'fresh-fitness',
    tagline: 'Iced, cold brew y frappes',
    bgImg: IMG('photo-1461023058943-07fcbe16d735'),
  },
  {
    slugMatch: /postre/,
    template: 'pasteleria-rosa',
    tagline: 'Dulces hechos en casa',
    bgImg: IMG('photo-1551024601-bec78aea704b'),
  },
  {
    slugMatch: /brunch/,
    template: 'minimal-claro',
    tagline: 'Desayunos completos hasta el mediodía',
    bgImg: IMG('photo-1525351484163-7529414344d8'),
  },
  {
    slugMatch: /sandwich|sándwich/,
    template: 'gourmet-dark',
    tagline: 'Frescos, calentitos y bien rellenos',
    bgImg: IMG('photo-1528735602780-2552fd46c7af'),
  },
  {
    slugMatch: /embotellado/,
    template: 'premium-gold',
    tagline: 'Bebidas premium y refrigeradas',
    bgImg: IMG('photo-1553530666-ba11a7da3888'),
  },
  {
    slugMatch: /soda/,
    template: 'vibrante',
    tagline: 'Refrescantes y burbujeantes',
    bgImg: IMG('photo-1437418747212-8d9709afab22'),
  },
  {
    slugMatch: /jugo/,
    template: 'fresh-fitness',
    tagline: 'Hechos al momento con frutas frescas',
    bgImg: IMG('photo-1622597467836-f3285f2131b8'),
  },
];

// Templates copiados del frontend section-cover-templates.ts. Si se
// actualizan ahí, hay que mantenerlos sincronizados acá. (No los importo
// porque sería molesto cruzar frontend↔backend; el script es one-shot.)
const COVER_TEMPLATES = {
  'gourmet-dark': {
    version: 1,
    bgImageUrl: null,
    bgColor: '#0a0a0a',
    bgFit: 'cover',
    bgPosition: 'center',
    overlay: { color: 'linear-gradient(180deg, rgba(10,10,10,0.15) 0%, rgba(10,10,10,0.85) 100%)', opacity: 1 },
    height: 240,
    borderRadius: 16,
    align: 'left',
    verticalAlign: 'bottom',
    paddingX: 24,
    paddingY: 28,
    title: { color: '#FFFFFF', fontFamily: '"Playfair Display", Georgia, serif', fontWeight: 700, fontSize: 36, letterSpacing: -0.02, lineHeight: 1.05, shadow: { color: 'rgba(0,0,0,0.5)', blur: 10, offsetY: 2 }, transform: 'none' },
    tagline: { color: 'rgba(255,255,255,0.85)', fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 400, fontSize: 14, letterSpacing: 0, lineHeight: 1.4, shadow: null, transform: 'none' },
    badge: null,
    badgeText: null,
  },
  'premium-gold': {
    version: 1,
    bgImageUrl: null,
    bgColor: '#0d0d0d',
    bgFit: 'cover',
    bgPosition: 'center',
    overlay: { color: 'linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.7) 100%)', opacity: 1 },
    height: 220,
    borderRadius: 12,
    align: 'center',
    verticalAlign: 'middle',
    paddingX: 24,
    paddingY: 24,
    title: { color: '#D4AF37', fontFamily: '"Cormorant Garamond", serif', fontWeight: 700, fontSize: 38, letterSpacing: 0.08, lineHeight: 1.0, shadow: { color: 'rgba(0,0,0,0.6)', blur: 12, offsetY: 2 }, transform: 'uppercase' },
    tagline: { color: 'rgba(212,175,55,0.85)', fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 400, fontSize: 12, letterSpacing: 0.2, lineHeight: 1.4, shadow: null, transform: 'uppercase' },
    badge: null,
    badgeText: null,
  },
  'vibrante': {
    version: 1,
    bgImageUrl: null,
    bgColor: '#F97316',
    bgFit: 'cover',
    bgPosition: 'center',
    overlay: { color: 'linear-gradient(135deg, rgba(249,115,22,0.6) 0%, rgba(234,179,8,0.4) 100%)', opacity: 1 },
    height: 200,
    borderRadius: 20,
    align: 'left',
    verticalAlign: 'middle',
    paddingX: 24,
    paddingY: 20,
    title: { color: '#FFFFFF', fontFamily: '"Archivo Black", sans-serif', fontWeight: 400, fontSize: 36, letterSpacing: -0.01, lineHeight: 0.95, shadow: { color: 'rgba(0,0,0,0.3)', blur: 6, offsetY: 2 }, transform: 'none' },
    tagline: { color: '#FFFFFF', fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 600, fontSize: 14, letterSpacing: 0, lineHeight: 1.3, shadow: null, transform: 'none' },
    badge: null,
    badgeText: null,
  },
  'minimal-claro': {
    version: 1,
    bgImageUrl: null,
    bgColor: '#FAFAF9',
    bgFit: 'cover',
    bgPosition: 'center',
    overlay: { color: 'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(0,0,0,0.5) 100%)', opacity: 1 },
    height: 200,
    borderRadius: 12,
    align: 'left',
    verticalAlign: 'bottom',
    paddingX: 28,
    paddingY: 24,
    title: { color: '#FFFFFF', fontFamily: '"DM Serif Display", serif', fontWeight: 400, fontSize: 34, letterSpacing: -0.01, lineHeight: 1.05, shadow: { color: 'rgba(0,0,0,0.4)', blur: 8, offsetY: 2 }, transform: 'none' },
    tagline: { color: 'rgba(255,255,255,0.9)', fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 400, fontSize: 13, letterSpacing: 0, lineHeight: 1.4, shadow: null, transform: 'none' },
    badge: null,
    badgeText: null,
  },
  'vintage-cafe': {
    version: 1,
    bgImageUrl: null,
    bgColor: '#4A2C20',
    bgFit: 'cover',
    bgPosition: 'center',
    overlay: { color: 'linear-gradient(180deg, rgba(74,44,32,0.3) 0%, rgba(74,44,32,0.8) 100%)', opacity: 1 },
    height: 220,
    borderRadius: 8,
    align: 'center',
    verticalAlign: 'middle',
    paddingX: 24,
    paddingY: 24,
    title: { color: '#F5EBDC', fontFamily: 'Lobster, cursive', fontWeight: 400, fontSize: 38, letterSpacing: 0, lineHeight: 1.0, shadow: { color: 'rgba(0,0,0,0.4)', blur: 6, offsetY: 2 }, transform: 'none' },
    tagline: { color: '#D4B896', fontFamily: '"Cormorant Garamond", serif', fontWeight: 400, fontSize: 14, letterSpacing: 0.05, lineHeight: 1.4, shadow: null, transform: 'uppercase' },
    badge: null,
    badgeText: null,
  },
  'fresh-fitness': {
    version: 1,
    bgImageUrl: null,
    bgColor: '#06B6D4',
    bgFit: 'cover',
    bgPosition: 'center',
    overlay: { color: 'linear-gradient(135deg, rgba(6,182,212,0.7) 0%, rgba(163,230,53,0.3) 100%)', opacity: 1 },
    height: 200,
    borderRadius: 20,
    align: 'left',
    verticalAlign: 'bottom',
    paddingX: 24,
    paddingY: 20,
    title: { color: '#FFFFFF', fontFamily: 'Montserrat, sans-serif', fontWeight: 900, fontSize: 34, letterSpacing: -0.02, lineHeight: 1.0, shadow: { color: 'rgba(0,0,0,0.25)', blur: 4, offsetY: 1 }, transform: 'uppercase' },
    tagline: { color: '#FFFFFF', fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 500, fontSize: 13, letterSpacing: 0.05, lineHeight: 1.3, shadow: null, transform: 'none' },
    badge: null,
    badgeText: null,
  },
  'pasteleria-rosa': {
    version: 1,
    bgImageUrl: null,
    bgColor: '#FCE7F3',
    bgFit: 'cover',
    bgPosition: 'center',
    overlay: { color: 'linear-gradient(180deg, rgba(252,231,243,0.1) 0%, rgba(236,72,153,0.5) 100%)', opacity: 1 },
    height: 210,
    borderRadius: 24,
    align: 'center',
    verticalAlign: 'middle',
    paddingX: 24,
    paddingY: 24,
    title: { color: '#FFFFFF', fontFamily: '"Great Vibes", cursive', fontWeight: 400, fontSize: 44, letterSpacing: 0, lineHeight: 1.0, shadow: { color: 'rgba(190,24,93,0.4)', blur: 8, offsetY: 2 }, transform: 'none' },
    tagline: { color: 'rgba(255,255,255,0.95)', fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 500, fontSize: 13, letterSpacing: 0.05, lineHeight: 1.4, shadow: null, transform: 'uppercase' },
    badge: null,
    badgeText: null,
  },
};

async function main() {
  console.log(`\nBuscando tenant ${TENANT_SLUG}...`);
  const tenant = await prisma.tenant.findUnique({
    where: { slug: TENANT_SLUG },
    include: { storefront: true },
  });
  if (!tenant) {
    console.error(`✗ Tenant ${TENANT_SLUG} no encontrado`);
    process.exit(1);
  }
  console.log(`✓ Tenant: ${tenant.brandName} (id ${tenant.id})`);

  // 1. Cambiar layout a SECTIONS
  console.log('\n1. Storefront → menuLayout = SECTIONS');
  if (tenant.storefront) {
    await prisma.storefront.update({
      where: { id: tenant.storefront.id },
      data: { menuLayout: 'SECTIONS' },
    });
    console.log(`   ✓ Actualizado (antes: ${tenant.storefront.menuLayout})`);
  } else {
    await prisma.storefront.create({
      data: {
        tenantId: tenant.id,
        menuLayout: 'SECTIONS',
        isPublished: true,
      },
    });
    console.log('   ✓ Storefront creado con menuLayout SECTIONS');
  }

  // 2. Aplicar coverConfig + tagline a cada categoría
  console.log('\n2. Aplicando portadas a categorías...');
  const cats = await prisma.category.findMany({
    where: { tenantId: tenant.id, parentId: null },
    orderBy: { position: 'asc' },
  });

  let applied = 0;
  let skipped = 0;
  for (const c of cats) {
    if (c.coverConfig) {
      console.log(`   = ${c.name} — ya tiene portada, skip`);
      skipped++;
      continue;
    }
    const match = SECTION_TEMPLATES.find((t) => t.slugMatch.test(c.slug));
    if (!match) {
      console.log(`   ? ${c.name} (slug "${c.slug}") — no matchea ningún template, skip`);
      skipped++;
      continue;
    }
    const template = COVER_TEMPLATES[match.template];
    if (!template) {
      console.log(`   ✗ Template ${match.template} no encontrado en el script`);
      skipped++;
      continue;
    }
    const config = { ...template, bgImageUrl: match.bgImg };
    await prisma.category.update({
      where: { id: c.id },
      data: {
        coverConfig: config,
        tagline: match.tagline,
        imageUrl: match.bgImg,
      },
    });
    console.log(`   ✓ ${c.name} → ${match.template}`);
    applied++;
  }

  console.log(`\nListo. Aplicadas: ${applied}, omitidas: ${skipped}`);
  console.log(`\nVer en: https://soyclubify.com/m/${TENANT_SLUG}`);
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
