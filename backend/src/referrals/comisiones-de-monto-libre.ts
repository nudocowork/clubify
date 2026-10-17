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
// EQUIPO-: la comisión de equipo es un % de las ventas de la quincena, no del
// plan de un negocio (ver `comision-de-equipo.service.ts`).
// MANUAL-: la que crea un administrador con «+ Nueva comisión» del reporte de
// comisiones, con su propia base y su propio % (`reporte-comisiones/comision-manual.ts`).
// PART-: participación global (socio, PM) sobre un cobro. Sale de su propia
// regla (`ParticipacionGlobal`), no del % del código (ver `reglas-de-comision.ts`).
const MONTO_LIBRE = /^(UPG|IMPL|EQUIPO|MANUAL|PART)-/;

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
export const NO_ES_DEL_UPGRADE = {
  // Ni las que salieron de una REGLA de colaborador (fija, renovación…) ni las
  // PARTICIPACIONES: el recálculo no conoce reglas y las devolvería al % del
  // código. Las reglas nunca cambian comisiones ya creadas, y el recálculo
  // tampoco puede cambiar lo que una regla creó.
  reglaColaboradorId: null,
  participacionId: null,
  OR: [
    { periodKey: null },
    // Tampoco la de EQUIPO (un % de las ventas de la quincena): el recálculo
    // la reescribiría como «base del plan × % del código», que no es su regla.
    // Ni la MANUAL: su monto lo fijó una persona con una base y un % propios;
    // recalcularla sobre el plan del negocio deshace lo que se decidió a mano.
    {
      AND: [
        { NOT: { periodKey: { startsWith: 'UPG-' } } },
        { NOT: { periodKey: { startsWith: 'EQUIPO-' } } },
        { NOT: { periodKey: { startsWith: 'MANUAL-' } } },
        { NOT: { periodKey: { startsWith: 'PART-' } } },
      ],
    },
  ],
};

/**
 * ¿Esta comisión la juzga su propia regla y no el % del código? Para el arqueo
 * y «Corregir todo»: una fila con regla de colaborador no tiene «esperado»
 * deducible desde el código, y forzarla al % del código es reescribir lo que
 * decidió la regla.
 */
export const tieneReglaPropia = (c: { reglaColaboradorId?: string | null; participacionId?: string | null }) =>
  !!c.reglaColaboradorId || !!c.participacionId;

/**
 * Filtro Prisma para «esta comisión NO es la de equipo». Para el arqueo de
 * comisiones: la de equipo no tiene negocio ni referido detrás, y sin esto
 * salía como fantasma «sin negocio» y «Corregir todo» la anulaba.
 */
export const NO_ES_DE_EQUIPO = {
  // Las participaciones tampoco tienen referido detrás (cuelgan del ingreso).
  participacionId: null,
  OR: [
    { periodKey: null },
    // La MANUAL tampoco tiene referido detrás (nace sin `referralUseId`): el
    // arqueo la vería «fantasma» y «Corregir todo» la anularía.
    {
      AND: [
        { NOT: { periodKey: { startsWith: 'EQUIPO-' } } },
        { NOT: { periodKey: { startsWith: 'MANUAL-' } } },
        { NOT: { periodKey: { startsWith: 'PART-' } } },
      ],
    },
  ],
};
