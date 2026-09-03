/**
 * Sistema visual CARNET — la dirección elegida para la cuponera (2026-08-26).
 *
 * La idea: la membresía se lee como un DOCUMENTO, no como un cupón. De ahí el
 * teal profundo de tinta oficial, la monoespaciada para todo lo que es dato
 * (categorías, series, límites) y las tramas finas tipo guilloche.
 *
 * Vive acá y no en un CSS global para no pelearse con el tema del panel: las
 * pantallas públicas de la cuponera son un mundo cerrado y se pintan solas.
 */

export const CARNET = {
  /** Tinta oficial. Fondo de todas las pantallas públicas. */
  ink: '#0e3a44',
  /** Un paso más claro: tarjetas y bloques sobre el fondo. */
  ink2: '#12474f',
  /** Aún más oscuro: barras y encabezados. */
  inkDeep: '#0a2a31',
  /** Papel. Texto sobre tinta y fondo de la ficha. */
  paper: '#eaf4f5',
  /** Menta: acento único. Etiquetas, series, subrayados. */
  mint: '#7fd4c1',
  /** Texto secundario sobre tinta. */
  muted: '#9fc0c5',
  /** Texto secundario sobre papel. */
  mutedOnPaper: '#4a7d85',
  /** Líneas sobre papel. */
  lineOnPaper: '#c8dade',
  /** Líneas sobre tinta. */
  lineOnInk: 'rgba(127,212,193,.28)',

  mono: '"IBM Plex Mono", ui-monospace, "SF Mono", monospace',
  sans: '"Archivo", "Helvetica Neue", system-ui, sans-serif',

  /** Trama diagonal fina, como el fondo de un documento. */
  guilloche: 'repeating-linear-gradient(115deg, rgba(14,58,68,.05) 0 1px, transparent 1px 7px)',
} as const;

/** Etiqueta en versalitas monoespaciadas: categorías, campos, series. */
export const label = (color: string = CARNET.mint): React.CSSProperties => ({
  fontFamily: CARNET.mono,
  fontSize: 10.5,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  color,
});

/** Cómo se lee el tope por miembro. Espeja describeLimit del backend. */
export function limiteTexto(
  maxPerMember: number | null | undefined,
  limitPeriod: string | null | undefined,
): string {
  if (maxPerMember == null) return 'USO ILIMITADO';
  const p = limitPeriod ?? 'LIFETIME';
  if (p === 'LIFETIME') {
    return maxPerMember === 1 ? 'UN SOLO USO' : `${maxPerMember} USOS EN TOTAL`;
  }
  const v: Record<string, string> = {
    DAY: 'POR DÍA', WEEK: 'POR SEMANA', MONTH: 'POR MES', YEAR: 'POR AÑO',
  };
  return `${maxPerMember} ${maxPerMember === 1 ? 'USO' : 'USOS'} ${v[p] ?? ''}`.trim();
}

/** Titular del beneficio: "15% OFF", "2x1", "$10.000 OFF". */
export function beneficioTitular(b: {
  type: string;
  percentOff?: number | null;
  amountOffCents?: number | null;
  currency?: string | null;
}): string {
  const money = (c: number) => `$${Number(c || 0).toLocaleString('es-CO')}`;
  if (b.type === 'PERCENT_OFF' && b.percentOff) return `${b.percentOff}% OFF`;
  if (b.type === 'AMOUNT_OFF' && b.amountOffCents) return `${money(b.amountOffCents)} OFF`;
  if (b.type === 'TWO_FOR_ONE') return '2x1';
  if (b.type === 'FREEBIE') return 'GRATIS';
  return 'BENEFICIO';
}

/** Iniciales para el recuadro cuando el aliado no cargó logo. */
export function iniciales(nombre: string): string {
  return (nombre || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || '—';
}
