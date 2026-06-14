/**
 * Configuración extendida del InfoLink — vive bajo `link.theme.background`
 * y `link.theme.popup` (no requiere migración Prisma porque `theme` ya es
 * JSON libre). 2026-06-12 (Bloque 1).
 */

export type InfoLinkBackground =
  | { type: 'SOLID'; color: string }
  | {
      type: 'IMAGE';
      imageUrl: string;
      /** Overlay oscuro encima de la imagen para legibilidad. 0-100. */
      overlay?: number;
    }
  | {
      type: 'GRADIENT';
      from: string;
      to: string;
      /** Ángulo en grados. Default 180 (vertical, de arriba a abajo). */
      angle?: number;
    };

export type InfoLinkPopup = {
  enabled: boolean;
  imageUrl?: string | null;
  title?: string | null;
  description?: string | null;
  buttonText?: string | null;
  buttonUrl?: string | null;
  buttonColor?: string | null;
  /** Segundos a esperar antes de mostrarlo. 0 = al cargar. Default 3. */
  delaySeconds?: number;
  /** Si true, una vez visto no se vuelve a mostrar en la misma sesión. */
  oncePerSession?: boolean;
  /** Nombre interno opcional para distinguir popups entre sí en el admin
   *  (ej: "Promo Martes", "Happy Hour"). No visible al cliente. */
  name?: string | null;
  /** Programación opcional. Si está presente, el popup solo se muestra
   *  cuando el momento actual cae dentro de cualquiera de las restricciones
   *  definidas. Sin schedule = siempre activo. */
  schedule?: PopupSchedule | null;
};

/** Programación de cuándo mostrar un popup. Todos los campos son
 *  acumulativos (AND): debe coincidir el día, el rango de fechas y la
 *  hora simultáneamente. Campos null = sin restricción. */
export type PopupSchedule = {
  /** Días de la semana en los que aparece. 0=Domingo, 1=Lunes, ..., 6=Sábado.
   *  null o [] = todos los días. */
  daysOfWeek?: number[] | null;
  /** Fecha desde la cual está activo (YYYY-MM-DD). null = sin inicio. */
  startDate?: string | null;
  /** Fecha hasta la cual está activo (YYYY-MM-DD, inclusive). null = sin fin. */
  endDate?: string | null;
  /** Hora desde (HH:MM, 24h, hora local del cliente). null = desde 00:00. */
  startTime?: string | null;
  /** Hora hasta (HH:MM, 24h, exclusive). null = hasta 23:59. */
  endTime?: string | null;
};

/** Evalúa si un PopupSchedule coincide con un Date dado. Si schedule es
 *  null/undefined → true (siempre activo). Considera la hora local del
 *  cliente, no UTC. */
export function popupScheduleMatches(
  schedule: PopupSchedule | null | undefined,
  now: Date,
): boolean {
  if (!schedule) return true;
  const dow = now.getDay();
  if (
    Array.isArray(schedule.daysOfWeek) &&
    schedule.daysOfWeek.length > 0 &&
    !schedule.daysOfWeek.includes(dow)
  ) {
    return false;
  }
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (schedule.startDate && ymd < schedule.startDate) return false;
  if (schedule.endDate && ymd > schedule.endDate) return false;
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (schedule.startTime && hm < schedule.startTime) return false;
  if (schedule.endTime && hm >= schedule.endTime) return false;
  return true;
}

/**
 * Convierte el config de fondo a un string CSS válido para `background:`.
 * Devuelve undefined si no hay config (el template usa su default).
 */
export function backgroundCss(
  bg: InfoLinkBackground | null | undefined,
): string | undefined {
  if (!bg) return undefined;
  if (bg.type === 'SOLID') {
    return bg.color || undefined;
  }
  if (bg.type === 'IMAGE') {
    if (!bg.imageUrl) return undefined;
    const overlay = Math.max(0, Math.min(100, bg.overlay ?? 0)) / 100;
    if (overlay > 0) {
      return (
        `linear-gradient(rgba(0,0,0,${overlay}), rgba(0,0,0,${overlay})),` +
        ` url("${bg.imageUrl}") center/cover no-repeat`
      );
    }
    return `url("${bg.imageUrl}") center/cover no-repeat`;
  }
  if (bg.type === 'GRADIENT') {
    const angle =
      typeof bg.angle === 'number' && Number.isFinite(bg.angle) ? bg.angle : 180;
    return `linear-gradient(${angle}deg, ${bg.from}, ${bg.to})`;
  }
  return undefined;
}
