/**
 * El COMPROBANTE de una transferencia de comisiones: lo que permite demostrar
 * meses después que el pago salió de verdad, en vez de fiarse de una nota
 * escrita a mano ("Wise tx 4f3a").
 *
 * Aquí solo vive la REVISIÓN de lo que llega del panel. El archivo ya se subió
 * por `/media/upload` (S3/R2) y lo único que viaja es la URL: en esta base ya
 * hubo un caso de imágenes guardadas en crudo dentro de un JSON que se comió el
 * 77% del disco (QrPoster), así que el archivo nunca entra a la base.
 *
 * Función pura y sin Nest a propósito: es la parte que se puede probar sola.
 */

/** Lo que un banco entrega como comprobante: una captura o el PDF del soporte. */
export const TIPOS_DE_COMPROBANTE = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export type TipoDeComprobante = (typeof TIPOS_DE_COMPROBANTE)[number];

export type Comprobante = {
  url: string;
  /** Solo decide el icono/preview del panel. Null si no se pudo deducir. */
  mimeType: TipoDeComprobante | null;
};

export type RevisionDeComprobante =
  | { ok: true; comprobante: Comprobante | null }
  | { ok: false; motivo: string };

/** Tope del DTO (`@MaxLength(1000)`): una URL más larga es basura, no un enlace. */
const MAX_LARGO_URL = 1000;

const POR_EXTENSION: Record<string, TipoDeComprobante> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

/** Deduce el tipo por la extensión de la URL del bucket (`…/abc123.pdf`). */
export function tipoPorExtension(url: string): TipoDeComprobante | null {
  const sinQuery = url.split(/[?#]/)[0];
  const ext = (sinQuery.split('.').pop() ?? '').toLowerCase();
  return POR_EXTENSION[ext] ?? null;
}

/**
 * Revisa el comprobante que manda el panel antes de guardarlo con el pago.
 *
 * @param url        URL que devolvió `/media/upload`. Vacía/ausente = sin
 *                   comprobante (es opcional: un pago viejo puede no tenerlo).
 * @param mimeType   `contentType` que devolvió el upload. Opcional.
 * @param basePublica `S3_PUBLIC_URL` — la base pública del bucket. Cuando está
 *                   configurada se exige que la URL sea de ESE host.
 */
export function revisarComprobante(
  url?: string | null,
  mimeType?: string | null,
  basePublica?: string | null,
): RevisionDeComprobante {
  const limpia = (url ?? '').trim();
  if (!limpia) return { ok: true, comprobante: null };

  if (limpia.length > MAX_LARGO_URL) {
    return { ok: false, motivo: 'El enlace del comprobante es demasiado largo.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(limpia);
  } catch {
    return { ok: false, motivo: 'El comprobante no es un enlace válido.' };
  }

  // Solo https: la URL termina en un `href` del panel y en el histórico
  // contable. `http:`, `data:` o `javascript:` no son un comprobante de nada.
  if (parsed.protocol !== 'https:') {
    return { ok: false, motivo: 'El comprobante tiene que ser un enlace https.' };
  }

  // Credenciales en el enlace (`https://usuario:clave@host/…`): no salen nunca
  // de nuestro bucket y sirven para disfrazar el host ante quien lee la URL por
  // encima — se ve el "usuario" y se lee como si fuera el dominio.
  if (parsed.username || parsed.password) {
    return {
      ok: false,
      motivo: 'El comprobante no puede llevar usuario ni contraseña en el enlace.',
    };
  }

  // Host EXACTO, no prefijo. Comparar con `startsWith` dejaba pasar
  // `https://<base>.attacker.com/...` — es el mismo agujero que se tapó en el
  // proxy de /media (FIX 2026-06-16). Un comprobante que apunta afuera del
  // bucket se cae el día que hay que demostrar el pago.
  if (basePublica) {
    let hostBucket: string;
    try {
      hostBucket = new URL(basePublica).host;
    } catch {
      return { ok: false, motivo: 'La configuración del bucket no es válida.' };
    }
    if (parsed.host !== hostBucket) {
      return {
        ok: false,
        motivo: 'El comprobante tiene que ser un archivo subido a Clubify.',
      };
    }
  }

  const declarado = (mimeType ?? '').trim().toLowerCase().split(';')[0];
  if (declarado && !TIPOS_DE_COMPROBANTE.includes(declarado as TipoDeComprobante)) {
    return {
      ok: false,
      motivo: 'El comprobante tiene que ser una imagen (JPG, PNG o WebP) o un PDF.',
    };
  }

  // Sin tipo declarado se deduce de la extensión, y si tampoco sale de ahí se
  // rechaza. El candado no puede depender de que el panel mande el
  // `contentType`: cuando no lo mandaba, un `.mp4` entraba como comprobante
  // porque no había nada que comparar.
  const tipo = (declarado as TipoDeComprobante) || tipoPorExtension(limpia);
  if (!tipo) {
    return {
      ok: false,
      motivo:
        'No se pudo determinar el tipo del comprobante: subí una imagen (JPG, PNG o WebP) o un PDF.',
    };
  }

  return { ok: true, comprobante: { url: limpia, mimeType: tipo } };
}
