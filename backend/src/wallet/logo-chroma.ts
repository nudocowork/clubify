/**
 * Chroma-key del logo del wallet pass, versión "solo el fondo de verdad".
 *
 * PDF de peticiones de clientes (2026-08): «al subir un logo con fondo blanco
 * o con letras blancas, el sistema le quita el fondo» — el chroma-key anterior
 * recorría TODOS los píxeles y volvía transparente cualquier RGB ≥ 240. Eso
 * borraba también las letras/detalles blancos DENTRO del logo (no solo el
 * fondo), dejándolo ilegible cuando el pase tiene un color de fondo claro.
 *
 * El fix: flood-fill (4-conexo) desde los bordes de la imagen. Solo se vuelve
 * transparente el blanco CONECTADO al borde — es decir, el fondo real. Las
 * letras blancas dentro de una forma de color quedan intactas porque no tocan
 * el borde. Un logo con letras blancas sobre fondo de color no pierde nada
 * (ningún píxel del borde es blanco → no hay semillas → no se toca).
 */

/** Umbral conservador: RGB todos ≥ 240 se considera "blanco de fondo". */
export const WHITE_BG_THRESHOLD = 240;

/**
 * Recibe píxeles RGBA planos (row-major) y devuelve una copia donde el blanco
 * conectado al borde quedó transparente. No muta la entrada.
 */
export function removeBorderConnectedWhite(
  data: Uint8Array | Buffer,
  width: number,
  height: number,
  threshold = WHITE_BG_THRESHOLD,
): Uint8Array {
  const out = new Uint8Array(data);
  const n = width * height;
  if (n === 0) return out;

  const isWhite = (p: number): boolean => {
    const i = p * 4;
    return (
      out[i] >= threshold && out[i + 1] >= threshold && out[i + 2] >= threshold
    );
  };

  // BFS con cola plana preasignada: cada píxel entra a lo sumo una vez.
  const visited = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const push = (p: number) => {
    if (!visited[p] && isWhite(p)) {
      visited[p] = 1;
      queue[tail++] = p;
    }
  };

  // Semillas: todos los píxeles blancos del borde exterior.
  for (let x = 0; x < width; x++) {
    push(x); // fila superior
    push((height - 1) * width + x); // fila inferior
  }
  for (let y = 0; y < height; y++) {
    push(y * width); // columna izquierda
    push(y * width + width - 1); // columna derecha
  }

  while (head < tail) {
    const p = queue[head++];
    const x = p % width;
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (p >= width) push(p - width);
    if (p < n - width) push(p + width);
  }

  for (let p = 0; p < n; p++) {
    if (visited[p]) out[p * 4 + 3] = 0;
  }
  return out;
}
