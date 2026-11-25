'use client';
/**
 * El lienzo del flujo: el árbol dibujado de arriba abajo, con las ramas de una
 * condición lado a lado.
 *
 * Se dibuja con HTML y no con `@xyflow/react` (que está en el proyecto para las
 * secuencias de afiliados) a propósito: ahí cada nodo se coloca a mano en un
 * plano libre, y aquí el flujo ES un árbol que se ordena solo. Con un plano
 * libre el negocio tendría que acomodar cajas y podría dejar una suelta —
 * justo lo que el motor rechaza.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Grafo, Hueco, Nodo, TipoNodo, incompleto } from './grafo';
import { IconoFlujo } from './IconoFlujo';
import type { Textos } from './textos';

export const COLOR_NODO: Record<string, string> = {
  trigger: '#22C55E',
  wait: '#F5B544',
  push: '#4ADE80',
  sms: '#60A5FA',
  whatsapp: '#34D399',
  condition: '#C4B5FD',
  end: '#94A3B8',
};

export function resumenNodo(n: Nodo, t: Textos, campos?: Record<string, string>): string {
  const c = n.config ?? {};
  switch (n.type) {
    case 'wait': {
      const a = Number(c.amount) || 0;
      const u = (a === 1 ? t.unidad1 : t.unidades)[c.unit] ?? '';
      return a ? t.esperarN(a, u) : t.incompletoChip;
    }
    case 'push':
      return c.title || t.incompletoChip;
    case 'sms':
    case 'whatsapp':
      return c.body ? String(c.body).slice(0, 60) : t.incompletoChip;
    case 'condition': {
      if (!c.field) return t.incompletoChip;
      const campo = (campos ?? t.campos)[c.field] ?? c.field;
      const op = t.operadores[c.op] ?? '';
      const valor = ['empty', 'not_empty', 'is_true', 'is_false'].includes(c.op) ? '' : ` ${c.value ?? '…'}`;
      return `${campo}: ${op}${valor}`;
    }
    case 'end':
      return t.ayudaNodo.end;
  }
}

type Props = {
  grafo: Grafo;
  t: Textos;
  disparador: string;
  seleccion: string | null;
  conProblemas: Set<string>;
  disparadorConProblema: boolean;
  canales: { sms: boolean; whatsapp: boolean };
  onSeleccionar: (id: string) => void;
  onInsertar: (h: Hueco, tipo: TipoNodo) => void;
};

export function Lienzo(p: Props) {
  const caja = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const arrastre = useRef<{ x: number; y: number; l: number; t: number } | null>(null);

  // En un teléfono el árbol entero no cabe a tamaño real: arranca alejado.
  useEffect(() => {
    if (window.innerWidth < 768) setZoom(0.8);
  }, []);

  const cambiarZoom = (d: number) => setZoom((z) => Math.min(1.5, Math.max(0.4, Math.round((z + d) * 10) / 10)));

  return (
    <div className="relative h-full rounded-input overflow-hidden" style={{ background: '#0A111E' }}>
      <div
        ref={caja}
        className="absolute inset-0 overflow-auto cursor-grab active:cursor-grabbing select-none"
        style={{
          backgroundImage: 'radial-gradient(#1C2942 1px, transparent 1px)',
          backgroundSize: '22px 22px',
        }}
        onPointerDown={(e) => {
          // Solo se arrastra desde el fondo: sobre un nodo, el clic es del nodo.
          if ((e.target as HTMLElement).closest('[data-nodo],button,input,select,textarea')) return;
          const el = caja.current!;
          arrastre.current = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop };
          el.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const a = arrastre.current;
          if (!a) return;
          caja.current!.scrollLeft = a.l - (e.clientX - a.x);
          caja.current!.scrollTop = a.t - (e.clientY - a.y);
        }}
        onPointerUp={() => (arrastre.current = null)}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            cambiarZoom(e.deltaY > 0 ? -0.1 : 0.1);
          }
        }}
      >
        <div className="min-w-full w-max px-10 pt-10 pb-32 flex justify-center" style={{ zoom } as any}>
          <div className="flex flex-col items-center">
            <Tarjeta
              id="trigger"
              tipo="trigger"
              etiqueta={p.t.activador}
              texto={p.disparador ? p.t.disparadores[p.disparador] ?? p.disparador : p.t.elegirActivador}
              seleccionado={p.seleccion === 'trigger'}
              incompleto={!p.disparador}
              problema={p.disparadorConProblema}
              onClick={() => p.onSeleccionar('trigger')}
              t={p.t}
            />
            <Conector hueco={{ padre: null, rama: 'next' }} {...p} />
            <Rama id={p.grafo.rootId} {...p} />
          </div>
        </div>
      </div>

      <div className="absolute top-3 right-3 flex flex-col gap-1">
        {[
          { i: 'zoom-in', a: () => cambiarZoom(0.1), l: p.t.acercar },
          { i: 'zoom-out', a: () => cambiarZoom(-0.1), l: p.t.alejar },
          { i: 'fit', a: () => setZoom(1), l: p.t.centrar },
        ].map((b) => (
          <button
            key={b.i}
            onClick={b.a}
            title={b.l}
            aria-label={b.l}
            className="grid place-items-center w-9 h-9 rounded-lg text-slate-300 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            style={{ background: '#16223A', border: '1px solid #24324D' }}
          >
            <IconoFlujo nombre={b.i} size={16} />
          </button>
        ))}
        <div className="text-[10px] text-center text-slate-500 tabular-nums mt-0.5">{Math.round(zoom * 100)}%</div>
      </div>
    </div>
  );
}

function Rama({ id, ...p }: Props & { id: string | null | undefined }): ReactNode {
  if (!id || !p.grafo.nodes[id]) return <Fin t={p.t} />;
  const n = p.grafo.nodes[id];
  const tarjeta = (
    <Tarjeta
      id={n.id}
      tipo={n.type}
      etiqueta={p.t.tiposNodo[n.type]}
      texto={resumenNodo(n, p.t)}
      seleccionado={p.seleccion === n.id}
      incompleto={incompleto(n)}
      problema={p.conProblemas.has(n.id)}
      onClick={() => p.onSeleccionar(n.id)}
      t={p.t}
    />
  );
  if (n.type === 'end') return tarjeta;
  if (n.type === 'condition') {
    return (
      <>
        {tarjeta}
        <div className="w-px h-6" style={{ background: '#2B3A57' }} />
        <div className="flex items-start">
          {(['yes', 'no'] as const).map((rama, i) => (
            <div key={rama} className="relative flex flex-col items-center px-8">
              {/* tramo horizontal que une las dos ramas */}
              <div
                className="absolute top-0 h-px"
                style={{ background: '#2B3A57', left: i === 0 ? '50%' : 0, right: i === 0 ? 0 : '50%' }}
              />
              <div className="w-px h-4" style={{ background: '#2B3A57' }} />
              <span
                className="text-[11px] font-semibold rounded-pill px-2.5 py-0.5"
                style={
                  rama === 'yes'
                    ? { background: 'rgba(34,197,94,.15)', color: '#86EFAC' }
                    : { background: 'rgba(248,113,113,.14)', color: '#FCA5A5' }
                }
              >
                {rama === 'yes' ? p.t.si : p.t.no}
              </span>
              <Conector hueco={{ padre: n.id, rama }} {...p} />
              <Rama id={n[rama]} {...p} />
            </div>
          ))}
        </div>
      </>
    );
  }
  return (
    <>
      {tarjeta}
      <Conector hueco={{ padre: n.id, rama: 'next' }} {...p} />
      <Rama id={n.next} {...p} />
    </>
  );
}

