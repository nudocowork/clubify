import type { Prisma } from '@prisma/client';

/**
 * Las reglas del CRM de oportunidades del equipo: qué estados hay, con qué
 * embudos arranca, cómo se limpia un valor, dónde cae una tarjeta al soltarla y
 * qué se consulta con cada filtro.
 *
 * Puras a propósito —sin Nest ni base— para probarlas contra este módulo y no
 * contra una copia. Las usa `CrmDeEquipoService`. La referencia es el CRM de
 * TeamClubify (`lib/crm.ts` y `app/actions/crm.ts`).
 */

export const ESTADOS_DE_OPORTUNIDAD = ['abierta', 'ganada', 'perdida', 'abandonada'] as const;
export type EstadoDeOportunidad = (typeof ESTADOS_DE_OPORTUNIDAD)[number];

export function esEstadoDeOportunidad(s: unknown): s is EstadoDeOportunidad {
  return typeof s === 'string' && (ESTADOS_DE_OPORTUNIDAD as readonly string[]).includes(s);
}

/** Valor especial del filtro de responsable: las que no tienen ninguno. */
export const SIN_RESPONSABLE = '__sin__';

type EtapaInicial = { nombre: string; color: string };

/**
 * Los embudos con los que arranca un equipo la primera vez que abre el CRM: los
 * de TeamClubify («Chat general» y «Closers»). El color va en hex y no como
 * clave de tema, igual que en las columnas del tablero de leads: es dato del
 * equipo.
 */
export const EMBUDOS_INICIALES: Array<{ nombre: string; etapas: EtapaInicial[] }> = [
  {
    nombre: 'Chat general',
    etapas: [
      { nombre: 'Nuevo lead', color: '#64748b' },
      { nombre: 'En conversación', color: '#0ea5e9' },
      { nombre: 'Interesado', color: '#8b5cf6' },
      { nombre: 'Propuesta', color: '#f59e0b' },
      { nombre: 'Ganado', color: '#22c55e' },
      { nombre: 'Perdido', color: '#ef4444' },
    ],
  },
  {
    nombre: 'Closers',
    etapas: [
      { nombre: 'Agendado', color: '#0ea5e9' },
      { nombre: 'Reunión realizada', color: '#8b5cf6' },
      { nombre: 'Seguimiento', color: '#f59e0b' },
      { nombre: 'Propuesta / cierre', color: '#6366f1' },
      { nombre: 'Ganado', color: '#22c55e' },
      { nombre: 'Perdido', color: '#ef4444' },
    ],
  },
];

/** Las etapas de un embudo creado a mano: las de la referencia. */
export const ETAPAS_DE_EMBUDO_NUEVO: EtapaInicial[] = [
  { nombre: 'Nuevo lead', color: '#64748b' },
  { nombre: 'Contactado', color: '#0ea5e9' },
  { nombre: 'Propuesta enviada', color: '#8b5cf6' },
  { nombre: 'Negociación', color: '#f59e0b' },
  { nombre: 'Ganado', color: '#22c55e' },
];

/** Lo que cabe en DECIMAL(12,2). */
export const VALOR_MAXIMO = 9_999_999_999.99;

/**
 * El valor que llega de la pantalla, limpio.
 *
 * Vacío es 0 —una oportunidad sin valor todavía—, pero lo que no es un número
 * es un ERROR y no un 0 silencioso: un «1.500.000» mal leído no puede cerrar una
 * venta en cero.
 */
export function normalizarValor(raw: unknown): number | { error: string } {
  if (raw === null || raw === undefined || raw === '') return 0;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return { error: 'El valor no es un número' };
  if (n < 0) return { error: 'El valor no puede ser negativo' };
  if (n > VALOR_MAXIMO) return { error: 'El valor es demasiado grande' };
  return Math.round(n * 100) / 100;
}

/**
 * El orden de una columna después de soltar una tarjeta en `posicion`.
 *
 * Recibe los ids de la columna destino en su orden actual (con o sin la tarjeta)
 * y devuelve el orden nuevo con la tarjeta dentro una sola vez. La posición se
 * recorta a los extremos: soltar «más allá del final» la deja la última.
 */
export function ordenTrasSoltar(ids: string[], id: string, posicion: number): string[] {
  const resto = ids.filter((x) => x !== id);
  const p = Number.isFinite(posicion) ? Math.floor(posicion) : resto.length;
  const i = Math.max(0, Math.min(p, resto.length));
  return [...resto.slice(0, i), id, ...resto.slice(i)];
}

/**
 * Qué se escribe al pasar una oportunidad a un estado. Las fechas se sellan al
 * entrar y se limpian al salir, y el motivo solo vive en perdida o abandonada:
 * reabrir una perdida no puede arrastrar el motivo de antes.
 */
export function datosDeEstado(estado: EstadoDeOportunidad, motivo: string | null | undefined, ahora: Date) {
  const cierraSinVenta = estado === 'perdida' || estado === 'abandonada';
  return {
    status: estado,
    wonAt: estado === 'ganada' ? ahora : null,
    lostAt: cierraSinVenta ? ahora : null,
    lostReason: cierraSinVenta ? (motivo ?? '').trim().slice(0, 200) || null : null,
  };
}

export type FiltrosDeCrm = { responsable?: string; estado?: string; q?: string };

/**
 * El `where` del tablero. SIEMPRE empieza por el equipo y el embudo: es lo que
 * impide que un filtro, por raro que sea, saque oportunidades de otro equipo.
 */
export function whereDeOportunidades(
  teamId: string,
  embudoId: string,
  f: FiltrosDeCrm,
): Prisma.SalesOpportunityWhereInput {
  const y: Prisma.SalesOpportunityWhereInput[] = [{ salesTeamId: teamId }, { pipelineId: embudoId }];
  if (f.responsable === SIN_RESPONSABLE) y.push({ assignedUserId: null });
  else if (f.responsable) y.push({ assignedUserId: f.responsable });
  if (esEstadoDeOportunidad(f.estado)) y.push({ status: f.estado });
  const q = (f.q ?? '').trim().slice(0, 120);
  if (q) {
    y.push({
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { lead: { name: { contains: q, mode: 'insensitive' } } },
        { lead: { company: { contains: q, mode: 'insensitive' } } },
      ],
    });
  }
  return { AND: y };
}
