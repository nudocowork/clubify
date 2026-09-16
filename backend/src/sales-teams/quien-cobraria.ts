/**
 * Quién cobraría una venta cerrada por un equipo, y cuánto.
 *
 * PURO Y SIN USAR, a propósito. El motor de comisiones (Jhon) lo llamará
 * cuando se enganche el pago; hoy no lo invoca nada, ni el motor ni ninguna
 * pantalla. Existe para que las reglas que decidió Javier queden escritas y
 * probadas antes de tocar dinero.
 *
 * Reglas (Javier, 2026-09-15):
 *  · Closer y setter cobran el FIJO DE SU TIPO de afiliado en la marca, con el
 *    mismo cálculo que ya usa el motor para el referidor en modo FIXED_ONCE
 *    (`hotmart.service.ts`, `generateReferralCommission`): el
 *    `fixedCommissionUsd` del código si lo trae; si no, el de la marca por rol
 *    (embajador o influencer).
 *  · Closer y setter la misma persona (mismo código) → UNA sola vez.
 *  · El referidor que trajo el negocio cobra APARTE y SE SUMA, aunque sea la
 *    misma persona que cerró: son dos papeles distintos.
 *  · Renovaciones: closer y setter solo si la venta se vinculó con
 *    `pagaRenovaciones`. El referidor, nunca: en la marca de pago único
 *    influencers y embajadores siguen como hoy.
 *  · Sin código activo, aprobado y con rol de fijo → no cobra, con aviso.
 */

export type MontosDeMarca = { influencer: number; embajador: number };

export type CodigoParaCobro = {
  id: string;
  role: string;
  isActive: boolean;
  approvedAt: Date | string | null;
  fixedCommissionUsd: number | string | null;
};

export type Papel = 'closer' | 'setter' | 'referidor';
export type Cobro = { codigoId: string; papeles: Papel[]; monto: number };
export type MotivoSinCobro = 'sin_codigo' | 'inactivo' | 'rol_sin_fijo' | 'sin_aprobar';
export type AvisoDeCobro = { papel: 'closer' | 'setter'; motivo: MotivoSinCobro };

const ROLES_CON_FIJO: readonly string[] = ['INFLUENCER', 'AMBASSADOR'];
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * El fijo de un código. Espeja al motor: con `fixedCommissionUsd` puesto manda
 * ese número; sin él, el de la marca por rol. Si el número guardado no se
 * entiende, cae al de la marca en vez de devolver NaN.
 */
export function montoFijoDelCodigo(
  code: Pick<CodigoParaCobro, 'role' | 'fixedCommissionUsd'>,
  montos: MontosDeMarca,
): number {
  const porRol = code.role === 'AMBASSADOR' ? montos.embajador : montos.influencer;
  if (code.fixedCommissionUsd == null) return porRol;
  const propio = Number(code.fixedCommissionUsd);
  return Number.isFinite(propio) ? r2(propio) : porRol;
}

function motivoSinCobro(code: CodigoParaCobro | null): MotivoSinCobro | null {
  if (!code) return 'sin_codigo';
  if (!code.isActive) return 'inactivo';
  if (!ROLES_CON_FIJO.includes(code.role)) return 'rol_sin_fijo';
  if (!code.approvedAt) return 'sin_aprobar';
  return null;
}

export function quienCobraria(entrada: {
  closer: CodigoParaCobro | null;
  setter: CodigoParaCobro | null;
  /** El código que trajo el negocio (su atribución de siempre), si hay. */
  referidor: CodigoParaCobro | null;
  montos: MontosDeMarca;
  esRenovacion: boolean;
  /** Congelado en la venta al vincularla. */
  pagaRenovaciones: boolean;
}): { cobros: Cobro[]; avisos: AvisoDeCobro[]; total: number } {
  const avisos: AvisoDeCobro[] = [];
  const delEquipo: Cobro[] = [];

  for (const [papel, code] of [
    ['closer', entrada.closer],
    ['setter', entrada.setter],
  ] as const) {
    const motivo = motivoSinCobro(code);
    if (motivo) {
      avisos.push({ papel, motivo });
      continue;
    }
    if (!code) continue;
    const ya = delEquipo.find((c) => c.codigoId === code.id);
    if (ya) {
      ya.papeles.push(papel);
      continue;
    }
    delEquipo.push({ codigoId: code.id, papeles: [papel], monto: montoFijoDelCodigo(code, entrada.montos) });
  }

  const cobros: Cobro[] = [];
  if (!entrada.esRenovacion || entrada.pagaRenovaciones) cobros.push(...delEquipo);

  // El referidor, como hoy: solo en la venta, y aparte aunque sea la misma persona.
  const ref = entrada.referidor;
  if (!entrada.esRenovacion && ref && ref.isActive && ROLES_CON_FIJO.includes(ref.role)) {
    cobros.push({ codigoId: ref.id, papeles: ['referidor'], monto: montoFijoDelCodigo(ref, entrada.montos) });
  }

  return { cobros, avisos, total: r2(cobros.reduce((s, c) => s + c.monto, 0)) };
}