function Tarjeta(props: {
  id: string;
  tipo: string;
  etiqueta: string;
  texto: string;
  seleccionado: boolean;
  incompleto: boolean;
  problema: boolean;
  onClick: () => void;
  t: Textos;
}) {
  const color = COLOR_NODO[props.tipo];
  return (
    <button
      data-nodo
      onClick={props.onClick}
      className="relative w-[248px] rounded-[14px] px-4 py-3 text-center transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      style={{
        background: props.seleccionado ? '#172A4A' : '#12203A',
        border: `1px solid ${props.seleccionado ? '#22C55E' : props.problema ? '#B45353' : '#24324D'}`,
        boxShadow: props.seleccionado ? '0 0 0 3px rgba(34,197,94,.18)' : '0 1px 2px rgba(0,0,0,.4)',
      }}
    >
      <div className="flex items-center justify-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[.08em]" style={{ color }}>
        <IconoFlujo nombre={props.tipo} size={14} />
        {props.etiqueta}
      </div>
      <div className="text-[13.5px] leading-snug text-slate-100 mt-1 line-clamp-2 break-words">{props.texto}</div>
      {(props.incompleto || props.problema) && (
        <span
          className="absolute -top-2 -right-2 grid place-items-center w-5 h-5 rounded-full text-[11px] font-bold"
          style={{ background: props.problema ? '#EF4444' : '#F59E0B', color: '#0A111E' }}
          title={props.t.incompletoChip}
        >
          !
        </span>
      )}
    </button>
  );
}

function Conector({ hueco, ...p }: Props & { hueco: Hueco }) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const cerrar = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, [abierto]);

  const tipos: TipoNodo[] = ['wait', 'push', 'sms', 'whatsapp', 'condition', 'end'];
  return (
    <div ref={ref} className="relative flex flex-col items-center">
      <div className="w-px h-5" style={{ background: '#2B3A57' }} />
      <button
        onClick={() => setAbierto((a) => !a)}
        aria-label={p.t.agregarPaso}
        title={p.t.agregarPaso}
        className="grid place-items-center w-6 h-6 rounded-full text-slate-400 hover:text-white transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        style={{ background: '#16223A', border: '1px solid #2B3A57' }}
      >
        <IconoFlujo nombre="plus" size={13} />
      </button>
      <div className="w-px h-4" style={{ background: '#2B3A57' }} />
      <svg width="10" height="6" viewBox="0 0 10 6" className="-mt-px" aria-hidden>
        <path d="M0 0l5 6 5-6z" fill="#2B3A57" />
      </svg>
      {abierto && (
        <div
          className="absolute z-20 top-8 left-1/2 -translate-x-1/2 w-56 rounded-xl p-1.5 shadow-2xl"
          style={{ background: '#16223A', border: '1px solid #2B3A57' }}
        >
          {tipos.map((tipo) => {
            const sinCanal = (tipo === 'sms' && !p.canales.sms) || (tipo === 'whatsapp' && !p.canales.whatsapp);
            return (
              <button
                key={tipo}
                disabled={sinCanal}
                title={sinCanal ? p.t.canalNoDisponible : p.t.ayudaNodo[tipo]}
                onClick={() => {
                  setAbierto(false);
                  p.onInsertar(hueco, tipo);
                }}
                className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-slate-200 hover:bg-white/5 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <span style={{ color: COLOR_NODO[tipo] }}>
                  <IconoFlujo nombre={tipo} size={16} />
                </span>
                {p.t.tiposNodo[tipo]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Fin({ t }: { t: Textos }) {
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-pill px-3.5 py-1 text-[11px] font-semibold uppercase tracking-[.08em]"
      style={{ background: '#16223A', color: '#94A3B8', border: '1px solid #24324D' }}
    >
      <IconoFlujo nombre="end" size={12} />
      {t.fin}
    </div>
  );
}
