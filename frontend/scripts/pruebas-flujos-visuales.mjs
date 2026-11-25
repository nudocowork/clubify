#!/usr/bin/env node
/**
 * Pruebas de las operaciones del lienzo de Automatizaciones del negocio.
 *
 *   node scripts/pruebas-flujos-visuales.mjs
 *
 * A diferencia de `pruebas-lienzo-workflows.mjs` (que replica la lógica porque
 * vive dentro de un componente), aquí la lógica está en un módulo puro
 * (`src/components/flujos-visuales/grafo.ts`): se transpila con el TypeScript
 * del proyecto y se prueba EL MISMO código que corre en el navegador.
 *
 * Lo que importa: que insertar, borrar, duplicar y mover nunca PIERDAN pasos ni
 * dejen el árbol roto (dos entradas, un ciclo, un paso suelto). El backend
 * rechazaría ese grafo al guardar y el negocio perdería lo que estaba editando.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';

const AQUI = dirname(fileURLToPath(import.meta.url));
const fuente = readFileSync(resolve(AQUI, '../src/components/flujos-visuales/grafo.ts'), 'utf8');
const js = ts.transpileModule(fuente, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const G = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

let fallos = 0;
const casos = [];
const prueba = (n, f) => casos.push([n, f]);
const afirmar = (c, d) => {
  if (!c) throw new Error(d);
};

/** Mismas reglas que `problemasDeForma` del backend: árbol, sin sueltos. */
function sano(g) {
  const ids = Object.keys(g.nodes);
  const padres = new Map();
  for (const n of Object.values(g.nodes)) {
    for (const r of n.type === 'condition' ? [n.yes, n.no] : [n.next]) {
      if (!r) continue;
      afirmar(g.nodes[r], `${n.id} apunta a ${r}, que no existe`);
      padres.set(r, (padres.get(r) ?? 0) + 1);
    }
  }
  for (const [id, c] of padres) afirmar(c === 1, `${id} tiene ${c} entradas`);
  afirmar(!g.rootId || !padres.has(g.rootId), 'la raíz tiene padre (ciclo)');
  const vistos = new Set();
  const pila = g.rootId ? [g.rootId] : [];
  while (pila.length) {
    const id = pila.pop();
    afirmar(!vistos.has(id), `ciclo en ${id}`);
    vistos.add(id);
    const n = g.nodes[id];
    for (const r of n.type === 'condition' ? [n.yes, n.no] : [n.next]) if (r) pila.push(r);
  }
  for (const id of ids) afirmar(vistos.has(id), `${id} quedó suelto`);
}

/** El orden lineal desde la raíz (siguiendo `next`, y `yes` en condiciones). */
function orden(g) {
  const out = [];
  let id = g.rootId;
  while (id) {
    const n = g.nodes[id];
    out.push(n.config.label ?? n.type);
    id = n.type === 'condition' ? n.yes : n.next;
  }
  return out.join(' > ');
}

const raiz = { padre: null, rama: 'next' };
const paso = (label, type = 'push') => ({ ...G.nodoVacio(type), config: { label } });

function base() {
  let g = { rootId: null, nodes: {} };
  const a = paso('A'), b = paso('B', 'wait'), c = paso('C');
  g = G.insertar(g, raiz, a);
  g = G.insertar(g, { padre: a.id, rama: 'next' }, b);
  g = G.insertar(g, { padre: b.id, rama: 'next' }, c);
  return { g, a, b, c };
}

prueba('insertar al final y en medio conserva el orden', () => {
  const { g, a } = base();
  afirmar(orden(g) === 'A > B > C', orden(g));
  const x = paso('X');
  const g2 = G.insertar(g, { padre: a.id, rama: 'next' }, x);
  afirmar(orden(g2) === 'A > X > B > C', orden(g2));
  sano(g2);
});

prueba('insertar al principio (antes del primer paso)', () => {
  const { g } = base();
  const g2 = G.insertar(g, raiz, paso('0'));
  afirmar(orden(g2) === '0 > A > B > C', orden(g2));
  sano(g2);
});

prueba('una condición insertada en medio se lleva lo de abajo a su rama «Sí»', () => {
  const { g, a, b } = base();
  const q = G.nodoVacio('condition');
  const g2 = G.insertar(g, { padre: a.id, rama: 'next' }, q);
  afirmar(g2.nodes[q.id].yes === b.id && g2.nodes[q.id].no === null, 'rama Sí');
  afirmar(Object.keys(g2.nodes).length === 4, 'no se pierde nada');
  sano(g2);
});

