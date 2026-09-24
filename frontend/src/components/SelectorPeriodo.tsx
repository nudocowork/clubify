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

/** Los meses que abarca un período: "2026-T2" → ["2026-04","2026-05","2026-06"]. */
function mesesDe(p: string): string[] | null {
  const m = /^(\d{4})-(\d{2})$/.exec(p);
  if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? [p] : null;
  const t = /^(\d{4})-T([1-4])$/.exec(p);
  if (t) {
    const primero = (Number(t[2]) - 1) * 3 + 1;
    return [0, 1, 2].map((i) => `${t[1]}-${String(primero + i).padStart(2, '0')}`);
  }
  const a = /^(\d{4})$/.exec(p);
  if (a) {
    return Array.from({ length: 12 }, (_, i) => `${a[1]}-${String(i + 1).padStart(2, '0')}`);
  }
  return null;
}

/** El día de hoy como "YYYY-MM-DD", en la hora de quien mira (Bogotá). */
export function hoyComoDia(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * ¿Este día pertenece al período que se está gestionando?
 *
 * Se compara como TEXTO a propósito: en UTC, las 00:00 del 1 de mayo son las
 * 19:00 del 30 de abril en Bogotá, y un egreso del día 1 se contaría en el mes
 * anterior. Mismo criterio que `finance/fecha-del-movimiento.ts` en el backend.
 */
export function diaEnPeriodo(dia: string, periodo: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return false;
  const p = (periodo ?? '').trim();
  if (!p || p === 'todo') return true;
  const meses = mesesDe(p);
  return !meses || meses.includes(dia.slice(0, 7));
}

/**
 * Qué fecha traer puesta al abrir un formulario desde un período.
 *
 * Hoy SOLO si hoy cae dentro del período. Si no, el primer día del período —
 * nunca la fecha del sistema: es lo que hacía que un egreso creado desde mayo
 * se guardara en septiembre.
 */
export function diaPorDefectoDelPeriodo(periodo: string): string {
  const hoy = hoyComoDia();
  const p = (periodo ?? '').trim();
  if (!p || p === 'todo') return hoy;
  const meses = mesesDe(p);
  if (!meses) return hoy;
  return meses.includes(hoy.slice(0, 7)) ? hoy : `${meses[0]}-01`;
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
