/**
 * REGLAS DE COMISIÓN — el núcleo PURO (sin base de datos) de dos cosas:
 *
 *  1. PARTICIPACIONES GLOBALES: «X cobra Y sobre las ventas de Clubify»,
 *     ADICIONAL a la comisión de quien vendió. Reglas del dueño (2026-10-17):
 *       · Javier, socio comercial: 10 %.
 *       · Sara Plata (MJUBQ8H8): 2 %, ADEMÁS de su comisión de equipo.
 *     Una venta de $100 con closer al 5 % da Javier $10 + Sara $2 + closer $5:
 *     $17 de comisiones sobre $100 vendidos. El valor vendido NO se duplica:
 *     las participaciones salen del mismo cobro, no crean ventas.
 *
 *  2. REGLAS POR COLABORADOR: por encima del `commissionPercent` del código
 *     (fija, distinta para nueva o renovación, por periodicidad, por plan,
 *     con vigencia). Debajo de la excepción por cliente, que sigue ganando.
 *
 * Lo que comparten —«¿esta regla aplica a esta venta?»— vive aquí una sola vez.
 * Lo usan el webhook (vía el motor), el cron, el backfill (`scripts/
 * backfill-participaciones.cjs` carga ESTE archivo con ts-node, no una copia) y
 * las pruebas. Dos copias de esta lógica habrían discrepado la primera vez que
 * alguien tocara la vigencia.
 *
 * Regla que sostiene todo: una regla solo se lee al CREAR una comisión. Cambiar
 * un % no reescribe nada: cada comisión guarda la base y el % con que nació
 * (`baseAmountUsd`, `appliedPercent`).
 */

export type TipoDeVenta = 'NUEVA' | 'RENOVACION' | 'UPGRADE';
export type TipoDeRegla = 'PORCENTAJE' | 'FIJO';
export type AplicaA = 'NUEVAS' | 'RENOVACIONES' | 'AMBAS';

export const TIPOS_DE_REGLA: readonly TipoDeRegla[] = ['PORCENTAJE', 'FIJO'];
export const APLICA_A: readonly AplicaA[] = ['NUEVAS', 'RENOVACIONES', 'AMBAS'];
export const PERIODICIDADES = ['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'] as const;

/** Prefijo del `periodKey` de una participación. Ver `comisiones-de-monto-libre.ts`. */
export const PREFIJO_PARTICIPACION = 'PART-';

type Num = number | string | { toString(): string };

/** Lo que tienen en común las dos clases de regla. */
export type FiltrosDeRegla = {
  activo: boolean;
  aplicaA: string;
  periodicidades?: readonly string[] | null;
  planIds?: readonly string[] | null;
  vigenteDesde?: Date | string | null;
  /** Exclusiva: la venta tiene que ser ANTERIOR a esta fecha. */
  vigenteHasta?: Date | string | null;
};

export type VentaParaRegla = {
  fecha: Date;
  tipo: TipoDeVenta;
  periodicidad?: string | null;
  planId?: string | null;
};

const fecha = (d: Date | string | null | undefined): Date | null =>
  d == null ? null : new Date(d);

/**
 * ¿La regla cubre esa clase de venta?
 *
 * El UPGRADE cuenta como venta NUEVA: es dinero nuevo de un cliente que compra
 * más plan, no la recurrencia de lo que ya pagaba. El dueño solo habló de
 * «nuevas y renovaciones»; si algún día quiere tratarlo aparte, es este `if`.
 */
export function cubreElTipo(aplicaA: string, tipo: TipoDeVenta): boolean {
  if (aplicaA === 'AMBAS') return true;
  if (aplicaA === 'RENOVACIONES') return tipo === 'RENOVACION';
  if (aplicaA === 'NUEVAS') return tipo === 'NUEVA' || tipo === 'UPGRADE';
  // Un valor desconocido no aplica: mejor no pagar que pagar por un typo.
  return false;
}

/** Vigencia: desde inclusiva, hasta exclusiva. null = abierta por ese lado. */
export function estaVigente(r: Pick<FiltrosDeRegla, 'vigenteDesde' | 'vigenteHasta'>, cuando: Date): boolean {
  const desde = fecha(r.vigenteDesde);
  const hasta = fecha(r.vigenteHasta);
  if (desde && cuando.getTime() < desde.getTime()) return false;
  if (hasta && cuando.getTime() >= hasta.getTime()) return false;
  return true;
}

