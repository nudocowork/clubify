import { TIPOS_DE_AVISO, TipoAviso } from '../auth/prereg-alerts.service';

/**
 * Quién del equipo recibe qué aviso por SMS (Setting `prereg.alertPhones`).
 *
 * Hasta el 2026-09-22 ese Setting solo se podía cambiar a mano en la base.
 * Javier pidió poder poner el número del equipo de implementación (Samuel) y
 * cambiarlo desde Clubify: esta es la validación de lo que llega de la pantalla
 * «Avisos al equipo» (Integraciones SMS).
 */

export const CLAVE_AVISOS_AL_EQUIPO = 'prereg.alertPhones';
export const MAX_PERSONAS = 20;

export type PersonaDeAvisos = {
  name: string;
  phone: string;
  /** Solo estos avisos. Ausente = TODOS (el comportamiento de siempre). */
  solo?: TipoAviso[];
};

export type ResultadoValidacion =
  | { ok: true; personas: PersonaDeAvisos[] }
  | { ok: false; error: string };

/**
 * Normaliza y valida. Devuelve el error en español, listo para mostrarlo.
 *
 * La lista VACÍA se rechaza a propósito: `PreregAlertsService` interpreta un
 * Setting vacío como «usar los teléfonos de fábrica» (Javier y Jhon). Guardar
 * «nadie» acabaría mandando TODO a esos dos sin que nadie lo hubiera pedido.
 */
export function validarAvisosAlEquipo(entrada: unknown): ResultadoValidacion {
  if (!Array.isArray(entrada)) {
    return { ok: false, error: 'La lista de personas no es válida.' };
  }
  if (entrada.length === 0) {
    return {
      ok: false,
      error: 'Deja al menos una persona: sin nadie, los avisos irían a los teléfonos de fábrica.',
    };
  }
  if (entrada.length > MAX_PERSONAS) {
    return { ok: false, error: `Máximo ${MAX_PERSONAS} personas.` };
  }

  const tiposValidos = new Set<string>(TIPOS_DE_AVISO);
  const personas: PersonaDeAvisos[] = [];
  const vistos = new Set<string>();

  for (const [i, raw] of entrada.entries()) {
    const n = i + 1;
    const p = (raw ?? {}) as Record<string, unknown>;
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    if (!name || name.length > 60) {
      return { ok: false, error: `Persona ${n}: escribe un nombre (máximo 60 letras).` };
    }
    const bruto = typeof p.phone === 'string' ? p.phone.trim() : '';
    const phone = bruto.replace(/[\s\-().]/g, '');
    if (!/^\+\d{8,15}$/.test(phone)) {
      return {
        ok: false,
        error: `${name}: el teléfono debe llevar el código de país, por ejemplo +573001234567.`,
      };
    }
    if (vistos.has(phone)) {
      return { ok: false, error: `${name}: ese teléfono ya está en la lista.` };
    }
    vistos.add(phone);

    let solo: TipoAviso[] | undefined;
    if (p.solo !== undefined && p.solo !== null) {
      if (!Array.isArray(p.solo) || p.solo.some((t) => !tiposValidos.has(String(t)))) {
        return { ok: false, error: `${name}: hay un tipo de aviso que no existe.` };
      }
      const unicos = [...new Set(p.solo.map(String))] as TipoAviso[];
      // Sin ninguno marcado no significa «ninguno»: en el Setting, sin `solo`
      // se reciben todos. Para no recibir nada, se quita a la persona.
      if (unicos.length === 0) {
        return {
          ok: false,
          error: `${name}: marca al menos un aviso, o quítalo de la lista.`,
        };
      }
      solo = unicos;
    }
    personas.push(solo ? { name, phone, solo } : { name, phone });
  }
  return { ok: true, personas };
}

/** Lee el Setting tal como está guardado, tolerando basura. */
export function leerAvisosAlEquipo(valor: string | null | undefined): PersonaDeAvisos[] {
  if (!valor) return [];
  try {
    const r = validarAvisosAlEquipo(JSON.parse(valor));
    if (r.ok) return r.personas;
    // Guardado a mano con algún error: se enseña lo que se pueda leer.
    const crudo = JSON.parse(valor);
    return Array.isArray(crudo)
      ? crudo
          .filter((p) => p && typeof p.phone === 'string')
          .map((p) => ({
            name: String(p.name ?? ''),
            phone: String(p.phone),
            ...(Array.isArray(p.solo) ? { solo: p.solo } : {}),
          }))
      : [];
  } catch {
    return [];
  }
}
