#!/usr/bin/env node
/**
 * Pruebas del lienzo de Workflows de marca (BrandWorkflowsPanel).
 *
 *   node scripts/pruebas-lienzo-workflows.mjs
 *
 * El frontend no tiene runner de pruebas y montar uno para esto era
 * desproporcionado, así que esto es un script suelto sin dependencias.
 *
 * Cubre las dos cosas del lienzo que, si se rompen, no se notan hasta que
 * duelen:
 *
 *   1. El GRAFO. Un lienzo puede verse mal y no pasa nada; lo que no puede
 *      es PERDER PASOS. Insertar, borrar y la poda de `save()` tienen que
 *      dejar el flujo exactamente como el usuario cree que lo dejó.
 *   2. El contador de SEGMENTOS SMS. Es la diferencia entre pagar 1 envío y
 *      pagar 3, y no se ve hasta que llega la factura.
 *
 * Cómo está construido, y por qué: el componente es un .tsx con la lógica
 * dentro de closures sobre el estado de React, así que no se puede importar.
 * Se replica aquí y **al final se comprueba que el componente sigue teniendo
 * esa misma lógica**: si alguien la cambia, este script se pone en rojo en vez
 * de seguir dando verde sobre código que ya no existe.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));
const COMPONENTE = resolve(AQUI, '../src/components/BrandWorkflowsPanel.tsx');

let fallos = 0;
const casos = [];
const prueba = (nombre, fn) => casos.push([nombre, fn]);
function afirmar(cond, detalle) { if (!cond) throw new Error(detalle); }

// ══════════════════════════════════════════════════════════════════════════
// 1. GRAFO — réplica de insert / del / la poda de save()
// ══════════════════════════════════════════════════════════════════════════
const ES_RAMA = { if_else: true };

function crearEstado(nodes = {}, root = null) {
  return { nodes: { ...nodes }, root, editNode: null, confirmaciones: [], respuestaConfirm: true };
}

function insert(st, id, type, slotGet, slotSet) {
  const oldChild = slotGet(st);
  const node = { id, type, config: {}, ...(ES_RAMA[type] ? { yes: oldChild, no: null } : { next: oldChild }) };
  st.nodes[id] = node;
  slotSet(st, id);
  st.editNode = id;
}

function del(st, node, slotSet) {
  const nodes = st.nodes;
  const sucesor = node.next ?? node.yes ?? node.no ?? null;
  const subarbol = (id, vistos = new Set()) => {
    if (!id || vistos.has(id) || !nodes[id]) return vistos;
    vistos.add(id);
    subarbol(nodes[id].next, vistos);
    subarbol(nodes[id].yes, vistos);
    subarbol(nodes[id].no, vistos);
    return vistos;
  };
  const perdida = node.type === 'if_else'
    ? subarbol(node.yes === sucesor ? node.no : node.yes)
    : new Set();
  if (perdida.size) {
    st.confirmaciones.push({ rama: node.yes === sucesor ? 'No' : 'Sí', pasos: perdida.size });
    if (!st.respuestaConfirm) return false;
  }
  if (st.editNode && (st.editNode === node.id || perdida.has(st.editNode))) st.editNode = null;
  slotSet(st, sucesor);
  return true;
}

function podar(st) {
  const reach = new Set();
  const walk = (id) => {
    if (!id || reach.has(id) || !st.nodes[id]) return;
    reach.add(id);
    walk(st.nodes[id].next);
    walk(st.nodes[id].yes);
    walk(st.nodes[id].no);
  };
  walk(st.root);
  const pruned = {};
  reach.forEach((id) => { pruned[id] = st.nodes[id]; });
  return pruned;
}

const raizGet = (st) => st.root;
const raizSet = (st, v) => { st.root = v; };
const campoGet = (padre, campo) => (st) => st.nodes[padre][campo] ?? null;
const campoSet = (padre, campo) => (st, v) => { st.nodes[padre][campo] = v; };

prueba('grafo · insertar en un flujo vacío deja el nodo como raíz', () => {
  const st = crearEstado();
  insert(st, 'n1', 'send_sms', raizGet, raizSet);
  afirmar(st.root === 'n1', `root=${st.root}`);
  afirmar(st.nodes.n1.next === null, `next=${st.nodes.n1.next}`);
});

prueba('grafo · insertar ENCIMA de un paso lo empuja hacia abajo, no lo borra', () => {
  const st = crearEstado({ n1: { id: 'n1', type: 'send_sms', config: {}, next: null } }, 'n1');
  insert(st, 'n2', 'wait_delay', raizGet, raizSet);
  afirmar(st.root === 'n2', `root=${st.root}`);
  afirmar(st.nodes.n2.next === 'n1', `n2.next=${st.nodes.n2.next}`);
  afirmar(Object.keys(podar(st)).length === 2, 'se perdió un paso al podar');
});

prueba('grafo · insertar un «Si / No» encima manda lo existente a la rama Sí', () => {
  const st = crearEstado({ n1: { id: 'n1', type: 'send_sms', config: {}, next: null } }, 'n1');
  insert(st, 'nif', 'if_else', raizGet, raizSet);
  afirmar(st.nodes.nif.yes === 'n1', `yes=${st.nodes.nif.yes}`);
  afirmar(st.nodes.nif.no === null, `no=${st.nodes.nif.no}`);
  afirmar(Object.keys(podar(st)).length === 2, 'se perdió el paso empujado');
});

prueba('grafo · borrar un paso normal reengancha su continuación', () => {
  const st = crearEstado({
    a: { id: 'a', type: 'send_sms', config: {}, next: 'b' },
    b: { id: 'b', type: 'wait_delay', config: {}, next: 'c' },
    c: { id: 'c', type: 'send_email', config: {}, next: null },
  }, 'a');
  del(st, st.nodes.a, raizSet);
  afirmar(st.root === 'b', `root=${st.root}`);
  const p = podar(st);
  afirmar(!p.a && p.b && p.c, `podado=${Object.keys(p)}`);
});

prueba('grafo · borrar un «Si / No» con las dos ramas llenas avisa y conserva Sí', () => {
  const st = crearEstado({
    nif: { id: 'nif', type: 'if_else', config: {}, yes: 'y1', no: 'n1' },
    y1: { id: 'y1', type: 'send_sms', config: {}, next: null },
    n1: { id: 'n1', type: 'send_sms', config: {}, next: 'n2' },
    n2: { id: 'n2', type: 'end', config: {}, next: null },
  }, 'nif');
  del(st, st.nodes.nif, raizSet);
  afirmar(st.confirmaciones.length === 1, 'no avisó');
  afirmar(st.confirmaciones[0].rama === 'No', `rama=${st.confirmaciones[0].rama}`);
  afirmar(st.confirmaciones[0].pasos === 2, `pasos=${st.confirmaciones[0].pasos}`);
  afirmar(st.root === 'y1', `root=${st.root}`);
});

prueba('grafo · con Sí vacío y No lleno, sobrevive No', () => {
  const st = crearEstado({
    nif: { id: 'nif', type: 'if_else', config: {}, yes: null, no: 'n1' },
    n1: { id: 'n1', type: 'send_sms', config: {}, next: null },
  }, 'nif');
  del(st, st.nodes.nif, raizSet);
  afirmar(st.root === 'n1', `root=${st.root} — se perdió la única rama con contenido`);
  afirmar(st.confirmaciones.length === 0, 'avisó de una pérdida que no ocurre');
});

prueba('grafo · cancelar el aviso NO toca nada', () => {
  const st = crearEstado({
    nif: { id: 'nif', type: 'if_else', config: {}, yes: 'y1', no: 'n1' },
    y1: { id: 'y1', type: 'send_sms', config: {}, next: null },
    n1: { id: 'n1', type: 'send_sms', config: {}, next: null },
  }, 'nif');
  st.respuestaConfirm = false;
  const hecho = del(st, st.nodes.nif, raizSet);
  afirmar(hecho === false, 'siguió pese a cancelar');
  afirmar(st.root === 'nif', `root=${st.root}`);
  afirmar(Object.keys(podar(st)).length === 3, 'perdió pasos al cancelar');
});

prueba('grafo · borrar el paso abierto cierra el panel', () => {
  const st = crearEstado({ a: { id: 'a', type: 'send_sms', config: {}, next: null } }, 'a');
  st.editNode = 'a';
  del(st, st.nodes.a, raizSet);
  afirmar(st.editNode === null, 'el panel se quedó editando un nodo desenganchado');
});

prueba('grafo · borrar un «Si / No» cierra el panel si editabas en la rama perdida', () => {
  const st = crearEstado({
    nif: { id: 'nif', type: 'if_else', config: {}, yes: 'y1', no: 'n1' },
    y1: { id: 'y1', type: 'send_sms', config: {}, next: null },
    n1: { id: 'n1', type: 'send_sms', config: {}, next: 'n2' },
    n2: { id: 'n2', type: 'send_email', config: {}, next: null },
  }, 'nif');
  st.editNode = 'n2';
  del(st, st.nodes.nif, raizSet);
  afirmar(st.editNode === null, 'el panel siguió abierto sobre un nodo que ya no existe');
});

prueba('grafo · el panel NO se cierra si editabas en la rama que sobrevive', () => {
  const st = crearEstado({
    nif: { id: 'nif', type: 'if_else', config: {}, yes: 'y1', no: 'n1' },
    y1: { id: 'y1', type: 'send_sms', config: {}, next: null },
    n1: { id: 'n1', type: 'send_sms', config: {}, next: null },
  }, 'nif');
  st.editNode = 'y1';
  del(st, st.nodes.nif, raizSet);
  afirmar(st.editNode === 'y1', 'cerró el panel de un paso que sigue vivo');
});

prueba('grafo · la poda conserva TODO lo alcanzable, incluidas las dos ramas', () => {
  const st = crearEstado({
    nif: { id: 'nif', type: 'if_else', config: {}, yes: 'y1', no: 'n1' },
    y1: { id: 'y1', type: 'send_sms', config: {}, next: null },
    n1: { id: 'n1', type: 'send_email', config: {}, next: null },
    huerfano: { id: 'huerfano', type: 'send_sms', config: {}, next: null },
  }, 'nif');
  const p = podar(st);
  afirmar(Object.keys(p).sort().join(',') === 'n1,nif,y1', `podado=${Object.keys(p).sort()}`);
});

prueba('grafo · la poda conserva la cola colgando de un «Terminar»', () => {
  // El lienzo la pinta marcada «Nunca se ejecuta»; lo que NO puede es
  // desaparecer del guardado sin que nadie lo vea.
  const st = crearEstado({
    e: { id: 'e', type: 'end', config: {}, next: 'z' },
    z: { id: 'z', type: 'send_sms', config: {}, next: null },
  }, 'e');
  afirmar(podar(st).z, 'la cola tras «Terminar» se perdió al guardar');
});

prueba('grafo · un ciclo no cuelga la poda ni el recuento de borrado', () => {
  const st = crearEstado({
    a: { id: 'a', type: 'send_sms', config: {}, next: 'b' },
    b: { id: 'b', type: 'send_sms', config: {}, next: 'a' },
  }, 'a');
  afirmar(Object.keys(podar(st)).length === 2, 'la poda no cerró el ciclo');
  const st2 = crearEstado({
    nif: { id: 'nif', type: 'if_else', config: {}, yes: null, no: 'c1' },
    c1: { id: 'c1', type: 'send_sms', config: {}, next: 'c2' },
    c2: { id: 'c2', type: 'send_sms', config: {}, next: 'c1' },
  }, 'nif');
  del(st2, st2.nodes.nif, raizSet);
  afirmar(st2.root === 'c1', `root=${st2.root}`);
});

prueba('grafo · insertar dentro de la rama No no toca la rama Sí', () => {
  const st = crearEstado({
    nif: { id: 'nif', type: 'if_else', config: {}, yes: 'y1', no: null },
    y1: { id: 'y1', type: 'send_sms', config: {}, next: null },
  }, 'nif');
  insert(st, 'n9', 'send_sms', campoGet('nif', 'no'), campoSet('nif', 'no'));
  afirmar(st.nodes.nif.yes === 'y1', 'se movió la rama Sí');
  afirmar(st.nodes.nif.no === 'n9', `no=${st.nodes.nif.no}`);
  afirmar(Object.keys(podar(st)).length === 3, 'no se guardan los tres');
});

// ══════════════════════════════════════════════════════════════════════════
// 2. SEGMENTOS SMS
// ══════════════════════════════════════════════════════════════════════════
const GSM7 = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXT = '^{}\\[~]|€';
function segmentosSms(texto) {
  let esGsm = true;
  for (const ch of texto) {
    if (GSM7_EXT.includes(ch) || GSM7.includes(ch)) continue;
    esGsm = false;
    break;
  }
  let unidades = 0;
  for (const ch of texto) {
    unidades += esGsm ? (GSM7_EXT.includes(ch) ? 2 : 1) : ch.length;
  }
  const simple = esGsm ? 160 : 70;
  const multi = esGsm ? 153 : 67;
  const segmentos = unidades === 0 ? 0 : unidades <= simple ? 1 : Math.ceil(unidades / multi);
  return { unidades, segmentos, esGsm, tope: segmentos > 1 ? multi : simple };
}

const casosSms = [
  ['vacío', '', { unidades: 0, segmentos: 0, esGsm: true }],
  ['160 GSM = 1 segmento', 'a'.repeat(160), { unidades: 160, segmentos: 1, esGsm: true }],
  ['161 GSM = 2 segmentos', 'a'.repeat(161), { unidades: 161, segmentos: 2, esGsm: true }],
  ['306 GSM = 2 segmentos (2×153)', 'a'.repeat(306), { unidades: 306, segmentos: 2, esGsm: true }],
  ['307 GSM = 3 segmentos', 'a'.repeat(307), { unidades: 307, segmentos: 3, esGsm: true }],
  ['la llave { vale 2 en GSM-7', '{', { unidades: 2, segmentos: 1, esGsm: true }],
  ['una emoji fuerza UCS-2 y vale 2', '😀', { unidades: 2, segmentos: 1, esGsm: false }],
  ['35 emojis = 70 unidades = 1 segmento', '😀'.repeat(35), { unidades: 70, segmentos: 1, esGsm: false }],
  ['36 emojis = 72 unidades = 2 segmentos', '😀'.repeat(36), { unidades: 72, segmentos: 2, esGsm: false }],
  ['la á NO está en GSM-7', 'á', { unidades: 1, segmentos: 1, esGsm: false }],
  ['la é SÍ está en GSM-7', 'é', { unidades: 1, segmentos: 1, esGsm: true }],
  // En UCS-2 las llaves valen 1, no 2. Como cada variable es {{x}} —cuatro de
  // esos— contarlas siempre a 2 inflaba 4 por variable en cuanto había tilde.
  ['{{owner}} + emoji cuenta 1 por llave', '{{owner}}😀', { unidades: 11, segmentos: 1, esGsm: false }],
  ['{{owner}} solo (GSM) cuenta 2 por llave', '{{owner}}', { unidades: 13, segmentos: 1, esGsm: true }],
  ['mensaje real en español con tilde → UCS-2', 'Hola {{owner}}, tu plan está por vencer.', { esGsm: false }],
];
for (const [nombre, texto, esperado] of casosSms) {
  prueba(`sms · ${nombre}`, () => {
    const r = segmentosSms(texto);
    const mal = Object.entries(esperado).filter(([k, v]) => r[k] !== v);
    afirmar(!mal.length, `esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(r)}`);
  });
}

// ══════════════════════════════════════════════════════════════════════════
// Ejecutar
// ══════════════════════════════════════════════════════════════════════════
for (const [nombre, fn] of casos) {
  try { fn(); console.log(`ok     ${nombre}`); }
  catch (e) { fallos++; console.log(`FALLA  ${nombre}\n       ${e.message}`); }
}

// El script solo vale si el componente sigue teniendo esta lógica. El archivo
// está en CRLF (Windows + OneDrive), así que se normaliza antes de comparar:
// si no, las anclas de varias líneas nunca casan y esto da un rojo falso.
const src = readFileSync(COMPONENTE, 'utf8').replace(/\r\n/g, '\n');
const anclas = [
  'const sucesor = node.next ?? node.yes ?? node.no ?? null;',
  '? subarbol(node.yes === sucesor ? node.no : node.yes)',
  'if (editNode && (editNode === node.id || perdida.has(editNode))) setEditNode(null);',
  '...(branch ? { yes: oldChild, no: null } : { next: oldChild })',
  'walk(nodes[id].next); walk(nodes[id].yes); walk(nodes[id].no);',
  "const GSM7_EXT = '^{}\\\\[~]|€';",
  'unidades += esGsm ? (GSM7_EXT.includes(ch) ? 2 : 1) : ch.length;',
  'tope: segmentos > 1 ? multi : simple',
];
const faltan = anclas.filter((a) => !src.includes(a));
if (faltan.length) {
  fallos++;
  console.log(`\nFALLA  el componente ya no coincide con lo que se prueba aquí:\n       ${faltan.join('\n       ')}`);
} else {
  console.log('\nok     el componente coincide con la lógica probada aquí');
}

console.log(`\n${fallos === 0 ? 'TODO VERDE' : `${fallos} FALLO(S)`} — ${casos.length} casos`);
process.exit(fallos === 0 ? 0 : 1);
