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
};

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
