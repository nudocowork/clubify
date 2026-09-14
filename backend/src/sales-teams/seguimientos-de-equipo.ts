import { fechaEn, minutosLocalesAUtc } from '../common/franjas-horarias';

/**
 * Las reglas de «Seguimientos» del equipo: en qué grupo cae cada paso, qué
 * número de paso e intento lleva, y qué pide cada resultado.
 *
 * Puras a propósito —sin Prisma ni Nest— para probarlas contra este módulo.
 * Las mismas de TeamClubify (`teamFollowups` y `FollowupResultModal`).
 */

export type GrupoDeSeguimiento = 'vencidos' | 'hoy' | 'programados';

/**
 * En qué grupo cae un seguimiento, por DÍA de Bogotá y no por hora: uno de hoy
 * a las 08:00 sigue siendo «para hoy» a las 15:00. Es lo que hace la referencia
 * (`scheduled_for < today`), y lo que se espera de una lista de trabajo diaria:
 * lo vencido es lo de días anteriores, no lo de hace una hora.
 */
export function grupoDeSeguimiento(dueAt: Date, hoy: string, zona: string): GrupoDeSeguimiento {
  const dia = fechaEn(dueAt, zona);
  if (dia < hoy) return 'vencidos';
  if (dia === hoy) return 'hoy';
  return 'programados';
}

/**
 * Número de paso e intento de cada seguimiento de UN lead.
 *
 * `SalesFollowup` no los guarda —TeamClubify sí (`seq`, `attempt`)—, así que se
 * deducen de la historia del lead:
 *  · paso   = su posición entre todos los seguimientos del lead, por creación;
 *  · intento = 1 + cuántos pasos seguidos, justo antes, acabaron en «no
 *    respondió». Es lo que dice cuántas veces se le ha escrito sin respuesta.
 */
export function pasosEIntentos(
  delLead: Array<{ id: string; createdAt: Date; outcome: string | null }>,
): Map<string, { paso: number; intento: number }> {
  const orden = [...delLead].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const out = new Map<string, { paso: number; intento: number }>();
  let seguidosSinRespuesta = 0;
  orden.forEach((f, i) => {
    out.set(f.id, { paso: i + 1, intento: 1 + seguidosSinRespuesta });
    seguidosSinRespuesta = f.outcome === 'no_respondio' ? seguidosSinRespuesta + 1 : 0;
  });
  return out;
}

/**
 * Cadencia de reintentos cuando el lead no responde y nadie elige fecha: la de
 * TeamClubify por defecto (`followup_cadence = [1, 3, 7, 14]`), en días desde
 * hoy. El intento N usa `CADENCIA_DE_REINTENTOS[N - 1]` y, pasado el último,
 * se repite el último: el primer reintento (intento 2) va a los 3 días.
 *
 * Sin esto, «no respondió» sin fecha cerraba el paso sin crear otro y el lead
 * salía de la lista para siempre (Fable, 2026-09-14).
 */
export const CADENCIA_DE_REINTENTOS = [1, 3, 7, 14];
/** El reintento automático sale a las 9:00 locales. */
export const HORA_DEL_REINTENTO = 9 * 60;

export function fechaDelReintento(intento: number, hoy: string, zona: string): Date {
  const i = Math.min(Math.max(0, intento - 1), CADENCIA_DE_REINTENTOS.length - 1);
  // Sumar días sobre el rótulo AAAA-MM-DD y no sobre un instante: así el cambio
  // de mes no se corre por la zona del servidor.
  const d = new Date(`${hoy}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + CADENCIA_DE_REINTENTOS[i]);
  return minutosLocalesAUtc(d.toISOString().slice(0, 10), HORA_DEL_REINTENTO, zona);
}

export const RESULTADOS = ['compro', 'continuar', 'mas_tiempo', 'no_respondio', 'no_calificado'] as const;
export type Resultado = (typeof RESULTADOS)[number];

export type ResultadoValidado = {
  outcome: Resultado;
  proximaFecha: Date | null;
  nota: string | null;
  motivo: string | null;
};

/**
 * Lo que pide cada resultado, antes de tocar nada:
 *  · continuar / más tiempo → fecha del próximo paso, OBLIGATORIA: sin ella el
 *    lead se cae de la lista y nadie vuelve a escribirle;
 *  · no respondió          → fecha opcional: sin ella el servicio programa el
 *                            reintento solo (`fechaDelReintento`);
 *  · no calificado         → motivo, obligatorio: es lo que se lee al revisar
 *    por qué se pierden ventas;
 *  · compró                → nada.
 *
 * Devuelve el error como texto para que el servicio lo lance tal cual.
 */
export function validarResultado(
  input: { outcome?: string; proximaFecha?: string | null; nota?: string | null; motivo?: string | null },
  ahora: Date,
): ResultadoValidado | { error: string } {
  const outcome = input.outcome as Resultado;
  if (!(RESULTADOS as readonly string[]).includes(outcome ?? '')) {
    return { error: 'Resultado no válido' };
  }
  const nota = (input.nota ?? '').trim().slice(0, 2000) || null;
  const motivo = (input.motivo ?? '').trim().slice(0, 200) || null;

  let proximaFecha: Date | null = null;
  if (input.proximaFecha) {
    const d = new Date(input.proximaFecha);
    if (Number.isNaN(d.getTime())) return { error: 'La fecha del próximo paso no es válida' };
    // Un margen de un día hacia atrás: «hoy» elegido en un calendario llega
    // como la medianoche, que ya pasó, y no es un error de quien lo eligió.
    if (d.getTime() < ahora.getTime() - 86_400_000) {
      return { error: 'La fecha del próximo paso ya pasó' };
    }
    proximaFecha = d;
  }

  if ((outcome === 'continuar' || outcome === 'mas_tiempo') && !proximaFecha) {
    return { error: 'Elige la fecha del próximo paso' };
  }
  if (outcome === 'no_calificado' && !motivo) {
    return { error: 'Escribe el motivo por el que no califica' };
  }
  return { outcome, proximaFecha, nota, motivo };
}
