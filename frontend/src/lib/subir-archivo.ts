/**
 * La ÚNICA forma de subir un archivo desde el panel: valida con la política
 * (`politica-de-archivos.mjs`) ANTES de transmitir, sube por
 * `POST /api/media/upload?uso=…&folder=…` con progreso, y distingue «subiendo»
 * de «procesando» (el servidor optimiza la imagen después de recibirla; una
 * página de libro tarda 1–3 s y sin ese estado parecía colgado al 100 %).
 *
 * Por qué una sola: había cinco copias del mismo XHR (ImageUploader,
 * FileUploader, MenuBookPagesUploader, upload-cover-image, el editor de
 * correos), cada una con su tope (15 MB, 25 MB, «MiB» binarios) y su forma de
 * mostrar errores —una enseñaba al negocio el JSON crudo del servidor—.
 */
import { getToken } from '@/lib/api';
import {
  POLITICA,
  usoDeCarpeta,
  validarArchivo,
} from '@/lib/politica-de-archivos.mjs';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

export type Uso = keyof typeof POLITICA;
export type EstadoDeSubida = 'validando' | 'subiendo' | 'procesando' | 'listo' | 'error';

export interface ResultadoDeSubida {
  url: string;
  key: string;
  size: number;
  contentType: string;
  category: 'image' | 'audio' | 'video' | 'document';
  uso?: Uso;
  ancho?: number;
  alto?: number;
  bytesOriginal?: number;
  variantes?: Record<string, string>;
}

/** Error con un mensaje que SÍ se le puede enseñar al negocio. */
export class ErrorDeSubida extends Error {}

export function usoDe(opts: { uso?: Uso; folder?: string }): Uso {
  return (opts.uso ?? (usoDeCarpeta(opts.folder) as Uso)) as Uso;
}

/** Mensaje de Nest (`{"message": "..."}`) → texto para el negocio. */
function mensajeDelServidor(texto: string, status: number): string {
  try {
    const j = JSON.parse(texto);
    const m = Array.isArray(j?.message) ? j.message[0] : j?.message;
    if (typeof m === 'string' && m && !/^(Bad Request|File too large|Payload Too Large)$/i.test(m)) {
      return m;
    }
  } catch {
    /* respuesta no-JSON (proxy caído, 502…) */
  }
  if (status === 413) return 'El archivo es demasiado pesado. Reduce su tamaño o selecciona otro.';
  if (status === 401 || status === 403) return 'Tu sesión expiró o no tienes permiso para subir archivos. Vuelve a entrar.';
  if (status >= 500) return 'El servidor no pudo procesar el archivo. No se publicó nada; inténtalo de nuevo en un momento.';
  return `No se pudo subir el archivo (error ${status}).`;
}

function enviar<T>(
  ruta: string,
  file: Blob,
  nombre: string,
  alProgreso?: (pct: number) => void,
  alEstado?: (e: EstadoDeSubida) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file, nombre);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}${ruta}`);
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    alEstado?.('subiendo');
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      alProgreso?.(pct);
      if (pct >= 100) alEstado?.('procesando');
    };
    xhr.upload.onload = () => alEstado?.('procesando');
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        alEstado?.('error');
        reject(new ErrorDeSubida(mensajeDelServidor(xhr.responseText, xhr.status)));
        return;
      }
      try {
        const data = JSON.parse(xhr.responseText);
        alEstado?.('listo');
        resolve(data as T);
      } catch {
        alEstado?.('error');
        reject(new ErrorDeSubida('Respuesta del servidor inválida. Inténtalo de nuevo.'));
      }
    };
    xhr.onerror = () => {
      alEstado?.('error');
      reject(new ErrorDeSubida('Se cortó la conexión mientras subía el archivo. Revisa tu internet e inténtalo de nuevo.'));
    };
    xhr.onabort = () => {
      alEstado?.('error');
      reject(new ErrorDeSubida('Subida cancelada.'));
    };
    xhr.send(fd);
  });
}

/**
 * Sube un archivo para un USO. Lanza `ErrorDeSubida` con el motivo en español
 * (incluido el del peso, antes de transmitir un solo byte).
 */
export async function subirArchivo(
  file: File | Blob,
  opts: {
    uso?: Uso;
    folder?: string;
    nombre?: string;
    /** El recortador ya re-codificó la imagen: el tope se aplica a esto. */
    trasRecortar?: boolean;
    alProgreso?: (pct: number) => void;
    alEstado?: (e: EstadoDeSubida) => void;
  } = {},
): Promise<ResultadoDeSubida> {
  const uso = usoDe(opts);
  const nombre = opts.nombre ?? (file as File).name ?? 'archivo';
  opts.alEstado?.('validando');
  const problema = validarArchivo(
    { size: file.size, type: file.type, name: nombre },
    uso,
    { trasRecortar: opts.trasRecortar ?? false },
  );
  if (problema) {
    opts.alEstado?.('error');
    throw new ErrorDeSubida(problema);
  }
  const q = new URLSearchParams({ uso });
  if (opts.folder) q.set('folder', opts.folder);
  return enviar<ResultadoDeSubida>(`/api/media/upload?${q}`, file, nombre, opts.alProgreso, opts.alEstado);
}

/** Importa un PDF de menú libro: devuelve las páginas ya optimizadas, en orden. */
export async function importarPdfDelMenu(
  file: File,
  opts: { alProgreso?: (pct: number) => void; alEstado?: (e: EstadoDeSubida) => void } = {},
): Promise<{ total: number; paginas: ResultadoDeSubida[] }> {
  const problema = validarArchivo(file, 'PDF_MENU');
  if (problema) throw new ErrorDeSubida(problema);
  return enviar(`/api/media/importar-pdf`, file, file.name || 'menu.pdf', opts.alProgreso, opts.alEstado);
}

/** Mide una imagen local (para validar dimensiones antes de subir). */
export function medirImagen(file: Blob): Promise<{ ancho: number; alto: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ ancho: img.naturalWidth, alto: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen'));
    };
    img.src = url;
  });
}