const enLista = (lista: readonly string[] | null | undefined, valor: string | null | undefined) =>
  !lista || lista.length === 0 || (!!valor && lista.map((x) => x.toUpperCase()).includes(valor.toUpperCase()));

/** ¿La regla aplica a esta venta? (activa, tipo, vigencia, periodicidad, plan) */
export function coincideConLaVenta(r: FiltrosDeRegla, v: VentaParaRegla): boolean {
  if (!r.activo) return false;
  if (!cubreElTipo(r.aplicaA, v.tipo)) return false;
  if (!estaVigente(r, v.fecha)) return false;
  // Con filtro de periodicidad, una venta SIN periodicidad conocida no entra:
  // no sabemos si es la que la regla quiere.
  if (!enLista(r.periodicidades, v.periodicidad ?? null)) return false;
  if (r.planIds && r.planIds.length > 0 && !(v.planId && r.planIds.includes(v.planId))) return false;
  return true;
}

/**
 * El monto de una regla sobre una base. Mismo redondeo que el motor de
 * siempre (`Math.round(base × pct) / 100`), para no mover centavos.
 *
 * FIJO: el monto tal cual; `appliedPercent` queda en null porque no hubo %.
 */
export function montoDeLaRegla(
  r: { tipo: string; valor: Num },
  base: number,
): { amount: number; appliedPercent: number | null } {
  const valor = Number(r.valor);
  if (!Number.isFinite(valor) || valor <= 0) return { amount: 0, appliedPercent: null };
  if (r.tipo === 'FIJO') return { amount: Math.round(valor * 100) / 100, appliedPercent: null };
  if (!(base > 0)) return { amount: 0, appliedPercent: valor };
  return { amount: Math.round(base * valor) / 100, appliedPercent: valor };
}

// ─────────────────────────────────────────────────────────────────────────────
//  PARTICIPACIONES GLOBALES
// ─────────────────────────────────────────────────────────────────────────────

export type ReglaDeParticipacion = FiltrosDeRegla & {
  id: string;
  nombre: string;
  beneficiarioCodeId: string;
  tipo: string;
  valor: Num;
  negociosIncluidos?: readonly string[] | null;
  negociosExcluidos?: readonly string[] | null;
  createdAt?: Date | string | null;
};

/** Por qué una venta NO genera participaciones. Se enseña en el backfill. */
export type MotivoDeExclusion =
  | 'REEMBOLSADA'
  | 'NO_PAGADA'
  | 'MARCA_BLANCA'
  | 'NO_ES_VENTA_DE_PLAN'
  | 'SIN_NEGOCIO'
  | 'SIN_PRECIO_DE_PLAN';

export const MOTIVOS_DE_EXCLUSION: Record<MotivoDeExclusion, string> = {
  REEMBOLSADA: 'Reembolsada o cancelada',
  NO_PAGADA: 'No confirmada como pagada (en revisión o intermediada)',
  MARCA_BLANCA: 'Venta de una marca blanca (el cobro no es de Clubify)',
  NO_ES_VENTA_DE_PLAN: 'No es venta de un plan (créditos, implementación, servicio)',
  SIN_NEGOCIO: 'Sin negocio ni grupo identificado',
  SIN_PRECIO_DE_PLAN: 'Sin precio de plan del que calcular',
};

/** Un cobro del libro de ingresos, ya resuelto (base, marca, tipo). */
export type VentaParaParticipar = {
  ingresoId: string;
  /** Estado del IncomeRecord: PAGADO | REEMBOLSADO | CANCELADO | EN_REVISION | INTERMEDIADO */
  estado: string;
  /** NUEVA | RENOVACION | UPGRADE; null = no es una venta de plan (OTRO, MARCA_BLANCA). */
  tipo: TipoDeVenta | null;
  /** El dinero lo recibe Clubify (ni el ingreso ni el negocio son de una marca blanca, y no lo pagó una marca). */
  esDeClubify: boolean;
  tenantId: string | null;
  businessGroupId?: string | null;
  fecha: Date;
  periodicidad?: string | null;
  planId?: string | null;
  /** Precio pactado del plan en USD. null = no se pudo saber. */
  baseUsd: number | null;
};

