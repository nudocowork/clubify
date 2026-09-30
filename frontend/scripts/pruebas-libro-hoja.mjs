#!/usr/bin/env node
/**
 * Pruebas del MODO LIBRO del menú (efecto de hoja, 2026-09-30).
 *
 *   node scripts/pruebas-libro-hoja.mjs
 *
 * Lo que se quería (Javier, con el flipbook de La Gloriosa como referencia):
 * portada sola, interior a doble página, la hoja con la página siguiente en
 * el dorso, y el pase que sigue el dedo y decide al soltar.
 *
 * Lo que estas pruebas cuidan: la GEOMETRÍA. Si el reparto en hojas o el
 * mapeo página⇄hojas-pasadas se tuerce, el cliente ve la página equivocada
 * al abrir un deep-link de sección, o el contador miente — y eso no se nota
 * en una revisión visual rápida.
 */
import {
  IMPULSO_QUE_DECIDE,
  anguloDesdePuntero,
  curvaturaEnAngulo,
  decideAlSoltar,
  desplazamientoDelLibro,
  duracionDelVuelo,
  hojasDelLibro,
  paginaActiva,
  paginasVisibles,
  pasadasParaVer,
} from '../src/lib/menu/hoja-del-libro.mjs';

let fallos = 0;
const casos = [];
const prueba = (nombre, fn) => casos.push([nombre, fn]);
function afirmar(cond, detalle) {
  if (!cond) throw new Error(detalle);
}
const igual = (a, b, detalle) =>
  afirmar(
    JSON.stringify(a) === JSON.stringify(b),
    `${detalle} — esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`,
  );

// ══════════════════════════════════════════════════════════════════════════
// 1. El reparto en hojas: como un libro impreso
// ══════════════════════════════════════════════════════════════════════════
prueba('en spread, la hoja lleva la página siguiente en el dorso', () => {
  igual(
    hojasDelLibro(6, true),
    [
      { frente: 0, dorso: 1 },
      { frente: 2, dorso: 3 },
      { frente: 4, dorso: 5 },
    ],
    'seis páginas',
  );
});

prueba('con total IMPAR la última hoja queda con dorso de papel', () => {
  const h = hojasDelLibro(5, true);
  igual(h[h.length - 1], { frente: 4, dorso: null }, 'última hoja de 5');
});

prueba('en una página (teléfono) cada página es su hoja, dorso de papel', () => {
  igual(
    hojasDelLibro(3, false),
    [
      { frente: 0, dorso: null },
      { frente: 1, dorso: null },
      { frente: 2, dorso: null },
    ],
    'tres páginas en móvil',
  );
});

// ══════════════════════════════════════════════════════════════════════════
// 2. Qué se ve: portada sola → pares → contraportada
// ══════════════════════════════════════════════════════════════════════════
prueba('la secuencia de un libro de 6: [0] → [1|2] → [3|4] → [5]', () => {
  const h = hojasDelLibro(6, true);
  igual(paginasVisibles(h, 0, true), { izquierda: null, derecha: 0 }, 'cerrado');
  igual(paginasVisibles(h, 1, true), { izquierda: 1, derecha: 2 }, 'primer spread');
  igual(paginasVisibles(h, 2, true), { izquierda: 3, derecha: 4 }, 'segundo spread');
  igual(paginasVisibles(h, 3, true), { izquierda: 5, derecha: null }, 'contraportada');
});

prueba('la página ACTIVA (contador/URL) es la más avanzada visible', () => {
  const h = hojasDelLibro(6, true);
  igual(paginaActiva(h, 0, true), 0, 'cerrado');
  igual(paginaActiva(h, 1, true), 2, 'primer spread');
  igual(paginaActiva(h, 3, true), 5, 'contraportada');
});

