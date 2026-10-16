/**
 * «Pendientes por asignar vendedor» y «Venta directa» (Javier, 2026-10-16).
 *
 * EL CASO QUE LO PIDE: Habibi Bar Cantina pagó $432 por fuera el 16-sep y $68
 * por Hotmart el 17-sep, y no tiene ningún `ReferralUse`. Nadie se enteró de
 * que faltaba decir quién lo vendió: el aviso viejo («Negocios sin afiliado»)
 * solo miraba negocios ACTIVOS con suscripción de Hotmart, así que un cobro
 * manual no lo hacía aparecer. Y no había forma de decir «esto lo vendió la
 * empresa, no le toca comisión a nadie»: un negocio así se quedaba en el aviso
 * para siempre.
 *
 * Aquí vive la regla pura (sin base de datos) para poder probarla sola.
 */
import { tieneAfiliadoQueCobra, type NegocioParaAtribucion } from './sin-afiliado';

/**
 * Código de la plataforma que marca un negocio como VENTA DIRECTA.
 *
 * Por qué un `ReferralCode` y no una columna nueva en `Tenant`: todos los
 * caminos que ya preguntan «¿quién vendió este negocio?» miran `ReferralUse`
 * (la ficha, el arqueo, la cadena de atribución, el webhook). Con un código
 * especial, el negocio queda «asignado» para todos ellos sin tocar el esquema,
 * y pasarlo luego a un vendedor real es la misma reasignación de siempre.
 *
 * El guion bajo no es estético: el webhook de Hotmart solo acepta como código
 * de afiliado `^[A-Z0-9]{4,20}$`, y el código no tiene `slug`, así que nadie
 * puede «registrarse» con él desde un enlace.
 */
export const CODIGO_VENTA_DIRECTA = 'VENTA_DIRECTA';

/**
 * Cómo nace el código de venta directa.
 *
 * ROL `VENDOR` A PROPÓSITO, no `AMBASSADOR` ni `INFLUENCER`. Es lo que hace que
 * no se genere comisión por NINGÚN camino:
 *
 *  - El cobro de Hotmart/Stripe/Cross (`HotmartService.generarComisionesDeCobro`)
 *    elige entre dos flujos. El de 3 vías (`generateCommissionsForPayment`)
 *    solo crea filas con % > 0, y un VENDOR sin padre cae en la rama
 *    «influencer directo» de `getAttributionChain` con su 0 % → cero filas. El
 *    flujo de embajador/influencer (`generateReferralCommission`) busca solo
 *    atribuciones INFLUENCER/AMBASSADOR → no encuentra la venta directa → no
 *    crea comisión directa. Por cualquiera de los dos: nada.
 *  - La comisión retroactiva al asignar (`backfillCommissionForAssignment`)
 *    manda a los VENDOR por el generador de 3 vías → cero filas.
 *  - En cambio, la rama de INFLUENCER/AMBASSADOR de esos dos caminos crea la
 *    comisión SIN mirar si el monto es 0: con un código de embajador al 0 %
 *    cada cobro dejaría una comisión de $0,00 en el panel, en los cortes y en
 *    el aviso de venta al «afiliado».
 *  - Lo que SÍ sigue saliendo es la comisión del SOCIO global (si hay uno
 *    configurado en `referrals.socioCodeId`; hoy no lo hay): cobra sobre toda
 *    venta, haya vendedor o no, y no es de quien vendió.
 *  - `getAttributionChain` ordena VENDOR por encima de AMBASSADOR/INFLUENCER:
 *    si quedara colgada una atribución vieja con comisiones PAGADAS (esas no se
 *    borran al reasignar), la venta directa sigue mandando y no se le paga al
 *    de antes.
 *
 * INACTIVO: `searchAffiliates`, `listVendors` y el registro público filtran por
 * `isActive`, así que el código no aparece en ningún buscador ni se puede usar
 * al registrarse. Asignarlo es solo por el botón «Venta directa».
 */
export const DATOS_CODIGO_VENTA_DIRECTA = {
  code: CODIGO_VENTA_DIRECTA,
  slug: null,
  ownerName: 'Venta directa (empresa)',
  // Sin correo ni WhatsApp reales: este «afiliado» no recibe avisos. Además, al
  // no generar comisiones, el aviso de venta al afiliado no tiene de qué saltar.
  ownerEmail: 'venta-directa@invalid.local',
  ownerWhatsapp: '',
  role: 'VENDOR' as const,
  commissionPercent: 0,
  fixedCommissionUsd: null,
  parentCodeId: null,
  parentEmbajadorCodeId: null,
  campaignId: null,
  allowVendors: false,
  isActive: false,
  source: 'venta-directa',
};

