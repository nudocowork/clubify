/**
 * El reparto de la comisión del UPGRADE a plan anual.
 *
 * ── POR QUÉ ESTE ARCHIVO EXISTE ──────────────────────────────────────────
 *
 * El motor de comisiones de siempre (`ReferralsService.generateCommissionsForPayment`)
 * **ignora a propósito el monto pagado**: calcula la base con
 * `getCommissionBase(subscriptionPriceUsd, periodicidad)`, o sea el precio
 * pactado del negocio o el canónico del bundle. Eso está bien para un cobro
 * recurrente y es la regla que arregló las comisiones sub-estimadas por el FX
 * de Hotmart — pero en un upgrade la base tiene que ser **lo que el negocio
 * pagó de verdad** (si pagó 350 por pasar a anual, la comisión sale de 350, no
 * de los 500 del anual estándar).
 *
 * No se puede resolver llamando al motor con otro número: el monto no entra por
 * parámetro, y `computeExpectedCommissionRows` —que sí acepta la base— es
 * privado y está marcado como intocable. La casa ya resolvió este mismo
 * problema una vez, con la comisión de IMPLEMENTACIÓN
 * (`referrals.service.ts` → `generateImplementationCommission`), repitiendo el
 * reparto a mano sobre un monto suelto.
 *
 * Aquí se repite también, PERO con dos diferencias que valen la pena:
 *
 *  1. la aritmética vive en una función PURA (esta), sin base de datos, y
 *  2. hay una prueba de NO REGRESIÓN (`comision-del-upgrade.spec.ts`) que pasa
 *     los MISMOS datos por esta función y por `computeExpectedCommissionRows`
 *     y exige que den lo mismo, fila por fila. Si alguien cambia el reparto del
 *     motor y no cambia este archivo, esa prueba se pone en rojo. Es el único
 *     freno real contra la copia que se desincroniza en silencio.
 *
 * Lo que NO se copia aquí es la resolución de los porcentajes (excepción por
 * negocio, % indirecto del influencer). Eso lo sigue resolviendo quien llama
 * con los MISMOS servicios que usa el motor —`CommissionExceptionsService.resolvePercent`
 * y el Setting `referrals.indirectPercent`—, así que ahí no hay duplicado.
 */

export type CadenaDeAtribucion = {
  influencer: { id: string } | null;
  embajador: { id: string } | null;
  vendor: { id: string } | null;
};

export type FilaDeComision = {
  recipientCodeId: string;
  vendorCodeId: string | null;
  amount: number;
  appliedPercent: number;
};

export type ModoDeReparto =
  | 'DISCOUNT_FROM_INFLUENCER'
  | 'ADDITIONAL_COMPANY_COMMISSION';

/**
 * Reparte `base` entre influencer / embajador / vendedor con los porcentajes
 * YA resueltos (excepciones incluidas).
 *
 * Las tres reglas que copia del motor, y que no son evidentes:
 *
 *  · **El vendedor sale de la tajada del embajador** (modo DISCOUNT, el de por
 *    defecto): su % nunca puede exceder el del embajador, y al embajador se le
 *    resta. El total que se le paga a la cadena es el % del embajador, no sube.
 *    En modo ADDITIONAL el vendedor es un costo extra de la empresa: el
 *    embajador conserva su % completo.
 *  · **Una fila con importe 0 no se crea.** Un beneficiario al 0 % no es una
 *    comisión de $0, es que no le toca nada.
 *  · **El redondeo es `Math.round(base × pct) / 100`**, no `base × pct / 100`
 *    redondeado aparte. Da lo mismo en casi todos los casos y no en todos; es
 *    la forma exacta que usa el motor.
 */
export function filasDeComisionDelUpgrade(args: {
  base: number;
  cadena: CadenaDeAtribucion;
  /** % del influencer ya resuelto (su % directo, el indirecto, o su excepción). */
  influencerPct: number;
  /** % del embajador ya resuelto. */
  embajadorPct: number;
  /** % del vendedor ya resuelto, SIN acotar al del embajador (se acota aquí). */
  vendorPctCrudo: number;
  modo: ModoDeReparto;
}): FilaDeComision[] {
  const { base, cadena, influencerPct, embajadorPct, modo } = args;
  const filas: FilaDeComision[] = [];
  if (!(base > 0)) return filas;

  const adicional = modo === 'ADDITIONAL_COMPANY_COMMISSION';
  const vendorPct =
    cadena.embajador && !adicional
      ? Math.min(args.vendorPctCrudo, embajadorPct)
      : args.vendorPctCrudo;

  if (cadena.influencer && influencerPct > 0) {
    filas.push({
      recipientCodeId: cadena.influencer.id,
      vendorCodeId: null,
      amount: Math.round(base * influencerPct) / 100,
      appliedPercent: influencerPct,
    });
  }
  if (cadena.embajador) {
    const embajadorEfectivo = adicional
      ? embajadorPct
      : Math.max(0, embajadorPct - vendorPct);
    if (embajadorEfectivo > 0) {
      filas.push({
        recipientCodeId: cadena.embajador.id,
        vendorCodeId: null,
        amount: Math.round(base * embajadorEfectivo) / 100,
        appliedPercent: embajadorEfectivo,
      });
    }
  }
  if (cadena.vendor && vendorPct > 0) {
    filas.push({
      recipientCodeId: cadena.vendor.id,
      vendorCodeId: cadena.vendor.id,
      amount: Math.round(base * vendorPct) / 100,
      appliedPercent: vendorPct,
    });
  }
  return filas;
}

/**
 * La clave de período de la comisión de un upgrade.
 *
 * NO es `YYYY-MM` a secas, y esto es deliberado.
 *
 * EL CHOQUE QUE EVITA: el motor tiene tres capas de dedup, y una es por CICLO
 * —si ya existe una comisión de ese (use, beneficiario) cuyo `businessDate` cae
 * en el mismo mes, se salta en silencio—, además del UNIQUE de base de datos
 * `(referralUseId, recipientCodeId, periodKey)`. Un upgrade hecho el mismo mes
 * que el último cobro normal choca con las dos: la fila no se crearía y nadie
 * se enteraría, porque el skip no lanza nada.
 *
 * Con `UPG-2026-09-<id del upgrade>` la clave es única por upgrade, así que el
 * UNIQUE no la puede frenar, y sigue llevando el mes dentro para que se lea de
 * un vistazo a qué mes pertenece. Es la misma solución que ya usa la comisión
 * de implementación (`IMPL-<mes>-<aleatorio>`), con el id del upgrade en vez de
 * un aleatorio para poder volver de la comisión al upgrade que la generó.
 *
 * El dedup por ciclo no aplica porque el upgrade NO pasa por
 * `generateCommissionsForPayment`: crea sus filas él mismo.
 */
export function periodKeyDelUpgrade(cuando: Date, upgradeId: string): string {
  const y = cuando.getUTCFullYear();
  const m = String(cuando.getUTCMonth() + 1).padStart(2, '0');
  return `UPG-${y}-${m}-${upgradeId}`;
}
