import type { AccesoAlEquipo } from './team-access';
import { digitsOnly, emailNormOf } from '../marketing/identity';

/**
 * «Venta del equipo»: el lead que el equipo ganó, VINCULADO al negocio de la
 * marca en que se convirtió, con quién lo cerró (closer) y quién agendó la
 * cita (setter).
 *
 * Existe para poder enganchar el pago después (Jhon): hoy un lead ganado no
 * sabe qué negocio es, y sin eso ninguna venta de un equipo le puede pagar a
 * nadie. Aquí NO se paga ni se calcula dinero. Lo que cobraría cada uno lo
 * describe `quien-cobraria.ts`, que hoy no llama nadie.
 *
 * Decisiones de Javier (2026-09-15) que viven aquí:
 *  · Vincula el líder del equipo o un admin de la marca.
 *  · Cobran closer y setter; «solo la venta o también las renovaciones» lo
 *    elige la MARCA, y se congela en la venta al vincularla.
 *
 * Puras a propósito —sin Nest ni base— para probarlas sin dobles.
 */

export const ESTADOS_DE_VENTA = ['vinculada', 'desvinculada'] as const;
export type EstadoDeVenta = (typeof ESTADOS_DE_VENTA)[number];

// ── Quién ───────────────────────────────────────────────────────────────────

export function puedeVincularVentas(
  acceso: Pick<AccesoAlEquipo, 'esAdminDeMarca' | 'roles' | 'puedeEscribir'>,
): boolean {
  return acceso.puedeEscribir && (acceso.esAdminDeMarca || acceso.roles.includes('lider'));
}

/**
 * Buscar negocios de la marca por texto, solo un admin. El líder es un
 * afiliado: con el buscador podría recorrer nombres y correos de todos los
 * negocios de la marca. Al líder le bastan las sugerencias, que salen del
 * teléfono y el correo de SU cliente, que ya conoce.
 */
export function puedeBuscarNegocios(acceso: Pick<AccesoAlEquipo, 'esAdminDeMarca'>): boolean {
  return acceso.esAdminDeMarca;
}

// ── El código de afiliado de cada persona ───────────────────────────────────

/** Los roles con monto fijo en la marca (`getBrandFixedAmount`: influencer y embajador). */
export const ROLES_CON_FIJO: readonly string[] = ['INFLUENCER', 'AMBASSADOR'];

export type CodigoDeAfiliado = {
  id: string;
  role: string;
  isActive: boolean;
  approvedAt: Date | string | null;
};

export type EstadoDelCodigo = 'aprobado' | 'sin_codigo' | 'sin_aprobar' | 'varios';

/**
 * El código con el que esa persona cobraría en la marca. Se pasan SOLO los
 * códigos de la marca del equipo: nunca se cae a uno de otra marca (sería
 * pagarle a un afiliado de Clubify una venta de Sellea).
 *
 * Con varios aprobados no se adivina: queda sin código y con aviso.
 */
export function codigoParaLaVenta(codigos: CodigoDeAfiliado[]): { estado: EstadoDelCodigo; codigoId: string | null } {
  const validos = codigos.filter((c) => c.isActive && ROLES_CON_FIJO.includes(c.role));
  const aprobados = validos.filter((c) => !!c.approvedAt);
  if (aprobados.length === 1) return { estado: 'aprobado', codigoId: aprobados[0].id };
  if (aprobados.length > 1) return { estado: 'varios', codigoId: null };
  return { estado: validos.length ? 'sin_aprobar' : 'sin_codigo', codigoId: null };
}

export type AvisoDePersona = Exclude<EstadoDelCodigo, 'aprobado'> | 'codigo_nuevo';

/**
 * El aviso que se enseña junto a una persona de la venta. Manda lo GUARDADO: el
 * código se congela al vincular. Si entonces no tenía y hoy sí, se dice
 * (`codigo_nuevo`) en vez de callarlo, porque la venta sigue sin código hasta
 * que alguien la vuelva a guardar.
 */