export type FilaDeParticipacion = {
  participacionId: string;
  recipientCodeId: string;
  ingresoId: string;
  amount: number;
  baseAmountUsd: number;
  appliedPercent: number | null;
};

/** El primer motivo por el que la venta no participa, o null si participa. */
export function exclusionDeLaVenta(v: VentaParaParticipar): MotivoDeExclusion | null {
  if (v.estado === 'REEMBOLSADO' || v.estado === 'CANCELADO') return 'REEMBOLSADA';
  if (v.estado !== 'PAGADO') return 'NO_PAGADA';
  if (!v.esDeClubify) return 'MARCA_BLANCA';
  if (!v.tipo) return 'NO_ES_VENTA_DE_PLAN';
  if (!v.tenantId && !v.businessGroupId) return 'SIN_NEGOCIO';
  if (v.baseUsd == null || !(v.baseUsd > 0)) return 'SIN_PRECIO_DE_PLAN';
  return null;
}

/** Filtros de negocio de una participación (solo uno / todos menos). */
function cubreElNegocio(r: ReglaDeParticipacion, tenantId: string | null): boolean {
  if (r.negociosExcluidos?.length && tenantId && r.negociosExcluidos.includes(tenantId)) return false;
  if (r.negociosIncluidos?.length && !(tenantId && r.negociosIncluidos.includes(tenantId))) return false;
  return true;
}

/**
 * LA FUNCIÓN: las comisiones de participación que genera UNA venta.
 *
 * Pura: no sabe de dedup. El dedup lo pone la base (UNIQUE participacionId +
 * ingresoId), así que llamarla dos veces con el mismo cobro produce las mismas
 * filas y la segunda escritura no inserta nada.
 *
 * `soloVigentesEnVivo`: el cron y el webhook solo aplican una regla a los
 * cobros que llegaron DESPUÉS de crearla. Lo de antes —aunque la regla diga
 * «desde siempre»— lo decide un humano con el backfill: si no, crear una regla
 * hoy generaría en silencio las participaciones de los últimos días.
 */
export function comisionesDeParticipaciones(
  venta: VentaParaParticipar,
  reglas: readonly ReglaDeParticipacion[],
  opts: { soloVigentesEnVivo?: { ingresoCreadoEl: Date } } = {},
): { filas: FilaDeParticipacion[]; exclusion: MotivoDeExclusion | null } {
  const exclusion = exclusionDeLaVenta(venta);
  if (exclusion) return { filas: [], exclusion };
  const base = venta.baseUsd as number;
  const filas: FilaDeParticipacion[] = [];
  for (const r of reglas) {
    if (!coincideConLaVenta(r, { fecha: venta.fecha, tipo: venta.tipo as TipoDeVenta, periodicidad: venta.periodicidad, planId: venta.planId })) continue;
    if (!cubreElNegocio(r, venta.tenantId)) continue;
    if (opts.soloVigentesEnVivo && r.createdAt) {
      const creada = new Date(r.createdAt).getTime();
      const llego = Math.max(opts.soloVigentesEnVivo.ingresoCreadoEl.getTime(), venta.fecha.getTime());
      if (llego < creada) continue;
    }
    const { amount, appliedPercent } = montoDeLaRegla(r, base);
    // Una fila de $0 no es una comisión: es que no le toca nada.
    if (!(amount > 0)) continue;
    filas.push({
      participacionId: r.id,
      recipientCodeId: r.beneficiarioCodeId,
      ingresoId: venta.ingresoId,
      amount,
      baseAmountUsd: base,
      appliedPercent,
    });
  }
  return { filas, exclusion: null };
}

/**
 * El precio PACTADO del plan de un cobro, en USD. Nunca lo cobrado en moneda
 * local ni el neto (memoria «base = precio pactado»).
 *
 * Orden, del dato más fiel al menos:
 *  1. La base con la que NACIÓ la comisión del vendedor de ESE cobro. Es la que
 *     ya usó el motor (override del negocio o enlace de oferta), congelada.
 *  2. UPGRADE: lo que se pagó por el cambio (la comisión del upgrade sale de
 *     ahí, no del precio de lista del plan nuevo).
 *  3. Grupo empresarial: su precio; si no, el canónico de su periodicidad.
 *  4. El override del negocio (`subscriptionPriceUsd`), SOLO si el cobro es de
 *     la periodicidad que el negocio tiene hoy: tras un upgrade, el precio de
 *     hoy no es el de los cobros viejos.
 *  5. El canónico de la periodicidad del cobro (68/150/278/500).
 */
