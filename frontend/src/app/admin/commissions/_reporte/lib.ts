/**
 * Tipos, formato y rangos de fecha del Reporte de comisiones. Los tipos son
 * espejo de lo que devuelve `backend/src/reporte-comisiones`.
 */

export type Estado =
  | 'GENERADA'
  | 'EN_REVISION'
  | 'APROBADA'
  | 'PENDIENTE_PAGO'
  | 'PAGADA'
  | 'RETENIDA'
  | 'REVERSADA';

export type Equipo = 'CLOSERS' | 'SOCIOS' | 'ADMINISTRACION';

export const ESTADOS: Array<{ id: Estado; etiqueta: string; badge: string; ayuda: string }> = [
  { id: 'GENERADA', etiqueta: 'Generadas', badge: 'badge-warn', ayuda: 'En los 15 días de espera desde el cobro.' },
  { id: 'EN_REVISION', etiqueta: 'En revisión', badge: 'badge-info', ayuda: 'Retenidas desde aquí hasta que alguien las apruebe.' },
  { id: 'APROBADA', etiqueta: 'Aprobadas', badge: 'badge-info', ayuda: 'Libres, esperando su corte.' },
  { id: 'PENDIENTE_PAGO', etiqueta: 'Pendientes de pago', badge: 'badge-warn', ayuda: 'Dentro de un corte o con un abono.' },
  { id: 'PAGADA', etiqueta: 'Pagadas', badge: 'badge-ok', ayuda: 'El dinero ya salió.' },
  { id: 'RETENIDA', etiqueta: 'Retenidas', badge: 'badge-mute', ayuda: 'Frenadas: no entran a ningún corte.' },
  { id: 'REVERSADA', etiqueta: 'Reversadas', badge: 'badge-bad', ayuda: 'Anuladas: nunca se pagan.' },
];

export const ETIQUETA_EQUIPO: Record<Equipo, string> = {
  CLOSERS: 'Equipo de closers',
  SOCIOS: 'Socios comerciales',
  ADMINISTRACION: 'Administración y otros',
};

export const PERIODICIDADES = [
  { id: 'MENSUAL', etiqueta: 'Mensual' },
  { id: 'TRIMESTRAL', etiqueta: 'Trimestral' },
  { id: 'SEMESTRAL', etiqueta: 'Semestral' },
  { id: 'ANUAL', etiqueta: 'Anual' },
];

export type Totales = {
  ventas: number;
  vendidoUsd: number;
  comisiones: number;
  comisionesUsd: number;
  ajustesUsd: number;
  pagadoUsd: number;
  saldoUsd: number;
  porEstado: Record<Estado, { cantidad: number; montoUsd: number }>;
  liquidacion: string;
  liquidacionEtiqueta: string;
};

export type ColaboradorResumen = {
  codeId: string | null;
  nombre: string;
  rol: string | null;
  rolEtiqueta: string;
  equipo: Equipo;
  equipoEtiqueta: string;
  equipoDeVenta: string | null;
  etiqueta: string;
  totales: Totales;
  cortesAbiertos: Array<{ batchId: string; code: string; pendienteUsd: number }>;
};

/**
 * La parte del socio que calcula Contabilidad (línea «Socio»). Es un DATO: ya
 * se paga desde Contabilidad a fin de mes, así que no está en `general`,
 * `porEquipo` ni el cuadre, y la pantalla tampoco debe sumarlo a nada.
 */
export type SocioContabilidad = {
  nombre: string;
  montoUsd: number;
  porcentaje: number;
  baseUsd: number;
  base: 'BRUTO' | 'NETO' | 'MIXTA';
  baseEtiqueta: string;
  nota: string;
  informativo: true;
};

export type Resumen = {
  periodo: { desde: string | null; hasta: string | null };
  ventas: { totalUsd: number; cantidad: number };
  general: Totales;
  porEquipo: Record<Equipo, Totales & { etiqueta: string; colaboradores: number }>;
  /** null con filtro de colaborador o de otro equipo, o si no se pudo leer. */
  socioContabilidad: SocioContabilidad | null;
  colaboradoresComisionando: number;
  colaboradores: ColaboradorResumen[];
  porMes: Array<{ mes: string; comisionesUsd: number; pagadoUsd: number }>;
  cuadre: { ok: boolean; sumaDeIndividuales: { comisionesUsd: number; pagadoUsd: number; saldoUsd: number } };
  avisos: string[];
};

export type Fila = {
  id: string;
  fecha: string;
  colaborador: { codeId: string | null; nombre: string; rol: string | null; rolEtiqueta: string; equipo: Equipo };
  negocio: { id: string | null; nombre: string | null; esGrupo: boolean };
  cliente: string | null;
  plan: string | null;
  periodicidad: string | null;
  ventaUsd: number | null;
  porcentaje: number | null;
  esFijo: boolean;
  montoUsd: number;
  pagadoUsd: number;
  estado: Estado | null;
  estadoEtiqueta: string;
  status: string;
  paymentStatus: string;
  tipoVenta: 'NUEVA' | 'RENOVACION' | null;
  tipoVentaEtiqueta: string | null;
  proximaRenovacion: string | null;
  estadoCliente: string;
  esManual: boolean;
  tipoManual: string | null;
  esDeEquipo: boolean;
  esParticipacion: boolean;
  corte: { id: string; code: string; status: string; paymentDate: string | null } | null;
  notas: string | null;
};

