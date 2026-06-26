// Tipos, constantes y helpers compartidos entre las sub-rutas del módulo
// Reservas (agenda, plano, eventos, online, reportes).

export type Location = { id: string; name: string };

export type Zone = {
  id: string;
  name: string;
  slug: string;
  type: string;
  locationId?: string | null;
  // Geometría explícita del recuadro en el plano (modo editor). null/undefined
  // = "auto": el recuadro se deriva de las posiciones de las mesas.
  posX?: number | null;
  posY?: number | null;
  width?: number | null;
  height?: number | null;
};

export type Table = {
  id: string;
  number: string;
  seats: number;
  shape: string;
  posX: number;
  posY: number;
  width?: number | null;
  height?: number | null;
  isBlocked: boolean;
  zoneId?: string | null;
  zone?: { name: string } | null;
};

export type ReservationStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'SEATED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export type Reservation = {
  id: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  party: number;
  date: string;
  time: string;
  notes?: string | null;
  status: ReservationStatus;
  channel: string;
  tableId?: string | null;
  zoneId?: string | null;
  table?: { number: string } | null;
  zone?: { name: string } | null;
  customer?: {
    id: string;
    fullName: string;
    tags: string[];
  } | null;
  labels?: string[]; // tags dinámicos (VIP, Frecuente, Cumpleaños, Primera visita, Alto valor)
};

export const STATUS_META: Record<
  ReservationStatus,
  { label: string; dot: string; bg: string; fg: string }
> = {
  PENDING: { label: 'Pendiente', dot: '#f59e0b', bg: '#fff7ed', fg: '#b45309' },
  CONFIRMED: { label: 'Confirmada', dot: '#22C55E', bg: '#ecfdf3', fg: '#15803d' },
  SEATED: { label: 'Sentada', dot: '#3b82f6', bg: '#eff6ff', fg: '#1d4ed8' },
  COMPLETED: { label: 'Completada', dot: '#6b7280', bg: '#f3f4f6', fg: '#6b7280' },
  CANCELLED: { label: 'Cancelada', dot: '#6b7280', bg: '#f3f4f6', fg: '#6b7280' },
  NO_SHOW: { label: 'Ausente', dot: '#dc2626', bg: '#fef2f2', fg: '#dc2626' },
};

export const LABEL_COLORS: Record<string, { bg: string; fg: string }> = {
  VIP: { bg: '#fef3c7', fg: '#b45309' },
  Frecuente: { bg: '#dcfce7', fg: '#15803d' },
  'Primera visita': { bg: '#dbeafe', fg: '#1e40af' },
  Cumpleaños: { bg: '#fce7f3', fg: '#be185d' },
  'Alto valor': { bg: '#ede9fe', fg: '#6d28d9' },
};

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function avatarColor(name: string) {
  const palette = [
    '#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6',
    '#06b6d4', '#ef4444', '#84cc16', '#14b8a6', '#f97316',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash << 5) - hash + name.charCodeAt(i);
  return palette[Math.abs(hash) % palette.length];
}

export const SHIFT_RANGES: Record<'diurno' | 'tarde' | 'noche', [number, number]> = {
  diurno: [0, 17],
  tarde: [17, 21],
  noche: [21, 24],
};

export function reservationShift(time: string): 'diurno' | 'tarde' | 'noche' {
  const h = parseInt(time.slice(0, 2), 10);
  if (h < 17) return 'diurno';
  if (h < 21) return 'tarde';
  return 'noche';
}

export function channelMeta(channel: string): { label: string; icon: string } {
  const map: Record<string, { label: string; icon: string }> = {
    WEB: { label: 'Web', icon: '🌐' },
    WHATSAPP: { label: 'WhatsApp', icon: '💬' },
    PHONE: { label: 'Teléfono', icon: '📞' },
    QR: { label: 'QR', icon: '📱' },
    IN_PERSON: { label: 'Walk-in', icon: '🚶' },
  };
  return map[channel] ?? { label: channel, icon: '·' };
}

/** Convierte "13:00" → "1:00 p.m.", "00:30" → "12:30 a.m.", "12:00" → "12:00 p.m." */
export function to12h(time: string): string {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return time;
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'p.m.' : 'a.m.';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export function fmtLongDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return date.toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}