export function basePactadaDelCobro(args: {
  baseDeLaComisionDelCobro?: number | null;
  tipo: TipoDeVenta | null;
  grossUsd: number;
  periodicidadDelCobro?: string | null;
  grupo?: { priceUsd?: number | null; planPeriodicity?: string | null } | null;
  negocio?: { subscriptionPriceUsd?: number | null; planPeriodicity?: string | null } | null;
  canonico: (periodicidad: string | null) => number;
}): number | null {
  const pos = (n: number | null | undefined) => (n != null && Number.isFinite(n) && n > 0 ? n : null);
  const congelada = pos(args.baseDeLaComisionDelCobro);
  if (congelada) return congelada;
  if (args.tipo === 'UPGRADE') return pos(args.grossUsd);
  if (args.grupo) {
    return pos(args.grupo.priceUsd) ?? pos(args.canonico(args.periodicidadDelCobro ?? args.grupo.planPeriodicity ?? null));
  }
  const per = args.periodicidadDelCobro ?? args.negocio?.planPeriodicity ?? null;
  const override = pos(args.negocio?.subscriptionPriceUsd);
  const mismaPeriodicidad =
    !args.periodicidadDelCobro ||
    !args.negocio?.planPeriodicity ||
    args.periodicidadDelCobro.toUpperCase() === args.negocio.planPeriodicity.toUpperCase();
  if (override && mismaPeriodicidad) return override;
  // Sin periodicidad en ningún lado no se inventa una: «MENSUAL por defecto»
  // es justo el error que convertía planes desconocidos en $68.
  if (!per) return null;
  return pos(args.canonico(per));
}

/** Clase de venta a partir de la categoría del libro. OTRO / MARCA_BLANCA → null. */
export function tipoDeVentaDeLaCategoria(categoria: string | null | undefined, isFirstPayment?: boolean): TipoDeVenta | null {
  if (categoria === 'NUEVA' || categoria === 'RENOVACION' || categoria === 'UPGRADE') return categoria;
  if (categoria == null) return isFirstPayment ? 'NUEVA' : 'RENOVACION';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  REGLAS POR COLABORADOR
// ─────────────────────────────────────────────────────────────────────────────

export type ReglaDeColaborador = FiltrosDeRegla & {
  id: string;
  codeId: string;
  prioridad: number;
  tipo: string;
  valor: Num;
  createdAt?: Date | string | null;
};

const especificidad = (r: FiltrosDeRegla) =>
  (r.aplicaA !== 'AMBAS' ? 1 : 0) +
  (r.periodicidades?.length ? 1 : 0) +
  (r.planIds?.length ? 1 : 0) +
  (r.vigenteDesde || r.vigenteHasta ? 1 : 0);

/**
 * La regla que manda para un colaborador en una venta, o null (entonces el
 * código cobra su `commissionPercent` de siempre).
 *
 * Orden: mayor prioridad; a igualdad, la más específica (una «renovaciones
 * anuales» gana a una «todas»); a igualdad, la más nueva.
 */
export function elegirReglaDeColaborador<T extends ReglaDeColaborador>(
  reglas: readonly T[],
  codeId: string,
  venta: VentaParaRegla,
): T | null {
  const candidatas = reglas.filter((r) => r.codeId === codeId && coincideConLaVenta(r, venta));
  if (!candidatas.length) return null;
  return candidatas.slice().sort((a, b) => {
    if (b.prioridad !== a.prioridad) return b.prioridad - a.prioridad;
    const e = especificidad(b) - especificidad(a);
    if (e !== 0) return e;
    return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
  })[0];
}

/** Lo que una regla le cambia a un miembro de la cadena en el reparto. */
export type AjusteDeRegla = { reglaId: string; pct?: number; fijo?: number };

export function ajusteDeLaRegla(r: Pick<ReglaDeColaborador, 'id' | 'tipo' | 'valor'>): AjusteDeRegla | null {
  const valor = Number(r.valor);
  if (!Number.isFinite(valor) || valor < 0) return null;
  return r.tipo === 'FIJO' ? { reglaId: r.id, fijo: Math.round(valor * 100) / 100 } : { reglaId: r.id, pct: valor };
}