prueba('borrar un paso sube el de abajo', () => {
  const { g, b } = base();
  const g2 = G.borrar(g, b.id);
  afirmar(orden(g2) === 'A > C', orden(g2));
  sano(g2);
});

prueba('borrar el primer paso', () => {
  const { g, a } = base();
  const g2 = G.borrar(g, a.id);
  afirmar(orden(g2) === 'B > C', orden(g2));
  sano(g2);
});

prueba('borrar una condición conserva «Sí» y elimina «No» entera', () => {
  const { g, a, b } = base();
  const q = G.nodoVacio('condition');
  let g2 = G.insertar(g, { padre: a.id, rama: 'next' }, q);
  g2 = G.insertar(g2, { padre: q.id, rama: 'no' }, paso('N1'));
  const n1 = g2.nodes[q.id].no;
  g2 = G.insertar(g2, { padre: n1, rama: 'next' }, paso('N2'));
  afirmar(G.pasosDeRama(g2, g2.nodes[q.id].no) === 2, 'cuenta la rama No');
  const g3 = G.borrar(g2, q.id);
  afirmar(orden(g3) === 'A > B > C', orden(g3));
  afirmar(Object.keys(g3.nodes).length === 3, `quedan ${Object.keys(g3.nodes).length}`);
  sano(g3);
  void b;
});

prueba('un «Fin» insertado corta lo de debajo', () => {
  const { g, a } = base();
  const g2 = G.insertar(g, { padre: a.id, rama: 'next' }, G.nodoVacio('end'));
  afirmar(orden(g2) === 'A > end', orden(g2));
  sano(g2);
});

prueba('duplicar deja la copia justo debajo, con id nuevo y config independiente', () => {
  const { g, b } = base();
  const g2 = G.duplicar(g, b.id);
  afirmar(orden(g2) === 'A > B > B > C', orden(g2));
  const copia = g2.nodes[g2.nodes[b.id].next];
  afirmar(copia.id !== b.id, 'id nuevo');
  copia.config.label = 'cambiada';
  afirmar(g2.nodes[b.id].config.label === 'B', 'la original no cambia');
  sano(g2);
});

prueba('subir y bajar re-enlazan sin perder pasos', () => {
  const { g, a, b, c } = base();
  const g2 = G.mover(g, c.id, -1);
  afirmar(orden(g2) === 'A > C > B', orden(g2));
  sano(g2);
  const g3 = G.mover(g2, a.id, 1);
  afirmar(orden(g3) === 'C > A > B', orden(g3));
  sano(g3);
  afirmar(!G.puedeMover(g, a.id, -1), 'el primero no sube');
  afirmar(!G.puedeMover(g, c.id, 1), 'el último no baja');
  void b;
});

prueba('no se mueve a través de una condición', () => {
  const { g, a } = base();
  const q = G.nodoVacio('condition');
  const g2 = G.insertar(g, { padre: a.id, rama: 'next' }, q);
  afirmar(!G.puedeMover(g2, a.id, 1), 'A no baja a la condición');
  const b = g2.nodes[q.id].yes;
  afirmar(!G.puedeMover(g2, b, -1), 'B no sube por encima de la condición');
});

prueba('incompleto: push sin texto, espera sin tiempo, condición sin valor', () => {
  afirmar(G.incompleto(G.nodoVacio('push')), 'push vacío');
  afirmar(!G.incompleto({ ...G.nodoVacio('push'), config: { title: 'a', body: 'b' } }), 'push lleno');
  afirmar(G.incompleto({ ...G.nodoVacio('wait'), config: { amount: 0, unit: 'days' } }), 'espera 0');
  afirmar(G.incompleto({ ...G.nodoVacio('condition'), config: { field: 'sellos_actuales', op: 'gt' } }), 'sin valor');
  afirmar(!G.incompleto({ ...G.nodoVacio('condition'), config: { field: 'cupon_activo', op: 'is_true' } }), 'sí/no no lleva valor');
});

for (const [n, f] of casos) {
  try {
    f();
    console.log(`  ✓ ${n}`);
  } catch (e) {
    fallos++;
    console.log(`  ✗ ${n}\n      ${e.message}`);
  }
}
console.log(fallos ? `\n${fallos} de ${casos.length} fallaron` : `\n${casos.length} pruebas en verde`);
process.exit(fallos ? 1 : 0);
