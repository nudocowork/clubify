'use client';
import { useRef, useState } from 'react';
import { Icon } from './Icon';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

function getToken() {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(^|;\s*)clubify_token=([^;]+)/);
  return m ? decodeURIComponent(m[2]) : null;
}

export function ImageUploader({
  value,
  onChange,
  folder = 'products',
  className = '',
}: {
  value?: string | null;
  onChange: (url: string | null) => void;
  folder?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setErr('Solo imágenes (jpg, png, webp, gif)');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErr('Máximo 5 MB');
      return;
    }
    setErr(null);
    setBusy(true);
    setProgress(10);

    try {
      const fd = new FormData();
      fd.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      const result = await new Promise<{ url: string }>((resolve, reject) => {
        xhr.open('POST', `${API}/api/media/upload?folder=${folder}`);
        const token = getToken();
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve(JSON.parse(xhr.responseText))
            : reject(new Error(xhr.responseText || 'Upload failed'));
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(fd);
      });
      onChange(result.url);
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
    if (file) handleFile(file);
  }

  if (value) {
    return (
      <div className={`relative group ${className}`}>
        <img
          src={value}
          alt=""
          className="w-full h-40 object-cover rounded-input border border-line"
        />
        <div className="absolute inset-0 bg-ink/0 group-hover:bg-ink/40 rounded-input transition flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => inputRef.current?.click()}
          >
            <Icon name="edit" size={12} /> Cambiar
          </button>
          <button
            type="button"
            className="btn-danger text-xs"
            onClick={() => onChange(null)}
          >
            <Icon name="trash" size={12} /> Quitar
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </div>
    );
  }

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
        className={`relative h-40 rounded-input border-2 border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer transition ${
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
            <div className="text-sm font-medium">Sube una imagen</div>
            <div className="text-xs text-mute">
              Arrastra o haz click · jpg, png, webp · max 5MB
            </div>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
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
