/**
 * CALENDARIO DE CORTES DE COMISIONES — helpers PUROS (sin Nest, sin Prisma).
 *
 * Regla del negocio: se corta el día 15 y el ÚLTIMO día de cada mes. El último
 * día se CALCULA (28/29/30/31) — nunca se hardcodea: febrero cierra el 28 o el
 * 29 según el año, abril/junio/septiembre/noviembre el 30, el resto el 31.
 *
 * Todo se razona en **America/Bogota (UTC-5, sin DST)**. El servidor corre en
 * UTC: un corte "del 31" calculado en UTC se ejecutaría el 31 a las 19:00 hora
 * Colombia o el 1ro, según cómo esté escrito. Por eso el tipo de dato que viaja
 * por acá es un `ymd` string ('YYYY-MM-DD') ya normalizado a Bogotá, y solo se
 * convierte a Date en los bordes (queries / columnas).
 *
 * Están en un archivo aparte del service para poder testearlos sin levantar el
 * contenedor de Nest (backend/test/cutoff-calendar.test.ts).
 */

export const BOGOTA_TZ = 'America/Bogota';

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' del instante `d` visto en hora Bogotá. */
export function bogotaYmd(d: Date = new Date()): string {
  // 'en-CA' formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BOGOTA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Hora (0-23) del instante `d` en Bogotá. El tick de las 0 es el de medianoche. */
export function bogotaHour(d: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: BOGOTA_TZ,
      hour: '2-digit',
      hour12: false,
    }).format(d),
  );
}

export function parseYmd(ymd: string): { y: number; m: number; d: number } {
  if (!YMD_RE.test(ymd)) throw new Error(`Fecha inválida (esperado YYYY-MM-DD): ${ymd}`);
  const [y, m, d] = ymd.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) throw new Error(`Fecha inválida: ${ymd}`);
  return { y, m, d };
}

export function fmtYmd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Último día del mes. `month1` es 1-based (1 = enero).
 * `Date.UTC(y, m, 0)` = "día 0 del mes siguiente" = último del mes pedido, y
 * resuelve los bisiestos solo (2024-02 → 29, 2026-02 → 28).
 */
export function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** ¿Este día calendario es día de corte? (15 o último del mes) */
export function isCutoffDay(ymd: string): boolean {
  const { y, m, d } = parseYmd(ymd);
  return d === 15 || d === lastDayOfMonth(y, m);
}

/** Ventana que cubre el corte: 1→15 o 16→último día. */
export function cutoffPeriod(ymd: string): { start: string; end: string } {
  const { y, m, d } = parseYmd(ymd);
  const last = lastDayOfMonth(y, m);
  if (d === 15) return { start: fmtYmd(y, m, 1), end: fmtYmd(y, m, 15) };
  if (d === last) return { start: fmtYmd(y, m, 16), end: fmtYmd(y, m, last) };
  throw new Error(`${ymd} no es día de corte`);
}

/** Suma (o resta, con n negativo) días calendario a un ymd. */
export function addDaysYmd(ymd: string, n: number): string {
  const { y, m, d } = parseYmd(ymd);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return fmtYmd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Días calendario entre dos ymd (b − a). */
export function daysBetweenYmd(a: string, b: string): number {
  const pa = parseYmd(a);
  const pb = parseYmd(b);
  return Math.round(
    (Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000,
  );
}

/** Primer día de corte >= `ymd` (el propio `ymd` si ya lo es). */
export function nextCutoffYmd(ymd: string): string {
  const { y, m, d } = parseYmd(ymd);
  const last = lastDayOfMonth(y, m);
  if (d <= 15) return fmtYmd(y, m, 15);
  if (d <= last) return fmtYmd(y, m, last);
  // Inalcanzable con fechas válidas, pero deja la función total.
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return fmtYmd(ny, nm, 15);
}

/** Días de corte dentro de [from, to] inclusive. Orden ascendente. */
export function cutoffDaysInRange(from: string, to: string): string[] {
  const out: string[] = [];
  if (daysBetweenYmd(from, to) < 0) return out;
  let cur = nextCutoffYmd(from);
  while (daysBetweenYmd(cur, to) >= 0) {
    out.push(cur);
    cur = nextCutoffYmd(addDaysYmd(cur, 1));
  }
  return out;
}

/** Instante UTC de las 00:00 de Bogotá de ese día (UTC-5, sin DST). */
export function bogotaDayStartUtc(ymd: string): Date {
  parseYmd(ymd);
  return new Date(`${ymd}T05:00:00.000Z`);
}

/** Instante UTC del FIN del día Bogotá (= 00:00 Bogotá del día siguiente). */
export function bogotaDayEndUtc(ymd: string): Date {
  return bogotaDayStartUtc(addDaysYmd(ymd, 1));
}

/**
 * Mediodía de Bogotá (17:00 UTC). Las fechas "de calendario" de un lote se
 * guardan acá para que su día nunca se corra al leerlas en otra zona.
 * (Mismo criterio que `batchYmdToDate` del brief PASO 3.)
 */
export function bogotaNoonUtc(ymd: string): Date {
  parseYmd(ymd);
  return new Date(`${ymd}T17:00:00.000Z`);
}

/** Código canónico del lote de un corte. Formato existente, no cambiar. */
export function cutoffCode(ymd: string): string {
  parseYmd(ymd);
  return `CORTE-${ymd}`;
}

/**
 * Etiqueta "Corte N" del corte, quincenal, 1..24 por AÑO (decisión del dueño
 * 2026-08-31). Corte 1 = 1–15 ene, Corte 2 = 16–31 ene, Corte 3 = 1–15 feb…
 * N = (mes−1)×2 + (primera quincena ? 1 : 2). Es solo presentación: el `code`
 * interno ("CORTE-2026-08-15") NO cambia. Se deriva del ymd del corte.
 */
export function cutoffLabel(ymd: string): {
  number: number;
  year: number;
  label: string;
} {
  const { y, m, d } = parseYmd(ymd);
  const number = d <= 15 ? (m - 1) * 2 + 1 : m * 2;
  return { number, year: y, label: `Corte ${number}` };
}

/** Deriva el ymd ("2026-08-15") desde el code de un lote ("CORTE-2026-08-15"). */
export function ymdFromCutoffCode(code: string): string | null {
  const m = /^CORTE-(\d{4}-\d{2}-\d{2})$/.exec(code ?? '');
  return m ? m[1] : null;
}
