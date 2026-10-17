/**
 * QUIÉN cobra y CUÁNTO por un cobro de un negocio con afiliado. Fuente única.
 *
 * ── POR QUÉ ESTE ARCHIVO EXISTE ──────────────────────────────────────────
 *
 * Cada camino que crea comisiones (webhook de primer cobro y renovación, pago
 * manual, «Generar comisión ahora», asignación desde admin, implementación,
 * reconciliador) elegía por su cuenta a QUIÉN le tocaba la venta y con QUÉ %.
 * Unos lo hacían bien y otros no, y la diferencia salía en producción:
 *
 *  · MOTILART (cobro del 22-sep, $50): vendió el EMBAJADOR Santiago Romero, que
 *    cuelga del INFLUENCER Juan Camilo. Debía salir el % de Santiago + el 5 %
 *    indirecto de Juan. Salió UNA comisión: el 25 % completo para Juan, nada
 *    para Santiago.
 *  · Enchurrados TEX-MEX (08-oct, $150): vendió Gabriel Ruiz bajo Nicolás
 *    Quintero. Salieron $15 enteros para Nicolás. Alquimia Café Bistro, del
 *    mismo Gabriel (13-oct, primer cobro), sí salió bien: $25 + $25.
 *
 * La causa es la misma en los dos: el webhook genera la indirecta del
 * influencer colgándola de un «parent-use» (un `ReferralUse` del influencer
 * para ESE negocio, creado la primera vez). Desde ese momento el negocio tiene
 * dos registros, y el webhook elegía «el más reciente» —que es justamente el
 * parent-use—. Resultado: el primer cobro reparte bien y las renovaciones le
 * pagan al influencer su % completo como si la venta fuera suya, sin directa
 * para el embajador. Es el bug de Birria León de junio, que se arregló en el
 * reconciliador pero no en el webhook ni en «Generar comisión ahora».
 *
 * Por eso aquí viven, PURAS y probadas, las tres decisiones:
 *
 *  1. `elegirUsoQueVendio`: de todos los registros del negocio, cuál es el de la
 *     persona que vendió. Por ROL (vendedor > embajador > influencer), nunca por
 *     fecha a secas: un influencer solo «vende» un negocio si no hay embajador
 *     ni vendedor suyo detrás.
 *  2. `cadenaDelCodigo`: desde el código que vendió, quién está arriba.
 *  3. `repartoDeComision`: con los % ya resueltos, las filas que se crean.
 *
 * Regla de negocio que sostienen juntas: **un influencer NUNCA cobra su %
 * completo por una venta que hizo su embajador** (o un vendedor de su equipo);
 * cobra el % indirecto (`referrals.indirectPercent`, 5 % por defecto).
 */

/** Rango de cada rol a la hora de decidir quién vendió. Mayor = más cerca de la venta. */
const RANGO_DE_ROL: Record<string, number> = {
  VENDOR: 3,
  AMBASSADOR: 2,
  INFLUENCER: 1,
};

/** Un registro dado de baja (CHURNED) solo gana si no hay ninguno vivo del mismo rol. */
const ESTADOS_VIVOS = new Set(['SIGNED_UP', 'ACTIVE', 'PAYING']);

export type UsoParaElegir = {
  createdAt: Date | string;
  /** Si no se seleccionó, se da por vivo. */
  status?: string | null;
  referralCode: { role: string };
};

/**
 * El registro (`ReferralUse`) de la persona que VENDIÓ el negocio.
 *
 * Orden: rol (vendedor > embajador > influencer), luego vivo antes que dado de
 * baja, luego el más reciente. Los roles que no venden (SOCIO) no cuentan.
 *
 * El rol va primero porque el parent-use del influencer es SIEMPRE posterior al
 * registro de su embajador (se crea al generar la primera indirecta): ordenar
 * por fecha lo hacía ganar en cada renovación.
 */
export function elegirUsoQueVendio<T extends UsoParaElegir>(
  usos: readonly T[],
): T | null {
  const vivo = (u: T) => u.status == null || ESTADOS_VIVOS.has(u.status);
  const candidatos = usos.filter((u) => RANGO_DE_ROL[u.referralCode.role] != null);
  if (!candidatos.length) return null;
  return candidatos.slice().sort((a, b) => {
    const r = RANGO_DE_ROL[b.referralCode.role] - RANGO_DE_ROL[a.referralCode.role];
    if (r !== 0) return r;
    const v = Number(vivo(b)) - Number(vivo(a));
    if (v !== 0) return v;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  })[0];
}

type Pct = number | string | { toString(): string } | null | undefined;

type CodigoBasico = {
  id: string;
  role: string;
  commissionPercent: Pct;
  maxCommissionPercent?: Pct;
};

export type CodigoConSuperiores = CodigoBasico & {
  parentCode?: CodigoBasico | null;
  parentEmbajadorCode?: (CodigoBasico & { parentCode?: CodigoBasico | null }) | null;
};

