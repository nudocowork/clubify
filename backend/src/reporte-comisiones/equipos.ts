/**
 * A QUÉ EQUIPO PERTENECE CADA COLABORADOR en el reporte de comisiones.
 *
 * Tres equipos, por pedido del dueño:
 *  · Equipo de closers — los que venden: influencers, embajadores, vendedores y
 *    los miembros de un equipo de ventas.
 *  · Socios comerciales — participaciones sobre el total (rol SOCIO, el socio
 *    de plataforma de `referrals.socioCodeId` y las participaciones globales
 *    que está construyendo el motor nuevo).
 *  · Administración y otros — lo demás: la comisión de equipo (el % de las
 *    ventas de la quincena de la Project Manager) y bonos.
 *
 * Es una función aislada a propósito: el motor de reglas nuevas (participaciones
 * globales) todavía no existe en el schema. Cuando exista, se le pasa su lista
 * de códigos en `participacionesGlobales` y no hay que tocar nada más.
 */

export const EQUIPOS = ['CLOSERS', 'SOCIOS', 'ADMINISTRACION'] as const;
export type Equipo = (typeof EQUIPOS)[number];

export const ETIQUETA_DE_EQUIPO: Record<Equipo, string> = {
  CLOSERS: 'Equipo de closers',
  SOCIOS: 'Socios comerciales',
  ADMINISTRACION: 'Administración y otros',
};

export function esEquipo(v: unknown): v is Equipo {
  return typeof v === 'string' && (EQUIPOS as readonly string[]).includes(v);
}

export const ETIQUETA_DE_ROL: Record<string, string> = {
  INFLUENCER: 'Influencer',
  AMBASSADOR: 'Embajador',
  VENDOR: 'Vendedor',
  SOCIO: 'Socio',
};

/** Códigos que el sistema ya marca por ajuste (ver `Setting`). */
export type MarcasDeEquipo = {
  /** `referrals.socioCodeId`: el socio de plataforma (10 % de cada venta). */
  socioCodeIds: ReadonlySet<string>;
  /** `comisiones.equipo.codeId`: quien cobra la comisión de equipo. */
  comisionDeEquipoCodeIds: ReadonlySet<string>;
  /** Participaciones globales del motor nuevo. Vacío hasta que exista. */
  participacionesGlobales?: ReadonlySet<string>;
  /** Códigos cuyo dueño es miembro activo de un equipo de ventas. */
  miembrosDeEquiposDeVenta: ReadonlySet<string>;
};

/**
 * El equipo de un colaborador. Orden de precedencia (la primera gana):
 *
 *  1. Socio — rol SOCIO, socio de plataforma o participación global. Va
 *     primero porque una participación es sobre TODA venta: aunque la persona
 *     también venda, su comisión de socio no es la de un closer.
 *  2. Comisión de equipo → Administración. Va antes que los closers porque el
 *     código de la Project Manager puede tener rol de influencer (es el rol por
 *     defecto de `ReferralCode`) y lo que cobra no es por vender.
 *  3. Influencer / embajador / vendedor, o miembro de un equipo de ventas →
 *     Closers.
 *  4. Lo demás → Administración y otros.
 */
export function equipoDeColaborador(
  colaborador: { codeId: string; role: string | null },
  marcas: MarcasDeEquipo,
): Equipo {
  const { codeId, role } = colaborador;
  if (
    role === 'SOCIO' ||
    marcas.socioCodeIds.has(codeId) ||
    (marcas.participacionesGlobales?.has(codeId) ?? false)
  ) {
    return 'SOCIOS';
  }
  if (marcas.comisionDeEquipoCodeIds.has(codeId)) return 'ADMINISTRACION';
  if (role === 'INFLUENCER' || role === 'AMBASSADOR' || role === 'VENDOR') return 'CLOSERS';
  if (marcas.miembrosDeEquiposDeVenta.has(codeId)) return 'CLOSERS';
  return 'ADMINISTRACION';
}

/** «Nombre — Rol / Equipo», como se pinta en el desplegable. */
export function etiquetaDeColaborador(c: {
  nombre: string;
  role: string | null;
  equipo: Equipo;
  equipoDeVenta?: string | null;
}): string {
  const rol = (c.role && ETIQUETA_DE_ROL[c.role]) || 'Colaborador';
  const equipo = c.equipoDeVenta || ETIQUETA_DE_EQUIPO[c.equipo];
  return `${c.nombre} — ${rol} / ${equipo}`;
}
