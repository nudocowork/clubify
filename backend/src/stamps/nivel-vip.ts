/**
 * Niveles de la tarjeta VIP (`Card.tiers` + `Card.tierMetric`) en el escaneo.
 *
 * POR QUÉ EXISTE (auditoría 2026-11-26): con la métrica `spend` (la que viene
 * por defecto) el nivel NUNCA subía. El servicio sumaba `amount` solo en
 * POINTS_ADD / CASHBACK_ADD —o sea el cashback o los puntos GANADOS, no lo que
 * el cliente gastó—, y en una tarjeta MEMBERSHIP el escáner solo ofrecía
 * «Registrar visita», sin monto. Resultado: el progreso se quedaba en cero.
 *
 * Además el progreso se escribía como un absoluto calculado ANTES del candado
 * del pase: dos escaneos simultáneos leían el mismo valor y uno se perdía.
 * Aquí solo se decide el AVANCE (un delta) y el nivel que corresponde a un
 * progreso dado; el servicio aplica el delta con `increment` y calcula el
 * nivel con el valor fresco leído dentro del candado.
 *
 * Puro y sin base de datos, para probarlo solo.
 */

export type MetricaDeNivel = 'spend' | 'visits' | 'stamps';

export type Nivel = { name: string; threshold: number; perks: string[] };

/**
 * `Card.tiers` es un JSON que escribe el editor (y el Onboarding): se limpia
 * aquí para no reventar con una fila a medio llenar.
 */
export function nivelesDeLaTarjeta(tiers: unknown): Nivel[] {
  if (!Array.isArray(tiers)) return [];
  return tiers
    .filter(
      (t): t is { name: unknown; threshold: unknown; perks?: unknown } =>
        !!t && typeof t === 'object' && typeof (t as any).name === 'string' && (t as any).name.trim() !== '',
    )
    .map((t) => ({
      name: String(t.name).trim(),
      threshold: Number.isFinite(Number(t.threshold)) ? Number(t.threshold) : 0,
      perks: Array.isArray(t.perks)
        ? t.perks.filter((p): p is string => typeof p === 'string' && p.trim() !== '').map((p) => p.trim())
        : [],
    }));
}

/** Sin métrica guardada, la tarjeta sube por gasto: es el default del editor. */
export function metricaDeNivel(m: unknown): MetricaDeNivel {
  return m === 'visits' || m === 'stamps' ? m : 'spend';
}

/** Acciones que SUMAN y que, en una tarjeta por gasto, traen una compra. */
const ACCIONES_CON_COMPRA = ['VISIT', 'STAMP', 'POINTS_ADD', 'CASHBACK_ADD'];

/**
 * Cuánto avanza el progreso de nivel con este escaneo.
 *
 * `spend`: lo que el cliente PAGÓ (`purchaseAmount`), nunca `amount` (que en
 * cashback y puntos es lo ganado). Un regalo no es una compra: no suma.
 * `visits` y `stamps`: igual que siempre, `amount` en VISIT/STAMP y STAMP.
 */
export function avanceDeNivel(o: {
  metrica: MetricaDeNivel;
  accion: string;
  amount: number;
  purchaseAmount: number | undefined;
  esRegalo: boolean;
}): number {
  if (o.metrica === 'spend') {
    if (o.esRegalo || !ACCIONES_CON_COMPRA.includes(o.accion)) return 0;
    const compra = Number(o.purchaseAmount ?? 0);
    return Number.isFinite(compra) && compra > 0 ? compra : 0;
  }
  if (o.metrica === 'visits') {
    return o.accion === 'VISIT' || o.accion === 'STAMP' ? o.amount : 0;
  }
  return o.accion === 'STAMP' ? o.amount : 0;
}

/**
 * ¿Hay que exigir el monto de la compra? Solo en la VIP por gasto al
 * registrar la compra (VISIT): sin monto, el escaneo no movería el nivel y el
 * cajero creería que sí. El regalo no lleva compra, y el SUPER_ADMIN puede
 * corregir a mano.
 */
export function faltaMontoParaNivel(o: {
  tipoDeTarjeta: string;
  hayNiveles: boolean;
  metrica: MetricaDeNivel;
  accion: string;
  purchaseAmount: number | undefined;
  esRegalo: boolean;
  esSuperAdmin: boolean;
}): boolean {
  if (o.tipoDeTarjeta !== 'MEMBERSHIP' || !o.hayNiveles || o.metrica !== 'spend') return false;
  if (o.accion !== 'VISIT' || o.esRegalo || o.esSuperAdmin) return false;
  return !(Number(o.purchaseAmount ?? 0) > 0);
}

export const MENSAJE_FALTA_MONTO = 'Escribe el monto de la compra para sumar a su nivel.';

/**
 * El nivel más alto cuyo umbral alcanza el progreso. Si no llega a ninguno,
 * se queda el que tenía (mismo criterio que antes: nunca se borra un nivel por
 * no alcanzar el primero).
 */
export function nivelPara(niveles: Nivel[], progreso: number, actual: string | null): string | null {
  const alcanzado = [...niveles]
    .sort((a, b) => b.threshold - a.threshold)
    .find((t) => progreso >= t.threshold);
  return alcanzado ? alcanzado.name : actual;
}

/**
 * Texto del aviso cuando el cliente SUBE de nivel. `undefined` si no cambió o
 * si bajó (pasa cuando el negocio sube los umbrales): a nadie se le notifica
 * «bajaste de nivel» desde un escaneo.
 *
 * Es el ÚNICO aviso de la VIP en Android: el genérico de Google está apagado
 * para MEMBERSHIP (ver `google-wallet.service.ts`), porque decía «Nuevo nivel»
 * en cada compra.
 */
export function mensajeDeSubidaDeNivel(
  niveles: Nivel[],
  anterior: string | null,
  nuevo: string | null,
): { header: string; body: string } | undefined {
  if (!nuevo || nuevo === anterior) return undefined;
  const destino = niveles.find((t) => t.name === nuevo);
  if (!destino) return undefined;
  const previo = anterior ? niveles.find((t) => t.name === anterior) : undefined;
  if (previo && previo.threshold >= destino.threshold) return undefined;
  const beneficios = destino.perks.join(' · ').slice(0, 120);
  return {
    header: '¡Subiste de nivel!',
    body: beneficios ? `Ahora eres ${destino.name}. ${beneficios}` : `Ahora eres ${destino.name}.`,
  };
}
