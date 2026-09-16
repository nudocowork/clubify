/**
 * El zoom del menú libro: las cuentas.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * Los clientes piden ampliar la carta desde el móvil. Hoy no pueden, y no
 * es que falte el botón: el slider del visor lleva `touch-action: pan-x`
 * (`touch-pan-x`), y eso le QUITA al navegador su propio pellizco sobre las
 * imágenes. El gesto de toda la vida no hace nada.
 *
 * El fallo clásico de este tipo de visor es el que hay que evitar al
 * añadirlo: ampliar y luego mover la imagen no puede cambiar de página. Por
 * eso el desplazamiento se limita SIEMPRE contra el borde de la imagen
 * ampliada, y a escala 1 el límite es 0 — la imagen no se puede mover y el
 * slider vuelve a mandar.
 *
 * Las cuentas viven aquí y no dentro del componente para poder probarlas
 * desde node sin montar React:
 *   node scripts/pruebas-libro-zoom.mjs
 */

/** A 1 se ve la página entera; es el estado en el que el slider pasa hoja. */
export const ZOOM_MINIMO = 1;
/** Más de 4 no aporta: la imagen original no tiene ese detalle. */
export const ZOOM_MAXIMO = 4;
/** Lo que amplía un doble toque. Suficiente para leer un precio. */
export const ZOOM_DOBLE_TOQUE = 2.5;
/** Escalón de los botones +/− y de la rueda. */
export const PASO_DE_ZOOM = 0.5;

/** El zoom nunca sale del rango. */
export function limitarZoom(escala) {
  const n = Number(escala);
  if (!Number.isFinite(n)) return ZOOM_MINIMO;
  return Math.min(ZOOM_MAXIMO, Math.max(ZOOM_MINIMO, n));
}

/** Si a esta escala el visor sigue pasando página. */
export function pasaPagina(escala) {
  return limitarZoom(escala) <= ZOOM_MINIMO;
}

/**
 * Cuánto se puede arrastrar en un eje: hasta que el borde de la imagen
 * ampliada llegue al borde de lo que se ve, y ni un píxel más. Si la imagen
 * ampliada sigue siendo más pequeña que el hueco (pasa en el modo vertical,
 * donde va en `object-contain`), el límite es 0 y se queda centrada.
 */
export function limiteDeArrastre(medida, medidaVisible, escala) {
  const ampliada = Number(medida) * limitarZoom(escala);
  const hueco = Number(medidaVisible);
  if (!Number.isFinite(ampliada) || !Number.isFinite(hueco)) return 0;
  return Math.max(0, (ampliada - hueco) / 2);
}

/**
 * Deja el desplazamiento dentro de lo permitido.
 * `medidas`: tamaño de la imagen SIN ampliar y del hueco donde se ve.
 */
export function limitarDesplazamiento(desplazamiento, escala, medidas) {
  const { ancho = 0, alto = 0, anchoVisible = 0, altoVisible = 0 } = medidas ?? {};
  const maxX = limiteDeArrastre(ancho, anchoVisible, escala);
  const maxY = limiteDeArrastre(alto, altoVisible, escala);
  const x = Number(desplazamiento?.x) || 0;
  const y = Number(desplazamiento?.y) || 0;
  return {
    x: Math.min(maxX, Math.max(-maxX, x)),
    y: Math.min(maxY, Math.max(-maxY, y)),
  };
}

/**
 * Amplía dejando quieto el punto que el dedo (o el cursor) está tocando.
 * Sin esto, ampliar salta al centro y el cliente pierde de vista el plato
 * que estaba mirando.
 *
 * `punto` va medido desde el CENTRO del hueco visible.
 */
export function zoomHaciaUnPunto({
  escala,
  nuevaEscala,
  desplazamiento,
  punto,
  medidas,
}) {
  const s = limitarZoom(escala);
  const s2 = limitarZoom(nuevaEscala);
  const d = { x: Number(desplazamiento?.x) || 0, y: Number(desplazamiento?.y) || 0 };
  const p = { x: Number(punto?.x) || 0, y: Number(punto?.y) || 0 };
  // El punto bajo el dedo se queda donde está: d' = p − (s'/s)·(p − d)
  const razon = s2 / s;
  const bruto = {
    x: p.x - razon * (p.x - d.x),
    y: p.y - razon * (p.y - d.y),
  };
  return {
    escala: s2,
    desplazamiento: limitarDesplazamiento(bruto, s2, medidas),
  };
}

/** Distancia entre dos dedos (para el pellizco). */
export function distanciaEntreDedos(a, b) {
  const dx = (Number(b?.x) || 0) - (Number(a?.x) || 0);
  const dy = (Number(b?.y) || 0) - (Number(a?.y) || 0);
  return Math.hypot(dx, dy);
}

/** Punto medio entre dos dedos: el centro del pellizco. */
export function puntoMedio(a, b) {
  return {
    x: ((Number(a?.x) || 0) + (Number(b?.x) || 0)) / 2,
    y: ((Number(a?.y) || 0) + (Number(b?.y) || 0)) / 2,
  };
}

/** Escala de un pellizco en curso, a partir de la separación inicial. */
export function escalaDelPellizco(escalaInicial, distanciaInicial, distancia) {
  const d0 = Number(distanciaInicial);
  const d = Number(distancia);
  if (!Number.isFinite(d0) || d0 <= 0 || !Number.isFinite(d)) {
    return limitarZoom(escalaInicial);
  }
  return limitarZoom(Number(escalaInicial) * (d / d0));
}

/**
 * Cuánto mueve el zoom una vuelta de rueda. 0 = no tocar nada.
 *
 * El deslizamiento LATERAL de un trackpad manda `deltaY = 0` (el gesto va en
 * `deltaX`). Tratarlo como «hacia abajo» hacía que deslizar de lado con la
 * página ampliada la fuera encogiendo sola.
 */
export function pasoDeLaRueda(deltaY) {
  const d = Number(deltaY);
  if (!Number.isFinite(d) || d === 0) return 0;
  return d < 0 ? PASO_DE_ZOOM : -PASO_DE_ZOOM;
}

/** Qué hace un doble toque: si ya está ampliado, devuelve la página entera. */
export function zoomDelDobleToque(escala) {
  return pasaPagina(escala) ? ZOOM_DOBLE_TOQUE : ZOOM_MINIMO;
}

/**
 * Si la rueda del ratón debe ampliar en vez de desplazar la página.
 *
 * Con Ctrl/⌘ siempre (es el gesto universal, y es lo que manda el pellizco
 * del trackpad). Sin modificador, solo cuando el cliente YA amplió: así la
 * rueda nunca le secuestra el desplazamiento normal de la página, y en
 * cuanto vuelve a 1 recupera el control sin quedarse atrapado.
 */
export function laRuedaAmplia(escala, conModificador) {
  return Boolean(conModificador) || !pasaPagina(escala);
}

/** Estado inicial (y el de «volver a 100 %»). */
export function zoomInicial() {
  return { escala: ZOOM_MINIMO, desplazamiento: { x: 0, y: 0 } };
}
