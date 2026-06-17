// #5 (2026-06-17): popups MÚLTIPLES + programados del menú storefront.
// Se guardan en `Storefront.theme.menuPopups` (Json, sin migración — igual que
// los popups de infolink). Reusa el scheduling de info-link-extras.
import {
  type PopupSchedule,
  popupScheduleMatches,
} from './info-link-extras';

export type StorefrontPopupItem = {
  /** id estable (nanoid client-side) → key de sessionStorage por popup. */
  id: string;
  enabled: boolean;
  imageUrl: string;
  /** Si está set, al tocar el popup lleva a /c/<cardId> (inscripción a tarjeta). */
  cardId?: string | null;
  /** Segundos antes de mostrarlo. 0 = inmediato. Default 10. */
  delaySeconds?: number;
  /** Nombre interno para distinguirlos en el admin (ej "Promo lunes"). */
  name?: string | null;
  /** Programación opcional (días/horario/fechas). null = siempre activo. */
  schedule?: PopupSchedule | null;
};

/** Devuelve el primer popup habilitado cuyo schedule coincide con `now`.
 *  null si ninguno aplica. El orden del array define la prioridad. */
export function resolveActiveMenuPopup(
  popups: StorefrontPopupItem[] | null | undefined,
  now: Date,
): StorefrontPopupItem | null {
  if (!Array.isArray(popups)) return null;
  for (const p of popups) {
    if (!p || !p.enabled || !p.imageUrl) continue;
    if (popupScheduleMatches(p.schedule, now)) return p;
  }
  return null;
}
