/**
 * Siembra las DOS participaciones globales que confirmó el dueño (2026-10-17):
 *
 *   · Javier — socio comercial — 10 % del precio del plan.
 *   · Sara Plata (código MJUBQ8H8) — 2 % del precio del plan, ADEMÁS de su
 *     comisión de equipo.
 *
 * Las dos: ventas nuevas y renovaciones, vigentes desde siempre, solo Clubify.
 * Sembrarlas NO crea comisiones del pasado: en vivo, una regla solo cubre los
 * cobros que lleguen después de crearla. El histórico es del backfill
 * (`backfill-participaciones.cjs`), que simula primero.
 *
 * CÓMO SE IDENTIFICA A JAVIER (sin inventar datos):
 *   1. `--javier-codigo=XXXX` si ya sabes qué código es el suyo; si no,
 *   2. el usuario con el correo `--javier-email` (por defecto javier@gmail.com,
 *      el del admin) y su código de rol SOCIO (por `ownerUserId` o por correo).
 *   3. Si tiene usuario pero no código SOCIO, se le CREA uno de plataforma
 *      (rol SOCIO, marca Clubify) con su nombre y teléfono del usuario. No se
 *      toca `referrals.socioCodeId`: ese ajuste es el socio único de antes, y
 *      activarlo además de la participación pagaría el 10 % dos veces (el motor
 *      viejo lo evita igual, pero no hace falta tentarlo).
 *   4. Si no aparece el usuario, se aborta la parte de Javier y se listan los
 *      SUPER_ADMIN para que elijas. La de Sara sigue.
 *
 * Simula por defecto. Idempotente: si el beneficiario ya tiene una
 * participación, no se crea otra.
 *
 * Uso:
 *   railway run node scripts/sembrar-participaciones.cjs                (simula)
 *   railway run node scripts/sembrar-participaciones.cjs --aplicar      (escribe)
 *   … --javier-email=otro@correo.com  |  --javier-codigo=ABCD1234
 *   … --inactivas   (las crea desactivadas, para encenderlas desde el panel)
 *
 * Requisito: haber corrido `apply-participaciones-migration.cjs --aplicar` y
 * tener el cliente de Prisma generado con el esquema nuevo (`npx prisma generate`).
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});

const APLICAR = process.argv.includes('--aplicar');
const INACTIVAS = process.argv.includes('--inactivas');
const arg = (k) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3).trim() : null;
};
const JAVIER_EMAIL = (arg('javier-email') || 'javier@gmail.com').toLowerCase();
const JAVIER_CODIGO = arg('javier-codigo');
const SARA_CODIGO = 'MJUBQ8H8';
const MOTIVO = 'Regla confirmada por el dueño el 2026-10-17 (sembrado inicial).';

async function codigoDeJavier(clubifyId) {
  if (JAVIER_CODIGO) {
    const c = await p.referralCode.findUnique({ where: { code: JAVIER_CODIGO.toUpperCase() } });
    if (!c) throw new Error(`No existe el código ${JAVIER_CODIGO}.`);
    return { code: c, crear: null };
  }
  const user = await p.user.findFirst({
    where: { email: { equals: JAVIER_EMAIL, mode: 'insensitive' } },
    select: { id: true, email: true, fullName: true, phone: true, role: true },
  });
  if (!user) {
    const admins = await p.user.findMany({
      where: { role: 'SUPER_ADMIN' },
      select: { email: true, fullName: true },
      take: 30,
    });
    console.log(`\n✗ No hay usuario con el correo ${JAVIER_EMAIL}. SUPER_ADMIN existentes:`);
    for (const a of admins) console.log(`    ${a.email} — ${a.fullName}`);
    console.log('  Vuelve a correrlo con --javier-email=<el suyo> o --javier-codigo=<su código>.');
    return null;
  }
  const code = await p.referralCode.findFirst({
    where: { role: 'SOCIO', OR: [{ ownerUserId: user.id }, { ownerEmail: { equals: user.email, mode: 'insensitive' } }] },
  });
  if (code) return { code, crear: null, user };
  // Código de plataforma nuevo para él. El texto, legible y sin chocar.
  let texto = 'SOCIOJAVIER';
  for (let i = 2; await p.referralCode.findUnique({ where: { code: texto } }); i++) texto = `SOCIOJAVIER${i}`;
  return {
    code: null,
    user,
    crear: {
      code: texto,
      slug: texto.toLowerCase(),
      ownerName: user.fullName,
      ownerEmail: user.email.toLowerCase(),
      ownerWhatsapp: user.phone || '',
      ownerUserId: user.id,
      commissionPercent: 10,
      role: 'SOCIO',
      whiteLabelId: clubifyId,
      isActive: true,
      approvedAt: new Date(),
      source: 'participacion-global',
    },
  };
}

async function sembrar({ nombre, beneficiarioCodeId, valor }) {
  const ya = await p.participacionGlobal.findFirst({ where: { beneficiarioCodeId } });
  if (ya) {
    console.log(`  = «${ya.nombre}» ya existe (${Number(ya.valor)} %, ${ya.activo ? 'activa' : 'inactiva'}). No se toca.`);
    return;
  }
  console.log(`  + «${nombre}»: ${valor} % del precio del plan, nuevas y renovaciones, desde siempre${INACTIVAS ? ', INACTIVA' : ''}.`);
  if (!APLICAR) return;
  const r = await p.participacionGlobal.create({
    data: {
      nombre,
      beneficiarioCodeId,
      tipo: 'PORCENTAJE',
      valor,
      base: 'PRECIO_PLAN',
      aplicaA: 'AMBAS',
      vigenteDesde: null,
      vigenteHasta: null,
      activo: !INACTIVAS,
    },
  });
  await p.reglaDeComisionHistorial.create({
    data: {
      ambito: 'PARTICIPACION',
      reglaId: r.id,
      accion: 'CREADA',
      despues: JSON.parse(JSON.stringify(r)),
      motivo: MOTIVO,
      actorEmail: 'script:sembrar-participaciones',
    },
  });
}

(async () => {
  console.log(APLICAR ? 'MODO: APLICAR (escribe)\n' : 'MODO: SIMULACIÓN (no escribe nada)\n');
  const clubify = await p.whiteLabel.findFirst({ where: { slug: 'clubify' }, select: { id: true } });
  const clubifyId = clubify ? clubify.id : null;

  // Sara
  const sara = await p.referralCode.findUnique({ where: { code: SARA_CODIGO } });
  if (!sara) console.log(`✗ No existe el código ${SARA_CODIGO} (Sara Plata). Su participación no se siembra.`);
  else console.log(`Sara: ${sara.ownerName} <${sara.ownerEmail}> · código ${sara.code} · rol ${sara.role}${sara.isActive ? '' : ' · INACTIVO'}`);

  // Javier
  const j = await codigoDeJavier(clubifyId);
  if (j) {
    if (j.code) console.log(`Javier: ${j.code.ownerName} <${j.code.ownerEmail}> · código ${j.code.code} · rol ${j.code.role}`);
    else console.log(`Javier: usuario ${j.user.fullName} <${j.user.email}> SIN código SOCIO → se crea ${j.crear.code} (plataforma, rol SOCIO).`);
  }

  const socioViejo = await p.setting.findUnique({ where: { key: 'referrals.socioCodeId' } });
  if (socioViejo && socioViejo.value) {
    console.log(`\nAVISO: el ajuste viejo referrals.socioCodeId está en ${socioViejo.value}. Si es el mismo código que el de`);
    console.log('Javier, el motor viejo deja de generar en cuanto exista la participación (no se paga dos veces).');
  }

  console.log('\nParticipaciones:');
  let javierCodeId = j && j.code ? j.code.id : null;
  if (j && !j.code && APLICAR) {
    const creado = await p.referralCode.create({ data: j.crear });
    javierCodeId = creado.id;
    console.log(`  + código ${creado.code} creado para Javier.`);
  }
  if (j) {
    if (javierCodeId) await sembrar({ nombre: 'Javier — socio comercial', beneficiarioCodeId: javierCodeId, valor: 10 });
    else console.log('  + «Javier — socio comercial»: 10 % (se creará junto con su código al aplicar).');
  }
  if (sara) await sembrar({ nombre: 'Sara Plata — participación 2 %', beneficiarioCodeId: sara.id, valor: 2 });

  console.log('\nOJO antes de aplicar (dinero que podría salir dos veces):');
  console.log(' · Contabilidad ya resta una línea «Socio» (10 % del bruto hasta sep-2026, del neto desde oct)');
  console.log('   en la cascada de utilidad (finance/socio.ts). Si ese socio es Javier, la participación');
  console.log('   le paga OTRO 10 % por los cortes de comisiones. Confirmar cuál de los dos queda.');
  console.log(' · Sara ya cobra 2 % de TODAS las ventas por quincena (comisión de equipo). Con esto cobra');
  console.log('   otro 2 % por venta sobre el precio del plan. El dueño dijo «además»: confirmado, pero que conste.');
  if (!APLICAR) console.log('\nSimulación terminada. Para escribir: --aplicar');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
