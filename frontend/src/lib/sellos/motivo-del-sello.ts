import type { useTranslations } from 'next-intl';

/**
 * Cómo se le cuenta al negocio un movimiento de sellos: «Sello» en vez de
 * `STAMP`, y por qué se dio («Cortesía», «Fecha especial», «Canje de premio»,
 * «Por pedido ABC123», «Compra»…) con quién lo dio y en qué sede.
 *
 * Lo usan la ficha del cliente (Actividad de sellos) y la exportación a
 * Excel/CSV, para que las dos digan exactamente lo mismo. Los textos viven en
 * `app_customers_id`.
 */
export type TraductorDeSellos = ReturnType<typeof useTranslations<'app_customers_id'>>;

export type SelloConMotivo = {
  action: string;
  note?: string | null;
  /** COURTESY | SPECIAL_DATE cuando el sello fue regalado. */
  giftReason?: string | null;
  /** COUPON | REWARD en un canje. */
  redeemKind?: string | null;
  orderId?: string | null;
  operator?: { fullName: string } | null;
  location?: { name: string } | null;
  order?: { code: string } | null;
};

const ACCIONES_DE_SELLO = new Set([
  'STAMP', 'VISIT', 'REDEEM', 'POINTS_ADD', 'POINTS_DEDUCT', 'REFUND',
  'CASHBACK_ADD', 'CASHBACK_REDEEM', 'STAMP_REMOVE',
]);

/** Nota que escribe el motor de automatizaciones; no es texto del negocio. */
const NOTA_AUTOMATICA = 'Por automation';

/** «Sello», «Canje», «Visita»… en vez del código interno (STAMP, REDEEM). */
export function tituloDelSello(s: SelloConMotivo, t: TraductorDeSellos): string {
  return ACCIONES_DE_SELLO.has(s.action) ? t(`act_${s.action}` as never) : s.action;
}

/** Solo el porqué: regalo, canje, pedido; o compra / escaneo si no hay más. */
export function motivoBase(
  s: SelloConMotivo,
  monto: number | null,
  t: TraductorDeSellos,
): string[] {
  const partes: string[] = [];
  if (s.giftReason === 'COURTESY') partes.push(t('reason_COURTESY'));
  else if (s.giftReason === 'SPECIAL_DATE') partes.push(t('reason_SPECIAL_DATE'));
  if (s.action === 'REDEEM') {
    if (s.redeemKind === 'COUPON') partes.push(t('reason_COUPON'));
    else if (s.redeemKind === 'REWARD') partes.push(t('reason_REWARD'));
  }
  if (s.orderId) partes.push(t('reason_ORDER', { code: s.order?.code ?? '' }).trim());
  if (partes.length === 0) {
    if (monto && monto > 0) partes.push(t('reason_PURCHASE'));
    else if (s.operator) partes.push(t('reason_SCAN'));
  }
  return partes;
}

/** Nombre del operador, «Automático» si lo hizo el sistema, o nada. */
export function quienDioElSello(s: SelloConMotivo, t: TraductorDeSellos): string {
  if (s.operator?.fullName) return s.operator.fullName;
  if (s.orderId || s.note === NOTA_AUTOMATICA) return t('bySystem');
  return '';
}

/** La nota libre del operador; la del motor de automatizaciones no cuenta. */
export function notaDelSello(s: SelloConMotivo): string {
  return s.note && s.note !== NOTA_AUTOMATICA ? s.note : '';
}

/**
 * Todo en una línea para la ficha: «Cortesía · por Andrés · Sede Centro».
 */
export function motivoDelSello(
  s: SelloConMotivo,
  monto: number | null,
  t: TraductorDeSellos,
): string {
  const partes = motivoBase(s, monto, t);
  if (s.note === NOTA_AUTOMATICA) partes.push(t('reason_AUTOMATION'));
  else if (s.note) partes.push(s.note);
  if (s.operator?.fullName) partes.push(t('byOperator', { name: s.operator.fullName }));
  else if (s.orderId || s.note === NOTA_AUTOMATICA) partes.push(t('bySystem'));
  if (s.location?.name) partes.push(s.location.name);
  return partes.join(' · ');
}
