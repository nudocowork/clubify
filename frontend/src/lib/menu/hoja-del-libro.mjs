/**
 * La matemática del MODO LIBRO del menú (efecto de hoja, 2026-09-30).
 *
 * Javier eligió el estilo del flipbook de referencia (La Gloriosa en Heyzine):
 * portada sola, interior a doble página, la hoja con contenido por las dos
 * caras y el pase que SIGUE EL DEDO. Estas cuentas viven aquí y no en el
 * componente para poder probarlas desde node sin montar React:
 *
 *   node scripts/pruebas-libro-hoja.mjs
 *
 * El render (React + CSS 3D) está en `components/menu/LibroDeHojas.tsx`. A
 * propósito NO se usa react-pageflip: ya estuvo en el visor y se quitó porque
 * en móvil apilaba páginas en vez de paginar (ver MenuBookViewer.tsx).
 */

/**
 * Reparte las páginas en HOJAS físicas.
 *
 * En DOBLE PÁGINA (spread) la hoja k tiene de frente la página derecha y de
 * dorso la página que quedará a la izquierda al pasarla — como un libro
 * impreso: (0,1), (2,3), … Si el total es par, la última hoja queda sin
 * dorso (null = reverso de papel).
 *
 * En UNA PÁGINA (teléfono) cada página es su propia hoja y el dorso es
 * siempre papel: pasar la hoja revela la siguiente debajo, no hay «lado
 * izquierdo» donde leerla.
 */
export function hojasDelLibro(totalPaginas, spread) {
  const hojas = [];
  if (totalPaginas <= 0) return hojas;
  if (!spread) {
    for (let i = 0; i < totalPaginas; i++) {
      hojas.push({ frente: i, dorso: null });
    }
    return hojas;
  }
  for (let i = 0; i < totalPaginas; i += 2) {
    hojas.push({
      frente: i,
      dorso: i + 1 < totalPaginas ? i + 1 : null,
    });
  }
  return hojas;
}

/**
 * Qué páginas se VEN con `pasadas` hojas del lado izquierdo.
 *
 * Spread: con 0 pasadas solo la portada (página 0, libro cerrado); con k>0,
 * a la izquierda el dorso de la hoja k-1 y a la derecha el frente de la
 * hoja k (o solo la izquierda si ya no quedan hojas: contraportada).
 */
export function paginasVisibles(hojas, pasadas, spread) {
  if (hojas.length === 0) return { izquierda: null, derecha: null };
  if (!spread) {
    const i = Math.min(pasadas, hojas.length - 1);
    return { izquierda: null, derecha: hojas[i].frente };
  }
  const izquierda = pasadas > 0 ? hojas[pasadas - 1].dorso : null;
  const derecha = pasadas < hojas.length ? hojas[pasadas].frente : null;
  return { izquierda, derecha };
}

/**
 * El índice de página que se reporta afuera (contador, chips de sección,
 * URL): la más avanzada de las visibles. Es lo que mantiene los deep-links
 * y el resaltado de sección funcionando igual que en el modo deslizar.
 */
export function paginaActiva(hojas, pasadas, spread) {
  const v = paginasVisibles(hojas, pasadas, spread);
  return v.derecha ?? v.izquierda ?? 0;
}

/**
 * La inversa: cuántas hojas deben estar pasadas para VER la página `idx`
 * (para «ir a la sección» y el deep-link inicial).
 */
export function pasadasParaVer(hojas, idx, spread) {
  if (!spread) return Math.max(0, Math.min(idx, hojas.length - 1));
  for (let k = 0; k < hojas.length + 1; k++) {
    const v = paginasVisibles(hojas, k, true);
    if (v.izquierda === idx || v.derecha === idx) return k;
  }
  return 0;
}

/**
 * El ángulo de la hoja según dónde está el dedo respecto al LOMO.
 *
 * En el borde derecho 0°, sobre el lomo −90°, en el borde izquierdo −180°.
 * Se recorta a [−180, 0]: el dedo puede salirse del libro sin que la hoja
 * se dé la vuelta de más.
 */
export function anguloDesdePuntero(clientX, lomoX, anchoPagina) {
  if (anchoPagina <= 0) return 0;
  const rel = Math.max(-1, Math.min(1, (clientX - lomoX) / anchoPagina));
  return Math.max(-180, Math.min(0, -90 * (1 - rel)));
}

/**
 * Al soltar: ¿la hoja cae hacia adelante o se devuelve?
 *
 * Manda el IMPULSO si lo hay (un tirón corto pero rápido completa el pase,
 * como en el flipbook de referencia); si no, la posición: pasada la mitad
 * (−90°) cae, antes se devuelve. Velocidad en px/ms, negativa hacia la
 * izquierda.
 */
export const IMPULSO_QUE_DECIDE = 0.35;
export function decideAlSoltar(angulo, velocidadPxMs) {
  if (velocidadPxMs <= -IMPULSO_QUE_DECIDE) return true;
  if (velocidadPxMs >= IMPULSO_QUE_DECIDE) return false;
  return angulo < -90;
}

/**
 * Cuánto se arquea el papel en un ángulo dado del vuelo: nada en reposo,
 * máximo a mitad del giro, plano otra vez al caer. Devuelve los GRADOS de
 * cada columna de curvatura (se reparten entre las columnas anidadas).
 */
export function curvaturaEnAngulo(angulo, columnas, maxGrados = 14) {
  const arco = Math.sin((Math.min(Math.abs(angulo), 180) / 180) * Math.PI);
  return -(maxGrados * arco) / Math.max(1, columnas - 1);
}

/**
 * El desplazamiento del bloque del libro para el centrado tipo referencia:
 * cerrado al inicio (solo se ve la portada, centrada), abierto en el medio
 * (el lomo al centro), cerrado al final (solo la contraportada).
 * Devuelve la fracción del ANCHO DE PÁGINA a trasladar en X.
 */
export function desplazamientoDelLibro(hojas, pasadas, spread) {
  if (!spread) return 0;
  if (pasadas === 0) return -0.5;
  if (pasadas >= hojas.length) return 0.5;
  return 0;
}

/**
 * La duración del vuelo restante, proporcional a lo que falta por girar:
 * soltar la hoja casi caída no puede tardar lo mismo que el pase entero.
 */
export function duracionDelVuelo(desdeAngulo, hastaAngulo, durBase = 620) {
  return (durBase * Math.abs(hastaAngulo - desdeAngulo)) / 180 + 120;
}
