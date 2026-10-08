#!/usr/bin/env node
/**
 * Pruebas del monto que escribe el cajero (`src/lib/monto-escrito.mjs`).
 *
 *   node scripts/pruebas-monto-escrito.mjs
 *
 * Lo que se cuida: que se puedan escribir decimales (con coma o punto) sin
 * romper el «12.500» colombiano, que es doce mil quinientos.
 */
import assert from 'node:assert/strict';
import { leerMonto } from '../src/lib/monto-escrito.mjs';

const casos = [
  ['25000', 25000],
  ['12.500', 12500],
  ['12,500', 12500],
  ['1.234.567', 1234567],
  ['25,5', 25.5],
  ['25,50', 25.5],
  ['25.50', 25.5],
  ['0,99', 0.99],
  ['1.234,56', 1234.56],
  ['1,234.56', 1234.56],
  ['$ 12.500', 12500],
  [' 45.90 ', 45.9],
  ['12.', 12],
  [',5', 0.5],
  [25.5, 25.5],
  ['', null],
  ['abc', null],
  ['12,345,6', null],
  ['1.2.3', null],
  ['25,555', 25555],
  ['25,5555', null],
  ['-5', null],
];

let fallos = 0;
for (const [entrada, esperado] of casos) {
  try {
    assert.equal(leerMonto(entrada), esperado);
    console.log(`  ✓ ${JSON.stringify(entrada)} → ${esperado}`);
  } catch {
    fallos++;
    console.log(`  ✗ ${JSON.stringify(entrada)} → esperado ${esperado}, salió ${leerMonto(entrada)}`);
  }
}
if (fallos) {
  console.log(`\n${fallos} caso(s) fallaron`);
  process.exit(1);
}
console.log(`\nTODO VERDE — ${casos.length} casos`);
