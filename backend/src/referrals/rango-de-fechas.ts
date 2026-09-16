/**
 * Rango de fechas del panel de comisiones (/admin/commissions, "Detalle
 * avanzado").
 *
 * EL FALLO QUE ESTO IMPIDE (16-09-2026, reportado por Javier con Serendipity):
 * el `where` filtraba por la COLUMNA `businessDate`, pero la columna "Fecha de
 * compra" que se pinta no siempre sale de ahí: cuando `businessDate` es NULL
 * —19 comisiones activas en producción— la fecha se CALCULA al leer
 * (`tenant.purchasedAt` o `commission.createdAt`). Resultado: la fila enseñaba
 * "26 ago" y al filtrar 16/08–31/08 desaparecía, porque en la base su
 * `businessDate` era NULL y NULL no entra en ningún rango.
 *
 * Se caían 10 comisiones ($158.90) en ese rango: las de Serendipity, El
 * Arrayán, Taqueria La Adelita, Mr. Pedidos, Oasispty_, ATHOS, Restaurante el
 * Establo, Café 1550 de Altitud y HABEMUS PIZZA — más la comisión del GRUPO
 * "Aldehir - Grupo Mistika" ($15 del 17/08), que no cuelga de ningún negocio
 * (`referralUseId` null, `businessGroupId` puesto) y que el panel pintaba
 * "(sin negocio)" por leer sólo `referralUse.tenant`. No era una comisión
 * huérfana: era la del grupo.
 *
 * La raíz no era el rango: era tener DOS fuentes para la misma fecha. Por eso
 * este módulo es el ÚNICO sitio donde se decide qué fecha representa una
 * comisión. Lo usan a la vez la consulta que filtra y el mapeo que pinta la
 * columna, así que no pueden volver a discrepar.
 */

/** Filtro de Prisma, suelto a propósito (igual que `baseWhere` en el service). */
type FiltroPrisma = Record<string, any>;

/** Días de "hold" antes de que una comisión PENDING pase a APPROVED. */
export const DIAS_DE_HOLD = 15;

const UN_DIA_MS = 86_400_000;

/** Tipo de fecha sobre el que operan el filtro Y la columna. */
export type TipoDeFecha = 'purchase' | 'payment' | 'batch' | 'available';

/** Rango medio abierto [gte, lt) en instantes UTC. */
export type RangoDeFechas = { gte?: Date; lt?: Date };

/**
 * Datos mínimos de una comisión para saber qué fecha le corresponde.
 * Se pasa plano para que esto siga siendo puro y testeable sin base de datos.
 */
export type FilaDeComision = {
  businessDate?: Date | string | null;
  createdAt: Date | string;
  availableAt?: Date | string | null;
  paidAt?: Date | string | null;
  /** `tenant.purchasedAt` del negocio de la comisión (si tiene negocio). */
  tenantPurchasedAt?: Date | string | null;
};

const aFecha = (d: Date | string | null | undefined): Date | null =>
  d === null || d === undefined ? null : new Date(d);

/**
 * Instante UTC de las 00:00 de Bogotá de ese día (UTC-5, sin DST).
 *
 * Todo el producto factura en horario de Bogotá: el usuario que escribe
 * "31/08" quiere el día 31 COMPLETO allí, no hasta las 19:00 como pasaría si
 * se anclara a UTC.
 */
export function inicioDelDiaBogota(ymd: string): Date {
  return new Date(`${ymd}T05:00:00.000Z`);
}

/**
 * Construye el rango a partir de los dos <input type="date"> del panel.
 * `hasta` es INCLUSIVO del día entero: se traduce a "< el día siguiente".
 * Devuelve null si no hay ninguna fecha puesta (= sin filtro).
 */
export function rangoBogota(
  desde?: string,
  hasta?: string,
): RangoDeFechas | null {
  if (!desde && !hasta) return null;
  const rango: RangoDeFechas = {};
  if (desde) rango.gte = inicioDelDiaBogota(desde);
  if (hasta)
    rango.lt = new Date(inicioDelDiaBogota(hasta).getTime() + UN_DIA_MS);
  return rango;
}

/** ¿Cae esa fecha dentro del rango? Una fecha nula nunca cae en ninguno. */
export function dentroDelRango(
  fecha: Date | null | undefined,
  rango: RangoDeFechas,
): boolean {
  if (!fecha) return false;
  const ms = fecha.getTime();
  if (rango.gte && ms < rango.gte.getTime()) return false;
  if (rango.lt && ms >= rango.lt.getTime()) return false;
  return true;
}

/**
 * Fecha efectiva de desbloqueo: la almacenada `availableAt` o, para comisiones
 * legacy sin ese campo, el fallback histórico createdAt + 15 días.
 */