export type Filtros = {
  desde: string;
  hasta: string;
  colaborador: string;
  equipo: string;
  negocio: string;
  periodicidad: string;
  tipoVenta: string;
  estado: string;
};

export const FILTROS_VACIOS: Filtros = {
  desde: '',
  hasta: '',
  colaborador: '',
  equipo: '',
  negocio: '',
  periodicidad: '',
  tipoVenta: '',
  estado: '',
};

export function aQuery(f: Partial<Filtros> & Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== '' && v !== undefined && v !== null) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ── Formato ──────────────────────────────────────────────────────────────

const fmtUsd = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
export const usd = (n: number | null | undefined) => (n == null ? '—' : fmtUsd.format(n));

const fmtFecha = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', year: 'numeric' });
const fmtFechaHora = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
export const fecha = (iso: string | null | undefined) => (iso ? fmtFecha.format(new Date(iso)) : '—');
export const fechaHora = (iso: string | null | undefined) => (iso ? fmtFechaHora.format(new Date(iso)) : '—');
/** AAAA-MM-DD del día en Bogotá: para las hojas de cálculo. */
export const ymd = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(iso)) : '';

export const badgeDeEstado = (e: Estado | null) => ESTADOS.find((x) => x.id === e)?.badge ?? 'badge-mute';

/**
 * El estado de una fila de la lista de Comisiones (`/admin/commissions`), que no
 * trae el estado del reporte. ESPEJO de `estadoDeComision` en
 * `backend/src/reporte-comisiones/estados.ts`: si cambia allí, cambia aquí, o
 * la tarjeta del Resumen y la etiqueta de la lista dirán cosas distintas.
 * «En revisión» no se deduce de la fila (en la base es una RETAINED): lo dice
 * `enRevision`, la lista que da el reporte.
 */
export function estadoDeFila(
  c: { id: string; status: string; paymentStatus: string; amountPaid: number; payoutBatch?: unknown },
  enRevision: ReadonlySet<string>,
): Estado | null {
  if (c.status === 'ADJUSTMENT') return null;
  if (c.status === 'REJECTED') return 'REVERSADA';
  if (c.status === 'PAID' || c.paymentStatus === 'PAID') return 'PAGADA';
  if (c.status === 'RETAINED') return enRevision.has(c.id) ? 'EN_REVISION' : 'RETENIDA';
  if (c.status === 'APPROVED') {
    return c.paymentStatus === 'PARTIAL' || c.amountPaid > 0 || c.payoutBatch ? 'PENDIENTE_PAGO' : 'APROBADA';
  }
  return 'GENERADA';
}

/** Etiqueta en singular para una fila («Generada», no «Generadas»). */
export const ESTADO_SINGULAR: Record<Estado, string> = {
  GENERADA: 'Generada',
  EN_REVISION: 'En revisión',
  APROBADA: 'Aprobada',
  PENDIENTE_PAGO: 'Pendiente de pago',
  PAGADA: 'Pagada',
  RETENIDA: 'Retenida',
  REVERSADA: 'Reversada',
};

// ── Rangos de fecha (hora Bogotá) ────────────────────────────────────────

export type Preset = 'hoy' | 'ayer' | 'semana' | 'mes' | 'mesAnterior' | 'rango' | 'todo';

export const PRESETS: Array<{ id: Preset; etiqueta: string }> = [
  { id: 'hoy', etiqueta: 'Hoy' },
  { id: 'ayer', etiqueta: 'Ayer' },
  { id: 'semana', etiqueta: 'Esta semana' },
  { id: 'mes', etiqueta: 'Este mes' },
  { id: 'mesAnterior', etiqueta: 'Mes anterior' },
  { id: 'rango', etiqueta: 'Rango' },
  { id: 'todo', etiqueta: 'Todo' },
];

function hoyBogota(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

function sumarDias(d: string, n: number): string {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** Desde/hasta (inclusive) de un preset, en días de Bogotá. */
export function rangoDe(p: Preset): { desde: string; hasta: string } | null {
  const hoy = hoyBogota();
  switch (p) {
    case 'hoy':
      return { desde: hoy, hasta: hoy };
    case 'ayer': {
      const a = sumarDias(hoy, -1);
      return { desde: a, hasta: a };
    }
    case 'semana': {
      // Semana de lunes a domingo, como se cuenta en Colombia.
      const dia = new Date(`${hoy}T12:00:00Z`).getUTCDay(); // 0 = domingo
      return { desde: sumarDias(hoy, -((dia + 6) % 7)), hasta: hoy };
    }
    case 'mes':
      return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
    case 'mesAnterior': {
      const primero = `${hoy.slice(0, 7)}-01`;
      const finAnterior = sumarDias(primero, -1);
      return { desde: `${finAnterior.slice(0, 7)}-01`, hasta: finAnterior };
    }
    case 'todo':
      return { desde: '', hasta: '' };
    default:
      return null;
  }
}

/** Nueva clave de idempotencia para el formulario de comisión manual. */
export function nuevaClave(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
