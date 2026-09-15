import type { Prisma } from '@prisma/client';

/**
 * Los ajustes de la agenda pública del equipo: cómo se presenta y cuándo se
 * puede reservar.
 *
 * Es la tarjeta «Evento» + «Disponibilidad» de TeamClubify (`AgendaSettings`,
 * modelo `BookingConfig`), sin lo que aquí ya vive en otro sitio: el horario por
 * día es «¿Cuándo atiende el equipo?», el formulario es «Formularios» y el
 * enlace no se cambia (un enlace repartido que deja de funcionar es peor que
 * uno feo). Tampoco la zona horaria: toda la agenda cuenta en hora de Bogotá, y
 * cambiarla solo aquí descuadraría el Banco y los recordatorios.
 *
 * Se guardan en `SalesTeam.bookingConfig`, junto a `formularioId`. Puras a
 * propósito, para probarlas sin base.
 */

export type AjustesDeAgenda = {
  /** null = «Agenda una cita». */
  titulo: string | null;
  /** null = «con <nombre del equipo>». */
  subtitulo: string | null;
  duracionMin: number;
  diasHaciaAdelante: number;
  /** No se ofrece un hueco que empiece antes de esto. */
  antelacionMin: number;
  /** AAAA-MM-DD, ordenadas y sin repetir. */
  fechasBloqueadas: string[];
  /** «Volver al sitio» al terminar. Solo http(s). */
  volverAlSitio: string | null;
  /** Segundos hasta llevar solo a ese sitio. 0 = solo el enlace, sin llevar a nadie. */
  redirigirEnSegundos: number;
};

export const AJUSTES_DE_AGENDA_POR_DEFECTO: AjustesDeAgenda = {
  titulo: null,
  subtitulo: null,
  duracionMin: 30,
  diasHaciaAdelante: 21,
  antelacionMin: 30,
  fechasBloqueadas: [],
  volverAlSitio: null,
  redirigirEnSegundos: 0,
};

export const DURACIONES = [15, 20, 30, 45, 60, 90, 120] as const;
/** En minutos: de «sin antelación» a dos días. */
export const ANTELACIONES = [0, 30, 60, 120, 240, 720, 1440, 2880] as const;
/** Cada día ofrecido cuesta consultas al abrir la agenda pública: dos meses basta. */
export const MAX_DIAS_HACIA_ADELANTE = 60;
/** Cuánto se espera antes de llevar al sitio. 0 = no se lleva a nadie. */
export const SEGUNDOS_DE_REDIRECCION = [0, 3, 5, 10, 15, 30] as const;
export const MAX_FECHAS_BLOQUEADAS = 120;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Hoy en Bogotá, AAAA-MM-DD: toda la agenda cuenta en esa zona. */
export function hoyEnBogota(ahora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(ahora);
}

