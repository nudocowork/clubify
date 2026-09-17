/**
 * «Tu pago falló»: una vez por episodio de mora, y nunca a una cuenta pausada.
 *
 * Hotmart reintenta un cobro fallido varias veces, y cada reintento llega como
 * un `PURCHASE_DELAYED` nuevo. El webhook avisaba al dueño en TODOS: Delizzibo
 * recibió el aviso 4 veces (3 en tres horas), Café Macondo 2 en 40 minutos, y
 * AutoTech —suspendida desde julio— 4 veces en septiembre un texto que le pide
 * pagar «para no pausar tu cuenta» (arqueo del 2026-09-17).
 *
 * Un EPISODIO empieza con el primer fallo sin cobrar y termina cuando entra un
 * pago (que pone `failedPaymentCount` a 0). Su día 0 es `firstFailedAt`.
 */

export interface EstadoDeFallo {
  failedPaymentCount: number | null;
  firstFailedAt: Date | null;
}

/**
 * ¿Este fallo abre un episodio nuevo?
 *
 * Mira el CONTADOR y no solo `firstFailedAt`: hay caminos de pago que ponen el
 * contador a 0 sin limpiar la fecha, y con la fecha vieja puesta el fallo
 * siguiente heredaría un episodio que ya se cerró —sin aviso y con la gracia
 * contada desde meses atrás, o sea, suspensión inmediata.
 */
export function abreEpisodio(t: EstadoDeFallo): boolean {
  return (t.failedPaymentCount ?? 0) <= 0 || !t.firstFailedAt;
}

/** Día 0 del episodio al que pertenece un fallo que llega `ahora`. */
export function inicioDelEpisodio(t: EstadoDeFallo, ahora: Date): Date {
  return abreEpisodio(t) ? ahora : (t.firstFailedAt as Date);
}

/**
 * Condición del UPDATE que RECLAMA el aviso al dueño. Solo una escritura la
 * cumple por episodio: la primera deja `paymentFailureNoticeSentAt` en `ahora`,
 * que ya no es anterior al inicio del episodio.
 *
 * Se reclama en la base y no con lo leído al entrar porque los reintentos de
 * Hotmart pueden solaparse, y leer-decidir-escribir es justo lo que duplicaba.
 *
 * El aviso de mora del cron diario escribe el mismo campo; si ya avisó dentro
 * del episodio, el reintento de Hotmart tampoco repite.
 */
export function condicionDelAvisoDeFallo(tenantId: string, episodio: Date) {
  return {
    id: tenantId,
    // «Paga para no pausar tu cuenta» a una cuenta ya pausada no tiene sentido.
    status: { not: 'SUSPENDED' as const },
    OR: [
      { paymentFailureNoticeSentAt: null },
      { paymentFailureNoticeSentAt: { lt: episodio } },
    ],
  };
}

/**
 * Cómo se nombra un grupo en los avisos internos al equipo: el nombre del grupo
 * solo no dice qué negocios afecta, y quien lo lee tiene que saber a quién
 * llamar sin abrir el panel.
 */
export function etiquetaDelGrupo(grupo: {
  name: string;
  negocios: { brandName: string }[];
}): string {
  const nombres = grupo.negocios.map((n) => n.brandName).filter(Boolean);
  return nombres.length ? `${grupo.name} (grupo: ${nombres.join(', ')})` : grupo.name;
}
