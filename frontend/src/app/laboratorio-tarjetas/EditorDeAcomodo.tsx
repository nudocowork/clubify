'use client';
/**
 * Editor del acomodo de «Tu producto»: cada sello se arrastra, y al tocarlo se
 * le cambia tamaño, giro e imagen. Las posiciones viven en coordenadas del
 * lienzo 640×246, las mismas con las que se dibuja la franja: lo que se acomoda
 * aquí es exactamente lo que sale en el pase.
 */
import { useMemo, useRef, useState } from 'react';
import {
  ALTO,
  ANCHO,

  dibujarFranja,
  posicionesDe,
  type Acomodo,
  type ConfigFranja,
  type Faltantes,
  type PosSello,
} from '@/lib/cards/estilos-de-franja';
import { quitarFondo } from './quitar-fondo';

const ACOMODOS: Array<{ id: Acomodo; txt: string }> = [
  { id: 'FILA', txt: 'Fila' },
  { id: 'CUADRICULA', txt: 'Cuadrícula' },
  { id: 'ENCIMADO', txt: 'Encimado' },
  { id: 'ARCO', txt: 'Arco' },
];

const FALTANTES: Array<{ id: Faltantes; txt: string }> = [
  { id: 'TRANSPARENTES', txt: 'Transparentes' },
  { id: 'CONTORNO', txt: 'Contorno' },
  { id: 'OCULTOS', txt: 'Ocultos' },
];

async function leer(f: File, sinFondo: boolean): Promise<string> {
  const url = await new Promise<string>((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => mal(r.error);
    r.readAsDataURL(f);
  });
  return sinFondo ? quitarFondo(url) : url;
}

