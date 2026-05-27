'use client';
import { useRef, useState } from 'react';
import { Icon } from './Icon';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

function getToken() {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(^|;\s*)clubify_token=([^;]+)/);
  return m ? decodeURIComponent(m[2]) : null;
}

export type FileKind = 'audio' | 'video' | 'document' | 'image' | 'any';

type UploadResult = {
  url: string;
  key: string;
  size: number;
  contentType: string;
  category: 'image' | 'audio' | 'video' | 'document';
};

const ACCEPT_BY_KIND: Record<FileKind, string> = {
  audio: 'audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave,audio/mp4,audio/m4a,audio/x-m4a,audio/aac,audio/ogg,audio/webm',
  video: 'video/mp4,video/quicktime,video/webm,video/x-m4v',
  document: 'application/pdf',
  image: 'image/jpeg,image/png,image/webp,image/gif',
  any: 'image/jpeg,image/png,image/webp,image/gif,audio/mpeg,audio/mp3,audio/wav,audio/m4a,audio/aac,audio/ogg,audio/webm,video/mp4,video/quicktime,video/webm,application/pdf',
};

const MAX_MB_BY_KIND: Record<FileKind, number> = {
  audio: 50,
  video: 100,
  document: 30,
  image: 15,
  any: 100,
};

function prettyBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.split('/').pop() ?? url;
  } catch {
    return url.split('/').pop() ?? url;
  }
}

function detectCategory(contentType: string): UploadResult['category'] {
  if (contentType.startsWith('audio/')) return 'audio';
  if (contentType.startsWith('video/')) return 'video';
  if (contentType === 'application/pdf') return 'document';
  return 'image';
}

/**
 * Uploader genérico para archivos NO-cropper (audio, video, PDF, o imágenes
 * sin recortar). Para fotos de producto con cropper seguí usando
 * `ImageUploader`. Este componente sube directo vía multipart /api/media/upload
 * con progress y preview por tipo.
 */
export function FileUploader({
  value,
  contentType,
  onChange,
  folder = 'crm-attachments',
  kind = 'any',
  maxSizeMb,
  className = '',
  label,
}: {
  value?: string | null;
  /** Tipo del archivo guardado (para mostrar preview correcto al volver a abrir). */
  contentType?: string | null;
  onChange: (url: string | null, meta?: { contentType: string; size: number; category: UploadResult['category'] }) => void;
  folder?: string;
  kind?: FileKind;
  maxSizeMb?: number;
  className?: string;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const accept = ACCEPT_BY_KIND[kind];
  const cap = maxSizeMb ?? MAX_MB_BY_KIND[kind];

  async function pickFile(file: File) {
    if (accept) {
      const allowed = accept.split(',').map((s) => s.trim());
      if (!allowed.includes(file.type)) {
        setErr(`Tipo no permitido: ${file.type || 'desconocido'}`);
        return;
      }
    }
    if (file.size > cap * 1024 * 1024) {
      setErr(`Máximo ${cap} MB (este pesa ${prettyBytes(file.size)})`);
      return;
    }
    setErr(null);
    await uploadBlob(file);
  }

  async function uploadBlob(file: File) {
    setBusy(true);
    setProgress(5);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      };
      const result = await new Promise<UploadResult>((resolve, reject) => {
        xhr.open('POST', `${API}/api/media/upload?folder=${folder}`);
        const token = getToken();
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.onload = () => {
          if (xhr.status < 200 || xhr.status >= 300) {
            try {
              const parsed = JSON.parse(xhr.responseText);
              reject(new Error(parsed.message || parsed.error || 'Upload failed'));
            } catch {
              reject(new Error(xhr.responseText || `HTTP ${xhr.status}`));
            }
            return;
          }
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            reject(new Error('Respuesta del servidor inválida'));
          }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(fd);
      });
      onChange(result.url, {
        contentType: result.contentType,
        size: result.size,
        category: result.category,
      });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) pickFile(file);
  }

  // ─────────── Preview de archivo ya subido ───────────
  if (value) {
    const category = contentType ? detectCategory(contentType) : null;
    const name = fileNameFromUrl(value);

    return (
      <div className={`relative group ${className}`}>
        <div className="rounded-input border border-line bg-bg2/40 p-3 flex items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-brand-soft flex items-center justify-center flex-shrink-0 text-2xl">
            {category === 'audio' && '🎵'}
            {category === 'video' && '🎬'}
            {category === 'document' && '📄'}
            {category === 'image' && '🖼️'}
            {!category && '📎'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{name}</div>
            <div className="text-xs text-mute">
              {contentType ?? 'archivo'} ·{' '}
              <a
                href={value}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:underline"
              >
                Abrir
              </a>
            </div>
          </div>
          <div className="flex gap-1 flex-shrink-0">
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => inputRef.current?.click()}
              title="Cambiar archivo"
            >
              <Icon name="edit" size={12} />
            </button>
            <button
              type="button"
              className="btn-danger text-xs"
              onClick={() => onChange(null)}
              title="Quitar archivo"
            >
              <Icon name="trash" size={12} />
            </button>
          </div>
        </div>

        {/* Inline preview por tipo */}
        {category === 'audio' && (
          <audio src={value} controls className="w-full mt-2" />
        )}
        {category === 'video' && (
          <video
            src={value}
            controls
            className="w-full mt-2 rounded-input max-h-72 bg-ink"
          />
        )}
        {category === 'image' && (
          <img
            src={value}
            alt=""
            className="w-full mt-2 rounded-input max-h-72 object-contain bg-bg2"
          />
        )}

        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])}
        />
      </div>
    );
  }

  // ─────────── Dropzone ───────────
  return (
    <div className={className}>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`relative min-h-[120px] rounded-input border-2 border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer transition p-4 ${
          dragOver
            ? 'border-brand bg-brand-soft'
            : 'border-line hover:border-brand bg-bg2/50'
        }`}
      >
        {busy ? (
          <>
            <div className="w-2/3 h-1.5 rounded-full bg-line overflow-hidden">
              <div
                className="h-full bg-brand transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="text-xs text-mute">Subiendo… {progress}%</div>
          </>
        ) : (
          <>
            <div className="w-10 h-10 rounded-full bg-brand-soft flex items-center justify-center text-brand">
              <Icon name="plus" size={18} />
            </div>
            <div className="text-sm font-medium">
              {label ?? 'Subir archivo'}
            </div>
            <div className="text-xs text-mute text-center leading-relaxed">
              Arrastra o haz click ·{' '}
              {kind === 'audio' && 'mp3, wav, m4a, aac, ogg'}
              {kind === 'video' && 'mp4, mov, webm'}
              {kind === 'document' && 'pdf'}
              {kind === 'image' && 'jpg, png, webp, gif'}
              {kind === 'any' && 'imagen, audio, video o pdf'}
              <br />
              max {cap} MB
            </div>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])}
        />
      </div>
      {err && (
        <div className="mt-2 rounded-lg bg-bad-soft px-3 py-2 text-xs text-bad-ink">
          {err}
        </div>
      )}
    </div>
  );
}
