import type { Prisma } from '@prisma/client';
import { COLORES_DE_EQUIPO } from './configuracion-de-equipo';
import {
  leerAjustesDeAgenda,
  normalizarAjustesDeAgenda,
  type AjustesDeAgenda,
  type FranjaDeAgenda,
} from './ajustes-de-agenda';

/**
 * Las agendas de reserva de un equipo — las reglas, sin base.
 *
 * Cada agenda es un enlace público distinto (`/agenda/<slug>`), con su propio
 * horario, formulario y ajustes; lo que se reserva en cualquiera entra al Banco
 * del equipo. Es «Agendas de reserva del equipo» de TeamClubify.
 */

export const MAX_AGENDAS_POR_EQUIPO = 20;
export const MIN_SLUG = 3;
export const MAX_SLUG = 60;

/**
 * Enlaces que no se reparten. `/agenda/cita/<token>` es donde se gestiona una
 * cita reservada: una agenda llamada «cita» se confundiría con esa ruta.
 */
const RESERVADOS = new Set(['cita']);

/** La misma paleta que el color del equipo: una sola en toda la Configuración. */
export const COLORES_DE_AGENDA = COLORES_DE_EQUIPO;

/** «Agenda Clubify - Instagram» → «agenda-clubify-instagram». */
export function slugDeAgenda(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '');
}

/** Por qué un slug (ya pasado por `slugDeAgenda`) no vale, o null. */
export function errorDeSlug(slug: string): string | null {
  if (slug.length < MIN_SLUG) return `El enlace necesita al menos ${MIN_SLUG} letras o números`;
  if (slug.length > MAX_SLUG || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return 'El enlace solo puede llevar minúsculas, números y guiones';
  }
  if (RESERVADOS.has(slug)) return `«${slug}» está reservado: elige otro enlace`;
  return null;
}

/** De dónde sale el enlace cuando no se escribe uno: el nombre, o «agenda» si no da para tres letras. */
export function raizDeSlug(nombre: string): string {
  // Tres caracteres de margen para el sufijo «-99».
  const s = slugDeAgenda(nombre).slice(0, MAX_SLUG - 3).replace(/-+$/g, '');
  return s.length >= MIN_SLUG ? s : 'agenda';
}

/** `raiz`, `raiz-2`, `raiz-3`… el primero libre, o null si están todos tomados. */
export function primerSlugLibre(raiz: string, ocupados: Set<string>): string | null {
  for (let i = 1; i <= 99; i++) {
    const s = i === 1 ? raiz : `${raiz}-${i}`;
    if (!ocupados.has(s) && !errorDeSlug(s)) return s;
  }
  return null;
}

export type CambiosDeAgenda = {
  /** Lo que va en columnas de `SalesAgenda`. */
  columnas: { name?: string; slug?: string; color?: string | null; isActive?: boolean; formId?: string | null };
  /** Lo que se mezcla en `settings`. */
  ajustes: Partial<AjustesDeAgenda>;
};

/** Lo que manda «Configurar», validado. Solo las claves que llegaron. */
export function normalizarAgenda(raw: unknown, hoy?: string): CambiosDeAgenda | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Los datos de la agenda no son válidos' };
  const e = raw as Record<string, unknown>;
  const columnas: CambiosDeAgenda['columnas'] = {};

  if (e.nombre !== undefined) {
    const n = typeof e.nombre === 'string' ? e.nombre.trim().slice(0, 80) : '';
    if (!n) return { error: 'La agenda necesita un nombre' };
    columnas.name = n;
  }
  if (e.slug !== undefined) {
    const s = slugDeAgenda(typeof e.slug === 'string' ? e.slug : '');
    const error = errorDeSlug(s);
    if (error) return { error };
    columnas.slug = s;
  }
  if (e.color !== undefined) {
    const c = typeof e.color === 'string' ? e.color.trim().toUpperCase() : '';
    if (!c) columnas.color = null;
    else if (!(COLORES_DE_AGENDA as readonly string[]).includes(c)) return { error: 'Ese color no está entre los que se ofrecen' };
    else columnas.color = c;
  }
  if (e.activa !== undefined) {
    if (typeof e.activa !== 'boolean') return { error: '«Agenda activa» tiene que ser sí o no' };
    columnas.isActive = e.activa;
  }
  if (e.formularioId !== undefined) {
    columnas.formId = typeof e.formularioId === 'string' && e.formularioId.trim() ? e.formularioId.trim() : null;
  }

  const ajustes = normalizarAjustesDeAgenda(e, hoy);
  if ('error' in ajustes && typeof ajustes.error === 'string') return { error: ajustes.error };
  return { columnas, ajustes: ajustes as Partial<AjustesDeAgenda> };
}

/** «09:00–17:30»: de la primera hora que abre a la última que cierra, como la fila de la referencia. */
export function resumenDeHorario(franjas: FranjaDeAgenda[]): string | null {
  if (!franjas.length) return null;
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return `${hhmm(Math.min(...franjas.map((f) => f.startMin)))}–${hhmm(Math.max(...franjas.map((f) => f.endMin)))}`;
}

/** Una agenda como la ve «Configuración». */
export function agendaParaElPanel(
  a: {
    id: string;
    name: string;
    slug: string;
    color: string | null;
    isActive: boolean;
    formId: string | null;
    settings: Prisma.JsonValue;
    createdAt: Date;
  },
  hoy?: string,
) {
  const ajustes = leerAjustesDeAgenda(a.settings, hoy);
  return {
    id: a.id,
    nombre: a.name,
    slug: a.slug,
    color: a.color,
    activa: a.isActive,
    formularioId: a.formId,
    ajustes,
    horario: resumenDeHorario(ajustes.franjas),
    creadaEl: a.createdAt,
  };
}
