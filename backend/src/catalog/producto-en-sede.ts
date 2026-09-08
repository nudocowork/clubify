/**
 * Qué vende una sede, y a qué precio.
 *
 * Toda la decisión del menú por sede vive aquí, en funciones puras y sin base
 * de datos, por un motivo concreto: es lo que ve el cliente cuando escanea el
 * QR de un local. Equivocarse aquí no rompe el panel — le enseña a alguien un
 * plato que esa cocina no hace, o se lo cobra a otro precio.
 *
 * LAS DOS REGLAS, Y DE ELLAS SALE TODO LO DEMÁS
 * ---------------------------------------------
 *
 *  1. **Sin filas = en todas las sedes.** Es el estado de los 3.447 productos
 *     que ya existen, y el de 25 de los 26 negocios con más de una sede, que
 *     comparten una sola carta. No mantienen nada, nunca, abran los locales
 *     que abran.
 *
 *  2. **Null en un campo = lo mismo que el producto.** Una sede que no
 *     personaliza el precio no guarda precio, así que hereda sola el día que
 *     cambie el de base. Es la lección de las cartas duplicadas: allí había
 *     que replicar cada cambio carta por carta, y una copia desincronizada no
 *     se veía hasta que un cliente pagaba de menos.
 *
 * «TODAS» NO ES «TODAS LAS CASILLAS MARCADAS»
 * -------------------------------------------
 * Y la diferencia solo se nota el día que abren una sede:
 *
 *   · en TODAS          → el producto entra solo.
 *   · en SELECCIONADAS  → no entra; alguien decide si lo añade.
 *
 * Las dos cosas hacen falta a la vez, y por eso el modo es un campo y no se
 * deduce de si hay filas o no.
 */

export interface ProductoBase {
  id: string;
  locationMode?: string | null;
  basePrice: unknown;
  isAvailable?: boolean | null;
  stock?: number | null;
}

export interface FilaDeSede {
  productId: string;
  locationId: string;
  selected: boolean;
  price?: unknown;
  isAvailable?: boolean | null;
  stock?: number | null;
}

/** El producto tal y como lo ve UNA sede. */
export interface ProductoResuelto<T extends ProductoBase> {
  producto: T;
  /** Precio que se le cobra al cliente en esta sede. */
  price: number;
  /** Si se puede pedir aquí y ahora. */
  isAvailable: boolean;
  stock: number | null;
  /** true si esta sede tiene algo propio (precio, agotado o stock). */
  personalizado: boolean;
}

const SELECCIONADAS = 'SELECCIONADAS';

/** Índice por producto+sede, para no recorrer el array por cada producto. */
export function indexarFilas(filas: FilaDeSede[]): Map<string, FilaDeSede> {
  const m = new Map<string, FilaDeSede>();
  for (const f of filas) m.set(`${f.productId}::${f.locationId}`, f);
  return m;
}

/**
 * ¿Se vende este producto en esta sede?
 *
 * `locationId` null significa «no estoy mirando una sede concreta» — el enlace
 * general del negocio, el panel, el buscador. Ahí se ve todo: esconder el
 * catálogo porque no vino una sede en la URL dejaría el menú general vacío.
 */
export function seVendeEn(
  producto: ProductoBase,
  locationId: string | null,
  porSede: Map<string, FilaDeSede>,
): boolean {
  if (!locationId) return true;
  const fila = porSede.get(`${producto.id}::${locationId}`);

  if (producto.locationMode === SELECCIONADAS) {
    // Solo donde alguien lo marcó. Sin fila, esta sede no lo hace.
    return !!fila?.selected;
  }

  // TODAS (y cualquier valor viejo o corrupto, que se trata como TODAS a
  // propósito: ante la duda, el producto se vende — es lo que pasaba ayer).
  return true;
}

/** El producto resuelto para una sede: precio, disponibilidad y stock. */
export function resolverEnSede<T extends ProductoBase>(
  producto: T,
  locationId: string | null,
  porSede: Map<string, FilaDeSede>,
): ProductoResuelto<T> {
  const fila = locationId
    ? porSede.get(`${producto.id}::${locationId}`)
    : undefined;

  const precioPropio = Number(fila?.price);
  const tienePrecio = fila?.price != null && Number.isFinite(precioPropio);

  const precioBase = Number(producto.basePrice);
  const price = tienePrecio
    ? precioPropio
    : Number.isFinite(precioBase)
      ? precioBase
      : 0;

  // Agotado manda el que diga que NO. Si el producto está agotado en general,
  // una sede no puede venderlo aunque su fila diga que sí: lo contrario deja
  // entrar pedidos de algo que el negocio marcó como no disponible.
  const disponibleEnGeneral = producto.isAvailable !== false;
  const disponibleAqui = fila?.isAvailable ?? null;
  const isAvailable =
    disponibleEnGeneral && (disponibleAqui === null ? true : disponibleAqui);

  const stock = fila?.stock ?? producto.stock ?? null;

  return {
    producto,
    price,
    isAvailable,
    stock,
    personalizado:
      !!fila &&
      (fila.price != null || fila.isAvailable != null || fila.stock != null),
  };
}

/**
 * El catálogo de una sede: filtra lo que no se vende y resuelve el resto.
 *
 * Una sola pasada, sin consultas dentro del bucle. Licores El Amanecer tiene
 * 545 productos en 2 sedes; una consulta por producto serían 545 idas a la
 * base cada vez que un cliente abre el menú.
 */
export function catalogoDeSede<T extends ProductoBase>(
  productos: T[],
  locationId: string | null,
  filas: FilaDeSede[],
): ProductoResuelto<T>[] {
  const porSede = indexarFilas(filas);
  const salida: ProductoResuelto<T>[] = [];
  for (const p of productos) {
    if (!seVendeEn(p, locationId, porSede)) continue;
    salida.push(resolverEnSede(p, locationId, porSede));
  }
  return salida;
}

/**
 * En qué sedes se vende un producto, para pintarlo en el panel.
 *
 * Devuelve `null` cuando es «todas las sedes» — que es un estado, no una
 * lista, y hay que enseñarlo como tal. Devolver aquí los ids de todas las
 * sedes de hoy sería mentir: mañana hay una más y también estaría dentro.
 */
export function sedesDeProducto(
  producto: ProductoBase,
  filas: FilaDeSede[],
): string[] | null {
  if (producto.locationMode !== SELECCIONADAS) return null;
  return filas
    .filter((f) => f.productId === producto.id && f.selected)
    .map((f) => f.locationId);
}
