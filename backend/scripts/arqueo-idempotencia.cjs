#!/usr/bin/env node
/**
 * Arqueo de leer-decidir-escribir (fase 17).
 *
 * Por qué existe: es el bug más repetido de este producto y siempre se ve
 * igual — «al cliente le llegó dos veces». Un cobro, un SMS, un sello, un
 * cupón. El patrón es siempre este:
 *
 *     const ya = await prisma.x.findFirst({ where: {...} });   // leer
 *     if (ya) return;                                           // decidir
 *     await prisma.x.create({ ... });                           // escribir
 *
 * Entre el leer y el escribir caben dos peticiones. Los webhooks reintentan,
 * el cliente hace doble clic, el cron se solapa con el reintento: las dos leen
 * «no existe» y las dos escriben. No se arregla comprobando mejor, porque el
 * problema no es la comprobación: se arregla haciendo que solo una pueda
 * ganar —índice único, `upsert`, un UPDATE condicional mirando el `count`, o
 * un advisory lock.
 *
 * Qué hace: busca funciones que leen y luego escriben el MISMO modelo sin
 * ninguna de esas protecciones.
 *
 * Qué NO hace: decidir. Hay sitios donde la carrera no importa (un contador de
 * visitas) y otros donde ya la corta un índice único que este arqueo no ve
 * porque está en el schema y no en el código. Esto ORDENA la revisión.
 *
 *   node scripts/arqueo-idempotencia.cjs           # por riesgo
 *   node scripts/arqueo-idempotencia.cjs --full
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const argOpcion = (nombre, porDefecto) => {
  const a = process.argv.find((x) => x.startsWith(`--${nombre}=`));
  return a ? path.resolve(a.slice(nombre.length + 3)) : porDefecto;
};
const SRC = argOpcion('src', path.join(ROOT, 'src'));
const SCHEMA = argOpcion('schema', path.join(ROOT, 'prisma', 'schema.prisma'));

/**
 * Modelos que tienen ALGÚN índice único. Es el dato que decide si la carrera
 * importa: con un único, la segunda petición choca contra la base y falla —
 * feo, pero no duplica. Sin él, las dos escriben y el duplicado se queda.
 *
 * Sin este cruce la lista era ruido: salían 58 creaciones y la mayoría están
 * cortadas por un `@@unique` que el código no menciona porque vive en el
 * schema.
 */
function modelosConUnico() {
  const txt = fs.readFileSync(SCHEMA, 'utf8');
  const conUnico = new Set();
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m;
  while ((m = re.exec(txt))) {
    const [, nombre, cuerpo] = m;
    if (/@unique\b|@@unique\(/.test(cuerpo)) {
      conUnico.add(nombre[0].toLowerCase() + nombre.slice(1));
    }
  }
  return conUnico;
}

const LEE = new Set(['findFirst', 'findUnique', 'findFirstOrThrow', 'findUniqueOrThrow', 'count']);
const ESCRIBE = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert']);

/** Lo que corta la carrera de verdad. `upsert` y `updateMany` condicional
 *  dejan que la base decida quién gana; el advisory lock serializa; la
 *  transacción sola NO basta en el aislamiento por defecto de Postgres
 *  (READ COMMITTED), pero se cuenta como atenuante porque suele venir
 *  acompañada de un único o de un lock. */
const PROTEGE = /upsert|advisory_xact_lock|advisory_lock|\$transaction|SERIALIZABLE|onConflict|skipDuplicates/;

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

function llamadaPrisma(node) {
  if (!ts.isCallExpression(node)) return null;
  const fn = node.expression;
  if (!ts.isPropertyAccessExpression(fn)) return null;
  const op = fn.name.text;
  if (!LEE.has(op) && !ESCRIBE.has(op)) return null;
  const owner = fn.expression;
  if (!ts.isPropertyAccessExpression(owner)) return null;
  if (!/(^|\.)(prisma|tx|db|client)$/i.test(owner.expression.getText().trim())) return null;
  return { modelo: owner.name.text, op };
}

function funcionContenedora(node) {
  let n = node.parent;
  while (n) {
    if (ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n)) return n;
    n = n.parent;
  }
  return null;
}

