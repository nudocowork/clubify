/**
 * Quita el fondo LISO de una foto de producto, en el navegador.
 *
 * Toma el color de los bordes y borra desde los bordes hacia adentro todo lo
 * que se le parezca (relleno por inundación, no por color global: así no se
 * come el blanco DENTRO del producto, como la espuma de un café). Luego recorta
 * al producto y lo centra en un cuadrado, para que el sello quede centrado.
 *
 * Es para el laboratorio: con fotos de fondo complejo no hace milagros. Si el
 * estilo se aprueba, en producción conviene hacerlo en el servidor.
 */
const LADO_MAX = 512;
const TOLERANCIA = 42;

function cargar(url: string): Promise<HTMLImageElement> {
  return new Promise((ok, mal) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => mal(new Error('No se pudo leer la imagen'));
    img.src = url;
  });
}

export async function quitarFondo(dataUrl: string): Promise<string> {
  const img = await cargar(dataUrl);
  const k = Math.min(1, LADO_MAX / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k));
  const h = Math.max(1, Math.round(img.height * k));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  const datos = ctx.getImageData(0, 0, w, h);
  const px = datos.data;

  // Color del fondo = promedio del borde (los PNG ya transparentes no se tocan).
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  let transparentes = 0;
  const borde: number[] = [];
  for (let x = 0; x < w; x++) borde.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) borde.push(y * w, y * w + w - 1);
  for (const i of borde) {
    if (px[i * 4 + 3] < 20) transparentes++;
    r += px[i * 4];
    g += px[i * 4 + 1];
    b += px[i * 4 + 2];
    n++;
  }
  if (transparentes > n * 0.5) return recortar(cv, ctx, w, h);
  r /= n;
  g /= n;
  b /= n;

  const dist = (i: number) => Math.hypot(px[i * 4] - r, px[i * 4 + 1] - g, px[i * 4 + 2] - b);
  const visto = new Uint8Array(w * h);
  const cola: number[] = [];
  for (const i of borde) {
    if (!visto[i] && dist(i) < TOLERANCIA * 1.5) {
      visto[i] = 1;
      cola.push(i);
    }
  }
  while (cola.length) {
    const i = cola.pop()!;
    const d = dist(i);
    // Borde suave: lo muy parecido se borra entero; lo de la orilla, a medias.
    px[i * 4 + 3] = d < TOLERANCIA ? 0 : Math.min(px[i * 4 + 3], Math.round(((d - TOLERANCIA) / (TOLERANCIA * 0.5)) * 255));
    if (d >= TOLERANCIA) continue;
    const x = i % w;
    const y = (i - x) / w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j >= 0 && !visto[j] && dist(j) < TOLERANCIA * 1.5) {
        visto[j] = 1;
        cola.push(j);
      }
    }
  }
  ctx.putImageData(datos, 0, 0);
  return recortar(cv, ctx, w, h);
}

/** Recorta a lo visible y lo centra en un cuadrado con un pequeño margen. */
function recortar(cv: HTMLCanvasElement, ctx: CanvasRenderingContext2D, w: number, h: number): string {
  const px = ctx.getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return cv.toDataURL('image/png');
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const lado = Math.round(Math.max(bw, bh) * 1.06);
  const out = document.createElement('canvas');
  out.width = lado;
  out.height = lado;
  out.getContext('2d')!.drawImage(cv, x0, y0, bw, bh, (lado - bw) / 2, (lado - bh) / 2, bw, bh);
  return out.toDataURL('image/png');
}