/** ¿Es este el código de venta directa? */
export function esCodigoVentaDirecta(code: string | null | undefined): boolean {
  return (code ?? '').trim().toUpperCase() === CODIGO_VENTA_DIRECTA;
}

/**
 * ¿El código que ya existe en la base es seguro de usar como venta directa?
 *
 * Si alguien lo editó y le puso un %, o lo colgó de un embajador, asignarlo
 * pagaría comisión: mejor negarse que pagarle a quien no vendió.
 */
export function codigoVentaDirectaEsSeguro(c: {
  role: string;
  commissionPercent: unknown;
  fixedCommissionUsd?: unknown;
  parentCodeId?: string | null;
  parentEmbajadorCodeId?: string | null;
}): boolean {
  if (c.role !== 'VENDOR') return false;
  if (Number(c.commissionPercent ?? 0) !== 0) return false;
  if (c.fixedCommissionUsd != null && Number(c.fixedCommissionUsd) !== 0) return false;
  if (c.parentCodeId || c.parentEmbajadorCodeId) return false;
  return true;
}

/**
 * Suscripción real de pasarela. Los prefijos son altas sin cobro (cortesía,
 * prueba, manual sin pago, marca blanca, simulación, campaña): mismo filtro que
 * el aviso viejo de `listUnattributedBusinesses`.
 */
export function esSuscripcionReal(hotmartSubscriberCode: string | null | undefined): boolean {
  return (
    !!hotmartSubscriberCode &&
    !/^(comp-|trial-|manual-|wl-|sim-|campaign-)/i.test(hotmartSubscriberCode)
  );
}

/**
 * ¿Este negocio le ha pagado algo a la plataforma?
 *
 * - Un cobro PAGADO en Contabilidad (`IncomeRecord`) — Hotmart, Stripe, Cross o
 *   pago manual —. Es lo que faltaba: Habibi entró por un pago manual.
 * - O, para los negocios de antes de Contabilidad, estar ACTIVO con una
 *   suscripción real de pasarela (lo que miraba el aviso viejo, para no perder
 *   a nadie de los que ya salían).
 *
 * `lastChargeAt` sola NO cuenta: una activación gratuita también la escribe
 * (ver `backfillCommissionForAssignment`), y metería en la lista negocios que
 * nunca pagaron.
 */
export function haCobrado(n: {
  cobrosPagados: number;
  status: string;
  hotmartSubscriberCode?: string | null;
}): boolean {
  if (n.cobrosPagados > 0) return true;
  return n.status === 'ACTIVE' && esSuscripcionReal(n.hotmartSubscriberCode);
}

export type NegocioParaPendiente = NegocioParaAtribucion & {
  /** Ver `haCobrado`. */
  haCobrado: boolean;
  /** Tiene un `ReferralUse` con el código de venta directa. */
  ventaDirecta: boolean;
};

/**
 * El negocio va en «Pendientes por asignar vendedor»: pagó, no está marcado
 * como venta directa y nadie cobra comisión por él (ni directo ni por su grupo
 * empresarial — ver `tieneAfiliadoQueCobra`, que ya distingue el código
 * desactivado y el grupo sin recipiente).
 *
 * El `ReferralUse` del SOCIO no cuenta como asignación: el socio cobra sobre
 * toda venta y existe en casi todos los negocios, así que tenerlo no dice quién
 * vendió. `atribuidoDirecto` solo se calcula con influencer/embajador/vendedor.
 */
export function esPendientePorAsignar(n: NegocioParaPendiente): boolean {
  if (!n.haCobrado) return false;
  if (n.ventaDirecta) return false;
  return !tieneAfiliadoQueCobra(n);
}

export type CobroDelLibro = {
  saleDate: Date;
  grossUsd: number;
  gateway: string;
};

/** El primer cobro (por fecha de venta) — el que dice cuándo entró el negocio. */
export function primerCobro<T extends CobroDelLibro>(cobros: T[]): T | null {
  let primero: T | null = null;
  for (const c of cobros) {
    if (!primero || c.saleDate.getTime() < primero.saleDate.getTime()) primero = c;
  }
  return primero;
}

/**
 * ¿La atribución cuenta como «alguien cobra por este negocio»?
 *
 * Igual que la consulta del aviso viejo: solo influencer/embajador/vendedor
 * con el código ACTIVO. La venta directa se cuenta aparte (su código está
 * inactivo a propósito y no es un vendedor).
 */
export function esAtribucionQueCobra(codigo: {
  code: string;
  role: string;
  isActive: boolean;
}): boolean {
  if (esCodigoVentaDirecta(codigo.code)) return false;
  if (!codigo.isActive) return false;
  return codigo.role === 'INFLUENCER' || codigo.role === 'AMBASSADOR' || codigo.role === 'VENDOR';
}
