/**
 * COMISIONES DE MONTO LIBRE — las que NO salen del precio del plan.
 *
 * Todo el motor de comisiones asume la misma cosa: la base es el precio del
 * plan del negocio (`subscriptionPriceUsd` o el canónico del bundle) y, si hace
 * falta, se puede volver a deducir. Hay dos excepciones, y las dos llevan su
 * propia marca en el `periodKey`:
 *
 *  · `UPG-<mes>-<id>`   — upgrade a plan anual. La base es lo que el negocio
 *                         pagó DE VERDAD por el cambio (350, por ejemplo), no
 *                         los 500 del anual de lista.
 *  · `IMPL-<mes>-<...>` — implementación pagada. Un cargo único y pactado
 *                         ($100 / $200 / $500 / $1000).
 *
 * ── POR QUÉ ESTE ARCHIVO ────────────────────────────────────────────────
 *
 * Porque tres sitios distintos recalculan comisiones «desde la base del
 * negocio», y para estas filas eso es destruirlas:
 *
 *  1. El ARQUEO (`auditCommissions`) deduce la base del negocio con el
 *     `max(baseAmountUsd)` de TODAS sus filas. Con un upgrade de 350 conviviendo
 *     con mensuales de 68, el máximo pasa a 350 y el arqueo declara mal TODAS
 *     las mensuales. Y «Corregir todo» se usa: 7 veces en 90 días.
 *  2. `recalcTenantSplit` y `recalcForRecipientCode` hacen
 *     `amount = base_actual × pct` sobre las PENDING/APPROVED del negocio o del
 *     afiliado. La base actual después del upgrade son los 500 del anual: la
 *     comisión del upgrade pasaría de $87,50 a $125 en cuanto alguien tocara el
 *     modo de reparto, el precio, o el % del afiliado.
 *
 * Tener el criterio en UN sitio es lo que evita que los tres se desincronicen.
 */

/** Prefijos de `periodKey` cuya base NO es el precio del plan. */
const MONTO_LIBRE = /^(UPG|IMPL)-/;

/** ¿Esta comisión se calculó sobre un monto pactado aparte? */
export const esDeMontoLibre = (periodKey: string | null | undefined): boolean =>
  !!periodKey && MONTO_LIBRE.test(periodKey);

/** ¿Es, concretamente, la comisión de un upgrade a plan anual? */
export const esDelUpgrade = (periodKey: string | null | undefined): boolean =>
  !!periodKey && /^UPG-/.test(periodKey);

/**
 * Filtro Prisma para «esta comisión NO es la de un upgrade».
 *
 * El `OR` con `periodKey: null` NO sobra, y este es el detalle que se escapa:
 * un `NOT { startsWith: 'UPG-' }` a secas se traduce a
 * `NOT (periodKey LIKE 'UPG-%')`, que en SQL vale NULL —no TRUE— cuando la
 * columna es NULL. O sea que dejaría fuera del recálculo TODAS las comisiones
 * legacy sin `periodKey`… que son justo las que hay que recalcular.
 */
export const NO_ES_DEL_UPGRADE: {
  OR: Array<{ periodKey: null } | { NOT: { periodKey: { startsWith: string } } }>;
} = {
  OR: [{ periodKey: null }, { NOT: { periodKey: { startsWith: 'UPG-' } } }],
};
