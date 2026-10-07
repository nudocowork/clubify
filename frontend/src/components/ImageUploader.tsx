'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from './Icon';
// La subida (token canónico, progreso, mensajes) vive en `@/lib/subir-archivo`.
import {
  POLITICA,
  aceptarDe,
  textoDeAyuda,
  validarArchivo,
  validarDimensiones,
} from '@/lib/politica-de-archivos.mjs';
import { medirImagen, subirArchivo, usoDe, type EstadoDeSubida, type Uso } from '@/lib/subir-archivo';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

export function ImageUploader({
  value,
  onChange,
  folder = 'products',
  uso,
  className = '',
  // Si true (default para fotos de producto), abre el cropper antes de
  // subir. Si false (logos, branding), sube tal cual.
  crop = true,
  aspect = 1, // 1 = cuadrado, 4/3 = card, etc.
  // Obsoleto: el tope lo decide la política del USO (politica-de-archivos),
  // igual que en el servidor. Se acepta para no romper a quien lo pasa, y solo
  // puede BAJAR el tope, nunca subirlo por encima de lo que el servidor admite.
  maxSizeMb,
  // Avisa cuando la imagen es <1600 px. Pensado para diapositivas a pantalla
  // completa: por defecto solo en ese uso (antes saltaba también al subir la
  // foto de un producto, que se pinta a 400 px).
  minDimensionWarn,
}: {
  value?: string | null;
  onChange: (url: string | null) => void;
  folder?: string;
  /** Uso del recurso; si falta se deduce de `folder`, como en el servidor. */
  uso?: Uso;
  className?: string;
  crop?: boolean;
  aspect?: number;
  maxSizeMb?: number;
  minDimensionWarn?: boolean;
}) {
  const usoReal = usoDe({ uso, folder });
  const politica = POLITICA[usoReal];
  const ladoMaestro = politica.tipo === 'imagen' ? politica.ladoMaestro : 2560;
  const avisarPequena = minDimensionWarn ?? usoReal === 'DIAPOSITIVA';
  const ayuda = textoDeAyuda(usoReal);
  const t = useTranslations('image_uploader');
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [estado, setEstado] = useState<EstadoDeSubida | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);

  function problemaDePeso(f: Blob, trasRecortar: boolean): string | null {
    const p = validarArchivo(
      { size: f.size, type: f.type, name: (f as File).name ?? '' },
      usoReal,
      { trasRecortar },
    );
    if (p) return p;
    if (maxSizeMb && f.size > maxSizeMb * 1_000_000 && (!crop || trasRecortar)) {
      return `Esta imagen pesa ${(f.size / 1e6).toFixed(1).replace('.', ',')} MB. El máximo aquí es ${maxSizeMb} MB. Reduce su tamaño o selecciona otra imagen.`;
    }
    return null;
  }

  async function pickFile(file: File) {
    // Se valida ANTES de leerla o subirla: un banner de 9 MB por el wifi de
    // un local tardaba un minuto en subir para que el servidor lo rechazara.
    // Con recortador, lo que se transmite es el RECORTE (re-codificado en el
    // navegador al lado del maestro): el peso se mira después de recortar, y
    // aquí solo el formato. La memoria del lienzo la protege el tope de
    // megapíxeles de más abajo.
    const problema = crop
      ? problemaDePeso(new File([], file.name, { type: file.type }), false)
      : problemaDePeso(file, false);
    if (problema) {
      setErr(problema);
      return;
    }
    setErr(null);

    // Medir dimensiones reales antes de subir. Si la imagen es chica
    // para slides full-screen, mostrar warning (no bloquear — el cliente
    // decide). 1600×900 es el mínimo razonable para que se vea nítido
    // en pantallas modernas tras el render del slide.
    try {
      const medida = await medirImagen(file);
      const dims = { w: medida.ancho, h: medida.alto };
      const fueraDePolitica = validarDimensiones(dims.w, dims.h, usoReal);
      if (fueraDePolitica) {
        setErr(fueraDePolitica);
        return;
      }
      const maxSide = Math.max(dims.w, dims.h);
      if (avisarPequena && maxSide < 1600) {
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

  function prettyBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function uploadBlob(blob: Blob | File, trasRecortar = false) {
    const problema = problemaDePeso(blob, trasRecortar);
    if (problema) {
      setErr(problema);
      return;
    }
    setBusy(true);
    setProgress(0);
    setErr(null);
    try {
      const result = await subirArchivo(blob, {
        uso: usoReal,
        folder,
        nombre: (blob as File).name ?? 'recorte.jpg',
        trasRecortar,
        alProgreso: setProgress,
        alEstado: setEstado,
      });
      onChange(result.url);
    } catch (e: any) {
      // El error se queda junto al campo; el resto del formulario no se toca.
      setErr(e?.message || 'No se pudo subir la imagen. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
      setProgress(0);
      setEstado(null);
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
        ladoMaximo={ladoMaestro}
        onCancel={() => {
          URL.revokeObjectURL(cropSrc);
          setCropSrc(null);
        }}
        onConfirm={(blob) => {
          URL.revokeObjectURL(cropSrc);
          setCropSrc(null);
          uploadBlob(blob, true);
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
              title={t('reframe')}
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
        <input ref={inputRef} type="file" accept={aceptarDe(usoReal)} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pickFile(f); }} />
        {busy && (
          <div className="absolute inset-0 h-40 rounded-input bg-bg/80 flex flex-col items-center justify-center gap-2">
            <div className="w-2/3 h-1.5 rounded-full bg-line overflow-hidden">
              <div className="h-full bg-brand transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="text-xs text-mute">
              {estado === 'procesando' ? 'Optimizando la imagen…' : `Subiendo… ${progress}%`}
            </div>
          </div>
        )}
        {err && (
          <div className="mt-2 rounded-lg bg-bad-soft px-3 py-2 text-xs text-bad-ink">{err}</div>
        )}
        <div className="mt-1 text-[11px] text-mute">{ayuda}</div>
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
            <div className="text-xs text-mute">
              {estado === 'procesando' ? 'Optimizando la imagen…' : `Subiendo… ${progress}%`}
            </div>
          </>
        ) : (
          <>
            <div className="w-10 h-10 rounded-full bg-brand-soft flex items-center justify-center text-brand">
              <Icon name="plus" size={18} />
            </div>
            <div className="text-sm font-medium">Sube una imagen</div>
            <div className="text-xs text-mute text-center px-3">
              Arrastra o da clic · {ayuda}
            </div>
          </>
        )}
        <input ref={inputRef} type="file" accept={aceptarDe(usoReal)} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pickFile(f); }} />
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
  ladoMaximo,
  onConfirm,
  onCancel,
}: {
  src: string;
  aspect: number;
  /** Lado del maestro del uso: exportar más grande solo es peso que el servidor tira. */
  ladoMaximo: number;
  onConfirm: (blob: Blob) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('image_uploader');
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

  // Límites del zoom RELATIVOS al tamaño de la imagen. Antes el slider tenía
  // un rango FIJO (0.3–5) que no matcheaba imágenes grandes ni chicas: para
  // una foto grande el auto-fit (cover ≈ 0.15) quedaba por debajo del min del
  // slider → el thumb se trababa en el extremo y no volvía al encuadre; para
  // un logo chico 5× era casi nada. Ahora:
  //   coverZoom   = la imagen CUBRE el recuadro (llena, puede recortar).
  //   containZoom = la imagen ENTRA completa (con margen) — es el "Encajar todo".
  // El rango va de medio-contain (permite margen, como pediste) a 4× cover
  // (acercar bien), y SIEMPRE incluye ambos auto-fits para que no se trabe.
  const coverZoom =
    imgSize.w && imgSize.h
      ? Math.max(FRAME_W / imgSize.w, FRAME_H / imgSize.h)
      : 1;
  const containZoom =
    imgSize.w && imgSize.h
      ? Math.min(FRAME_W / imgSize.w, FRAME_H / imgSize.h)
      : 1;
  const minZoom = containZoom * 0.5;
  const maxZoom = coverZoom * 4;

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

    // Resolución de salida: los píxeles REALES del recorte (sw × sh), sin
    // ampliar nunca y sin pasar del lado del maestro del uso. Antes se forzaba
    // un mínimo de 1600 px y un máximo de 4000: una foto de producto recortada
    // salía a 4000 × 4000 en JPEG 95 (6–8 MB) para que el servidor la redujera
    // a 1600, y una imagen pequeña se ampliaba sin ganar detalle.
    const escala = Math.min(1, ladoMaximo / Math.max(sw, sh));
    const OUT_W = Math.max(1, Math.round(sw * escala));
    const OUT_H = Math.max(1, Math.round(OUT_W * (FRAME_H / FRAME_W)));
    const canvas = document.createElement('canvas');
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) { setExporting(false); return; }
    // Calidad del re-sampling al hacer drawImage — high preserva
    // detalle fino al reducir.
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

    // Con transparencia, WebP con alfa: un PNG del recorte de un logo o de un
    // producto sin fondo pesaba 3–5 MB y rozaba el tope del uso. Safari
    // antiguo no codifica WebP en el lienzo y devuelve PNG: se respeta el tipo
    // que de verdad salió (`blob.type`).
    const format = sourceHasAlpha ? 'image/webp' : 'image/jpeg';
    canvas.toBlob(
      (blob) => {
        setExporting(false);
        if (blob) {
          const tipo = blob.type || format;
          const ext = tipo === 'image/webp' ? 'webp' : tipo === 'image/png' ? 'png' : 'jpg';
          const file = new File([blob], `recorte.${ext}`, { type: tipo });
          onConfirm(file);
        }
      },
      format,
      // 0.95: el servidor vuelve a codificar; ir alto aquí evita artefactos
      // de doble compresión en texto y bordes finos.
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
            min={minZoom}
            max={maxZoom}
            step={Math.max(0.001, (maxZoom - minZoom) / 200)}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-full"
            disabled={!imgLoaded}
          />
          <div className="flex justify-between text-[10px] text-mute mt-0.5">
            <span>{t('smallerWithMargin')}</span>
            <span>{t('zoomInMore')}</span>
          </div>
        </label>

        <div className="flex justify-between items-center gap-2 mt-4">
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (!imgRef.current) return;
                setZoom(coverZoom);
                setPos({ x: 0, y: 0 });
              }}
              disabled={!imgLoaded || exporting}
              className="text-xs text-mute hover:text-ink"
              title={t('resetCrop')}
            >
              ↺ Centrar
            </button>
            <button
              type="button"
              onClick={() => {
                if (!imgRef.current) return;
                setZoom(containZoom);
                setPos({ x: 0, y: 0 });
              }}
              disabled={!imgLoaded || exporting}
              className="text-xs text-mute hover:text-ink"
              title={t('showWhole')}
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