export function avisoDePersona(codigoGuardado: string | null, vigente: EstadoDelCodigo): AvisoDePersona | null {
  if (codigoGuardado) return null;
  return vigente === 'aprobado' ? 'codigo_nuevo' : vigente;
}

// ── Sugerencias de negocio ──────────────────────────────────────────────────

export const MAX_SUGERENCIAS = 5;

export type NegocioParaSugerir = {
  id: string;
  nombre: string;
  email: string | null;
  phone: string | null;
  whatsappPhone: string | null;
};

export type MotivoDeSugerencia = 'telefono_y_correo' | 'telefono' | 'correo';
export type Sugerencia = {
  id: string;
  nombre: string;
  motivo: MotivoDeSugerencia;
  /** Otro negocio casó por lo MISMO: con estos datos no se distinguen. */
  ambigua: boolean;
};

/** Dígitos mínimos del lado corto para dar por bueno un sufijo. Ver `mismoTelefono`. */
export const MIN_DIGITOS_DE_TELEFONO = 10;

/**
 * ¿El mismo teléfono, PARA SUGERIR? Más estricto que `samePhone` de
 * `identity.ts`, que da por iguales dos números si uno es sufijo del otro con
 * ≥7 dígitos: un lead tecleado sin indicativo («3001122») casaría con cualquier
 * negocio acabado en eso, y en Sellea ya hay negocios que comparten cola. Aquí
 * un falso positivo termina en que alguien, con prisa, le atribuya a su equipo
 * el negocio de otro —y la comisión de esa venta a quien no la cerró—, así que
 * se exige el número nacional completo (10 dígitos) o igualdad.
 *
 * `identity.ts` NO se toca: allí ese umbral está bien (fundir dos fichas de más
 * es mejor que duplicar una persona) y lo usa medio producto.
 */
export function mismoTelefono(a?: string | null, b?: string | null): boolean {
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  if (!da || !db) return false;
  if (da === db) return true;
  // El nacional dentro de su E.164 (3001112233 ⊂ 573001112233) sigue casando.
  const [corto, largo] = da.length <= db.length ? [da, db] : [db, da];
  return corto.length >= MIN_DIGITOS_DE_TELEFONO && largo.endsWith(corto);
}

/**
 * Negocios de la marca que PODRÍAN ser este cliente. Solo sugiere: vincula una
 * persona, que lo confirma.
 *
 * El teléfono se compara con `mismoTelefono` (ver ahí por qué no con `samePhone`
 * ni con `phoneKey`, que es un cubo de candidatos y junta a São Paulo con Río).
 */
export function sugerirNegocios(
  lead: { phone?: string | null; email?: string | null },
  negocios: NegocioParaSugerir[],
): Sugerencia[] {
  const correo = emailNormOf(lead.email);
  const telefono = lead.phone?.trim() ? lead.phone : null;
  if (!correo && !telefono) return [];
  const orden: Record<MotivoDeSugerencia, number> = { telefono_y_correo: 0, telefono: 1, correo: 2 };
  const halladas: Array<{ id: string; nombre: string; porTelefono: boolean; porCorreo: boolean }> = [];
  for (const n of negocios) {
    const porTelefono = !!telefono && (mismoTelefono(telefono, n.phone) || mismoTelefono(telefono, n.whatsappPhone));
    const porCorreo = !!correo && emailNormOf(n.email) === correo;
    if (!porTelefono && !porCorreo) continue;
    halladas.push({ id: n.id, nombre: n.nombre, porTelefono, porCorreo });
  }
  // Dos negocios que casan por lo mismo no se distinguen con lo que hay: se
  // marcan para decirlo en la pantalla, en vez de que quien vincula elija el
  // primero de la lista creyendo que es el único.
  const conTelefono = halladas.filter((h) => h.porTelefono).length;
  const conCorreo = halladas.filter((h) => h.porCorreo).length;
  return halladas
    .map((h): Sugerencia => {
      const motivo: MotivoDeSugerencia =
        h.porTelefono && h.porCorreo ? 'telefono_y_correo' : h.porTelefono ? 'telefono' : 'correo';
      return {
        id: h.id,
        nombre: h.nombre,
        motivo,
        ambigua: (h.porTelefono && conTelefono > 1) || (h.porCorreo && conCorreo > 1),
      };
    })
    .sort((a, b) => orden[a.motivo] - orden[b.motivo] || a.nombre.localeCompare(b.nombre, 'es'))
    .slice(0, MAX_SUGERENCIAS);
}