/** Una fecha AAAA-MM-DD que existe en el calendario (no «2026-02-30»). */
export function esFecha(v: unknown): v is string {
  if (typeof v !== 'string' || !FECHA.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const f = new Date(Date.UTC(y, m - 1, d));
  return f.getUTCFullYear() === y && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

/** Solo http(s): un `javascript:` en «Volver al sitio» sería un enlace que ejecuta código. */
function enlaceSeguro(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString().slice(0, 300) : null;
  } catch {
    return null;
  }
}

const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Lo que manda la pantalla, validado. Devuelve SOLO las claves que llegaron,
 * para mezclarlas con lo guardado sin pisar lo demás (`formularioId`).
 */
export function normalizarAjustesDeAgenda(
  raw: unknown,
  hoy = hoyEnBogota(),
): Partial<AjustesDeAgenda> | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Los ajustes de la agenda no son válidos' };
  const e = raw as Record<string, unknown>;
  const out: Partial<AjustesDeAgenda> = {};

  if (e.titulo !== undefined) out.titulo = texto(e.titulo, 80) || null;
  if (e.subtitulo !== undefined) out.subtitulo = texto(e.subtitulo, 200) || null;
  if (e.duracionMin !== undefined) {
    if (!(DURACIONES as readonly number[]).includes(Number(e.duracionMin))) {
      return { error: `La duración tiene que ser una de estas: ${DURACIONES.join(', ')} minutos` };
    }
    out.duracionMin = Number(e.duracionMin);
  }
  if (e.diasHaciaAdelante !== undefined) {
    const n = Number(e.diasHaciaAdelante);
    if (!Number.isInteger(n) || n < 1 || n > MAX_DIAS_HACIA_ADELANTE) {
      return { error: `Los días hacia adelante van de 1 a ${MAX_DIAS_HACIA_ADELANTE}` };
    }
    out.diasHaciaAdelante = n;
  }
  if (e.antelacionMin !== undefined) {
    if (!(ANTELACIONES as readonly number[]).includes(Number(e.antelacionMin))) {
      return { error: 'Esa antelación no está entre las que se ofrecen' };
    }
    out.antelacionMin = Number(e.antelacionMin);
  }
  if (e.fechasBloqueadas !== undefined) {
    if (!Array.isArray(e.fechasBloqueadas)) return { error: 'Las fechas bloqueadas no son una lista' };
    const malas = e.fechasBloqueadas.filter((f) => !esFecha(f));
    if (malas.length) return { error: `«${String(malas[0])}» no es una fecha (AAAA-MM-DD)` };
    // Las que ya pasaron no bloquean nada: fuera, para que no se acumulen hasta
    // el tope año tras año (Fable, 2026-09-15).
    const fechas = [...new Set(e.fechasBloqueadas as string[])].filter((f) => f >= hoy).sort();
    if (fechas.length > MAX_FECHAS_BLOQUEADAS) return { error: `Como mucho ${MAX_FECHAS_BLOQUEADAS} fechas bloqueadas` };
    out.fechasBloqueadas = fechas;
  }
  if (e.redirigirEnSegundos !== undefined) {
    if (!(SEGUNDOS_DE_REDIRECCION as readonly number[]).includes(Number(e.redirigirEnSegundos))) {
      return { error: 'Ese tiempo de redirección no está entre los que se ofrecen' };
    }
    out.redirigirEnSegundos = Number(e.redirigirEnSegundos);
  }
  if (e.volverAlSitio !== undefined) {
    const t = texto(e.volverAlSitio, 300);
    const u = enlaceSeguro(t);
    if (t && !u) return { error: '«Volver al sitio» tiene que ser un enlace que empiece por http:// o https://' };
    out.volverAlSitio = u;
  }
  return out;
}

/**
 * Lo guardado en `bookingConfig`, re-limpiado. Lo que no se entiende vuelve al
 * valor por defecto: un JSON roto no puede dejar la agenda sin horas.
 */
export function leerAjustesDeAgenda(json: Prisma.JsonValue | null | undefined, hoy = hoyEnBogota()): AjustesDeAgenda {
  const o = json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const d = AJUSTES_DE_AGENDA_POR_DEFECTO;
  const duracion = Number(o.duracionMin);
  const dias = Number(o.diasHaciaAdelante);
  const antelacion = Number(o.antelacionMin);
  return {
    titulo: texto(o.titulo, 80) || null,
    subtitulo: texto(o.subtitulo, 200) || null,
    duracionMin: (DURACIONES as readonly number[]).includes(duracion) ? duracion : d.duracionMin,
    diasHaciaAdelante: Number.isInteger(dias) && dias >= 1 && dias <= MAX_DIAS_HACIA_ADELANTE ? dias : d.diasHaciaAdelante,
    antelacionMin: (ANTELACIONES as readonly number[]).includes(antelacion) ? antelacion : d.antelacionMin,
    fechasBloqueadas: Array.isArray(o.fechasBloqueadas)
      ? [...new Set(o.fechasBloqueadas.filter(esFecha))].filter((f) => f >= hoy).sort().slice(0, MAX_FECHAS_BLOQUEADAS)
      : [],
    volverAlSitio: enlaceSeguro(o.volverAlSitio),
    // Sin sitio al que volver no se lleva a nadie, diga lo que diga lo guardado.
    redirigirEnSegundos:
      enlaceSeguro(o.volverAlSitio) && (SEGUNDOS_DE_REDIRECCION as readonly number[]).includes(Number(o.redirigirEnSegundos))
        ? Number(o.redirigirEnSegundos)
        : d.redirigirEnSegundos,
  };
}
