/**
 * Traducción de lo que manda el Onboarding a lo que esperan los servicios de
 * Club y de Convenios.
 *
 * SOLO NORMALIZA. Las reglas de negocio —tramos que no se solapen, topes
 * coherentes con el cupo, slugs sin colisión, el módulo encendido— viven en
 * `ClubService` y `ConveniosService`, que son los que ya usa el panel. Aquí no
 * se repite ninguna: duplicarlas es exactamente cómo el panel y el sync acaban
 * aplicando criterios distintos, que ya pasó con el cobro de créditos y con
 * los premios intermedios.
 */

export const BENEFICIOS_VALIDOS = [
  'PERCENT_OFF',
  'AMOUNT_OFF',
  'FREEBIE',
  'TWO_FOR_ONE',
  'OTHER',
] as const;
export const PERIODOS_VALIDOS = ['SIEMPRE', 'DIA', 'SEMANA', 'MES', 'ANIO'] as const;
export const VERIFICACIONES_VALIDAS = ['ABIERTO', 'CODIGO', 'LISTA'] as const;

const texto = (v: unknown, max: number): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s ? s.slice(0, max) : undefined;
};

/** Entero dentro de un rango. Fuera de rango o no numérico → undefined, que
 *  significa «no lo toques», no «ponlo a cero». */
const entero = (v: unknown, min: number, max: number): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) return undefined;
  return n;
};

export type TramoAlta = { desdeDia: number; hastaDia: number; beneficios: number };

/**
 * Plan de club.
 *
 * `null` explícito en `maxPorDia`/`minutosEntreConsumos` SÍ se respeta: es la
 * forma de decir «quita el tope», distinta de no mandarlo.
 */
export function datosDePlanDeClub(b: any): {
  name?: string;
  description?: string;
  beneficiosPorMes?: number;
  unidad?: string;
  precioCents?: number;
  currency?: string;
  periodicidad?: string;
  maxPorDia?: number | null;
  minutosEntreConsumos?: number | null;
  tramos?: TramoAlta[];
} {
  const out: Record<string, unknown> = {};
  const name = texto(b?.name, 80);
  if (name) out.name = name;
  const desc = texto(b?.description, 500);
  if (desc !== undefined) out.description = desc;
  const cupo = entero(b?.beneficiosPorMes, 1, 100000);
  if (cupo !== undefined) out.beneficiosPorMes = cupo;
  const unidad = texto(b?.unidad, 30);
  if (unidad) out.unidad = unidad;
  // En la unidad MENOR de la moneda. En COP no hay decimales: 49000 son
  // 49.000 pesos. Mandar 490 por «49.000» es el error clásico y no hay forma
  // de detectarlo desde aquí — va avisado en la documentación.
  const precio = entero(b?.precioCents, 0, 1000000000);
  if (precio !== undefined) out.precioCents = precio;
  const cur = texto(b?.currency, 3);
  if (cur) out.currency = cur.toUpperCase();
  const per = texto(b?.periodicidad, 10);
  if (per) out.periodicidad = per.toUpperCase();

  // `null` explícito = quitar el tope. Ausente = no se toca.
  if (b?.maxPorDia === null) out.maxPorDia = null;
  else {
    const v = entero(b?.maxPorDia, 1, 1000);
    if (v !== undefined) out.maxPorDia = v;
  }
  if (b?.minutosEntreConsumos === null) out.minutosEntreConsumos = null;
  else {
    const v = entero(b?.minutosEntreConsumos, 1, 60 * 24 * 30);
    if (v !== undefined) out.minutosEntreConsumos = v;
  }

  if (Array.isArray(b?.tramosAlta)) {
    out.tramos = b.tramosAlta
      .map((t: any) => {
        const desde = entero(t?.desdeDia, 1, 31);
        const hasta = entero(t?.hastaDia, 1, 31);
        const ben = entero(t?.beneficios, 0, 100000);
        if (desde === undefined || hasta === undefined || ben === undefined) {
          return null;
        }
        return { desdeDia: desde, hastaDia: hasta, beneficios: ben };
      })
      .filter((t: TramoAlta | null): t is TramoAlta => t !== null)
      .sort((a: TramoAlta, b2: TramoAlta) => a.desdeDia - b2.desdeDia);
  }
  return out as any;
}

export type CuponDeConvenio = {
  name: string;
  tipo?: string;
  valor?: number;
  description?: string;
  terms?: string;
  maxPorPersona?: number | null;
  periodo?: string;
};

/** Convenio (alianza con una empresa). */
export function datosDeConvenio(b: any): {
  name?: string;
  logoUrl?: string;
  description?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  verificacion?: string;
  codigo?: string;
  endsAt?: Date | null;
  cupones?: CuponDeConvenio[];
} {
  const out: Record<string, unknown> = {};
  const name = texto(b?.name, 120);
  if (name) out.name = name;
  for (const [k, max] of [
    ['logoUrl', 500],
    ['description', 1000],
    ['contactName', 120],
    ['contactEmail', 200],
    ['contactPhone', 40],
  ] as const) {
    const v = texto(b?.[k], max);
    if (v !== undefined) out[k] = v;
  }
  const verif = texto(b?.verificacion, 10)?.toUpperCase();
  // Un modo desconocido NO se convierte en ABIERTO: eso abriría el convenio a
  // cualquiera por una errata. Se ignora y manda el que hubiera.
  if (verif && (VERIFICACIONES_VALIDAS as readonly string[]).includes(verif)) {
    out.verificacion = verif;
  }
  const cod = texto(b?.codigo, 40);
  if (cod) out.codigo = cod.toUpperCase();
  if (b?.endsAt === null) out.endsAt = null;
  else if (b?.endsAt !== undefined) {
    const d = new Date(String(b.endsAt));
    if (!Number.isNaN(d.getTime())) out.endsAt = d;
  }

  if (Array.isArray(b?.cupones)) {
    out.cupones = b.cupones
      .map((c: any) => {
        const nombre = texto(c?.name, 120);
        if (!nombre) return null; // un cupón sin nombre no se puede ni listar
        const tipo = texto(c?.tipo, 20)?.toUpperCase();
        const periodo = texto(c?.periodo, 10)?.toUpperCase();
        const cupon: CuponDeConvenio = { name: nombre };
        if (tipo && (BENEFICIOS_VALIDOS as readonly string[]).includes(tipo)) {
          cupon.tipo = tipo;
        }
        const valor = entero(c?.valor, 0, 100000000);
        if (valor !== undefined) cupon.valor = valor;
        const d = texto(c?.description, 1000);
        if (d !== undefined) cupon.description = d;
        const t = texto(c?.terms, 2000);
        if (t !== undefined) cupon.terms = t;
        if (c?.maxPorPersona === null) cupon.maxPorPersona = null;
        else {
          const m = entero(c?.maxPorPersona, 1, 10000);
          if (m !== undefined) cupon.maxPorPersona = m;
        }
        if (periodo && (PERIODOS_VALIDOS as readonly string[]).includes(periodo)) {
          cupon.periodo = periodo;
        }
        return cupon;
      })
      .filter((c: CuponDeConvenio | null): c is CuponDeConvenio => c !== null);
  }
  return out as any;
}