/** Texto de búsqueda: al menos 2 letras, como mucho 60. */
export function normalizarBusqueda(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().replace(/\s+/g, ' ');
  return t.length >= 2 ? t.slice(0, 60) : null;
}

/** Un id que llega del cuerpo: texto no vacío, o null. */
export function normalizarId(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

// ── Closer y setter precargados ─────────────────────────────────────────────

export type CitaParaPrecarga = {
  status: string;
  hostUserId: string | null;
  agendadaPorUserId: string | null;
  startAt: Date | string;
};

/**
 * Quién cerró y quién agendó, deducido de las citas del lead. Solo PRECARGA:
 * la persona que vincula lo confirma o lo cambia.
 *
 * · La cita que cuenta: la última REALIZADA con closer; si ninguna se marcó
 *   realizada, la última no cancelada con closer.
 * · Closer = su `hostUserId`. Setter = quien la agendó desde dentro, de ESA
 *   misma cita. Una reserva por el enlace público no tiene setter, y no se
 *   rellena con quien agendó otra cita: sería atribuirle esta venta.
 * · Solo colaboradores activos: a quien ya no está no se le puede elegir.
 */
export function precargarPersonas(
  citas: CitaParaPrecarga[],
  activos: ReadonlySet<string>,
): { closerUserId: string | null; setterUserId: string | null } {
  const vivas = citas
    .filter((c) => c.status !== 'CANCELADA')
    .slice()
    .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime());
  const conCloser = (c: CitaParaPrecarga) => !!c.hostUserId && activos.has(c.hostUserId);
  const cita = vivas.find((c) => c.status === 'REALIZADA' && conCloser(c)) ?? vivas.find(conCloser) ?? null;
  if (!cita) return { closerUserId: null, setterUserId: null };
  const setter = cita.agendadaPorUserId && activos.has(cita.agendadaPorUserId) ? cita.agendadaPorUserId : null;
  return { closerUserId: cita.hostUserId, setterUserId: setter };
}

// ── «Solo la venta» o «también las renovaciones» ────────────────────────────

/**
 * Setting por MARCA: `salesTeams.commission.renewals.<slug>` = `renovaciones`
 * para pagar también cada renovación; cualquier otra cosa (o nada) = solo la
 * venta.
 *
 * Por marca y no por equipo: los montos ya son por marca y tipo de afiliado; por
 * equipo, el mismo tipo cobraría distinto según a qué equipo lo metan, y el
 * líder —que es un afiliado— movería lo que cobra. Solo afecta a closer y
 * setter: influencers y embajadores siguen como hoy (Javier).
 *
 * Se lee al VINCULAR y se congela en la venta: cambiarlo después no reescribe
 * lo que ya se vendió.
 */
export const AJUSTE_DE_RENOVACIONES = 'salesTeams.commission.renewals';

export function claveDeRenovaciones(slugDeMarca: string | null | undefined): string | null {
  const slug = typeof slugDeMarca === 'string' ? slugDeMarca.trim() : '';
  return slug ? `${AJUSTE_DE_RENOVACIONES}.${slug}` : null;
}

export function pagaRenovacionesSegunAjuste(valor: string | null | undefined): boolean {
  return valor === 'renovaciones';
}
