'use client';

/**
 * El selector del PERÍODO CONTABLE de Contabilidad.
 *
 * Cada mes es un período cerrado: las finanzas de agosto se miran en agosto,
 * aunque estemos a 4 de septiembre y todo lo nuevo ya entre en septiembre. Por
 * eso el período vive en la CABECERA del módulo y no dentro de una pestaña —
 * manda sobre todo lo que se ve debajo, no sobre un reporte suelto.
 *
 * Se puede comparar meses (con el selector, o con la serie del reporte), pero
 * nunca se mezclan: lo que se ve pertenece a UN período.
 *
 * El valor viaja tal cual al backend como `?period=` y él lo resuelve
 * (`common/periodo-contable.ts`). Las cuatro formas válidas:
 *   "2026-09"  mes · "2026-T3" trimestre · "2026" año · "todo" histórico
 */

export type Granularidad = 'mes' | 'trimestre' | 'anio' | 'todo';

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export function granularidadDe(p: string): Granularidad {
  if (/^\d{4}-\d{2}$/.test(p)) return 'mes';
  if (/^\d{4}-T[1-4]$/.test(p)) return 'trimestre';
  if (/^\d{4}$/.test(p)) return 'anio';
  return 'todo';
}

/** ¿Es un mes cerrable? Solo los meses se cierran contablemente. */
export const esMes = (p: string) => granularidadDe(p) === 'mes';

/** El mes en curso, en hora local (el panel se usa desde Bogotá). */
export function periodoActual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function nombreDePeriodo(p: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(p);
  if (m) return `${MESES[Number(m[2]) - 1]} ${m[1]}`;
  const t = /^(\d{4})-T([1-4])$/.exec(p);
  if (t) return `${t[2]}º trimestre ${t[1]}`;
  if (/^\d{4}$/.test(p)) return `Año ${p}`;
  return 'Todo el histórico';
}

/** Mueve el período `paso` unidades de SU propia granularidad. */
export function correrPeriodo(p: string, paso: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(p);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1 + paso, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  const t = /^(\d{4})-T([1-4])$/.exec(p);
  if (t) {
    const total = Number(t[1]) * 4 + (Number(t[2]) - 1) + paso;
    return `${Math.floor(total / 4)}-T${(total % 4) + 1}`;
  }
  if (/^\d{4}$/.test(p)) return String(Number(p) + paso);
  return p; // "todo" no se corre
}

/** Cambia de granularidad SIN perder dónde estabas: sep-2026 → 3º trim. 2026. */
function convertir(p: string, a: Granularidad): string {
  if (a === 'todo') return 'todo';
  const base = granularidadDe(p) === 'todo' ? periodoActual() : p;
  const anio = base.slice(0, 4);
  if (a === 'anio') return anio;
  const m = /^\d{4}-(\d{2})$/.exec(base);
  const mes = m ? Number(m[1]) : null;
  const t = /^\d{4}-T([1-4])$/.exec(base);
  if (a === 'trimestre') {
    const tri = mes ? Math.floor((mes - 1) / 3) + 1 : t ? Number(t[1]) : 1;
    return `${anio}-T${tri}`;
  }
  // a === 'mes': del trimestre se entra por su primer mes.
  const primero = t ? (Number(t[1]) - 1) * 3 + 1 : 1;
  return `${anio}-${String(mes ?? primero).padStart(2, '0')}`;
}

const GRANULARIDADES: Array<[Granularidad, string]> = [
  ['mes', 'Mes'],
  ['trimestre', 'Trimestre'],
  ['anio', 'Año'],
  ['todo', 'Todo'],
];

export function SelectorPeriodo({
  valor,
  onChange,
}: {
  valor: string;
  onChange: (periodo: string) => void;
}) {
  const g = granularidadDe(valor);
  const hoy = periodoActual();
  // No se navega al futuro: un mes que no ha pasado no tiene nada que mirar.
  const enElTope =
    g !== 'todo' && correrPeriodo(valor, 1) > convertir(hoy, g);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="inline-flex bg-bg2 border border-line rounded-pill p-1">
        {GRANULARIDADES.map(([id, label]) => (
          <button
            key={id}
            onClick={() => onChange(convertir(valor, id))}
            className={`px-3 py-1.5 rounded-pill text-xs font-semibold ${g === id ? 'bg-white shadow-sm2 text-ink' : 'text-mute'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {g !== 'todo' && (
        <div className="inline-flex items-center gap-1 bg-bg2 border border-line rounded-pill px-1 py-1">
          <button
            aria-label="Período anterior"
            onClick={() => onChange(correrPeriodo(valor, -1))}
            className="w-7 h-7 rounded-pill text-mute hover:bg-white hover:text-ink font-bold leading-none"
          >
            ‹
          </button>
          <span className="px-2 text-sm font-semibold capitalize min-w-[9.5rem] text-center">
            {nombreDePeriodo(valor)}
          </span>
          <button
            aria-label="Período siguiente"
            disabled={enElTope}
            onClick={() => onChange(correrPeriodo(valor, 1))}
            className="w-7 h-7 rounded-pill text-mute hover:bg-white hover:text-ink font-bold leading-none disabled:opacity-30 disabled:hover:bg-transparent"
          >
            ›
          </button>
        </div>
      )}

      {g === 'mes' && (
        <input
          type="month"
          aria-label="Elegir mes"
          className="input py-1.5 text-sm"
          value={valor}
          max={hoy}
          onChange={(e) => e.target.value && onChange(e.target.value)}
        />
      )}

      {valor !== hoy && (
        <button
          onClick={() => onChange(hoy)}
          className="text-xs text-brand font-semibold hover:underline"
        >
          Ir al mes actual
        </button>
      )}
    </div>
  );
}
