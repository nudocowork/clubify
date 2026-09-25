/**
 * Horario de domicilios de un negocio: cuándo se le puede pedir.
 *
 * EL CASO (Javier, 2026-09-25): una hamburguesería trabaja de 6:00 p. m. a
 * 1:00 a. m. Un cliente entra a su Instagram al mediodía, pasa al InfoLink y de
 * ahí al menú de domicilios, arma su carrito y lo manda. **No hay nadie al otro
 * lado.** El pedido se queda sin responder y el cliente se queda esperando.
 *
 * Reglas:
 *  - **Sin horario configurado, se pide a cualquier hora.** Es lo que hacen hoy
 *    todos los negocios y no se le cambia el comportamiento a nadie por añadir
 *    esta función.
 *  - Una franja puede **cruzar la medianoche** (18:00 → 01:00). Es justo el caso
 *    del ejemplo, y es donde fallan estas cuentas si se hacen a ojo: la franja
 *    pertenece al día en que EMPIEZA, y el tramo después de medianoche cuenta
 *    para el día siguiente.
 *  - Todo se resuelve en la **hora local del negocio** (`Tenant.timezone`), no
 *    en la del servidor, que va en UTC.
 *
 * Es un módulo puro para poder probarlo: la aritmética de medianoche y de zonas
 * horarias es donde se cuelan los errores de una hora o de un día.
 */
import { momentoLocal } from '../automations/hora-local';

/** Una franja: qué días, desde qué hora y hasta cuál. */
export type Franja = {
  /** 0=domingo … 6=sábado, igual que `Date.getDay()`. */
  dias: number[];
  /** "HH:MM" en 24 h. */
  desde: string;
  hasta: string;
};

const ES_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

const NOMBRE_DIA = [
  'domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado',
];

