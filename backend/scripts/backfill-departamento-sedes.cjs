/**
 * Rellena `Location.state` (departamento/estado de la sede) leyéndolo de la
 * dirección que el negocio ya cargó.
 *
 * Por qué importa: de ese campo depende que el cliente vea SOLO los municipios
 * de la zona del negocio al pedir a domicilio, en vez de los 32 departamentos
 * de Colombia. Estaba como texto libre en el panel y solo 16 de 130 sedes lo
 * tenían puesto — para el resto, el checkout sigue mostrando el país entero.
 *
 * Cómo deduce: busca en `address` el nombre de un municipio o de un
 * departamento del dataset curado (el mismo que usa el checkout, así el valor
 * SIEMPRE casa). Si la dirección no lo dice, no inventa: deja el campo vacío
 * para que el negocio lo elija en el panel.
 *
 * SOLO LECTURA salvo `--aplicar`.
 *
 * Uso:
 *   railway run node scripts/backfill-departamento-sedes.cjs
 *   railway run node scripts/backfill-departamento-sedes.cjs --aplicar
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const APLICAR = process.argv.includes('--aplicar');

/** Lee el dataset del frontend: una sola fuente de verdad para los nombres. */
function cargarDataset() {
  const ruta = path.join(
    __dirname,
    '..',
    '..',
    'frontend',
    'src',
    'lib',
    'co-locations.ts',
  );
  const src = fs.readFileSync(ruta, 'utf8');
  const deps = [];
  const re = /departamento:\s*'([^']+)',\s*municipios:\s*\[([\s\S]*?)\]/g;
  let m;
  while ((m = re.exec(src))) {
    const municipios = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    deps.push({ departamento: m[1], municipios });
  }
  return deps;
}

const norm = (x) =>
  (x ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

(async () => {
  const DEPS = cargarDataset();
  if (!DEPS.length) {
    console.error('No pude leer el dataset de departamentos. Aborto.');
    return p.$disconnect();
  }
  console.log(`Dataset: ${DEPS.length} departamentos.\n`);

  const sedes = await p.$queryRawUnsafe(`
    SELECT l.id, l.name, l.address, l.state, t."brandName", t.country
      FROM "Location" l JOIN "Tenant" t ON t.id = l."tenantId"
     WHERE l."isActive" = true
       AND (l.state IS NULL OR l.state = '')
     ORDER BY t."brandName"`);

  console.log(`Sedes activas sin departamento: ${sedes.length}\n`);

  const deducidas = [];
  const sinDeducir = [];

  for (const s of sedes) {
    // Solo Colombia: el dataset que leemos es el colombiano. Otros países
    // quedan para el negocio, no adivinamos con datos que no tenemos.
    if ((s.country ?? 'CO') !== 'CO') {
      sinDeducir.push({ ...s, motivo: `país ${s.country}` });
      continue;
    }
    const dir = norm(s.address);
    if (!dir.trim()) {
      sinDeducir.push({ ...s, motivo: 'sin dirección' });
      continue;
    }

    // Primero por municipio (más específico), luego por departamento.
    let hallado = null;
    for (const d of DEPS) {
      for (const mun of d.municipios) {
        // Palabra completa: "Cali" no debe casar dentro de "Calima".
        const re = new RegExp(`(^|[^a-z])${norm(mun)}([^a-z]|$)`);
        if (re.test(dir)) {
          hallado = { dep: d.departamento, por: `municipio "${mun}"` };
          break;
        }
      }
      if (hallado) break;
    }
    if (!hallado) {
      for (const d of DEPS) {
        const re = new RegExp(`(^|[^a-z])${norm(d.departamento)}([^a-z]|$)`);
        if (re.test(dir)) {
          hallado = { dep: d.departamento, por: 'nombre del departamento' };
          break;
        }
      }
    }

    if (hallado) deducidas.push({ ...s, ...hallado });
    else sinDeducir.push({ ...s, motivo: 'la dirección no lo dice' });
  }

  console.log(`Deducidas: ${deducidas.length}`);
  for (const d of deducidas.slice(0, 30)) {
    console.log(
      `  ${String(d.brandName).slice(0, 22).padEnd(22)} ${String(d.name).slice(0, 18).padEnd(18)} → ${d.dep}  (por ${d.por})`,
    );
  }
  if (deducidas.length > 30) console.log(`  … y ${deducidas.length - 30} más`);

  console.log(`\nSin deducir: ${sinDeducir.length} (las elige el negocio en el panel)`);
  const motivos = {};
  for (const x of sinDeducir) motivos[x.motivo] = (motivos[x.motivo] ?? 0) + 1;
  for (const [k, v] of Object.entries(motivos)) console.log(`  ${v} · ${k}`);

  if (!APLICAR) {
    console.log('\n(en seco — volvé a correrlo con --aplicar para escribir)');
    return p.$disconnect();
  }

  let n = 0;
  for (const d of deducidas) {
    await p.$executeRawUnsafe(
      `UPDATE "Location" SET state = $1 WHERE id = $2`,
      d.dep,
      d.id,
    );
    n++;
  }
  console.log(`\n✅ ${n} sede(s) actualizadas. Ninguna otra columna fue tocada.`);

  await p.$disconnect();
})().catch(async (e) => {
  console.error('FALLÓ:', e.message);
  await p.$disconnect();
  process.exit(1);
});
