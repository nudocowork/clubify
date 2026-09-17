/**
 * Descargar una imagen de fuera SIN dejar que el otro lado decida cuánto
 * tarda ni cuánto pesa.
 *
 * Existe porque varios generadores de imágenes (iconos de marca, iconos de
 * sello) hacían `fetch(url)` a pelo dentro de peticiones públicas: un servidor
 * que no responde colgaba la petición, y uno que manda cientos de megas los
 * metía enteros en memoria antes de que `sharp` los rechazara.
 */
export class DescargaDemasiadoGrande extends Error {
  constructor(readonly maxBytes: number) {
    super(`La respuesta supera ${maxBytes} bytes`);
  }
}

export type ResultadoDescarga =
  | { ok: true; buffer: Buffer; contentType: string }
  | { ok: false; status: number };

export async function descargarAcotado(
  url: string,
  opts: { timeoutMs: number; maxBytes: number },
): Promise<ResultadoDescarga> {
  const res = await fetch(url, { signal: AbortSignal.timeout(opts.timeoutMs) });
  if (!res.ok) {
    // Soltar el cuerpo: sin esto la conexión queda ocupada hasta que el GC la cierre.
    await res.body?.cancel().catch(() => undefined);
    return { ok: false, status: res.status };
  }
  const declarado = Number(res.headers.get('content-length') ?? 0);
  if (declarado > opts.maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new DescargaDemasiadoGrande(opts.maxBytes);
  }
  const contentType = res.headers.get('content-type') ?? '';
  // El `content-length` puede faltar o mentir: se cuenta mientras se lee y se
  // corta en cuanto se pasa, en vez de leerlo todo y medir después.
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > opts.maxBytes) throw new DescargaDemasiadoGrande(opts.maxBytes);
    return { ok: true, buffer: buf, contentType };
  }
  const lector = res.body.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > opts.maxBytes) {
      await lector.cancel().catch(() => undefined);
      throw new DescargaDemasiadoGrande(opts.maxBytes);
    }
    trozos.push(value);
  }
  return { ok: true, buffer: Buffer.concat(trozos), contentType };
}

/** ¿Merece la pena volver a intentarlo pronto? 5xx y 429 sí; un 404 no. */
export function esEstadoPasajero(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}
