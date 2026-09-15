import type { Prisma } from '@prisma/client';

/**
 * Las reglas de «Tareas del CRM»: qué vistas hay, qué consulta cada una y cómo
 * se limpian la fecha y la acción.
 *
 * Puras a propósito —sin Nest ni base— para probarlas contra este módulo. Las
 * usa `TareasDeEquipoService`. La referencia es `listAllTasks` de TeamClubify.
 */

export const VISTAS_DE_TAREAS = ['pendientes', 'vencidas', 'hoy', 'mias', 'completadas'] as const;
export type VistaDeTareas = (typeof VISTAS_DE_TAREAS)[number];

/** Con lo que arranca el catálogo de un equipo, para que nunca salga vacío. */
export const ACCION_INICIAL = 'Seguimiento';

/** La acción es un título corto; el detalle va en la descripción. */
export const MAX_ACCION = 40;

export function normalizarVista(raw: unknown): VistaDeTareas {
  return (VISTAS_DE_TAREAS as readonly string[]).includes(raw as string) ? (raw as VistaDeTareas) : 'pendientes';
}

/**
 * `AAAA-MM-DD` de un día que existe; `null` si llega vacía; o un error.
 *
 * Se comprueba que el día exista de verdad: «2026-02-31» pasa la forma pero no
 * es un día, y guardado así ordenaría y vencería donde no toca.
 */
export function normalizarFecha(raw: unknown): string | null | { error: string } {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { error: 'La fecha no es válida' };
  const d = new Date(`${raw}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) {
    return { error: 'La fecha no es válida' };
  }
  return raw;
}

/** La acción en una línea, sin espacios dobles, y corta. */
export function normalizarAccion(raw: unknown): string | { error: string } {
  const t = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!t) return { error: 'Escribe la acción' };
  if (t.length > MAX_ACCION) {
    return { error: `La acción es un título corto: ${MAX_ACCION} caracteres como mucho` };
  }
  return t;
}

/** Vencida = abierta y con fecha de un día que ya pasó (día de Bogotá). */
export function estaVencida(t: { done: boolean; dueDate: string | null }, hoy: string): boolean {
  return !t.done && !!t.dueDate && t.dueDate < hoy;
}

/**
 * El `where` de cada vista. SIEMPRE empieza por el equipo. Las fechas son
 * `AAAA-MM-DD`, así que compararlas como texto ordena igual que como fechas.
 */
export function whereDeTareas(
  teamId: string,
  vista: VistaDeTareas,
  hoy: string,
  userId: string,
): Prisma.SalesTaskWhereInput {
  const base: Prisma.SalesTaskWhereInput = { salesTeamId: teamId, done: vista === 'completadas' };
  switch (vista) {
    case 'vencidas':
      return { ...base, dueDate: { lt: hoy } };
    case 'hoy':
      return { ...base, dueDate: hoy };
    case 'mias':
      return { ...base, assignedUserId: userId };
    default:
      return base;
  }
}
