import type { Prisma } from '@prisma/client';

/**
 * Las reglas de «Configuración» del equipo: estado, color, el mensaje de
 * WhatsApp del closer y cómo se ve el Banco.
 *
 * Puras a propósito —sin Nest ni base— para probarlas contra este módulo. Es lo
 * que en TeamClubify reparten `TeamSettings`, `BankStatesConfig`,
 * `BankFieldsConfig` y `lib/closers.ts`, con dos diferencias a propósito:
 *
 * · El mensaje por defecto no nombra ninguna marca. El de la referencia decía
 *   «del equipo de Clubify», y en un equipo de Sellea eso es la fuga de marca
 *   que más se repite en este producto. Aquí dice el nombre del EQUIPO.
 * · Las pestañas del Banco son las siete que tiene el Banco de aquí (la
 *   referencia tiene además «Reagendadas»).
 */

// ── Estado ──────────────────────────────────────────────────────────────────

export const ESTADOS_DE_EQUIPO = [
  { clave: 'activo', etiqueta: 'Activo', ayuda: 'Opera normalmente.' },
  { clave: 'pausado', etiqueta: 'Pausado', ayuda: 'La agenda pública no recibe citas nuevas.' },
  { clave: 'desactivado', etiqueta: 'Desactivado', ayuda: 'Solo lectura; conserva todo el historial.' },
] as const;
export type EstadoDeEquipo = (typeof ESTADOS_DE_EQUIPO)[number]['clave'];

export function esEstadoDeEquipo(v: unknown): v is EstadoDeEquipo {
  return ESTADOS_DE_EQUIPO.some((e) => e.clave === v);
}

/**
 * `isActive` se queda y se deriva del estado. Lo leen la agenda pública, «Mis
 * equipos» y la cabecera desde antes de que hubiera estados; cambiarlos todos a
 * la vez es la forma de que uno se quede atrás.
 */
export function activoSegunEstado(estado: EstadoDeEquipo): boolean {
  return estado !== 'desactivado';
}

/**
 * El estado que se enseña. Manda `isActive`, que es lo que de verdad abre y
 * cierra puertas: un equipo inactivo es «desactivado» diga lo que diga la
 * columna (por ejemplo, si la migración se cortó antes de rellenarla).
 */
export function estadoDeEquipo(status: unknown, isActive: boolean): EstadoDeEquipo {
  if (!isActive) return 'desactivado';
  return status === 'pausado' ? 'pausado' : 'activo';
}

// ── Color ───────────────────────────────────────────────────────────────────

/** Las sugerencias del selector (las de la referencia). Se admite cualquier #RRGGBB. */
export const COLORES_DE_EQUIPO = ['#22C55E', '#38BDF8', '#A78BFA', '#F59E0B', '#F472B6', '#14B8A6', '#FB7185', '#818CF8'] as const;

export function normalizarColor(raw: unknown): string | null | { error: string } {
  if (raw == null || raw === '') return null;
  const t = typeof raw === 'string' ? raw.trim() : '';
  if (!/^#[0-9a-fA-F]{6}$/.test(t)) return { error: 'El color tiene que ser un código como #22C55E' };
  return t.toUpperCase();
}

// ── Mensaje de WhatsApp del closer ──────────────────────────────────────────

export const MAX_MENSAJE = 1000;

export const MENSAJE_POR_DEFECTO =
  'Hola {{nombre}}, ¿cómo estás? Te habla {{closer}}, del equipo {{equipo}}. Hace unos días hablamos y quería retomar nuestra conversación.';

/**
 * El texto con el que se abre WhatsApp. Admite {{nombre}} y {{closer}}, como la
 * referencia, y {{equipo}}. Los reemplazos van por función: con un texto, un
 * nombre con «$&» dentro se convertiría en otra cosa.
 */
export function mensajeDeWhatsapp(
  plantilla: string | null | undefined,
  vars: { nombre?: string | null; closer?: string | null; equipo?: string | null },
): string {
  const t = (typeof plantilla === 'string' && plantilla.trim()) || MENSAJE_POR_DEFECTO;
  return (
    t
      .replace(/\{\{\s*nombre\s*\}\}/gi, () => (vars.nombre ?? '').trim())
      .replace(/\{\{\s*closer\s*\}\}/gi, () => (vars.closer ?? '').trim())
      .replace(/\{\{\s*equipo\s*\}\}/gi, () => (vars.equipo ?? '').trim())
      // Sin nombre, «Hola , ¿cómo estás?» se lee roto.
      .replace(/[ \t]+([,.;:!?])/g, '$1')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
  );
}

// ── Banco ───────────────────────────────────────────────────────────────────

/** Las pestañas del Banco, en el orden en que salen allí. `etiqueta` = el nombre de siempre. */
export const PESTANAS_DEL_BANCO = [
  { clave: 'por_asignar', etiqueta: 'Por asignar', ayuda: 'Recién agendada, sin closer' },
  { clave: 'por_confirmar', etiqueta: 'Por confirmar', ayuda: 'Con closer asignado' },
  { clave: 'seguimiento', etiqueta: 'Seguimiento', ayuda: 'En seguimiento' },
  { clave: 'no_show', etiqueta: 'No asistió', ayuda: 'No asistió' },
  { clave: 'canceladas', etiqueta: 'Canceladas', ayuda: 'Cancelada' },
  { clave: 'ganadas', etiqueta: 'Ganadas', ayuda: 'Ganada (venta cerrada)' },
  { clave: 'perdidas', etiqueta: 'Perdidas', ayuda: 'Perdida' },
] as const;
export type PestanaDelBanco = (typeof PESTANAS_DEL_BANCO)[number]['clave'];
export type EtiquetasDelBanco = Partial<Record<PestanaDelBanco, string>>;

export const MAX_ETIQUETA = 40;

/**
 * Los nombres que el equipo pone a las pestañas. Solo se guarda lo que cambia:
 * vacío o igual al de siempre es «el de siempre», así un cambio futuro del
 * nombre por defecto llega también a quien nunca lo tocó.
 */
export function normalizarEtiquetas(raw: unknown): EtiquetasDelBanco | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Los nombres de las pestañas no son válidos' };
  const entrada = raw as Record<string, unknown>;
  const out: EtiquetasDelBanco = {};
  for (const p of PESTANAS_DEL_BANCO) {
    const v = entrada[p.clave];
    if (v == null) continue;
    if (typeof v !== 'string') return { error: `El nombre de «${p.etiqueta}» no es texto` };
    const t = v.trim().slice(0, MAX_ETIQUETA);
    if (t && t !== p.etiqueta) out[p.clave] = t;
  }
  return out;
}

