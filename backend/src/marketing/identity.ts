/**
 * IDENTIDAD DE CONTACTO — el punto donde más duele equivocarse.
 * En el sistema real terminamos con 131 números repartidos en 265 fichas antes
 * de detectarlo. Todo pasa por UN SOLO resolver; si hay dos caminos con criterios
 * distintos, hay duplicados garantizados.
 *
 * Diseño de claves de teléfono (resuelve la tensión São Paulo/Río ↔ índice único):
 *  - `phoneKey` = últimos 10 dígitos → BUCKET de candidatos (índice NO único).
 *    NO decide identidad; solo acota la búsqueda para que sea indexada.
 *  - `phoneNorm` = TODOS los dígitos (forma canónica) → ÍNDICE ÚNICO parcial.
 *    Cierra la carrera de dos altas simultáneas del MISMO número. São Paulo
 *    (+5511987654321) y Río (+5521987654321) comparten `phoneKey` pero tienen
 *    `phoneNorm` distinto → ambos coexisten (son personas distintas).
 *  - El VEREDICTO de "¿son el mismo?" lo da `samePhone` (iguales o sufijo ≥7),
 *    NO la clave. Un `+57...` nacional y su E.164 se funden acá aunque su
 *    `phoneNorm` difiera.
 *
 * Helpers PUROS + un resolver inyectable (ContactStore) para testear reactivación
 * y carrera SIN base de datos.
 */

export function digitsOnly(raw?: string | null): string {
  return (raw ?? '').replace(/\D/g, '');
}

/** Forma canónica para el ÍNDICE ÚNICO: todos los dígitos. null si <7 (no identifica). */
export function phoneNormOf(raw?: string | null): string | null {
  const d = digitsOnly(raw);
  return d.length >= 7 ? d : null;
}

/** BUCKET de candidatos (índice NO único): últimos 10 dígitos. null si <7. NO decide. */
export function phoneKeyOf(raw?: string | null): string | null {
  const d = digitsOnly(raw);
  return d.length >= 7 ? d.slice(-10) : null;
}

/** Email normalizado (trim + minúsculas). null si no parece email. */
export function emailNormOf(raw?: string | null): string | null {
  const e = (raw ?? '').trim().toLowerCase();
  return e.includes('@') ? e : null;
}

/**
 * VEREDICTO de identidad por teléfono: iguales, O uno es sufijo del otro con
 * ≥7 dígitos. Ni "dígitos completos" (parte al mismo en dos: nacional vs E.164)
 * ni "últimos 10" (une a dos distintos: São Paulo vs Río).
 */
export function samePhone(a?: string | null, b?: string | null): boolean {
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  if (!da || !db) return false;
  if (da === db) return true;
  const [short, long] = da.length <= db.length ? [da, db] : [db, da];
  if (short.length < 7) return false;
  return long.endsWith(short);
}

// ── Resolver inyectable (testeable sin DB) ──

export type ContactRow = {
  id: string;
  email: string | null;
  phone: string | null;
  phoneKey: string | null;
  phoneNorm: string | null;
  deleted: boolean;
};

export type ResolveInput = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  tags?: string[];
};

export type ResolveDecision =
  | { action: 'reuse'; match: ContactRow }
  | { action: 'reactivate'; match: ContactRow }
  | { action: 'create' };

/**
 * DECISIÓN pura: dado el conjunto de candidatos (del bucket phoneKey + email) y
 * el input, ¿reuso la ficha, la reactivo o creo una nueva? Único lugar que
 * decide identidad. Prioriza el match por teléfono (veredicto samePhone) y luego
 * por email exacto normalizado.
 */
export function decideContactMatch(candidates: ContactRow[], input: ResolveInput): ResolveDecision {
  const email = emailNormOf(input.email);
  const match =
    candidates.find((c) => input.phone && samePhone(c.phone, input.phone)) ??
    candidates.find((c) => email && c.email && emailNormOf(c.email) === email);
  if (!match) return { action: 'create' };
  return match.deleted ? { action: 'reactivate', match } : { action: 'reuse', match };
}

/** Error que el store debe lanzar cuando el índice único parcial rechaza el insert. */
export class UniqueContactViolation extends Error {}

/**
 * Store que el resolver necesita. La implementación real usa Prisma; los tests
 * usan un fake en memoria (para probar reactivación y carrera sin DB).
 */
export interface ContactStore {
  /** Candidatos por bucket de teléfono O email (búsqueda GLOBAL por marca, incluye eliminados). */
  findCandidates(args: { phoneKey: string | null; email: string | null }): Promise<ContactRow[]>;
  /** Crea la ficha. Debe lanzar UniqueContactViolation si el índice único la rechaza. */
  create(data: {
    name: string | null;
    email: string | null;
    phone: string | null;
    phoneKey: string | null;
    phoneNorm: string | null;
    company: string | null;
    tags: string[];
  }): Promise<ContactRow>;
  /** Reactiva una ficha eliminada (deleted=false) dejando constancia. */
  reactivate(id: string, input: ResolveInput): Promise<ContactRow>;
  /** Relee por la clave única tras una violación de carrera → devuelve la ficha ganadora. */
  findByUnique(args: { phoneNorm: string | null; email: string | null }): Promise<ContactRow | null>;
}

/**
 * Resuelve (o crea) el contacto para un input. UN SOLO camino:
 *  1. Normaliza y busca candidatos por bucket phoneKey + email (global).
 *  2. Decide reuse / reactivate / create con el veredicto.
 *  3. Al crear, atrapa la violación de unicidad (carrera) y devuelve la ficha
 *     que ganó — para no perder el mensaje.
 */
export async function resolveContact(store: ContactStore, input: ResolveInput): Promise<ContactRow> {
  const phoneKey = phoneKeyOf(input.phone);
  const phoneNorm = phoneNormOf(input.phone);
  const email = emailNormOf(input.email);

  const candidates = await store.findCandidates({ phoneKey, email });
  const decision = decideContactMatch(candidates, input);

  if (decision.action === 'reuse') return decision.match;
  if (decision.action === 'reactivate') return store.reactivate(decision.match.id, input);

  try {
    return await store.create({
      name: input.name ?? null,
      email,
      phone: input.phone ?? null,
      phoneKey,
      phoneNorm,
      company: input.company ?? null,
      tags: input.tags ?? [],
    });
  } catch (e) {
    if (e instanceof UniqueContactViolation) {
      const winner = await store.findByUnique({ phoneNorm, email });
      if (winner) return winner;
    }
    throw e;
  }
}