export function EditorDeAcomodo({
  c,
  set,
  guardarImagen,
}: {
  c: ConfigFranja;
  set: (p: Partial<ConfigFranja>) => void;
  /**
   * En una tarjeta REAL las imágenes se suben al almacenamiento y se guarda la
   * URL (las imágenes no van a la base). Sin esto, como en el laboratorio, se
   * quedan en memoria como data URL.
   */
  guardarImagen?: (dataUrl: string) => Promise<string>;
}) {
  const [sel, setSel] = useState<number | null>(null);
  const [sinFondo, setSinFondo] = useState(true);
  const [procesando, setProcesando] = useState(false);
  const [errorDeSubida, setErrorDeSubida] = useState<string | null>(null);
  const lienzo = useRef<HTMLDivElement>(null);
  const arrastre = useRef<{ i: number; px: number; py: number; x0: number; y0: number } | null>(null);

  const pos = useMemo(() => posicionesDe(c), [c]);
  // La franja real de fondo; las asas transparentes de encima solo sirven para
  // agarrar cada sello.
  // En línea y no como <img>: un SVG cargado como imagen no baja las imágenes
  // externas, y en una tarjeta real los sellos son URLs del almacenamiento.
  const conSellos = useMemo(() => dibujarFranja(c), [c]);

  const cambiar = (i: number, p: Partial<PosSello>) => {
    const nuevas = pos.map((x, k) => (k === i ? { ...x, ...p } : x));
    set({ posiciones: nuevas });
  };

  const subir = async (f: File | undefined, alSubir: (url: string) => void) => {
    if (!f) return;
    setProcesando(true);
    setErrorDeSubida(null);
    try {
      const url = await leer(f, sinFondo);
      alSubir(guardarImagen ? await guardarImagen(url) : url);
    } catch (e: any) {
      setErrorDeSubida(String(e?.message ?? e));
    } finally {
      setProcesando(false);
    }
  };

  const escala = () => (lienzo.current ? ANCHO / lienzo.current.clientWidth : 1);

  const elegido = sel != null && sel < pos.length ? pos[sel] : null;

  return (
    <div className="space-y-4 pt-3 border-t border-line">
      <div>
        <div className="text-sm font-semibold">Imagen del sello</div>
        <p className="text-xs text-mute mb-2">
          Sube la foto de tu producto (una rebanada, un croissant, un vaso). Si tiene fondo liso, se lo quitamos.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="btn-ghost cursor-pointer">
            {procesando ? 'Procesando…' : c.iconoImagen ? 'Cambiar imagen' : 'Subir imagen'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => {
                void subir(e.target.files?.[0], (url) => set({ iconoImagen: url }));
                e.target.value = '';
              }}
            />
          </label>
          {c.iconoImagen && (
            <button type="button" className="btn-link text-sm" onClick={() => set({ iconoImagen: null })}>
              Quitar
            </button>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sinFondo} onChange={(e) => setSinFondo(e.target.checked)} className="accent-brand" />
            Quitar el fondo al subir
          </label>
        </div>
        {errorDeSubida && (
          <p className="text-xs text-bad bg-red-50 rounded-input px-2.5 py-1.5 mt-2">{errorDeSubida}</p>
        )}
      </div>

      <div>
        <div className="text-sm font-semibold mb-2">Sellos que faltan</div>
        <Segmentos opciones={FALTANTES} valor={c.faltantes ?? 'TRANSPARENTES'} onChange={(v) => set({ faltantes: v })} />
      </div>

      <div>
        <div className="text-sm font-semibold mb-2">Acomodo</div>
        <div
          ref={lienzo}
          className="relative w-full rounded-card overflow-hidden border border-line select-none touch-none"
          style={{ aspectRatio: `${ANCHO} / ${ALTO}`, background: c.area }}
          onPointerMove={(e) => {
            const a = arrastre.current;
            if (!a) return;
            const k = escala();
            const x = Math.max(0, Math.min(ANCHO, a.x0 + (e.clientX - a.px) * k));
            const y = Math.max(0, Math.min(ALTO, a.y0 + (e.clientY - a.py) * k));
            cambiar(a.i, { x: Math.round(x), y: Math.round(y) });
          }}
          onPointerUp={() => (arrastre.current = null)}
          onPointerLeave={() => (arrastre.current = null)}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setSel(null);
          }}
        >
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none [&>svg]:w-full [&>svg]:h-full"
            dangerouslySetInnerHTML={{ __html: conSellos }}
          />
          {pos.map((p, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Sello ${i + 1}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId);
                setSel(i);
                arrastre.current = { i, px: e.clientX, py: e.clientY, x0: p.x, y0: p.y };
              }}
              className={`absolute cursor-grab active:cursor-grabbing rounded-md ${
                sel === i ? 'ring-2 ring-brand' : 'hover:ring-1 hover:ring-white/60 hover:ring-dashed'
              }`}
              style={{
                left: `${((p.x - p.tam / 2) / ANCHO) * 100}%`,
                top: `${((p.y - p.tam / 2) / ALTO) * 100}%`,
                width: `${(p.tam / ANCHO) * 100}%`,
                height: `${(p.tam / ALTO) * 100}%`,
                transform: `rotate(${p.giro}deg)`,
                zIndex: sel === i ? 50 : i + 1,
              }}
            >
              <span
                className={`absolute -top-1.5 -left-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold grid place-items-center ${
                  sel === i ? 'bg-brand text-white' : 'bg-black/70 text-white'
                }`}
                style={{ transform: `rotate(${-p.giro}deg)` }}
              >
                {i + 1}
              </span>
            </button>
          ))}
        </div>
        <p className="text-xs text-mute mt-1.5">Arrastra cada sello para moverlo. Tócalo para cambiar su tamaño, giro e imagen.</p>
        <div className="mt-2">
          <Segmentos
            opciones={ACOMODOS}
            valor={c.posiciones ? null : (c.acomodo ?? 'FILA')}
            onChange={(v) => {
              // Sin posiciones propias: el acomodo queda marcado hasta que se
              // mueva un sello a mano.
              set({ acomodo: v, posiciones: undefined });
              setSel(null);
            }}
          />
        </div>
      </div>

      {elegido && sel != null && (
        <div className="rounded-card border border-line p-3 space-y-3 bg-bg2/40">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-sm font-semibold">Sello {sel + 1}</span>
            <label className="flex items-center gap-2 text-xs text-mute flex-1 min-w-[160px]">
              Tamaño
              <input
                type="range"
                min={24}
                max={ALTO}
                value={elegido.tam}
                onChange={(e) => cambiar(sel, { tam: Number(e.target.value) })}
                className="flex-1 accent-brand"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-mute flex-1 min-w-[160px]">
              Giro
              <input
                type="range"
                min={-180}
                max={180}
                value={elegido.giro}
                onChange={(e) => cambiar(sel, { giro: Number(e.target.value) })}
                className="flex-1 accent-brand"
              />
              <span className="w-9 text-right tabular-nums">{Math.round(elegido.giro)}°</span>
            </label>
            <button
              type="button"
              className="btn-ghost text-xs py-1.5"
              onClick={() => set({ posiciones: pos.map((x) => ({ ...x, tam: elegido.tam })) })}
            >
              Mismo tamaño a todos
            </button>
          </div>
          <div className="pt-2 border-t border-line">
            <div className="text-sm font-medium">Imagen del sello {sel + 1}</div>
            <p className="text-xs text-mute mb-2">
              Opcional: una imagen distinta para este sello (por ejemplo, un regalo en el último). Si no, usa la general.
            </p>
            <div className="flex items-center gap-3">
              <label className="btn-ghost cursor-pointer">
                {elegido.imagen ? 'Cambiar imagen' : 'Subir imagen'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    const i = sel;
                    void subir(e.target.files?.[0], (url) => cambiar(i, { imagen: url }));
                    e.target.value = '';
                  }}
                />
              </label>
              {elegido.imagen && (
                <button type="button" className="btn-link text-sm" onClick={() => cambiar(sel, { imagen: null })}>
                  Usar la general
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Segmentos<T extends string>({
  opciones,
  valor,
  onChange,
}: {
  opciones: Array<{ id: T; txt: string }>;
  /** null = ninguno marcado (p. ej. el acomodo ya se movió a mano). */
  valor: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <div className="bg-bg2 rounded-full p-0.5 inline-flex flex-wrap text-xs font-semibold">
      {opciones.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`px-3 py-1.5 rounded-full transition ${valor === o.id ? 'bg-white text-ink shadow-sm' : 'text-mute hover:text-ink'}`}
        >
          {o.txt}
        </button>
      ))}
    </div>
  );
}
