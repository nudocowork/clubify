'use client';
import { useEffect, useRef, useState } from 'react';
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
  // Si true (default para fotos de producto), abre el cropper antes de
  // subir. Si false (logos, branding), sube tal cual.
  crop = true,
  aspect = 1, // 1 = cuadrado, 4/3 = card, etc.
}: {
  value?: string | null;
  onChange: (url: string | null) => void;
  folder?: string;
  className?: string;
  crop?: boolean;
  aspect?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);

  function pickFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setErr('Solo imágenes (jpg, png, webp, gif)');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErr('Máximo 5 MB');
      return;
    }
    setErr(null);
    if (crop) {
      // Crear URL local para el cropper, luego se sube el blob recortado
      const url = URL.createObjectURL(file);
      setCropSrc(url);
    } else {
      uploadBlob(file);
    }
  }

  async function uploadBlob(blob: Blob | File) {
    setBusy(true);
    setProgress(10);
    try {
      const fd = new FormData();
      const filename = (blob as File).name ?? 'cropped.jpg';
      fd.append('file', blob, filename);
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      };
      const result = await new Promise<{ url: string }>((resolve, reject) => {
        xhr.open('POST', `${API}/api/media/upload?folder=${folder}`);
        const token = getToken();
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.onload = () => {
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(new Error(xhr.responseText || 'Upload failed'));
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
    if (file) pickFile(file);
  }

  // ─────────── Render ───────────
  if (cropSrc) {
    return (
      <CropperModal
        src={cropSrc}
        aspect={aspect}
        onCancel={() => {
          URL.revokeObjectURL(cropSrc);
          setCropSrc(null);
        }}
        onConfirm={(blob) => {
          URL.revokeObjectURL(cropSrc);
          setCropSrc(null);
          uploadBlob(blob);
        }}
      />
    );
  }

  if (value) {
    return (
      <div className={`relative group ${className}`}>
        <img src={value} alt="" className="w-full h-40 object-cover rounded-input border border-line" />
        <div className="absolute inset-0 bg-ink/0 group-hover:bg-ink/40 rounded-input transition flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
          <button type="button" className="btn-ghost text-xs" onClick={() => inputRef.current?.click()}>
            <Icon name="edit" size={12} /> Cambiar
          </button>
          <button type="button" className="btn-danger text-xs" onClick={() => onChange(null)}>
            <Icon name="trash" size={12} /> Quitar
          </button>
        </div>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])} />
      </div>
    );
  }

  return (
    <div className={className}>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`relative h-40 rounded-input border-2 border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer transition ${
          dragOver ? 'border-brand bg-brand-soft' : 'border-line hover:border-brand bg-bg2/50'
        }`}
      >
        {busy ? (
          <>
            <div className="w-2/3 h-1.5 rounded-full bg-line overflow-hidden">
              <div className="h-full bg-brand transition-all" style={{ width: `${progress}%` }} />
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
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])} />
      </div>
      {err && (
        <div className="mt-2 rounded-lg bg-bad-soft px-3 py-2 text-xs text-bad-ink">{err}</div>
      )}
    </div>
  );
}

/**
 * Cropper minimalista sin deps externas.
 *
 * - Frame fijo cuadrado (o aspect ratio dado) muestra el área que se va a
 *   guardar — lo que ves ahí es lo que sube.
 * - Slider de zoom (1x–4x). Drag para reposicionar la imagen dentro del frame.
 * - Al confirmar, dibuja la región visible del frame a un canvas y exporta
 *   JPEG 0.92 (~tamaño moderado).
 *
 * Implementación: la imagen se renderiza con CSS transform translate + scale
 * dentro de un viewport overflow-hidden del tamaño del frame. El export
 * computa el rectángulo equivalente sobre la imagen original y lo dibuja al
 * canvas con esas dimensiones.
 */
