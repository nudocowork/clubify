/**
 * Las sedes que llegan del Onboarding, y qué pasa con cada producto en cada una.
 *
 * El Onboarding no conoce los ids de Clubify. Manda **su** id (`externalId`) y
 * el nombre que el cliente escribió, y casar eso con la sede real es lo único
 * que hace este archivo. Vive aparte y sin base de datos a propósito: es la
 * pieza que decide si un plato aparece en la carta de un local, y equivocarse
 * aquí le enseña a un cliente algo que esa cocina no hace.
 *
 * POR QUÉ EL `externalId` MANDA SOBRE EL NOMBRE
 * ---------------------------------------------
 * Porque el nombre cambia. El día que alguien corrige «Sede Cacique» por
 * «Cacique Mall», casar por nombre no encuentra la sede y **crea una segunda**:
 * el negocio acaba con dos sedes, los productos repartidos entre ellas y nadie
 * entendiendo por qué media carta desapareció. Con el id propio del Onboarding
 * eso es un cambio de nombre y nada más.
 *
 * El nombre se sigue usando de respaldo, y hace falta: las sedes que ya existen
 * en producción se crearon antes de que hubiera `externalId` y no tienen
 * ninguno. La primera sincronización las encuentra por nombre y les graba el
 * id; a partir de ahí van por id.
 *
 * ANTE LA DUDA, EL PRODUCTO SE VENDE
 * ----------------------------------
 * Es la misma regla de `producto-en-sede.ts` y aquí importa el doble, porque
 * quien manda los datos es un formulario que el negocio llenó a mano. Si nada
 * casa —el push de sedes falló, alguien renombró la sede en el panel— el
 * producto queda en TODAS y se ve. La falla contraria vacía la carta entera y
 * nadie se entera hasta que un cliente escanea el QR.
 */

