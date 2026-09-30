/**
 * ¿Una cancelación desconecta el servicio en el acto?
 *
 * La regla de fondo es la decisión de Javier del 2026-09-10: quien pagó hasta
 * el 25 y avisa el 10 sigue hasta el 25. Pero eso protege días PAGADOS: si el
 * último cobro falló (`failedPaymentCount` > 0) o el período ya venció, no
 * queda nada que respetar y se desconecta ya.
 *
 * VALMONT BARBERIA (15-09-2026) canceló después de dos cobros fallidos y se
 * quedaba activo hasta el 13-10 sin haber pagado ese período.
 *
 * Vive en su propio archivo —y no dentro de `hotmart.service`— porque la
 * cancelación entra por DOS puertas y las dos tienen que decidir igual: el
 * webhook de la pasarela y el botón «cancelar» del panel del negocio. Que cada
 * una tuviera su criterio es lo que dejó a LICORES EL AMANECER sin sus últimos
 * tres días pagados (2026-09-23).
 */
/**
 * ¿MANDA LA PASARELA SOBRE ESTE NEGOCIO?
 *
 * Un negocio que no le paga nada a Stripe ni a Hotmart no puede ser suspendido
 * por ellos. Parece obvio y no lo era: la cuenta SELLEA vive del crédito de la
 * marca y no tiene precio de suscripción, pero arrastraba una suscripción de
 * Stripe de antes. El 26 de septiembre llegó su cancelación y la tumbó — la
 * cuenta de la propia marca, apagada por una pasarela a la que no le debe nada.
 *
 * El origen del cobro se lee del prefijo de `hotmartSubscriberCode`, que es el
 * mismo criterio que ya usa el reporte de comisiones para decidir quién aporta
 * dinero: `wl-` (alta con créditos de marca), `comp-` (cortesía), `trial-`,
 * `campaign-`/`sim-` (sistema) y el código vacío NO facturan por pasarela.
 *
 * Y ADEMÁS TIENE QUE NO TENER PRECIO. Un negocio dado de alta con créditos de
 * marca que luego empezó a pagar de verdad sí depende de su pasarela, y a ese
 * la cancelación tiene que afectarle como a cualquiera. Las dos condiciones
 * juntas describen exactamente lo que se quiere proteger: el que no paga nada.
 *
 * Medido en producción el 2026-09-28: en toda la plataforma hay 4 negocios sin
 * cobro por pasarela que arrastran una suscripción atada, y los 4 son de
 * Sellea. Los 81 de Hotmart no tienen ninguna.
 */
export function laPasarelaMandaSobreElNegocio(tenant: {
  hotmartSubscriberCode?: string | null;
  subscriptionPriceUsd?: unknown;
}): boolean {
  const precio = Number(tenant.subscriptionPriceUsd ?? 0);
  if (Number.isFinite(precio) && precio > 0) return true;

  const codigo = (tenant.hotmartSubscriberCode ?? '').trim();
  if (!codigo) return false;
  return !/^(wl-|comp-|trial-|campaign-|sim-)/i.test(codigo);
}

/**
 * ¿Este código es una suscripción REAL de Hotmart, cancelable por su API?
 *
 * Excluye los códigos sembrados por el sistema (`manual-`, `wl-`, `comp-`,
 * `trial-`, `campaign-`, `sim-`) y los de Stripe (`sub_…`): mandarle a la
 * API de Hotmart un código de esos es un 404 seguro — o peor, un silencio
 * que alguien lee como «cancelada».
 */
export function esCodigoHotmartReal(codigo: string | null | undefined): boolean {
  const c = (codigo ?? '').trim();
  if (!c) return false;
  if (/^sub_/i.test(c)) return false;
  return !/^(manual-|wl-|comp-|trial-|campaign-|sim-)/i.test(c);
}

export function desconectaAlCancelar(
  tenant: {
    status?: string | null;
    failedPaymentCount?: number | null;
    currentPeriodEnd?: Date | null;
  },
  ahora: Date,
): boolean {
  // Solo un negocio ACTIVO se desconecta aquí. Uno ya suspendido por mora no
  // necesita otra suspensión (se le pisaría la fecha), y uno en prueba que
  // nunca pagó sigue como antes (Fable, 15-09-2026).
  if (tenant.status && tenant.status !== 'ACTIVE') return false;
  if ((tenant.failedPaymentCount ?? 0) > 0) return true;
  return !tenant.currentPeriodEnd || tenant.currentPeriodEnd <= ahora;
}
