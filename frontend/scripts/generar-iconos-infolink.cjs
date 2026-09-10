/**
 * Genera `src/components/info-link-icons-lucide.ts` desde el catálogo curado.
 *
 *   cd frontend
 *   npm install --no-save lucide-static
 *   node scripts/generar-iconos-infolink.cjs
 *
 * POR QUÉ SE GENERA Y NO SE INSTALA UNA LIBRERÍA
 * ---------------------------------------------
 * `lucide-react` en el bundle mete el componente de cada icono. Esta página
 * (`/i/<slug>/<link>`) es PÚBLICA y la abre gente desde el móvil con datos:
 * cargar una librería entera para pintar cinco botones no se paga. Aquí solo
 * se copia el trazo SVG de los iconos del catálogo — unos 100 bytes cada uno,
 * sin dependencia en tiempo de ejecución y sin tocar `package.json`.
 *
 * Por eso `lucide-static` se instala con `--no-save`: hace falta para
 * REGENERAR, nunca para compilar ni para desplegar. El archivo generado se
 * commitea.
 *
 * LICENCIA
 * --------
 * Lucide es ISC (permite uso comercial sin atribución visible en el producto,
 * a diferencia de Flaticon, cuya licencia gratuita EXIGE crédito en cada uso).
 * El aviso de copyright viaja en la cabecera del archivo generado.
 */
const fs = require('node:fs');
const path = require('node:path');

const CATALOGO = require('./catalogo-iconos-infolink.cjs');
const DIR_ICONOS = path.join(__dirname, '..', 'node_modules', 'lucide-static', 'icons');
const SALIDA = path.join(__dirname, '..', 'src', 'components', 'info-link-icons-lucide.ts');

if (!fs.existsSync(DIR_ICONOS)) {
  console.error(
    'ERR falta lucide-static. Instálalo solo para generar:\n' +
      '    npm install --no-save lucide-static',
  );
  process.exit(1);
}

/** Se queda con el interior del <svg>: los <path>, <circle>, <line>… */
function interiorDelSvg(nombre) {
  const bruto = fs.readFileSync(path.join(DIR_ICONOS, `${nombre}.svg`), 'utf8');
  const m = bruto.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
  if (!m) throw new Error(`el SVG de "${nombre}" no tiene la forma esperada`);
  return m[1]
    .replace(/\s*\n\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const faltantes = [];
const vistos = new Set();
const duplicados = [];
const grupos = [];

for (const { categoria, iconos } of CATALOGO) {
  const salida = [];
  for (const [nombre, etiqueta, claves] of iconos) {
    if (!fs.existsSync(path.join(DIR_ICONOS, `${nombre}.svg`))) {
      faltantes.push(nombre);
      continue;
    }
    // Un nombre repetido saldría dos veces en el picker y el segundo ganaría
    // en el mapa por nombre. Mejor cazarlo aquí que verlo en producción.
    if (vistos.has(nombre)) duplicados.push(nombre);
    vistos.add(nombre);
    salida.push({ nombre, etiqueta, claves, cuerpo: interiorDelSvg(nombre) });
  }
  grupos.push({ categoria, iconos: salida });
}

// MUERE si algo no cuadra. Un icono que se salta en silencio es exactamente
// cómo se llega a una biblioteca pobre sin que nadie se entere — que es el
// problema que este archivo existe para resolver.
if (faltantes.length || duplicados.length) {
  if (faltantes.length) {
    console.error(`ERR ${faltantes.length} nombre(s) no existen en lucide-static:`);
    for (const n of faltantes) {
      const cerca = fs
        .readdirSync(DIR_ICONOS)
        .filter((f) => f.endsWith('.svg'))
        .map((f) => f.slice(0, -4))
        .filter((f) => f.includes(n.split('-')[0]))
        .slice(0, 6);
      console.error(`    ${n}${cerca.length ? `   ¿querías: ${cerca.join(', ')}?` : ''}`);
    }
  }
  if (duplicados.length) {
    console.error(`ERR nombre(s) repetidos en el catálogo: ${duplicados.join(', ')}`);
  }
  process.exit(1);
}

const total = grupos.reduce((n, g) => n + g.iconos.length, 0);
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const cuerpo = grupos
  .map(
    (g) =>
      `  {\n    categoria: '${esc(g.categoria)}',\n    iconos: [\n` +
      g.iconos
        .map(
          (i) =>
            `      { name: '${esc(i.nombre)}', label: '${esc(i.etiqueta)}', keywords: '${esc(i.claves)}', svg: '${esc(i.cuerpo)}' },`,
        )
        .join('\n') +
      `\n    ],\n  },`,
  )
  .join('\n');

const salida = `/* =====================================================================
 *  InfoLink · Iconos de trazo — ARCHIVO GENERADO, NO EDITAR A MANO
 * ---------------------------------------------------------------------
 *  Fuente: scripts/catalogo-iconos-infolink.cjs
 *  Regenerar:  npm install --no-save lucide-static
 *              node scripts/generar-iconos-infolink.cjs
 *
 *  ${total} iconos. Todos son de TRAZO y heredan el color por
 *  \`currentColor\`, así que el control «Color del icono» los pinta todos sin
 *  excepción. Si algún día se añade uno con color fijo dentro del SVG, dejará
 *  de obedecer ese control — no hacerlo.
 *
 *  Iconos de Lucide (https://lucide.dev) — ISC License,
 *  Copyright (c) 2026 Lucide Icons and Contributors.
 * =================================================================== */

export type IconoDeTrazo = {
  /** id estable que se guarda en button.iconName */
  name: string;
  label: string;
  keywords: string;
  /** interior del <svg> 24x24, stroke=currentColor */
  svg: string;
};

export type GrupoDeIconos = { categoria: string; iconos: IconoDeTrazo[] };

export const ICONOS_DE_TRAZO: GrupoDeIconos[] = [
${cuerpo}
];

export const TOTAL_ICONOS_DE_TRAZO = ${total};
`;

fs.writeFileSync(SALIDA, salida, 'utf8');
console.log(`ok · ${total} iconos en ${grupos.length} categorías → ${path.relative(process.cwd(), SALIDA)}`);
for (const g of grupos) console.log(`   ${g.categoria.padEnd(26)} ${g.iconos.length}`);
