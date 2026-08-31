/**
 * Nombre del plan tal como se le MUESTRA a una persona.
 *
 * El plan ES la periodicidad. El nombre interno del `Plan` («Elite», «Pro»,
 * «Sin plan») es un SKU para el gating y para Hotmart, y no debe aparecer nunca
 * en pantalla: un negocio no tiene contratado «Elite», tiene un plan mensual o
 * anual.
 *
 * Espejo de `planDisplayName` del frontend (`lib/plan-format.ts`), que ya
 * aplicaba esta regla en el «Detalle avanzado». Se necesita también aquí porque
 * las tablas del CORTE reciben la etiqueta ya resuelta desde el servidor, y ahí
 * se estaba mandando el nombre interno — por eso el corte mostraba «Elite»
 * mientras la pantalla de al lado decía «Plan Mensual» para el mismo negocio.
 */
const ETIQUETA: Record<string, string> = {
  MENSUAL: 'Mensual',
  TRIMESTRAL: 'Trimestral',
  SEMESTRAL: 'Semestral',
  ANUAL: 'Anual',
};

export function nombreDePlan(
  periodicidad: string | null | undefined,
): string | null {
  if (!periodicidad) return null; // el panel lo pinta como «—»
  const e = ETIQUETA[periodicidad];
  return e ? `Plan ${e}` : null;
}
