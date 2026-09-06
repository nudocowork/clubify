#!/usr/bin/env node
/**
 * Arqueo de índices que faltan (fase 20).
 *
 * Por qué existe: cada campo por el que se filtra sin índice es un escaneo de
 * tabla completa. Con pocas filas no se nota; con las de un año, el panel
 * empieza a ir lento y nadie sabe por qué, porque no hay una consulta
 * «mala» — hay treinta un poco malas.
 *
 * Qué hace: cruza los campos que aparecen en los `where` del código con los
 * índices declarados en `schema.prisma` (`@id`, `@unique`, `@@index`,
 * `@@unique`), y lista los que se usan y no están indexados, ordenados por
 * cuántas veces se usan.
 *
 * Qué NO hace: decidir. Un índice no sale gratis —ocupa disco y encarece cada
 * escritura—, así que la lista es para revisar, no para aplicar en bloque. Y no
 * ve el plan real: para eso hace falta `EXPLAIN ANALYZE` contra producción con
 * los datos de verdad.
 *
 * Importante para Postgres: en un índice compuesto `@@index([a, b])` solo el
 * PRIMER campo sirve para filtrar por él solo. Este arqueo lo tiene en cuenta.
 *
 *   node scripts/arqueo-indices.cjs           # lo que falta, por frecuencia
 *   node scripts/arqueo-indices.cjs --full    # incluye lo que ya está indexado
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');

/** `--src=` y `--schema=` para poder probarlo contra ficheros de ejemplo.
 *  Ver `test/arqueo-indices.test.ts`. */
const argOpcion = (nombre, porDefecto) => {
  const a = process.argv.find((x) => x.startsWith(`--${nombre}=`));
  return a ? path.resolve(a.slice(nombre.length + 3)) : porDefecto;
};
const SRC = argOpcion('src', path.join(ROOT, 'src'));
const SCHEMA = argOpcion('schema', path.join(ROOT, 'prisma', 'schema.prisma'));

/** Campos por los que Postgres puede filtrar solo, para cada modelo. */
function indicesDelSchema() {
  const txt = fs.readFileSync(SCHEMA, 'utf8');
  const porModelo = new Map();
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m;
  while ((m = re.exec(txt))) {
    const [, nombre, cuerpo] = m;
    const indexados = new Set();
    const campos = new Set();

    for (const linea of cuerpo.split('\n')) {
      const campo = linea.match(/^\s*(\w+)\s+\S/);
      if (campo && !linea.trim().startsWith('@@')) {
        campos.add(campo[1]);
        if (/@id\b/.test(linea) || /@unique\b/.test(linea)) indexados.add(campo[1]);
      }
      // @@index([a, b]) / @@unique([a, b]): en Postgres solo el PRIMER campo
      // del compuesto sirve para filtrar por el campo suelto.
      const compuesto = linea.match(/@@(?:index|unique)\(\s*\[([^\]]+)\]/);
      if (compuesto) {
        const primero = compuesto[1].split(',')[0].trim();
        if (primero) indexados.add(primero);
      }
    }
    porModelo.set(nombre[0].toLowerCase() + nombre.slice(1), { nombre, indexados, campos });
  }
  return porModelo;
}

function archivosTs(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) archivosTs(p, acc);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts') && !e.name.endsWith('.spec.ts')) {
      acc.push(p);
    }
  }
  return acc;
}

const OPS_LECTURA = new Set([
  'findUnique',
  'findFirst',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
]);

function llamadaPrisma(node) {
  if (!ts.isCallExpression(node)) return null;
  const fn = node.expression;
  if (!ts.isPropertyAccessExpression(fn) || !OPS_LECTURA.has(fn.name.text)) return null;
  const owner = fn.expression;
  if (!ts.isPropertyAccessExpression(owner)) return null;
  if (!/(^|\.)(prisma|tx|db|client)$/i.test(owner.expression.getText().trim())) return null;
  return { modelo: owner.name.text, op: fn.name.text };
}

/** Campos de PRIMER nivel del where. Los anidados (`producto: { tenantId }`)
 *  son filtros sobre otra tabla y se cuentan aparte, no aquí. */
