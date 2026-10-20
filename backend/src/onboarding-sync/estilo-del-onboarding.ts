/**
 * Qué hacer con el «estilo de menú» que manda el Onboarding.
 *
 * El formulario ofrece «flipbook» (libro) junto a los diseños de la carta, y
 * hasta el 2026-10-20 se guardaba tal cual como `Storefront.menuLayout`. Ese
 * valor es LEGADO: significa «en vez de la carta, muestra el Menú libro», y
 * el panel del negocio ya no lo ofrece, así que el negocio no podía
 * quitárselo. Rápidos y Fabulosos lo eligió, nunca subió páginas al libro, y
 * su carta de 19 productos salía como «La carta todavía se está preparando».
 * Cada vez que el Onboarding volvía a sincronizar, lo volvía a poner, aunque
 * en el panel ya hubieran elegido otro diseño.
 *
 * Ahora «libro» ENCIENDE el Menú libro (que se verá cuando tenga páginas) y
 * la carta se queda en un diseño normal: el que ya tenía, o el clásico si el
 * que tenía era el legado.
 */
export function aplicarEstiloDelOnboarding(
  estilo: string | null,
  layoutActual: string | null | undefined,
): { menuLayout?: string; bookMenuEnabled?: true } {
  if (!estilo) return {};
  if (estilo !== 'FLIPBOOK') return { menuLayout: estilo };
  const conservar = layoutActual && layoutActual !== 'FLIPBOOK';
  return conservar
    ? { bookMenuEnabled: true }
    : { bookMenuEnabled: true, menuLayout: 'CLASSIC' };
}
