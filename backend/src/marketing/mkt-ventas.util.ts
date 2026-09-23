// ── EL PUENTE CON EQUIPOS DE VENTAS — helpers puros ──
//
// Lo que un flujo de contactos necesita saber de `SalesLead`, `SalesMeeting`,
// `SalesOpportunity` y `SalesTask` sin tocar la base: elegir embudo y etapa,
// calcular el momento de una espera relativa a la cita y poner nombre a los
// eventos del barrido.
//
// Sin Nest y sin Prisma a propósito, como `wf-filtros.util.ts`: se prueban
// contra ESTE archivo y no contra una copia del motor.

import { sinAcentos } from '../superadmin/brand-workflows/wf-filtros.util';
import { MS_POR_UNIDAD } from './mkt-workflow.util';

/** ¿Se llaman igual? Sin tildes ni mayúsculas, como las etiquetas. */
export function mismoNombre(a: unknown, b: unknown): boolean {
  return sinAcentos(String(a ?? '')).trim() === sinAcentos(String(b ?? '')).trim();
}

type ConNombre = { id: string; name: string };

/**
 * El embudo (o la etapa) que pide el paso, dentro de la lista del equipo del
 * lead. Sin nombre configurado vale el PRIMERO —la lista llega ordenada por
 * `position`—; con un nombre que no existe ahí devuelve null.
 *
 * Null y no «el primero»: caer en otra etapa porque la configurada no está es
 * peor que no hacer nada. La tarjeta aparecería en una columna que nadie
 * eligió, y el equipo la trabajaría como si alguien lo hubiera decidido.
 */
export function elegirPorNombre<T extends ConNombre>(lista: T[], nombre: unknown): T | null {
  const pedido = String(nombre ?? '').trim();
  if (!pedido) return lista[0] ?? null;
  return lista.find((x) => mismoNombre(x.name, pedido)) ?? null;
}

/**
 * El día de Bogotá de un instante, como `AAAA-MM-DD`.
 *
 * `SalesTask.dueDate` se guarda así —texto, sin hora— y las vistas de tareas
 * comparan ese texto. Calcularlo en UTC dejaría las tareas creadas después de
 * las 19:00 de Bogotá venciendo un día más tarde de lo que dice el flujo.
 */
export function diaEnBogota(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/** La hora de Bogotá de un instante, `HH:MM`, para los {{merge}} de la cita. */
export function horaEnBogota(fecha: Date): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(fecha);
}

/**
 * De qué cita habla el flujo cuando dice «la cita del contacto»: la PRÓXIMA
 * que viene y, si ya no queda ninguna por delante, la última que tuvo.
 *
 * El respaldo hacia atrás es lo que hace que funcione un seguimiento de
 * «un día DESPUÉS de la reunión»: cuando ese paso se evalúa, la reunión ya
 * pasó. Sin él, el contacto se quedaría esperando una cita que nunca va a
 * volver a existir.
 *
 * Quien llama decide qué citas entran (las vivas, normalmente): aquí solo se
 * elige entre las que se le pasan.
 */
export function elegirCitaDeReferencia<T extends { startAt: Date }>(citas: T[], ahora = Date.now()): T | null {
  const ordenadas = [...citas].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  return ordenadas.find((c) => c.startAt.getTime() >= ahora) ?? ordenadas[ordenadas.length - 1] ?? null;
}

export type EsperaDeCita = { direction?: unknown; amount?: unknown; unit?: unknown };

/**
 * El instante al que apunta «X antes / después de la cita».
 *
 * `amount` mínimo 1, como en la referencia: el constructor guarda a veces solo
 * la unidad y `amount` queda sin definir; con un 0 el recordatorio de «1 hora
 * antes» salía A LA HORA de la reunión.
 */
export function momentoDeLaCita(inicio: Date, cfg: EsperaDeCita): number {
  const signo = String(cfg?.direction ?? 'before') === 'after' ? 1 : -1;
  const cantidad = Math.max(1, Number(cfg?.amount) || 1);
  const unidad = MS_POR_UNIDAD[String(cfg?.unit ?? 'hours')] ?? MS_POR_UNIDAD.hours;
  return inicio.getTime() + signo * cantidad * unidad;
}

/**
 * Qué hacer cuando ese momento YA pasó.
 *
 * El valor `auto` decide por la dirección, que es lo sensato y lo que hace la
 * referencia: un recordatorio de ANTES de la reunión ya no sirve —mandarlo
 * suelta de golpe todos los avisos vencidos del contacto que entró tarde—,
 * mientras que un seguimiento de DESPUÉS sigue teniendo sentido aunque llegue
 * con retraso.
 */
export function queHacerSiYaPaso(cfg: EsperaDeCita & { siYaPaso?: unknown }): 'seguir' | 'salir' {
  const pedido = String(cfg?.siYaPaso ?? 'auto');
  if (pedido === 'seguir' || pedido === 'salir') return pedido;
  return String(cfg?.direction ?? 'before') === 'after' ? 'seguir' : 'salir';
}

/**
 * El nombre de un evento de ventas ya visto.
 *
 * Es la clave de idempotencia del barrido de cada hora: la ventana que se mira
 * es más ancha que el intervalo del cron —para que no se escape nada entre dos
 * vueltas—, así que el mismo cambio se ve dos veces y hay que reconocerlo.
 *
 * Lleva el ESTADO (o la etapa) y no solo el id: «la cita 7 pasó a cancelada» y
 * «la cita 7 pasó a confirmada» son dos eventos distintos. El precio es que
 * volver a un estado por el que ya se pasó no dispara otra vez, y eso es lo que
 * queremos: repetir es peor que no repetir cuando lo que sale es un correo.
 */
export function refDeEvento(...partes: (string | number)[]): string {
  return partes.map((p) => String(p)).join(':');
}

/** La clave con la que se recuerda un evento ya disparado para UN flujo. */
export function claveDeEvento(workflowId: string, ref: string): string {
  return `${workflowId}|${ref}`;
}

/**
 * Cuánto hacia atrás mira el barrido. El cron va cada hora: media hora de
 * solape es lo que evita que un cambio caiga justo en el hueco entre dos
 * vueltas (un tick que tarda, un despliegue en medio).
 */
export const VENTANA_DEL_BARRIDO_MS = 90 * 60000;

