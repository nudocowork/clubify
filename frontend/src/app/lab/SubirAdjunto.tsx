'use client';
import { useRef, useState } from 'react';
import { getToken } from '@/lib/api';
import { AdjuntoLab } from './AdjuntoLab';

/**
 * Adjuntar una imagen o un video a una propuesta del Lab.
 *
 * Por qué no reusa `@/components/FileUploader`: ese sube a `/media/upload`, que
 * tiene su propia lista de roles (deja fuera a AFFILIATE_VENDOR, que sí usa el
 * Lab) y no sabe nada de las reglas del Lab —una sesión suplantada desde el
 * panel maestro no debe subir nada a nombre del administrador de la marca—. La
 * subida del Lab va por `/lab/adjuntos`, que pasa por esas mismas puertas.
 *
 * Se sigue pudiendo pegar una URL a mano, que es lo único que había antes.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// Los mismos tipos y topes que valida el backend (`lab-adjuntos.ts`). Acá son
// para avisar antes de gastar la subida, no como candado: el candado es el
// servidor.
const IMAGEN = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const VIDEO = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'];
const MAX_IMAGEN_MB = 15;
const MAX_VIDEO_MB = 100;

export const ADJUNTO_ACCEPT = [...IMAGEN, ...VIDEO].join(',');

function pesa(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function revisar(file: File): string | null {
  const esImagen = IMAGEN.includes(file.type);
  const esVideo = VIDEO.includes(file.type);
  if (!esImagen && !esVideo) {
    return 'Solo se pueden adjuntar imágenes (JPG, PNG, WebP, GIF) o videos (MP4, MOV, WebM).';
  }
  const tope = esVideo ? MAX_VIDEO_MB : MAX_IMAGEN_MB;
  if (file.size > tope * 1024 * 1024) {
    return `${esVideo ? 'El video' : 'La imagen'} pesa demasiado: máximo ${tope} MB (este pesa ${pesa(file.size)}).`;
  }
  return null;
}

export function SubirAdjunto({
  url,
  kind,
  onChange,
  disabled = false,
}: {
  url: string;
  kind: string;
  onChange: (url: string, kind: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function subir(file: File) {
    const malo = revisar(file);
    if (malo) {
      setError(malo);
      return;
    }
    setError(null);
    setSubiendo(true);
    setProgreso(0);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      const r = await new Promise<{ url: string; kind: string }>((ok, fallo) => {
        const xhr = new XMLHttpRequest();
        // Un video tarda: sin la barra parece que se colgó y se vuelve a pulsar.
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgreso(Math.round((e.loaded / e.total) * 100));
        };
        xhr.open('POST', `${API}/api/lab/adjuntos`);
        const token = getToken();
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.onload = () => {
          try {
            const cuerpo = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) ok(cuerpo);
            else fallo(new Error(cuerpo?.message ?? `Error ${xhr.status}`));
          } catch {
            fallo(new Error('El servidor respondió algo que no entendimos.'));
          }
        };
        xhr.onerror = () => fallo(new Error('No se pudo subir el archivo.'));
        xhr.send(fd);
      });
      onChange(r.url, r.kind);
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo subir el archivo.');
    } finally {
      setSubiendo(false);
      setProgreso(0);
    }
  }

  return (
    <div className="grid gap-2">
      {url ? (
        <div className="rounded-xl border border-line p-3">
          <AdjuntoLab url={url} kind={kind} />
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              className="btn-ghost text-xs"
              disabled={disabled || subiendo}
              onClick={() => inputRef.current?.click()}
            >
              Cambiar
            </button>
            <button
              type="button"
              className="btn-ghost text-xs text-bad"
              disabled={disabled || subiendo}
              onClick={() => onChange('', '')}
            >
              Quitar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="rounded-xl border-2 border-dashed border-line hover:border-brand transition p-4 text-center"
          disabled={disabled || subiendo}
          onClick={() => inputRef.current?.click()}
        >
          {subiendo ? (
            <>
              <div className="h-1.5 rounded-full bg-line overflow-hidden mb-2">
                <div
                  className="h-full bg-brand transition-all"
                  style={{ width: `${progreso}%` }}
                />
              </div>
              <span className="text-xs text-mute">Subiendo... {progreso}%</span>
            </>
          ) : (
            <>
              <div className="text-sm font-medium text-ink">
                📎 Adjuntar una imagen o un video
              </div>
              <div className="text-xs text-mute2 mt-1">
                JPG, PNG, WebP o GIF hasta {MAX_IMAGEN_MB} MB · MP4, MOV o WebM
                hasta {MAX_VIDEO_MB} MB
              </div>
            </>
          )}
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ADJUNTO_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          // Se limpia el input para que elegir el MISMO archivo otra vez
          // (después de un fallo) vuelva a disparar el change.
          e.target.value = '';
          if (f) subir(f);
        }}
      />

      <details className="text-xs text-mute2">
        <summary className="cursor-pointer">O pegar el enlace de un archivo</summary>
        <input
          className="input mt-2"
          type="url"
          placeholder="https://... (imagen, video, PDF)"
          value={url}
          disabled={disabled || subiendo}
          onChange={(e) => onChange(e.target.value.trim(), '')}
        />
      </details>

      {error && (
        <div className="rounded-lg bg-bad-soft px-3 py-2 text-xs text-bad-ink">
          {error}
        </div>
      )}
    </div>
  );
}