prueba('ir a una página encuentra SU estado de hojas (deep-link de sección)', () => {
  const h = hojasDelLibro(6, true);
  // La página 3 se ve en el segundo spread (izquierda): 2 hojas pasadas.
  igual(pasadasParaVer(h, 3, true), 2, 'página 3');
  igual(pasadasParaVer(h, 0, true), 0, 'portada');
  igual(pasadasParaVer(h, 5, true), 3, 'contraportada');
  // Ida y vuelta: lo que digo que se ve, se ve.
  for (let idx = 0; idx < 6; idx++) {
    const k = pasadasParaVer(h, idx, true);
    const v = paginasVisibles(h, k, true);
    afirmar(
      v.izquierda === idx || v.derecha === idx,
      `ida y vuelta de la página ${idx}: con ${k} pasadas se ve ${JSON.stringify(v)}`,
    );
  }
});

prueba('en móvil el mapeo es directo', () => {
  const h = hojasDelLibro(4, false);
  igual(paginaActiva(h, 2, false), 2, 'página activa');
  igual(pasadasParaVer(h, 2, false), 2, 'pasadas para verla');
});

// ══════════════════════════════════════════════════════════════════════════
// 3. El dedo manda: ángulo desde el puntero y decisión al soltar
// ══════════════════════════════════════════════════════════════════════════
prueba('borde derecho 0°, lomo −90°, borde izquierdo −180°', () => {
  igual(anguloDesdePuntero(500, 300, 200), 0, 'en el borde derecho');
  igual(anguloDesdePuntero(300, 300, 200), -90, 'sobre el lomo');
  igual(anguloDesdePuntero(100, 300, 200), -180, 'en el borde izquierdo');
});

prueba('el dedo puede salirse del libro sin dar la vuelta de más', () => {
  igual(anguloDesdePuntero(900, 300, 200), 0, 'muy a la derecha');
  igual(anguloDesdePuntero(-500, 300, 200), -180, 'muy a la izquierda');
});

prueba('al soltar decide la posición… salvo que haya impulso', () => {
  afirmar(decideAlSoltar(-120, 0), 'pasada la mitad, cae');
  afirmar(!decideAlSoltar(-60, 0), 'antes de la mitad, se devuelve');
  // Un tirón corto pero rápido completa aunque vaya por −30°.
  afirmar(decideAlSoltar(-30, -0.6), 'tirón rápido hacia la izquierda');
  // Y un tirón de vuelta devuelve aunque ya casi había caído.
  afirmar(!decideAlSoltar(-150, 0.6), 'tirón rápido de vuelta');
  afirmar(IMPULSO_QUE_DECIDE > 0, 'el umbral existe');
});

// ══════════════════════════════════════════════════════════════════════════
// 4. La materia: curvatura, centrado y duración
// ══════════════════════════════════════════════════════════════════════════
prueba('el papel se arquea a mitad del vuelo y llega PLANO a los extremos', () => {
  igual(curvaturaEnAngulo(0, 3), -0, 'en reposo');
  afirmar(Math.abs(curvaturaEnAngulo(-180, 3)) < 0.001, 'al caer, plano');
  afirmar(curvaturaEnAngulo(-90, 3) < -5, 'a mitad de giro se nota');
});

prueba('el libro se centra: cerrado al inicio, abierto en medio, cerrado al final', () => {
  const h = hojasDelLibro(6, true);
  igual(desplazamientoDelLibro(h, 0, true), -0.5, 'portada');
  igual(desplazamientoDelLibro(h, 1, true), 0, 'abierto');
  igual(desplazamientoDelLibro(h, 3, true), 0.5, 'contraportada');
  igual(desplazamientoDelLibro(h, 1, false), 0, 'en móvil no se traslada');
});

prueba('soltar una hoja casi caída tarda menos que el pase entero', () => {
  const entera = duracionDelVuelo(0, -180);
  const casiCaida = duracionDelVuelo(-150, -180);
  afirmar(casiCaida < entera / 2, `entera ${entera}ms vs resto ${casiCaida}ms`);
});

// ══════════════════════════════════════════════════════════════════════════
for (const [nombre, fn] of casos) {
  try {
    fn();
    console.log(`  ok   ${nombre}`);
  } catch (e) {
    fallos++;
    console.error(`  FALLO ${nombre}\n        ${e.message}`);
  }
}
console.log(fallos === 0 ? '\nTodo en pie.' : `\n${fallos} fallo(s).`);
process.exit(fallos === 0 ? 0 : 1);
