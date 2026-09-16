/**
 * ¿En qué fecha cobra la pasarela, y podemos fiarnos de la que tenemos escrita?
 *
 * Reglas PURAS (sin DB, sin efectos) sobre `currentPeriodEnd`, el campo del que
 * cuelgan TODOS los avisos previos al cobro (D-7, D-3, D-1 y D-0). Si esa fecha
 * miente, los avisos se programan para el día equivocado y el negocio no recibe
 * ninguno: no falla el envío, falla el calendario.
 *
 * QUÉ ARREGLA ESTO Y QUÉ NO — para no contar mal la historia
 * ---------------------------------------------------------
 * La raíz del desfase que dejó a Café Macondo sin avisos ya estaba arreglada
 * desde el **2026-08-18** (`f8b067df`): hasta entonces `nextChargeFromPayload`
 * no leía `purchase.date_next_charge`, así que las compras caían al fallback de
 * primer pago. Hoy Hotmart manda esa fecha en los 46/46 payloads de compra de
 * producción y el fallback casi nunca entra. Los 18 negocios desalineados que
 * se midieron el 2026-09-16 se procesaron entre el 24-06 y el 16-08: todos
 * ANTERIORES a aquel arreglo, y se reparan con
 * `scripts/corregir-fecha-de-cobro.cjs`, no con código.
 *
 * Lo de aquí es el CINTURÓN para el payload que no traiga `date_next_charge`
 * —raro, pero posible—: que la fecha se calcule desde el pago y no desde el día
 * en que procesamos el webhook. El caso Macondo enseña por qué importa: compró
 * el 16-06, el webhook llegó el 24-06 al cerrar la ventana de garantía, y
 * «hoy + 3 meses» dejó escrito el 24-09 cuando Hotmart cobraba el 16-09. El D-7
 * quedó para el 17-09, el D-3 para el 21-09 y el D-0 para el 24-09: los tres
 * DESPUÉS del cobro real, y el negocio se enteró con el «tu pago falló».
 */
import { addPlanPeriod } from '../common/plan-period';

const DIA_MS = 24 * 60 * 60 * 1000;

/** Margen por drift de fechas de la pasarela. Mismo umbral que `paidButStale`. */
export const MARGEN_DESFASE_DIAS = 2;

/** Epoch en ms por debajo del cual no nos fiamos (2001-09-09). Un epoch en
 *  SEGUNDOS de hoy (~1,7e9) cae aquí, que es justo lo que queremos descartar. */
const UMBRAL_EPOCH_MS = 1e12;

/** Tope de vueltas al avanzar ciclos. Mismo guard que `nextChargeAfterPayment`. */
const TOPE_CICLOS = 240;

export interface FechaDeCobroState {
  currentPeriodEnd: Date | null;
  lastChargeAt: Date | null;
  planPeriodicity: string | null;
}

/**
 * `approved_date` de Hotmart → Date, o null si no es de fiar.
 *
 * Está tipado como `number` (epoch en MILISEGUNDOS), pero llega de un webhook y
 * de un webhook llega lo que sea. Dos formas de colar una fecha basura:
 *   - epoch en SEGUNDOS (~1,7e9): `new Date()` lo lee como enero de 1970.
 *   - ese mismo número como STRING: `new Date('1750000000')` es Invalid Date, y
 *     el `toISOString()` del log de más abajo revienta con RangeError.
 *
 * Las dos acaban escritas en `lastChargeAt` y `purchasedAt`, que son la base de
 * la primera comisión, y desde el cambio de ancla también en la fecha de cobro.
 * Ante la duda, null: el llamador cae a «hoy», que es lo que se hacía siempre
 * cuando la fecha no venía.
 */
export function fechaDePagoAprobado(raw: unknown): Date | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (Number.isFinite(n)) {
    // Por debajo del umbral son segundos (o basura): no hay forma honesta de
    // distinguirlos de una fecha real, así que no se adivina.
    if (n <= UMBRAL_EPOCH_MS) return null;
    const d = new Date(n);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // Fecha en texto (ISO). Mismo guard de NaN que `nextChargeFromPayload`.
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Primer cobro cuando la pasarela NO manda `date_next_charge`.
 *
 * El ancla es la fecha REAL del pago (`approved_date`), nunca el día en que
 * procesamos el webhook: entre una cosa y otra pueden pasar días y ese hueco se
 * queda escrito en la fecha de cobro para siempre (caso Macondo). Sin
 * `approved_date` fiable no queda más remedio que usar hoy; el ancla se
 * devuelve para poder decirlo en el log.
 */
export function primerCobroSinFechaDeLaPasarela(
  pagoAprobado: Date | null,
  ahora: Date,
  periodicidad: string | null,
): { fecha: Date; ancla: 'pago' | 'hoy'; ciclosAdelantados: number } {
  const base = pagoAprobado ?? ahora;
  let fecha = addPlanPeriod(base, periodicidad);
  // COTA INFERIOR — el hueco que abre anclar en el pago, y que anclando en
  // «hoy» era imposible: si el pago es viejo (un pendiente que se consume meses
  // después), «pago + período» cae en el PASADO. El negocio nacería VENCIDO con
  // `failedPaymentCount = 0`, así que `decideDunning` ancla la mora en
  // `currentPeriodEnd`, lo manda a D+1 y acaba suspendiéndolo PAGANDO.
  // Se avanza por períodos completos hasta el futuro, igual que
  // `BillingService.nextChargeAfterPayment`.
  let ciclosAdelantados = 0;
  while (fecha.getTime() <= ahora.getTime() && ciclosAdelantados < TOPE_CICLOS) {
    fecha = addPlanPeriod(fecha, periodicidad);
    ciclosAdelantados++;
  }
  return { fecha, ancla: pagoAprobado ? 'pago' : 'hoy', ciclosAdelantados };
}

/**
 * El caso SIMÉTRICO de `paidButStale`: nuestra fecha de cobro va DESPUÉS del
 * ciclo real (último cobro + periodicidad).
 *
 * `paidButStale` solo mira el desfase hacia ATRÁS —la fecha se quedó vieja
 * porque el pago ya entró— y por eso el caso Macondo pasó desapercibido: una
 * fecha que va por DELANTE no dispara ninguna alarma, simplemente calla los
 * avisos hasta que el cobro ya falló.
 *
 * Devuelve los días de desfase, o null si la fecha está alineada (dentro del
 * margen) o no hay datos suficientes para afirmarlo.
 */
export function diasDeFechaTardia(
  t: FechaDeCobroState,
  margenDias: number = MARGEN_DESFASE_DIAS,
): number | null {
  if (!t.currentPeriodEnd || !t.lastChargeAt) return null;
  const esperado = addPlanPeriod(t.lastChargeAt, t.planPeriodicity);
  const dias = (t.currentPeriodEnd.getTime() - esperado.getTime()) / DIA_MS;
  return dias > margenDias ? Math.round(dias) : null;
}