export type CadenaDeComision = {
  influencer: { id: string; commissionPercent: number } | null;
  embajador: { id: string; commissionPercent: number; maxCommissionPercent: number } | null;
  vendor: { id: string; commissionPercent: number } | null;
  sourceCodeId: string | null;
};

export const CADENA_VACIA: CadenaDeComision = {
  influencer: null,
  embajador: null,
  vendor: null,
  sourceCodeId: null,
};

const num = (v: Pct) => Number(v ?? 0);
const tope = (v: Pct) => (v ? Number(v) : 25);

/**
 * La cadena de atribución que sale del código que vendió.
 *
 *  · VENDEDOR bajo EMBAJADOR → vendedor + embajador + (influencer del embajador).
 *  · VENDEDOR directo bajo un INFLUENCER → el influencer ocupa el hueco del
 *    embajador: es quien comparte su % con el vendedor, y así el reparto le
 *    resta el % del vendedor sin una fórmula aparte.
 *  · EMBAJADOR → embajador + (su influencer, que cobrará INDIRECTA).
 *  · INFLUENCER (o un vendedor sin superior) → solo él, a su % completo.
 */
export function cadenaDelCodigo(code: CodigoConSuperiores): CadenaDeComision {
  const sourceCodeId = code.id;
  if (code.role === 'VENDOR' && code.parentEmbajadorCode) {
    const parent = code.parentEmbajadorCode;
    const vendor = { id: code.id, commissionPercent: num(code.commissionPercent) };
    if (parent.role === 'INFLUENCER') {
      return {
        influencer: null,
        embajador: {
          id: parent.id,
          commissionPercent: num(parent.commissionPercent),
          maxCommissionPercent: tope(parent.maxCommissionPercent),
        },
        vendor,
        sourceCodeId,
      };
    }
    const inf = parent.parentCode ?? null;
    return {
      influencer: inf ? { id: inf.id, commissionPercent: num(inf.commissionPercent) } : null,
      embajador: {
        id: parent.id,
        commissionPercent: num(parent.commissionPercent),
        maxCommissionPercent: tope(parent.maxCommissionPercent),
      },
      vendor,
      sourceCodeId,
    };
  }
  if (code.role === 'AMBASSADOR') {
    const inf = code.parentCode ?? null;
    return {
      influencer: inf ? { id: inf.id, commissionPercent: num(inf.commissionPercent) } : null,
      embajador: {
        id: code.id,
        commissionPercent: num(code.commissionPercent),
        maxCommissionPercent: tope(code.maxCommissionPercent),
      },
      vendor: null,
      sourceCodeId,
    };
  }
  return {
    influencer: { id: code.id, commissionPercent: num(code.commissionPercent) },
    embajador: null,
    vendor: null,
    sourceCodeId,
  };
}

/**
 * El % del influencer ANTES de mirar excepciones: el suyo completo solo si la
 * venta la hizo él; si entró por un embajador o un vendedor, el indirecto.
 */
export function pctDePartidaDelInfluencer(
  cadena: CadenaDeComision,
  pctIndirecto: number,
): number {
  if (!cadena.influencer) return 0;
  return cadena.influencer.id === cadena.sourceCodeId
    ? cadena.influencer.commissionPercent
    : pctIndirecto;
}

/** La venta la hizo el propio influencer (cobra su % completo, sin indirecta). */
export function esVentaDirectaDelInfluencer(cadena: CadenaDeComision): boolean {
  return !!cadena.influencer && cadena.influencer.id === cadena.sourceCodeId;
}

export type FilaDeReparto = {
  recipientCodeId: string;
  vendorCodeId: string | null;
  amount: number;
  appliedPercent: number;
  /**
   * Regla de colaborador (`ReglaComisionColaborador`) de la que salió el monto
   * de esta fila. Se guarda en la comisión: una fila con regla no la recalcula
   * nadie, porque el recálculo no conoce reglas.
   */
  reglaId?: string | null;
};

/**
 * Monto FIJO (USD) que una regla de colaborador le pone a un miembro de la
 * cadena, en vez de su %. Ver `reglas-de-comision.ts`.
 */
export type FijosDelReparto = {
  influencer?: number | null;
  embajador?: number | null;
  vendor?: number | null;
};

export type ReglasDelReparto = {
  influencer?: string | null;
  embajador?: string | null;
  vendor?: string | null;
};

export type ModoDeRepartoDeComision =
  | 'DISCOUNT_FROM_INFLUENCER'
  | 'ADDITIONAL_COMPANY_COMMISSION';

/**
 * Reparte `base` entre influencer / embajador / vendedor con los porcentajes
 * YA resueltos (excepciones por negocio incluidas).
 *
 *  · **El vendedor sale de la tajada del embajador** (modo DISCOUNT, el de por
 *    defecto): su % nunca excede el del embajador y al embajador se le resta.
 *    En modo ADDITIONAL el vendedor es un costo extra de la empresa: el
 *    embajador conserva su % completo.
 *  · **Una fila con importe 0 no se crea.** Un beneficiario al 0 % no es una
 *    comisión de $0, es que no le toca nada.
 *  · **El redondeo es `Math.round(base × pct) / 100`**, la forma exacta que
 *    usa el motor desde siempre (no se cambia para no mover centavos).
 */
