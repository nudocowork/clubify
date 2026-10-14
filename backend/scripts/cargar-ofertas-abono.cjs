/**
 * Carga las ofertas de Hotmart de octubre 2026 (la Mensualidad básica y los
 * planes «+ Abono», que cobran la diferencia cuando el cliente ya dio un abono) en la lista de ENLACES DE VENTA (`landing.enlacesDeVenta`).
 *
 * Esa lista es la que pinta el panel de cada influencer, embajador y vendedor
 * en «Enlaces de pago directo», con SU código metido en `sck`: así Hotmart
 * devuelve el código en el aviso del pago y la comisión queda a su nombre
 * aunque el cliente no pase por su /ref. Nada de esto toca el código del
 * panel: es la misma lista que se edita en /admin/branding.
 *
 * Mezcla, no reemplaza: los enlaces añadidos que ya existan se conservan, y
 * estas cinco se crean o se actualizan por su `id`. La periodicidad va en cada
 * una porque el alta de Hotmart la usa de respaldo (`periodicidadDeLaOferta`).
 *
 *   railway run --service backend --environment production node scripts/cargar-ofertas-abono.cjs           (simula)
 *   railway run --service backend --environment production node scripts/cargar-ofertas-abono.cjs --aplicar
 */
const { PrismaClient } = require('@prisma/client');

const APLICAR = process.argv.includes('--aplicar');
const CLAVE = 'landing.enlacesDeVenta';

const OFERTAS = [
  {
    // Plan APARTE, no es abono: solo tarjetas de sellos, cupones y
    // geolocalización (Javier, 2026-10-13). Aún sin ventas.
    id: 'mensualidad-basica-25',
    nombre: 'Mensualidad básica',
    tipo: 'NORMAL',
    periodicidad: 'MENSUAL',
    precioUsd: 25,
    url: 'https://pay.hotmart.com/U102596072A?off=shoro1ov',
    activo: true,
  },
  {
    id: 'mensual-abono-48',
    nombre: 'Plan Mensual + Abono',
    tipo: 'NORMAL',
    periodicidad: 'MENSUAL',
    precioUsd: 48,
    url: 'https://pay.hotmart.com/U102596072A?off=n8e031ty',
    activo: true,
  },
  {
    id: 'trimestral-abono-135',
    nombre: 'Plan Trimestral + Abono',
    tipo: 'NORMAL',
    periodicidad: 'TRIMESTRAL',
    precioUsd: 135,
    url: 'https://pay.hotmart.com/U102596072A?off=2oxitibw&bid=1780088368942',
    activo: true,
  },
  {
    id: 'semestral-abono-258',
    nombre: 'Plan Semestral + Abono',
    tipo: 'NORMAL',
    periodicidad: 'SEMESTRAL',
    precioUsd: 258,
    url: 'https://pay.hotmart.com/U102596072A?off=52fe5ax7',
    activo: true,
  },
  {
    id: 'anual-abono-480',
    nombre: 'Plan Anual + Abono',
    tipo: 'NORMAL',
    periodicidad: 'ANUAL',
    precioUsd: 480,
    url: 'https://pay.hotmart.com/U102596072A?off=kkczwdkt',
    activo: true,
  },
];

const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});

(async () => {
  const fila = await p.setting.findUnique({ where: { key: CLAVE } });
  let actuales = [];
  try {
    actuales = fila?.value ? JSON.parse(fila.value) : [];
  } catch {
    throw new Error(`El ajuste ${CLAVE} no es JSON válido: revisar a mano antes de tocarlo.`);
  }
  if (!Array.isArray(actuales)) actuales = [];

  console.log(`Enlaces añadidos hoy: ${actuales.length}`);
  for (const e of actuales) console.log(`  · ${e.id} — ${e.nombre} ${e.activo === false ? '(inactivo)' : ''}`);

  // Una oferta ya cargada con OTRO id pero el mismo off= no se duplica.
  const offDe = (u) => {
    try {
      return new URL(u).searchParams.get('off');
    } catch {
      return null;
    }
  };
  const nueva = [...actuales];
  for (const o of OFERTAS) {
    const i = nueva.findIndex((e) => e.id === o.id || offDe(e.url) === offDe(o.url));
    if (i >= 0) {
      console.log(`  ~ actualizo ${o.nombre} (${nueva[i].id})`);
      nueva[i] = { ...o, id: nueva[i].id };
    } else {
      console.log(`  + agrego ${o.nombre} · $${o.precioUsd} · ${o.periodicidad}`);
      nueva.push(o);
    }
  }

  if (!APLICAR) {
    console.log(`\n(simulación: quedarían ${nueva.length} enlaces añadidos; --aplicar para guardar)`);
    return p.$disconnect();
  }
  await p.setting.upsert({
    where: { key: CLAVE },
    update: { value: JSON.stringify(nueva) },
    create: { key: CLAVE, value: JSON.stringify(nueva) },
  });
  console.log(`\n✓ Guardado. Los afiliados las ven en su panel al recargar.`);
  console.log('  Comprobación: https://api.soyclubify.com/api/enlaces-de-venta');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
