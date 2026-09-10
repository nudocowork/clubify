/**
 * Las sedes que llegan del Onboarding, y en cuáles se vende cada producto.
 *
 * El Onboarding no conoce los ids de Clubify. El cliente escribe «Sede
 * Cabecera» en un formulario y eso —un texto— es todo lo que viaja. Casar ese
 * texto con la sede real es lo único que hace este archivo, y vive aparte y
 * sin base de datos a propósito: es la pieza que decide si un plato aparece en
 * la carta de un local, y equivocarse aquí le enseña a un cliente algo que esa
 * cocina no hace.
 *
 * ANTE LA DUDA, EL PRODUCTO SE VENDE
 * ----------------------------------
 * Es la misma regla de `producto-en-sede.ts` y aquí importa el doble, porque
 * el que manda los datos es un formulario que el negocio llenó a mano. Si los
 * nombres no casan con nada —el push de sedes falló, alguien renombró la sede
 * en el panel, el cliente escribió «Cra 27» en vez de «Sede Centro»— el
 * producto queda en TODAS y se ve. La falla contraria vacía la carta entera y
 * nadie se entera hasta que un cliente escanea el QR.
 */

/** Nombre de sede → llave estable para compararlos. «Sede Cabecera» = «sede cabecera». */
export function llaveDeSede(nombre: unknown): string {
  return String(nombre ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface SedeConocida {
  id: string;
  name: string;
}

export interface SedesDeProducto {
  modo: 'TODAS' | 'SELECCIONADAS';
  /** Sedes donde se vende. Vacío cuando el modo es TODAS. */
  locationIds: string[];
  /** Nombres que no casaron con ninguna sede. Se informan, no rompen el sync. */
  desconocidas: string[];
}

/**
 * En qué sedes se vende un producto que llega del Onboarding.
 *
 * Devuelve `null` cuando el payload **no habla de sedes**, y eso no es lo
 * mismo que «en ninguna»: un onboarding de menú único, o una versión vieja del
 * asistente, no puede borrarle al negocio lo que configuró a mano en el panel.
 */
export function resolverSedesDeProducto(
  entrada: { locationMode?: unknown; locationNames?: unknown },
  sedes: SedeConocida[],
): SedesDeProducto | null {
  const sinModo = entrada.locationMode === undefined || entrada.locationMode === null;
  const sinNombres = entrada.locationNames === undefined || entrada.locationNames === null;
  if (sinModo && sinNombres) return null;

  const quiereSeleccionadas =
    String(entrada.locationMode ?? '')
      .trim()
      .toUpperCase() === 'SELECCIONADAS' ||
    (sinModo && Array.isArray(entrada.locationNames));

  if (!quiereSeleccionadas) {
    return { modo: 'TODAS', locationIds: [], desconocidas: [] };
  }

  // La primera sede con ese nombre gana. Dos sedes homónimas son un problema
  // del negocio, no una razón para dejar el producto sin carta.
  const porLlave = new Map<string, string>();
  for (const s of sedes) {
    const k = llaveDeSede(s.name);
    if (k && !porLlave.has(k)) porLlave.set(k, s.id);
  }

  const nombres = Array.isArray(entrada.locationNames) ? entrada.locationNames : [];
  const locationIds: string[] = [];
  const desconocidas: string[] = [];
  for (const n of nombres) {
    const texto = String(n ?? '').trim();
    if (!texto) continue;
    const id = porLlave.get(llaveDeSede(texto));
    if (!id) {
      desconocidas.push(texto);
      continue;
    }
    if (!locationIds.includes(id)) locationIds.push(id);
  }

  // Ninguna casó: o el push de sedes no llegó, o los nombres cambiaron. Dejar
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

  const porLlave = new Map<string, string>();
  for (const s of sedes) {
    const k = llaveDeSede(s.name);
    if (k && !porLlave.has(k)) porLlave.set(k, s.id);
  }

  const overrides: OverrideDeSede[] = [];
  const desconocidas: string[] = [];
  const vistas = new Set<string>();

  for (const o of entrada.locationOverrides) {
    if (!o || typeof o !== 'object') continue;
    const fila = o as Record<string, unknown>;
    const nombre = String(fila.name ?? fila.locationName ?? '').trim();
    if (!nombre) continue;

    const locationId = porLlave.get(llaveDeSede(nombre));
    if (!locationId) {
      desconocidas.push(nombre);
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