function camposDelWhere(whereNode) {
  if (!whereNode || !ts.isObjectLiteralExpression(whereNode)) return [];
  const out = [];
  for (const p of whereNode.properties) {
    if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) continue;
    const k = p.name.getText();
    if (/^(AND|OR|NOT)$/.test(k)) continue;
    out.push(k);
  }
  return out;
}

function propiedad(objNode, nombre) {
  if (!objNode || !ts.isObjectLiteralExpression(objNode)) return null;
  for (const p of objNode.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText() === nombre) return p.initializer;
  }
  return null;
}

const indices = indicesDelSchema();
const uso = new Map(); // "modelo.campo" -> { modelo, campo, veces, sitios[] }

for (const file of archivosTs(SRC)) {
  const texto = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, texto, ts.ScriptTarget.Latest, true);
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');

  const visit = (node) => {
    const call = llamadaPrisma(node);
    if (call && indices.has(call.modelo)) {
      const where = propiedad(node.arguments[0], 'where');
      const info = indices.get(call.modelo);
      const campos = camposDelWhere(where).filter((c) => info.campos.has(c));
      // Si el mismo `where` ya lleva un campo indexado —casi siempre tenantId—,
      // Postgres entra por ese índice y filtra el resto sobre pocas filas. Eso
      // NO es un escaneo de tabla. Lo que duele es el `where` en el que NINGÚN
      // campo está indexado: ahí no hay por dónde entrar.
      const hayEntrada = campos.some((c) => info.indexados.has(c));
      for (const campo of campos) {
        const clave = `${info.nombre}.${campo}`;
        if (!uso.has(clave)) {
          uso.set(clave, {
            modelo: info.nombre,
            campo,
            veces: 0,
            sinEntrada: 0,
            sitios: [],
            sitiosSinEntrada: [],
            indexado: info.indexados.has(campo),
          });
        }
        const u = uso.get(clave);
        u.veces++;
        const sitio = `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
        if (u.sitios.length < 3) u.sitios.push(sitio);
        if (!hayEntrada) {
          u.sinEntrada++;
          if (u.sitiosSinEntrada.length < 3) u.sitiosSinEntrada.push(sitio);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (indices.size === 0 || uso.size === 0) {
  console.error('\nEl arqueo no esta viendo el codigo: 0 modelos o 0 filtros.');
  console.error('Revisa que el schema y src/ esten donde se esperan.\n');
  process.exit(1);
}

const todos = [...uso.values()];
const faltan = todos.filter((u) => !u.indexado);
// Lo que de verdad escanea la tabla entera: sin índice Y sin ningún otro campo
// indexado en el mismo `where` por el que entrar.
const escanean = faltan.filter((u) => u.sinEntrada > 0).sort((a, b) => b.sinEntrada - a.sinEntrada);
const acompanados = faltan.filter((u) => u.sinEntrada === 0).sort((a, b) => b.veces - a.veces);

console.log('\n=== INDICES QUE FALTAN ===\n');
console.log(`Campos distintos usados en where : ${todos.length}`);
console.log(`  ya indexados                   : ${todos.length - faltan.length}`);
console.log(`  sin indice, pero acompanados   : ${acompanados.length}   (el where lleva otro campo indexado)`);
console.log(`  SIN INDICE Y SIN ENTRADA       : ${escanean.length}   <-- estos si escanean la tabla\n`);

const full = process.argv.includes('--full');
const lista = full ? [...escanean, ...acompanados] : escanean.slice(0, 25);
console.log(`--- ${full ? 'Todo lo que falta' : 'Escaneo de tabla, por veces que ocurre'} ---\n`);
for (const u of lista) {
  const cuantas = u.sinEntrada > 0 ? `${u.sinEntrada}x sin entrada` : `${u.veces}x acompanado`;
  console.log(`  ${cuantas.padStart(18)}   ${u.modelo}.${u.campo}`);
  const sitios = u.sinEntrada > 0 ? u.sitiosSinEntrada : u.sitios;
  console.log(`                       ${sitios.join('  ')}`);
}
console.log('');
console.log('Un indice no sale gratis: ocupa disco y encarece cada escritura.');
console.log('Esto es para revisar de arriba a abajo, no para aplicar en bloque.\n');
