/**
 * Cuánto se cobró de verdad en un rango.
 *
 * Vive fuera de `admin-reports.service.ts` por una razón concreta: es la cifra
 * grande del panel de administración, la que se mira para saber cómo va el
 * mes, y estaba mal. Aquí se puede probar sin base de datos.
 *
 * QUÉ HACÍA ANTES (y por qué fallaba)
 * -----------------------------------
 * No sumaba pagos. Contaba NEGOCIOS con `lastChargeAt` dentro del rango y le
 * ponía a cada uno el precio de su plan. Eso se equivoca por los dos lados a
 * la vez — medido contra producción el 2026-09-07, septiembre:
 *
 *   · de más: Moa Café ($480) y Oh! Cookies ($135) tenían fecha de cobro y
 *     ninguna transacción detrás. $615 de caja que nunca entró.
 *   · de menos: Segundo Piso pagó $150 y contaba $135. Dónde Jeank pagó $68 y
 *     contaba $50. demo demo pagó $80 por Stripe y contaba $50.
 *
 *   panel $1.454,52  ·  realidad $917,52  →  un 58% de más.
 *
 * QUÉ HACE AHORA
 * --------------
 * `cobrado` = la suma de las transacciones reales (`IncomeRecord`), que es la
 * misma fuente que usa Contabilidad.
 *
 * Lo que tiene fecha de cobro pero no tiene transacción NO desaparece: sale
 * aparte, en `sinRegistrar`. Puede ser un pago real que no llegó a
 * Contabilidad —y hay que perseguirlo— o una fecha vieja colgada —y hay que
 * limpiarla. Los dos casos se arreglan viéndolos.
 */

export type PeriodKey = 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';

export interface IngresoReal {
  tenantId: string | null;
  whiteLabelId: string | null;
  grossUsd: unknown;
  planPeriodicity: string | null;
}

export interface NegocioConFecha {
  id: string;
  planPeriodicity: string | null;
  subscriptionPriceUsd: unknown;
}

export interface GrupoConFecha {
  planPeriodicity: string | null;
  priceUsd: unknown;
  tenants?: { id: string }[];
}

export interface Bucket {
  count: number;
  amount: number;
  groups: number;
}

export interface Cobrado {
  cobradoUsd: number;
  porPlan: Record<PeriodKey, Bucket>;
  sinRegistrarUsd: number;
  sinRegistrarCount: number;
  /** Dinero que entró sin negocio detrás: packs de créditos y «Descuento de
   *  Implementación» (2026-09-09). Está DENTRO de `cobradoUsd` y FUERA de
   *  `porPlan` — no es la cuota de nadie, así que meterlo en un plan inventaría
   *  suscripciones mensuales que no existen. */
  sueltoUsd: number;
  sueltoCount: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function calcularCobrado(entrada: {
  ingresos: IngresoReal[];
  negociosConFecha: NegocioConFecha[];
  gruposConFecha: GrupoConFecha[];
  /** Negocios de la marca que se está mirando, con su periodicidad. */
  negociosEnAlcance: { id: string; planPeriodicity: string | null }[];
  /** Marca activa, o null si se mira la plataforma entera. */
  wlId: string | null;
  normalizePeriod: (p: string | null) => PeriodKey;
  precioDeLista: (t: {
    planPeriodicity: string | null;
    subscriptionPriceUsd: unknown;
  }) => number;
  precioCanonico: (k: PeriodKey) => number;
}): Cobrado {
  const {
    ingresos,
    negociosConFecha,
    gruposConFecha,
    negociosEnAlcance,
    wlId,
    normalizePeriod,
    precioDeLista,
    precioCanonico,
  } = entrada;

  const porPlan: Record<PeriodKey, Bucket> = {
    MENSUAL: { count: 0, amount: 0, groups: 0 },
    TRIMESTRAL: { count: 0, amount: 0, groups: 0 },
    SEMESTRAL: { count: 0, amount: 0, groups: 0 },
    ANUAL: { count: 0, amount: 0, groups: 0 },
  };

  const enAlcance = new Set(negociosEnAlcance.map((t) => t.id));
  const periodicidadDe = new Map(
    negociosEnAlcance.map((t) => [t.id, t.planPeriodicity]),
  );
  // Con qué negocios hubo movimiento real de dinero. Lo necesita el bloque de
  // «sin registrar» para no acusar a quien sí pagó.
  const cobraronDeVerdad = new Set<string>();

  let cobradoUsd = 0;
  let sueltoUsd = 0;
  let sueltoCount = 0;
  for (const r of ingresos) {
    // Acotar a la marca. Un ingreso sin negocio (pago suelto) entra solo si su
    // marca coincide, o si se mira la plataforma entera. Un suelto SIN marca
    // —una compra que no se pudo atribuir— solo cuenta en la vista global; en
    // la de una marca no aparece, porque no consta que sea suyo.
    if (r.tenantId) {
      if (!enAlcance.has(r.tenantId)) continue;
      cobraronDeVerdad.add(r.tenantId);
    } else if (wlId && r.whiteLabelId !== wlId) {
      continue;
    }
    const monto = Number(r.grossUsd);
    if (!Number.isFinite(monto)) continue;
    cobradoUsd += monto;

    // Sin negocio no hay cuota, así que no hay plan al que sumarlo. Va aparte:
    // dentro del total, fuera del desglose. Antes esto habría caído en MENSUAL
    // —el destino por defecto de una periodicidad nula— e inventado
    // suscripciones que nadie contrató.
    if (!r.tenantId) {
      sueltoUsd += monto;
      sueltoCount += 1;
      continue;
    }

    const key = normalizePeriod(
      r.planPeriodicity ?? periodicidadDe.get(r.tenantId) ?? null,
    );
    porPlan[key].count += 1;
    porPlan[key].amount += monto;
  }

  let sinRegistrarUsd = 0;
  let sinRegistrarCount = 0;
  for (const t of negociosConFecha) {
    if (cobraronDeVerdad.has(t.id)) continue;
    sinRegistrarUsd += precioDeLista(t);
    sinRegistrarCount += 1;
  }

  // Un Grupo Empresarial se cobra una vez por todos sus negocios. Si el dinero
  // entró, ya está sumado arriba por la transacción de alguno de sus miembros;
  // volver a sumar el precio del grupo contaría el mismo cobro dos veces.
  for (const g of gruposConFecha) {
    const key = normalizePeriod(g.planPeriodicity);
    if ((g.tenants ?? []).some((m) => cobraronDeVerdad.has(m.id))) {
      // Cobró: el dinero ya está sumado por la transacción de su negocio. Solo
      // se marca que UNA de las unidades de este plan es un grupo, para que el
      // panel no lo cuente como un negocio suelto más.
      porPlan[key].groups += 1;
      continue;
    }
    const precio = Number(g.priceUsd);
    sinRegistrarUsd += precio > 0 ? precio : precioCanonico(key);
    sinRegistrarCount += 1;
  }

  for (const k of Object.keys(porPlan) as PeriodKey[]) {
    porPlan[k].amount = round2(porPlan[k].amount);
  }

  return {
    cobradoUsd: round2(cobradoUsd),
    porPlan,
    sinRegistrarUsd: round2(sinRegistrarUsd),
    sinRegistrarCount,
    sueltoUsd: round2(sueltoUsd),
    sueltoCount,
  };
}