/** Nombre de sede → llave estable para compararlos. «Sede Cabecera» = «sede cabecera». */
export function llaveDeSede(nombre: unknown): string {
  return String(nombre ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface SedeConocida {
  id: string;
  name: string;
  /** El id que le puso el Onboarding. Null en las sedes creadas a mano. */
  externalId?: string | null;
}

/** Cómo viene una sede referida desde el Onboarding. */
export interface ReferenciaDeSede {
  externalId?: unknown;
  name?: unknown;
  locationName?: unknown;
}

/**
 * Índice de las sedes de un negocio, por id del Onboarding y por nombre.
 *
 * Se construye UNA vez por sincronización: un catálogo trae cientos de
 * productos y Licores El Amanecer tiene 545.
 */
export function indexarSedes(sedes: SedeConocida[]) {
  const porExterno = new Map<string, string>();
  const porNombre = new Map<string, string>();
  for (const s of sedes) {
    const ext = String(s.externalId ?? '').trim();
    if (ext && !porExterno.has(ext)) porExterno.set(ext, s.id);
    // La primera sede con ese nombre gana. Dos sedes homónimas son un problema
    // del negocio, no una razón para dejar el producto sin carta.
    const k = llaveDeSede(s.name);
    if (k && !porNombre.has(k)) porNombre.set(k, s.id);
  }
  return { porExterno, porNombre };
}

type IndiceDeSedes = ReturnType<typeof indexarSedes>;

/** La sede a la que apunta una referencia, o null si no existe. */
export function resolverSede(
  ref: ReferenciaDeSede,
  idx: IndiceDeSedes,
): string | null {
  const ext = String(ref.externalId ?? '').trim();
  if (ext) {
    const porId = idx.porExterno.get(ext);
    // Si trae id del Onboarding y no lo conocemos, NO se cae al nombre: esa
    // sede es nueva y le toca crearse en `/sync/locations`, no engancharse a
    // otra que se llame parecido.
    if (porId) return porId;
    if (ref.name === undefined && ref.locationName === undefined) return null;
  }
  const nombre = String(ref.name ?? ref.locationName ?? '').trim();
  if (!nombre) return null;
  return idx.porNombre.get(llaveDeSede(nombre)) ?? null;
}

/** Cómo se llama una referencia, para poder informarla cuando no casa. */
function etiqueta(ref: ReferenciaDeSede): string {
  const nombre = String(ref.name ?? ref.locationName ?? '').trim();
  if (nombre) return nombre;
  const ext = String(ref.externalId ?? '').trim();
  return ext ? `#${ext}` : '(sin nombre)';
}

export interface SedesDeProducto {
  modo: 'TODAS' | 'SELECCIONADAS';
  /** Sedes donde se vende. Vacío cuando el modo es TODAS. */
  locationIds: string[];
  /** Referencias que no casaron con ninguna sede. Se informan, no rompen el sync. */
  desconocidas: string[];
}

/**
 * En qué sedes se vende un producto que llega del Onboarding.
 *
 * Devuelve `null` cuando el payload **no habla de sedes**, y eso no es lo mismo
 * que «en ninguna»: un onboarding de menú único, o una versión vieja del
 * asistente, no puede borrarle al negocio lo que configuró a mano en el panel.
 */
export function resolverSedesDeProducto(
  entrada: {
    locationMode?: unknown;
    locationNames?: unknown;
    locationExternalIds?: unknown;
  },
  sedes: SedeConocida[],
): SedesDeProducto | null {
  const sinModo = entrada.locationMode === undefined || entrada.locationMode === null;
  const hayNombres = Array.isArray(entrada.locationNames);
  const hayExternos = Array.isArray(entrada.locationExternalIds);
  if (sinModo && !hayNombres && !hayExternos) return null;

  const quiereSeleccionadas =
    String(entrada.locationMode ?? '')
      .trim()
      .toUpperCase() === 'SELECCIONADAS' ||
    (sinModo && (hayNombres || hayExternos));

  if (!quiereSeleccionadas) {
    return { modo: 'TODAS', locationIds: [], desconocidas: [] };
  }

  const idx = indexarSedes(sedes);
  // Si vienen los ids del Onboarding, mandan ELLOS y los nombres se ignoran:
  // son la misma lista dicha dos veces. Mezclarlas marcaba como «sede
  // desconocida» el nombre nuevo de una sede que el id ya había encontrado —
  // justo el caso que el id existe para resolver.
  //
  // Un id que no conocemos NO se busca por nombre: es una sede nueva y sale en
  // `desconocidas`, que es la señal de que falta mandar `PUT /sync/locations`
  // antes que los productos.
  const refs: ReferenciaDeSede[] = hayExternos
    ? (entrada.locationExternalIds as unknown[]).map((e) => ({ externalId: e }))
    : (entrada.locationNames as unknown[]).map((n) => ({ name: n }));

  const locationIds: string[] = [];
  const desconocidas: string[] = [];
  for (const ref of refs) {
    if (
      String(ref.externalId ?? '').trim() === '' &&
      String(ref.name ?? '').trim() === ''
    ) {
      continue;
    }
    const id = resolverSede(ref, idx);
    if (!id) {
      desconocidas.push(etiqueta(ref));
      continue;
    }
    if (!locationIds.includes(id)) locationIds.push(id);
  }

  // Nada casó: o el push de sedes no llegó, o los nombres cambiaron. Dejar
  // SELECCIONADAS con cero sedes esconde el producto en todas partes — que es
  // justo el daño que no puede causar un sync automático.
  if (locationIds.length === 0) {
    return { modo: 'TODAS', locationIds: [], desconocidas };
  }

  // Marcadas TODAS las sedes de hoy. Se guarda como SELECCIONADAS igualmente:
  // el cliente eligió esta lista, no «y también las que abran mañana». Esa
  // diferencia es el motivo de que el modo sea un campo y no se deduzca de las
  // filas (ver `producto-en-sede.ts`).
  return { modo: 'SELECCIONADAS', locationIds, desconocidas };
}

/** Lo que UNA sede cambia de un producto. Solo lo que venga con valor. */
export interface OverrideDeSede {
  locationId: string;
  price?: number;
  imageUrl?: string;
  description?: string;
  isAvailable?: boolean;
}

/**
 * Qué cambia cada sede: precio, foto, texto o agotado.
 *
 * Es independiente de dónde se vende. Un producto en TODAS puede igualmente
 * tener filas —ahí sirven para el precio propio de una sede, no para decidir
 * dónde se vende— y esa distinción es la que sostiene el modelo entero (ver
 * `producto-en-sede.ts`).
 *
 * **Solo escribe lo que llega con valor; nunca vacía un campo.** El formulario
 * del Onboarding se rellena una vez, al principio, y después el negocio trabaja
 * en el panel. Si un reenvío del módulo pudiera borrar campos, el día que
 * alguien reabre el Onboarding le limpia a la sede el precio que llevaba meses
 * cobrando. Vaciar se hace desde el panel, que es donde se ve lo que hay.
 */
export function resolverOverridesDeProducto(
  entrada: { locationOverrides?: unknown },
  sedes: SedeConocida[],
): { overrides: OverrideDeSede[]; desconocidas: string[] } {
  if (!Array.isArray(entrada.locationOverrides)) {
    return { overrides: [], desconocidas: [] };
  }

  const idx = indexarSedes(sedes);
  const overrides: OverrideDeSede[] = [];
  const desconocidas: string[] = [];
  const vistas = new Set<string>();

  for (const o of entrada.locationOverrides) {
    if (!o || typeof o !== 'object') continue;
    const fila = o as Record<string, unknown>;
    const ref: ReferenciaDeSede = {
      externalId: fila.externalId ?? fila.locationExternalId,
      name: fila.name,
      locationName: fila.locationName,
    };
    if (
      String(ref.externalId ?? '').trim() === '' &&
      String(ref.name ?? ref.locationName ?? '').trim() === ''
    ) {
      continue;
    }

    const locationId = resolverSede(ref, idx);
    if (!locationId) {
      desconocidas.push(etiqueta(ref));
      continue;
    }
    if (vistas.has(locationId)) continue; // dos líneas para la misma sede: manda la primera
    vistas.add(locationId);

    const out: OverrideDeSede = { locationId };

    const precio = Number(fila.price);
    if (fila.price != null && fila.price !== '' && Number.isFinite(precio) && precio >= 0) {
      out.price = precio;
    }

    const foto = typeof fila.imageUrl === 'string' ? fila.imageUrl.trim() : '';
    // Solo URLs descargables: una data: URL en base64 no se puede servir desde
    // el menú y además infla la fila a varios MB.
    if (/^https?:\/\//i.test(foto)) out.imageUrl = foto;

    const texto =
      typeof fila.description === 'string' ? fila.description.trim() : '';
    if (texto) out.description = texto;

    if (typeof fila.isAvailable === 'boolean') out.isAvailable = fila.isAvailable;

    // Una línea que no cambia nada no es una fila: «sin filas = como el
    // producto» es la regla de la que cuelga todo lo demás.
    if (
      out.price !== undefined ||
      out.imageUrl !== undefined ||
      out.description !== undefined ||
      out.isAvailable !== undefined
    ) {
      overrides.push(out);
    }
  }

  return { overrides, desconocidas };
}