function CropperModal({
  src,
  aspect,
  onConfirm,
  onCancel,
}: {
  src: string;
  aspect: number;
  onConfirm: (blob: Blob) => void;
  onCancel: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 }); // px offset from center
  const dragState = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const [exporting, setExporting] = useState(false);

  // Frame visible (px). Mantengo cuadrado para aspect=1 ó rectangular según aspect.
  const FRAME_W = 320;
  const FRAME_H = Math.round(FRAME_W / aspect);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
      // Auto-fit: zoom mínimo para cubrir todo el frame
      const minZoom = Math.max(FRAME_W / img.naturalWidth, FRAME_H / img.naturalHeight);
      setZoom(Math.max(1, minZoom));
      setImgLoaded(true);
    };
    img.src = src;
  }, [src]);

  // Después de cambiar zoom, clampear pos para que la imagen no salga del frame
  useEffect(() => {
    if (!imgLoaded) return;
    setPos((p) => clampPos(p, zoom, imgSize, FRAME_W, FRAME_H));
  }, [zoom, imgLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  function clampPos(p: { x: number; y: number }, z: number, sz: { w: number; h: number }, fw: number, fh: number) {
    const sw = sz.w * z;
    const sh = sz.h * z;
    const maxX = Math.max(0, (sw - fw) / 2);
    const maxY = Math.max(0, (sh - fh) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, p.x)),
      y: Math.max(-maxY, Math.min(maxY, p.y)),
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startY: e.clientY, baseX: pos.x, baseY: pos.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    setPos(clampPos({ x: dragState.current.baseX + dx, y: dragState.current.baseY + dy }, zoom, imgSize, FRAME_W, FRAME_H));
  }
  function onPointerUp(e: React.PointerEvent) {
    dragState.current = null;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  }

  async function confirm() {
    if (!imgRef.current || !imgLoaded) return;
    setExporting(true);
    // Output canvas: tamaño basado en frame * 2 para mejor calidad sin ser enorme
    const OUT_W = FRAME_W * 2;
    const OUT_H = FRAME_H * 2;
    const canvas = document.createElement('canvas');
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) { setExporting(false); return; }

    // Calcular el rect sobre la imagen original que está visible en el frame.
    // En el viewport: la imagen se renderiza centrada, luego shifted por pos,
    // y escalada por zoom. El centro del frame corresponde al pixel
    // (imgSize.w/2 - pos.x/zoom, imgSize.h/2 - pos.y/zoom) de la imagen.
    const sw = FRAME_W / zoom;
    const sh = FRAME_H / zoom;
    const cx = imgSize.w / 2 - pos.x / zoom;
    const cy = imgSize.h / 2 - pos.y / zoom;
    const sx = cx - sw / 2;
    const sy = cy - sh / 2;

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, OUT_W, OUT_H);
    ctx.drawImage(imgRef.current, sx, sy, sw, sh, 0, 0, OUT_W, OUT_H);
    canvas.toBlob(
      (blob) => {
        setExporting(false);
        if (blob) {
          // Forzar nombre + tipo
          const file = new File([blob], 'cropped.jpg', { type: 'image/jpeg' });
          onConfirm(file);
        }
      },
      'image/jpeg',
      0.92,
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink/70 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-bg rounded-2xl shadow-xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-base m-0">Ajustar imagen</h3>
          <button onClick={onCancel} className="text-mute hover:text-ink p-1" title="Cerrar">✕</button>
        </div>

        <p className="text-xs text-mute mb-3">
          Mové la foto para encuadrar. Lo que veas en el recuadro es lo que se guarda.
        </p>

        {/* Viewport con frame fijo */}
        <div
          ref={containerRef}
          className="relative bg-ink mx-auto select-none touch-none rounded-input overflow-hidden"
          style={{ width: FRAME_W, height: FRAME_H, cursor: imgLoaded ? 'grab' : 'wait' }}
          onPointerDown={imgLoaded ? onPointerDown : undefined}
          onPointerMove={imgLoaded ? onPointerMove : undefined}
          onPointerUp={imgLoaded ? onPointerUp : undefined}
        >
          {imgLoaded && (
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: imgSize.w,
                height: imgSize.h,
                transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px) scale(${zoom})`,
                transformOrigin: 'center center',
                backgroundImage: `url(${src})`,
                backgroundSize: '100% 100%',
                pointerEvents: 'none',
              }}
            />
          )}
          {/* Grid 3x3 sobre el frame para guía de composición */}
          <div className="absolute inset-0 pointer-events-none border-2 border-white/80 rounded-input">
            <div className="absolute top-1/3 left-0 right-0 border-t border-white/30" />
            <div className="absolute top-2/3 left-0 right-0 border-t border-white/30" />
            <div className="absolute left-1/3 top-0 bottom-0 border-l border-white/30" />
            <div className="absolute left-2/3 top-0 bottom-0 border-l border-white/30" />
          </div>
        </div>

        {/* Zoom slider */}
        <label className="block mt-4">
          <div className="flex items-center justify-between mb-1.5 text-xs text-mute">
            <span>🔍 Zoom</span>
            <span>{zoom.toFixed(1)}×</span>
          </div>
          <input
            type="range"
            min={1}
            max={4}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-full"
            disabled={!imgLoaded}
          />
        </label>

        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-ghost" onClick={onCancel} disabled={exporting}>Cancelar</button>
          <button className="btn-primary" onClick={confirm} disabled={!imgLoaded || exporting}>
            {exporting ? 'Procesando…' : 'Listo'}
          </button>
        </div>
      </div>
    </div>
  );
}
