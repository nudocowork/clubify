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