export function repartoDeComision(args: {
  base: number;
  cadena: {
    influencer: { id: string } | null;
    embajador: { id: string } | null;
    vendor: { id: string } | null;
  };
  influencerPct: number;
  embajadorPct: number;
  /** % del vendedor SIN acotar al del embajador (se acota aquí). */
  vendorPctCrudo: number;
  modo: ModoDeRepartoDeComision | string;
  /** Montos fijos por regla de colaborador. Sin ninguno, la cuenta de siempre. */
  fijos?: FijosDelReparto;
  /** Regla de la que sale cada miembro (fija o %), para etiquetar su fila. */
  reglas?: ReglasDelReparto;
}): FilaDeReparto[] {
  const { base, cadena, influencerPct, embajadorPct, modo } = args;
  const filas: FilaDeReparto[] = [];
  if (!(base > 0)) return filas;
  const fijos = args.fijos ?? {};
  // Con algún monto fijo la cuenta se hace en DINERO; sin ninguno, en
  // porcentajes, exactamente como siempre (no se mueve un centavo de lo actual).
  if ([fijos.influencer, fijos.embajador, fijos.vendor].some((v) => v != null)) {
    return repartoConFijos({ ...args, fijos });
  }
  const regla = args.reglas ?? {};

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
      ...conRegla(regla.influencer),
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
        // El embajador queda «con regla» también si la regla era del vendedor:
        // su parte es la resta, y un recálculo sin la regla la cambiaría.
        ...conRegla(regla.embajador ?? (!adicional && vendorPct > 0 ? regla.vendor : null)),
      });
    }
  }
  if (cadena.vendor && vendorPct > 0) {
    filas.push({
      recipientCodeId: cadena.vendor.id,
      vendorCodeId: cadena.vendor.id,
      amount: Math.round(base * vendorPct) / 100,
      appliedPercent: vendorPct,
      ...conRegla(regla.vendor),
    });
  }
  return filas;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** La propiedad solo existe si hay regla: las filas de siempre no cambian de forma. */
function conRegla(reglaId: string | null | undefined): { reglaId?: string } {
  return reglaId ? { reglaId } : {};
}

/**
 * El mismo reparto cuando alguna regla pone un monto FIJO. Las reglas del
 * reparto no cambian, solo la unidad:
 *  · el vendedor sigue saliendo de la tajada del embajador (modo DISCOUNT) y
 *    nunca la excede;
 *  · una fila de $0 no se crea.
 * `appliedPercent` de una fila fija es el % equivalente (informativo, para el
 * panel): lo que manda es el monto, y por eso la fila lleva su `reglaId`.
 */
function repartoConFijos(args: {
  base: number;
  cadena: { influencer: { id: string } | null; embajador: { id: string } | null; vendor: { id: string } | null };
  influencerPct: number;
  embajadorPct: number;
  vendorPctCrudo: number;
  modo: ModoDeRepartoDeComision | string;
  fijos: FijosDelReparto;
  reglas?: ReglasDelReparto;
}): FilaDeReparto[] {
  const { base, cadena, fijos } = args;
  const regla = args.reglas ?? {};
  const adicional = args.modo === 'ADDITIONAL_COMPANY_COMMISSION';
  const pctDe = (monto: number) => Math.min(999.99, r2((monto / base) * 100));
  const monto = (fijo: number | null | undefined, pct: number) =>
    fijo != null ? r2(Math.max(0, fijo)) : Math.round(base * pct) / 100;
  const filas: FilaDeReparto[] = [];

  if (cadena.influencer) {
    const m = monto(fijos.influencer, args.influencerPct);
    if (m > 0) {
      filas.push({
        recipientCodeId: cadena.influencer.id,
        vendorCodeId: null,
        amount: m,
        appliedPercent: fijos.influencer != null ? pctDe(m) : args.influencerPct,
        ...conRegla(regla.influencer),
      });
    }
  }
  let vendorMonto = cadena.vendor ? monto(fijos.vendor, args.vendorPctCrudo) : 0;
  if (cadena.embajador) {
    const bruto = monto(fijos.embajador, args.embajadorPct);
    if (!adicional) vendorMonto = Math.min(vendorMonto, bruto);
    const efectivo = adicional ? bruto : r2(Math.max(0, bruto - vendorMonto));
    if (efectivo > 0) {
      filas.push({
        recipientCodeId: cadena.embajador.id,
        vendorCodeId: null,
        amount: efectivo,
        appliedPercent: pctDe(efectivo),
        ...conRegla(regla.embajador ?? (!adicional && vendorMonto > 0 ? regla.vendor : null)),
      });
    }
  }
  if (cadena.vendor && vendorMonto > 0) {
    filas.push({
      recipientCodeId: cadena.vendor.id,
      vendorCodeId: cadena.vendor.id,
      amount: vendorMonto,
      appliedPercent: pctDe(vendorMonto),
      ...conRegla(regla.vendor),
    });
  }
  return filas;
}