/** "18:30" → 1110. `null` si no es una hora válida. */
export function aMinutos(hora: string): number | null {
  const m = ES_HORA.exec((hora ?? '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 1110 → "6:30 p. m.", que es como lo lee un cliente. */
export function enDoceHoras(minutos: number): string {
  const h24 = Math.floor(minutos / 60) % 24;
  const mm = minutos % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const sufijo = h24 < 12 ? 'a. m.' : 'p. m.';
  return mm === 0 ? `${h12} ${sufijo}` : `${h12}:${String(mm).padStart(2, '0')} ${sufijo}`;
}

/**
 * Valida lo que llega del panel. Devuelve las franjas limpias o el motivo del
 * rechazo, en español y diciendo qué corregir.
 */
export function validarHorario(
  valor: unknown,
): { ok: true; franjas: Franja[] } | { ok: false; error: string } {
  if (valor == null) return { ok: true, franjas: [] };
  if (!Array.isArray(valor)) {
    return { ok: false, error: 'El horario tiene que ser una lista de franjas.' };
  }
  if (valor.length > 21) {
    return { ok: false, error: 'Demasiadas franjas: como mucho 21 (tres por día).' };
  }
  const franjas: Franja[] = [];
  for (const f of valor as Array<Record<string, unknown>>) {
    const dias = Array.isArray(f?.dias) ? f.dias.map(Number) : [];
    if (!dias.length) {
      return { ok: false, error: 'Cada franja necesita al menos un día.' };
    }
    if (dias.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      return { ok: false, error: 'Los días van de 0 (domingo) a 6 (sábado).' };
    }
    const desde = aMinutos(String(f?.desde ?? ''));
    const hasta = aMinutos(String(f?.hasta ?? ''));
    if (desde === null || hasta === null) {
      return { ok: false, error: 'Las horas van en formato HH:MM (por ejemplo 18:00).' };
    }
    if (desde === hasta) {
      // Ni 0 minutos ni 24 horas: no se sabe cuál de las dos quiso decir.
      return {
        ok: false,
        error: 'La hora de inicio y la de cierre no pueden ser la misma. Para todo el día, deja el horario vacío.',
      };
    }
    franjas.push({
      dias: [...new Set(dias)].sort((a, b) => a - b),
      desde: String(f.desde),
      hasta: String(f.hasta),
    });
  }
  return { ok: true, franjas };
}

/**
 * Lee el horario tal y como está guardado en la base.
 *
 * Tolerante a propósito: lo que entra se valida con `validarHorario`, pero al
 * LEER, una fila corrupta no puede dejar a un negocio sin poder recibir
 * pedidos. Sin horario legible, se pide a cualquier hora — que es el estado de
 * todos los negocios hoy.
 */
export function leerHorario(valor: unknown): Franja[] {
  const r = validarHorario(valor);
  return r.ok ? r.franjas : [];
}

/** ¿Está el negocio tomando pedidos en este instante? */
export function estaAbierto(
  franjas: Franja[] | null | undefined,
  ahora: Date,
  zona: string,
): boolean {
  // Sin horario: se pide a cualquier hora. Es el comportamiento de siempre.
  if (!franjas?.length) return true;
  const { diaSemana, minutos } = momentoLocal(ahora, zona);
  const ayer = (diaSemana + 6) % 7;

  return franjas.some((f) => {
    const desde = aMinutos(f.desde);
    const hasta = aMinutos(f.hasta);
    if (desde === null || hasta === null || desde === hasta) return false;
    if (desde < hasta) {
      // Franja normal dentro del mismo día.
      return f.dias.includes(diaSemana) && minutos >= desde && minutos < hasta;
    }
    // Cruza la medianoche: la franja es del día en que EMPIEZA, así que a la
    // 1 de la mañana del martes sigue abierta la franja del lunes.
    return (
      (f.dias.includes(diaSemana) && minutos >= desde) ||
      (f.dias.includes(ayer) && minutos < hasta)
    );
  });
}

/**
 * Cuándo vuelve a abrir, en palabras para el cliente: «hoy a las 6 p. m.»,
 * «mañana a las 6 p. m.» o «el viernes a las 6 p. m.». `null` si no hay
 * horario o si ya está abierto.
 */
export function proximaApertura(
  franjas: Franja[] | null | undefined,
  ahora: Date,
  zona: string,
): string | null {
  if (!franjas?.length) return null;
  if (estaAbierto(franjas, ahora, zona)) return null;
  const { diaSemana, minutos } = momentoLocal(ahora, zona);

  // Se recorren los próximos 7 días buscando el primer inicio de franja.
  for (let salto = 0; salto < 7; salto++) {
    const dia = (diaSemana + salto) % 7;
    const candidatas = franjas
      .filter((f) => f.dias.includes(dia))
      .map((f) => aMinutos(f.desde))
      .filter((m): m is number => m !== null)
      // Hoy solo cuentan las que todavía no han empezado.
      .filter((m) => salto > 0 || m > minutos)
      .sort((a, b) => a - b);
    if (!candidatas.length) continue;
    const hora = enDoceHoras(candidatas[0]);
    if (salto === 0) return `hoy a las ${hora}`;
    if (salto === 1) return `mañana a las ${hora}`;
    return `el ${NOMBRE_DIA[dia]} a las ${hora}`;
  }
  return null;
}

/** El horario en una línea, para pintarlo: «lunes a domingo, 6 p. m. – 1 a. m.» */
export function resumenDelHorario(franjas: Franja[] | null | undefined): string | null {
  if (!franjas?.length) return null;
  return franjas
    .map((f) => {
      const d = aMinutos(f.desde);
      const h = aMinutos(f.hasta);
      const horas = d !== null && h !== null ? `${enDoceHoras(d)} – ${enDoceHoras(h)}` : '';
      const dias =
        f.dias.length === 7
          ? 'todos los días'
          : f.dias.map((x) => NOMBRE_DIA[x]).join(', ');
      return `${dias}: ${horas}`;
    })
    .join(' · ');
}
