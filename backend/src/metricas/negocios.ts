/**
 * Reglas puras de las listas de negocios de /admin/metricas: quién se quedó
 * sin clientes nuevos, quién usa el sistema y quién creció más en pases.
 *
 * Están aquí, fuera del servicio, porque son las que deciden a qué negocio se
 * llama primero: un error de orden o de filtro manda al equipo a perseguir al
 * negocio equivocado, y eso se prueba mejor sin base de datos.
 */

const DIA_MS = 86_400_000;

export type EstadoNegocio = 'ACTIVE' | 'TRIAL' | 'SUSPENDED';

export interface NegocioBase {
  id: string;
  nombre: string;
  estado: EstadoNegocio;
  creadoEn: Date;
}

export function diasDesde(fecha: Date, ahora: Date): number {
  return Math.max(0, Math.floor((ahora.getTime() - fecha.getTime()) / DIA_MS));
}

export interface ClientesDelNegocio {
  /** Clientes registrados dentro del rango consultado. */
  nuevosEnRango: number;
  total: number;
  ultimoClienteEn: Date | null;
}

export interface FilaSinClientesNuevos {
  id: string;
  nombre: string;
  estado: EstadoNegocio;
  enPrueba: boolean;
  /** Días desde su último cliente nuevo; `null` si nunca registró uno. */
  diasSinClienteNuevo: number | null;
  /**
   * Los días que se usan para ordenar: los de arriba, o —si nunca tuvo un
   * cliente— los que lleva dado de alta. Un negocio que entró hace 200 días y
   * jamás registró a nadie está peor que uno que lleva 30 sin registrar.
   */
  diasQuedado: number;
  ultimoClienteEn: Date | null;
  totalClientes: number;
  ultimoSelloEn: Date | null;
}

/**
 * Negocios ACTIVOS y EN PRUEBA que no registraron ningún cliente nuevo en el
 * rango, del más quedado al menos. Los suspendidos no entran: ya se sabe por
 * qué no registran, y meterlos taparía a los que sí hay que llamar.
 */
export function negociosSinClientesNuevos(
  negocios: NegocioBase[],
  clientes: Map<string, ClientesDelNegocio>,
  ultimoSello: Map<string, Date | null>,
  ahora: Date,
): FilaSinClientesNuevos[] {
  return negocios
    .filter((n) => n.estado === 'ACTIVE' || n.estado === 'TRIAL')
    .filter((n) => (clientes.get(n.id)?.nuevosEnRango ?? 0) === 0)
    .map((n) => {
      const c = clientes.get(n.id);
      const ultimo = c?.ultimoClienteEn ?? null;
      const dias = ultimo ? diasDesde(ultimo, ahora) : null;
      return {
        id: n.id,
        nombre: n.nombre,
        estado: n.estado,
        enPrueba: n.estado === 'TRIAL',
        diasSinClienteNuevo: dias,
        diasQuedado: dias ?? diasDesde(n.creadoEn, ahora),
        ultimoClienteEn: ultimo,
        totalClientes: c?.total ?? 0,
        ultimoSelloEn: ultimoSello.get(n.id) ?? null,
      };
    })
    .sort((a, b) => b.diasQuedado - a.diasQuedado || a.nombre.localeCompare(b.nombre, 'es'));
}

export interface UsoDelSistema<T extends NegocioBase> {
  activos: number;
  usan: number;
  sinUso: T[];
}

/**
 * Activos que movieron el sistema (al menos un movimiento del escáner o un
 * pedido) frente a los que no. Solo ACTIVOS: un negocio en prueba que no lo
 * usa es un problema de venta, no de uso, y ya sale en su propia lista.
 */
export function clasificarUso<T extends NegocioBase>(
  negocios: T[],
  conActividad: Set<string>,
): UsoDelSistema<T> {
  const activos = negocios.filter((n) => n.estado === 'ACTIVE');
  const sinUso = activos
    .filter((n) => !conActividad.has(n.id))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return { activos: activos.length, usan: activos.length - sinUso.length, sinUso };
}

export interface FilaCrecimiento {
  id: string;
  nombre: string;
  enRango: number;
  anterior: number;
}

/**
 * Los que más pases emitieron en el rango. Se ordena por el número absoluto y
 * no por el %: pasar de 1 a 4 es «+300 %» y no le gana a quien emitió 400.
 * Empate → el que venía de menos (creció más de verdad).
 */
export function topCrecimiento(
  negocios: Array<Pick<NegocioBase, 'id' | 'nombre'>>,
  enRango: Map<string, number>,
  anterior: Map<string, number>,
  n = 5,
): FilaCrecimiento[] {
  return negocios
    .map((x) => ({
      id: x.id,
      nombre: x.nombre,
      enRango: enRango.get(x.id) ?? 0,
      anterior: anterior.get(x.id) ?? 0,
    }))
    .filter((x) => x.enRango > 0)
    .sort((a, b) => b.enRango - a.enRango || a.anterior - b.anterior)
    .slice(0, n);
}
