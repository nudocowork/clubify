'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  // Tamaño máximo permitido en MB. Default 15. El backend acepta 25 para
  // los folders menu-book/menu-book-popup (menús de alta resolución).
  maxSizeMb = 15,
}: {
  value?: string | null;
  onChange: (url: string | null) => void;
  folder?: string;
  className?: string;
  crop?: boolean;
  aspect?: number;
  maxSizeMb?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);

  async function pickFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setErr('Solo imágenes (jpg, png, webp, gif)');
      return;
    }
    if (file.size > maxSizeMb * 1024 * 1024) {
      setErr(`Máximo ${maxSizeMb} MB`);
      return;
    }
    setErr(null);

    // Medir dimensiones reales antes de subir. Si la imagen es chica
    // para slides full-screen, mostrar warning (no bloquear — el cliente
    // decide). 1600×900 es el mínimo razonable para que se vea nítido
    // en pantallas modernas tras el render del slide.
    try {
      const dims = await measureImage(file);
      const maxSide = Math.max(dims.w, dims.h);
      if (maxSide < 1600) {
        const ok = window.confirm(
          `La imagen es de ${dims.w}×${dims.h} px (peso ${prettyBytes(
            file.size,
          )}).\n\nPara slides en pantalla grande recomendamos al menos 1920×1080 px — sino puede verse pixelada al ampliarse.\n\n¿Subir esta imagen igual?`,
        );
        if (!ok) return;
      }
    } catch {
      // measureImage falló (cross-origin, formato exótico) — seguimos.
    }

    if (crop) {
      // Crear URL local para el cropper, luego se sube el blob recortado
      const url = URL.createObjectURL(file);
      setCropSrc(url);
    } else {
      uploadBlob(file);
    }
  }

  function measureImage(file: File): Promise<{ w: number; h: number }> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new window.Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ w: img.naturalWidth, h: img.naturalHeight });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('No se pudo leer la imagen'));
      };
      img.src = url;
    });
  }

  function prettyBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
        <div
          className="w-full h-40 rounded-input border border-line overflow-hidden"
          style={{
            // Checkerboard sutil para que logos blancos sobre transparente
            // sean visibles en la preview (sin esto se ven invisibles
            // contra el fondo blanco del modal).
            backgroundImage:
              'linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)',
            backgroundSize: '16px 16px',
            backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
          }}
        >
          <img
            src={value}
            alt=""
            className="w-full h-full object-contain"
          />
        </div>
        <div className="absolute inset-0 bg-ink/0 group-hover:bg-ink/40 rounded-input transition flex flex-wrap items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100 p-2">
          {crop && (
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setCropSrc(value)}
              title="Re-encuadrar la imagen actual sin volver a subir"
            >
              <Icon name="search" size={12} /> Ajustar
            </button>
          )}
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
              Arrastra o da clic · jpg, png, webp · max {maxSizeMb}MB
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
 * Cropper estilo Facebook (foto de portada / banner):
 *
 * - Vés la imagen ENTERA dentro del container (más grande que el frame)
 * - El cuadro recortable está fijo en el centro, resaltado con borde
 *   blanco + grid 3x3
 * - Lo que queda FUERA del cuadro se ve oscurecido (sabes qué se va a
 *   recortar pero seguís viendo el contexto)
 * - Drag mueve la imagen, slider hace zoom
 * - Al confirmar, exportamos solo el área del cuadro vía canvas
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

  // Container = viewport completo del cropper (vés la imagen aunque esté
  // fuera del frame). Frame = área que efectivamente se guarda.
  // El frame está centrado dentro del container.
  const FRAME_W = 280;
  const FRAME_H = Math.round(FRAME_W / aspect);
  const PADDING = 60; // espacio alrededor del frame para mostrar contexto
  const CONTAINER_W = FRAME_W + PADDING * 2;
  const CONTAINER_H = FRAME_H + PADDING * 2;

  // Si src es una URL remota (no blob: del file picker), usamos el proxy
  // CORS del backend para poder leer pixels en el canvas. Si es blob:, va
  // directo (mismo origen).
  const loadSrc = useMemo(() => {
    if (src.startsWith('blob:')) return src;
    return `${API}/api/media/proxy?url=${encodeURIComponent(src)}`;
  }, [src]);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
      // Auto-fit: zoom inicial para que la imagen cubra el frame ("cover")
      const coverZoom = Math.max(FRAME_W / img.naturalWidth, FRAME_H / img.naturalHeight);
      setZoom(coverZoom);
      setPos({ x: 0, y: 0 });
      setImgLoaded(true);
    };
    img.onerror = () => {
      setImgLoaded(false);
    };
    img.src = loadSrc;
  }, [loadSrc]);

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

    // Resolución de salida: tomamos directamente el ancho del crop EN
    // PIXELS DE LA IMAGEN ORIGINAL (sw) para no perder calidad. Antes
    // usabamos FRAME_W*2 = 560px fijo → para slides full-screen
    // (1920×1080+) la imagen quedaba pixelada 3.4x. Ahora:
    //   - Mínimo 1600px ancho (slides en pantalla full quedan nítidos)
    //   - Máximo 4000px ancho (no explota el canvas en imágenes
    //     gigantes ni demoramos el upload por una hora)
    // El backend después re-encodea a WebP 90q con max 2560px (ver
    // OPT_MAX_DIMENSION en media.service.ts), así que ir más arriba de
    // 2560 aquí solo desperdicia ancho de banda — pero por simetría
    // dejamos margen 4000 por si alguien sube una imagen 4K y quiere
    // conservar full quality si en el futuro el backend sube el max.
    const MIN_OUT = 1600;
    const MAX_OUT = 4000;
    const targetW = Math.max(MIN_OUT, Math.min(MAX_OUT, Math.round(sw)));
    const OUT_W = targetW;
    const OUT_H = Math.round(targetW * (FRAME_H / FRAME_W));
    const canvas = document.createElement('canvas');
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) { setExporting(false); return; }
    // Calidad del re-sampling al hacer drawImage — high preserva
    // detalle fino al upscalear imágenes chicas hasta MIN_OUT.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Detecta si la fuente tiene transparencia (PNG con alpha). Si la
    // tiene, exportamos como PNG sin fondo blanco, así no se rompe el
    // diseño de logos transparentes al pasar por el cropper.
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    const pctx = probe.getContext('2d');
    let sourceHasAlpha = false;
    if (pctx) {
      pctx.drawImage(imgRef.current, 0, 0, 1, 1);
      try {
        const px = pctx.getImageData(0, 0, 1, 1).data;
        sourceHasAlpha = px[3] < 255;
      } catch {
        // Cross-origin: asumir sin alpha (caso común para fotos)
        sourceHasAlpha = false;
      }
    }
    // Heurística mejor: muestrear las 4 esquinas de la imagen original
    if (!sourceHasAlpha && pctx) {
      const cornerProbe = document.createElement('canvas');
      cornerProbe.width = imgSize.w;
      cornerProbe.height = imgSize.h;
      const cctx = cornerProbe.getContext('2d');
      if (cctx) {
        cctx.drawImage(imgRef.current, 0, 0);
        try {
          const checks: Array<[number, number]> = [
            [0, 0],
            [imgSize.w - 1, 0],
            [0, imgSize.h - 1],
            [imgSize.w - 1, imgSize.h - 1],
          ];
          sourceHasAlpha = checks.some(([x, y]) => cctx.getImageData(x, y, 1, 1).data[3] < 255);
        } catch {}
      }
    }

    if (!sourceHasAlpha) {
      // Foto / JPEG: relleno blanco previo + export JPEG (más liviano)
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, OUT_W, OUT_H);
    }
    ctx.drawImage(imgRef.current, sx, sy, sw, sh, 0, 0, OUT_W, OUT_H);

    const format = sourceHasAlpha ? 'image/png' : 'image/jpeg';
    const ext = sourceHasAlpha ? 'png' : 'jpg';
    canvas.toBlob(
      (blob) => {
        setExporting(false);
        if (blob) {
          const file = new File([blob], `cropped.${ext}`, { type: format });
          onConfirm(file);
        }
      },
      format,
      // 0.95 (era 0.92) — el backend re-encodea a WebP de todos modos.
      // Subir la calidad de JPEG aquí reduce artefactos de doble
      // compresión en regiones de alto detalle (texto en imágenes,
      // bordes definidos).
      0.95,
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
          Arrastrá la foto. Lo que quede en el recuadro blanco se guarda;
          lo oscurecido alrededor es solo referencia.
        </p>

        {/* Viewport tipo Facebook: container grande con la imagen completa,
            frame en el centro como cuadro recortable. */}
        <div
          ref={containerRef}
          className="relative bg-ink mx-auto select-none touch-none overflow-hidden rounded-xl"
          style={{
            width: CONTAINER_W,
            height: CONTAINER_H,
            cursor: imgLoaded ? 'grab' : 'wait',
          }}
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
                backgroundImage: `url(${loadSrc})`,
                backgroundSize: '100% 100%',
                pointerEvents: 'none',
              }}
            />
          )}

          {/* 4 capas oscuras alrededor del frame (top/bottom/left/right) —
              dejan un "hole" del tamaño exacto del frame. */}
          <div
            className="absolute pointer-events-none bg-black/60"
            style={{ left: 0, top: 0, width: '100%', height: PADDING }}
          />
          <div
            className="absolute pointer-events-none bg-black/60"
            style={{ left: 0, bottom: 0, width: '100%', height: PADDING }}
          />
          <div
            className="absolute pointer-events-none bg-black/60"
            style={{ left: 0, top: PADDING, width: PADDING, height: FRAME_H }}
          />
          <div
            className="absolute pointer-events-none bg-black/60"
            style={{ right: 0, top: PADDING, width: PADDING, height: FRAME_H }}
          />

          {/* Outline del frame + grid 3x3 (encima del dim, marca el área que se guarda) */}
          <div
            className="absolute pointer-events-none border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
            style={{
              left: PADDING,
              top: PADDING,
              width: FRAME_W,
              height: FRAME_H,
            }}
          >
            <div className="absolute top-1/3 left-0 right-0 border-t border-white/40" />
            <div className="absolute top-2/3 left-0 right-0 border-t border-white/40" />
            <div className="absolute left-1/3 top-0 bottom-0 border-l border-white/40" />
            <div className="absolute left-2/3 top-0 bottom-0 border-l border-white/40" />
            {/* "Handles" en las 4 esquinas — solo decorativas (drag = imagen) */}
            <span className="absolute -top-1 -left-1 w-3 h-3 border-l-2 border-t-2 border-white" />
            <span className="absolute -top-1 -right-1 w-3 h-3 border-r-2 border-t-2 border-white" />
            <span className="absolute -bottom-1 -left-1 w-3 h-3 border-l-2 border-b-2 border-white" />
            <span className="absolute -bottom-1 -right-1 w-3 h-3 border-r-2 border-b-2 border-white" />
          </div>
        </div>

        {/* Zoom slider */}
        <label className="block mt-4">
          <div className="flex items-center justify-between mb-1.5 text-xs text-mute">
            <span>🔍 Zoom</span>
            <span className="font-semibold">{zoom.toFixed(2)}×</span>
          </div>
          <input
            type="range"
            min={0.3}
            max={5}
            step={0.02}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-full"
            disabled={!imgLoaded}
          />
          <div className="flex justify-between text-[10px] text-mute mt-0.5">
            <span>Más chica (con margen)</span>
            <span>Más zoom</span>
          </div>
        </label>

        <div className="flex justify-between items-center gap-2 mt-4">
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (!imgRef.current) return;
                const cz = Math.max(FRAME_W / imgSize.w, FRAME_H / imgSize.h);
                setZoom(cz);
                setPos({ x: 0, y: 0 });
              }}
              disabled={!imgLoaded || exporting}
              className="text-xs text-mute hover:text-ink"
              title="Volver al encuadre original"
            >
              ↺ Centrar
            </button>
            <button
              type="button"
              onClick={() => {
                if (!imgRef.current) return;
                const cz = Math.min(FRAME_W / imgSize.w, FRAME_H / imgSize.h);
                setZoom(cz);
                setPos({ x: 0, y: 0 });
              }}
              disabled={!imgLoaded || exporting}
              className="text-xs text-mute hover:text-ink"
              title="Mostrar la imagen completa con margen blanco"
            >
              ⤢ Encajar todo
            </button>
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={onCancel} disabled={exporting}>Cancelar</button>
            <button className="btn-primary" onClick={confirm} disabled={!imgLoaded || exporting}>
              {exporting ? 'Procesando…' : 'Listo'}
            </button>
          </div>
        </div>
        {!imgLoaded && (
          <div className="mt-3 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 leading-snug">
            No se pudo cargar la imagen para reajustar (puede ser por
            permisos del servidor de imágenes). Usa "Cambiar" para subir
            una versión nueva.
          </div>
        )}
      </div>
    </div>
  );
}