/** Lo que se ve al desplegar una cita en el Banco, antes de asignarle closer. */
export const CAMPOS_DEL_BANCO = [
  { clave: 'whatsapp', etiqueta: 'WhatsApp' },
  { clave: 'email', etiqueta: 'Correo' },
  { clave: 'empresa', etiqueta: 'Empresa' },
  { clave: 'origen', etiqueta: 'Origen' },
  { clave: 'closer', etiqueta: 'Closer' },
  { clave: 'duracion', etiqueta: 'Duración' },
  { clave: 'respuestas', etiqueta: 'Respuestas del formulario' },
] as const;
export type CampoDelBanco = (typeof CAMPOS_DEL_BANCO)[number]['clave'];

/** Los de siempre: los que el Banco enseñaba antes de poder elegirlos. */
export const CAMPOS_DEL_BANCO_POR_DEFECTO: CampoDelBanco[] = ['whatsapp', 'email', 'empresa', 'origen', 'closer', 'duracion'];

const esCampoDelBanco = (k: string): k is CampoDelBanco => CAMPOS_DEL_BANCO.some((c) => c.clave === k);

/** En el orden del catálogo, no en el de marcado: la ficha se lee siempre igual. */
export function normalizarCamposDelBanco(raw: unknown): CampoDelBanco[] | { error: string } {
  if (!Array.isArray(raw)) return { error: 'Los campos del Banco no son una lista' };
  // Vacío se lee como «los de siempre», y la tarjeta se quedaba diciendo «0
  // campos» mientras el Banco enseñaba seis (Fable, 2026-09-15).
  if (!raw.length) return { error: 'Marca al menos un dato para enseñar en el Banco' };
  const pedidos = new Set(raw.map((x) => String(x)));
  for (const k of pedidos) if (!esCampoDelBanco(k)) return { error: `«${k}» no es un campo del Banco` };
  return CAMPOS_DEL_BANCO.map((c) => c.clave).filter((k) => pedidos.has(k));
}

// ── Lo guardado ─────────────────────────────────────────────────────────────

export type AjustesDeEquipo = {
  /** null = el mensaje por defecto. */
  mensajeWhatsapp: string | null;
  etiquetasDelBanco: EtiquetasDelBanco;
  camposDelBanco: CampoDelBanco[];
  /** Este equipo recibe como contactos nuevos a los números que escriben sin estar en ningún tablero. */
  recibeDesconocidos: boolean;
};

/**
 * `SalesTeam.settings`, re-limpiado: lo que haya en la base no se da por bueno.
 * Nada de lo guardado puede dejar el Banco en blanco o romper la pantalla; lo
 * que no se entiende vuelve a lo de siempre.
 */
export function leerAjustes(json: Prisma.JsonValue | null | undefined): AjustesDeEquipo {
  const o = json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const etiquetas = normalizarEtiquetas(o.etiquetasDelBanco ?? {});
  const campos = Array.isArray(o.camposDelBanco)
    ? CAMPOS_DEL_BANCO.map((c) => c.clave).filter((k) => (o.camposDelBanco as unknown[]).includes(k))
    : [];
  const mensaje = typeof o.mensajeWhatsapp === 'string' ? o.mensajeWhatsapp.trim().slice(0, MAX_MENSAJE) : '';
  return {
    mensajeWhatsapp: mensaje || null,
    etiquetasDelBanco: 'error' in etiquetas ? {} : etiquetas,
    // Vacío = los de siempre; nunca una ficha en blanco.
    camposDelBanco: campos.length ? campos : [...CAMPOS_DEL_BANCO_POR_DEFECTO],
    recibeDesconocidos: o.recibeDesconocidos === true,
  };
}
