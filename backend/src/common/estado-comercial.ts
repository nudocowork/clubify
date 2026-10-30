/**
 * En qué punto de la relación comercial está un negocio.
 *
 * `Tenant.status` solo tiene ACTIVE, TRIAL y SUSPENDED, y debajo de SUSPENDED
 * caben tres historias que no se gestionan igual: el que dejó de pagar (hay que
 * cobrarle), el que canceló (se fue por decisión propia) y el que probó gratis
 * y nunca pagó (es un lead). Revueltas, «Pagos no procesados» reclamaba dinero
 * a quien ya no debía nada y el filtro de Suspendidos no servía para trabajar
 * (revisión del panel, 2026-10-30).
 *
 * Es una lectura: no sustituye a `status`, que sigue mandando sobre el acceso.
 * Por eso quien canceló y aún tiene período pagado sale aquí como CANCELADO
 * aunque siga con servicio: va a dejar de pagar, y eso es lo que importa al
 * mirar los cobros.
 */
export type EstadoComercial =
  | 'ACTIVO'
  | 'TRIAL'
  | 'SUSPENDIDO'
  | 'SUSPENDIDO_TRIAL'
  | 'CANCELADO';

export interface DatosDeEstadoComercial {
  status: string;
  canceledAt: Date | null;
  trialEndsAt: Date | null;
  lastChargeAt: Date | null;
  currentPeriodEnd: Date | null;
}

export function estadoComercial(t: DatosDeEstadoComercial): EstadoComercial {
  if (t.canceledAt) return 'CANCELADO';
  if (t.status === 'ACTIVE') return 'ACTIVO';
  if (t.status === 'TRIAL') return 'TRIAL';
  // Suspendido sin ningún ciclo pagado detrás: se le acabó la prueba. Un cobro
  // o un período en cualquier momento lo hacen moroso, no trial: `trialEndsAt`
  // solo no basta, porque se queda puesto en quien pagó después de probar.
  const nuncaPago = !t.lastChargeAt && !t.currentPeriodEnd;
  return t.trialEndsAt && nuncaPago ? 'SUSPENDIDO_TRIAL' : 'SUSPENDIDO';
}