export function fechaEfectivaDeDesbloqueo(fila: FilaDeComision): Date {
  const guardada = aFecha(fila.availableAt);
  if (guardada) return guardada;
  return new Date(aFecha(fila.createdAt)!.getTime() + DIAS_DE_HOLD * UN_DIA_MS);
}

/**
 * Fecha de compra CALCULADA, para las filas cuyo `businessDate` es NULL
 * (legacy / altas manuales que nacieron sin la fecha congelada).
 *
 * `primerCobroMs` = el desbloqueo efectivo MÁS ANTIGUO de ese negocio sobre
 * todo su historial: sirve para saber si esta comisión es la PRIMERA del
 * negocio (su venta inicial) o una recompra.
 *
 * GUARD R1: sólo se usa `tenant.purchasedAt` si no es muy posterior a la 1ª
 * comisión (<= createdAt + 1 día). Hubo un bug que estampó fechas de
 * RENOVACIÓN en `purchasedAt` de negocios legacy; en ese caso la fecha del
 * cobro real (createdAt) es la buena.
 */
export function fechaDeCompraCalculada(
  fila: FilaDeComision,
  primerCobroMs?: number,
): Date {
  const creada = aFecha(fila.createdAt)!;
  const comprada = aFecha(fila.tenantPurchasedAt);
  const cobroMs = fechaEfectivaDeDesbloqueo(fila).getTime();
  if (
    comprada &&
    primerCobroMs !== undefined &&
    cobroMs === primerCobroMs &&
    comprada.getTime() <= creada.getTime() + UN_DIA_MS
  ) {
    return comprada;
  }
  return creada;
}

/**
 * LA FECHA QUE EL PANEL PINTA en la primera columna, según el tipo activo.
 * Es la misma que tiene que decidir si la fila entra en el rango — de ahí que
 * viva en una sola función.
 */
export function fechaQuePintaElPanel(
  fila: FilaDeComision,
  tipo: TipoDeFecha,
  primerCobroMs?: number,
): Date | null {
  if (tipo === 'payment') return aFecha(fila.paidAt);
  if (tipo === 'available') return fechaEfectivaDeDesbloqueo(fila);
  if (tipo === 'batch') return null;
  // 'purchase': la congelada manda; si no hay, la calculada.
  return aFecha(fila.businessDate) ?? fechaDeCompraCalculada(fila, primerCobroMs);
}

/**
 * ¿Este tipo de fecha puede salir de un campo CALCULADO (y no sólo de una
 * columna)? Si sí, el `where` de SQL no puede ser exacto por sí solo y hay que
 * recortar en memoria con `fechaQuePintaElPanel`.
 *
 * - purchase  → businessDate puede ser NULL y calcularse. SÍ.
 * - available → availableAt puede ser NULL y calcularse (createdAt + 15d). SÍ.
 * - payment   → paidAt es la columna tal cual; NULL se pinta "—". No hace falta.
 * - batch     → no filtra por fecha.
 */
export function necesitaRecorteEnMemoria(tipo: TipoDeFecha): boolean {
  return tipo === 'purchase' || tipo === 'available';
}

/**
 * Fragmento de `where` para Prisma. Es un SUPERCONJUNTO a propósito: tiene que
 * dejar pasar toda fila que el panel pudiera pintar dentro del rango, porque
 * la fecha calculada no existe como columna y SQL no puede evaluarla.
 * El recorte exacto lo hace después `fechaQuePintaElPanel`.
 *
 * Lo que NO puede hacer nunca: dejar fuera una fila que el panel pinta dentro.
 * Eso es exactamente el bug que arreglamos.
 */
export function whereSupersetDeFecha(
  tipo: TipoDeFecha,
  rango: RangoDeFechas,
): FiltroPrisma {
  if (tipo === 'payment') return { paidAt: { ...rango } };

  if (tipo === 'available') {
    // availableAt NULL → se pinta createdAt + 15 días. Para no perderla,
    // se acepta si su createdAt cae en el rango corrido 15 días hacia atrás.
    const rangoCorrido: RangoDeFechas = {};
    if (rango.gte)
      rangoCorrido.gte = new Date(
        rango.gte.getTime() - DIAS_DE_HOLD * UN_DIA_MS,
      );
    if (rango.lt)
      rangoCorrido.lt = new Date(rango.lt.getTime() - DIAS_DE_HOLD * UN_DIA_MS);
    return {
      OR: [
        { availableAt: { ...rango } },
        { availableAt: null, createdAt: { ...rangoCorrido } },
      ],
    };
  }

  // 'purchase' (y cualquier otro): la congelada, o —si es NULL— cualquiera de
  // las dos fuentes de las que puede salir la calculada.
  return {
    OR: [
      { businessDate: { ...rango } },
      {
        businessDate: null,
        OR: [
          { createdAt: { ...rango } },
          { referralUse: { tenant: { purchasedAt: { ...rango } } } },
        ],
      },
    ],
  };
}