const conUnico = modelosConUnico();
const hallazgos = [];
let funcionesVistas = 0;

for (const file of archivosTs(SRC)) {
  const texto = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, texto, ts.ScriptTarget.Latest, true);
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');

  // Se recogen las operaciones por función, en orden de aparición.
  const porFuncion = new Map();
  const visit = (node) => {
    const call = llamadaPrisma(node);
    if (call) {
      const fn = funcionContenedora(node);
      if (fn && fn.name) {
        const clave = fn;
        if (!porFuncion.has(clave)) porFuncion.set(clave, []);
        porFuncion.get(clave).push({
          ...call,
          pos: node.getStart(),
          linea: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  for (const [fn, ops] of porFuncion) {
    funcionesVistas++;
    const texto = fn.getText();
    if (PROTEGE.test(texto)) continue;

    ops.sort((a, b) => a.pos - b.pos);
    for (const lectura of ops.filter((o) => LEE.has(o.op))) {
      // Una escritura POSTERIOR sobre el MISMO modelo: leer, decidir, escribir.
      const escritura = ops.find(
        (o) => ESCRIBE.has(o.op) && o.modelo === lectura.modelo && o.pos > lectura.pos,
      );
      if (!escritura) continue;
      // Un `if` entre medias es la parte de «decidir», y es lo que delata el
      // patrón frente a un leer y escribir sin relación.
      const entre = texto.slice(lectura.pos - fn.getStart(), escritura.pos - fn.getStart());
      if (!/\bif\s*\(/.test(entre)) continue;

      hallazgos.push({
        archivo: rel,
        linea: lectura.linea,
        lineaEscritura: escritura.linea,
        fn: fn.name.getText(),
        modelo: lectura.modelo,
        lee: lectura.op,
        escribe: escritura.op,
        crea: escritura.op === 'create' || escritura.op === 'createMany',
        // Con un unico en la tabla, la segunda peticion choca contra la base:
        // falla feo, pero NO duplica. Sin el, las dos escriben.
        tieneUnico: conUnico.has(lectura.modelo),
      });
      break; // uno por función basta para ponerla en la lista
    }
  }
}

if (funcionesVistas === 0) {
  console.error('\nEl arqueo no esta viendo el codigo: 0 funciones con Prisma.\n');
  process.exit(1);
}

// Crear duplicados es peor que actualizar dos veces: el duplicado se queda en
// la base y alguien lo cobra, lo envia o lo cuenta.
hallazgos.sort((a, b) => (b.crea ? 1 : 0) - (a.crea ? 1 : 0) || a.archivo.localeCompare(b.archivo));

const creaciones = hallazgos.filter((h) => h.crea);
// Lo que de verdad duplica: crear sin ningun unico que corte la carrera.
const duplican = creaciones.filter((h) => !h.tieneUnico);

console.log('\n=== LEER-DECIDIR-ESCRIBIR SIN ATOMICIDAD ===\n');
console.log(`Funciones con Prisma revisadas : ${funcionesVistas}`);
console.log(`Leer-decidir-escribir sin red  : ${hallazgos.length}`);
console.log(`  de esas, que CREAN            : ${creaciones.length}`);
console.log(`    ...y SIN unico que las corte: ${duplican.length}   <-- aqui el duplicado se queda\n`);

const full = process.argv.includes('--full');
const lista = full ? hallazgos : duplican.slice(0, 25);
console.log(`--- ${full ? 'Todas' : 'Crean sin unico que las corte (top 25)'} ---\n`);
for (const h of lista) {
  console.log(`  ${h.archivo}:${h.linea}  ${h.fn}()`);
  console.log(`      ${h.modelo}.${h.lee}() -> if -> ${h.modelo}.${h.escribe}() en la linea ${h.lineaEscritura}`);
}
console.log('');
console.log('No se arregla comprobando mejor: se arregla haciendo que solo una');
console.log('peticion pueda ganar (unico + upsert, UPDATE condicional mirando el');
console.log('count, o advisory lock).\n');
