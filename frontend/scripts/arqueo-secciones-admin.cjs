/**
 * Toda carpeta de `src/app/admin` tiene que estar en `src/lib/secciones-admin.ts`.
 *
 * Si falta, el panel lee `/admin/<carpeta>` como el panel de una marca blanca
 * llamada así: la página nueva se abre con el menú de otra marca o no se abre.
 * Pasó con «Marcas blancas» y con «Upgrades a anual» (2026-10-06).
 *
 * Uso: node scripts/arqueo-secciones-admin.cjs --ci
 */
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const lista = fs.readFileSync(path.join(raiz, 'src/lib/secciones-admin.ts'), 'utf8');
const enLista = new Set([...lista.matchAll(/'([^']+)'/g)].map((m) => m[1]));
const carpetas = fs
  .readdirSync(path.join(raiz, 'src/app/admin'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('(') && !d.name.startsWith('['))
  .map((d) => d.name);

const faltan = carpetas.filter((c) => !enLista.has(c));
if (faltan.length) {
  console.error(
    `Secciones del admin sin registrar en src/lib/secciones-admin.ts: ${faltan.join(', ')}\n` +
      'Sin eso, /admin/<carpeta> se abre como el panel de una marca blanca.',
  );
  process.exit(1);
}
console.log(`Secciones del admin: las ${carpetas.length} carpetas están registradas.`);
