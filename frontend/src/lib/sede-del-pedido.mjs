/**
 * Qué sede sirve un pedido a domicilio y de qué estado es — sin preguntárselo
 * al cliente.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * El checkout preguntaba el estado SIEMPRE, y el estado solo servía para dos
 * cosas: deducir a qué sede mandar el pedido y completar la dirección que
 * viaja en el mensaje de WhatsApp. Cuando el cliente entra por el enlace de
 * una sede (`?sede=`) o el negocio tiene una sola, la sede ya está decidida
 * antes de que el cliente escriba nada: preguntarle el estado es pedirle un
 * dato que ya sabemos. Es la queja de Quipao Bubble Tea (sede de Nueva
 * Esparta), repetida más de una vez.
 *
 * Y NO BASTABA CON MIRAR `Location.state`: en producción 96 de las 172 sedes
 * activas lo tienen vacío —el estado vive dentro de la dirección, que es lo
 * que escribe el Onboarding: «…, Pampatar 6316, Nueva Esparta, Venezuela»— así
 * que la regla vieja («el negocio tiene sede en un solo estado → no preguntes»)
 * no se activaba nunca en esos negocios. Por eso aquí el estado se deduce
 * también de la dirección de la sede.
 *
 * El estado NO se esconde del pedido: se rellena solo con el de la sede, para
 * que la línea de dirección del WhatsApp siga diciendo «Ciudad, Estado». Lo
 * que desaparece es la PREGUNTA.
 *
 * Está fuera del componente (y en .mjs) para poder probarlo de verdad, sin
 * montar un runner de pruebas en el frontend:
 *
 *     node scripts/pruebas-sede-del-pedido.mjs
 *
 * @typedef {{ id: string, name: string, state: string | null, address?: string | null }} Sede
 * @typedef {{ name: string, cities: string[] }} Region
 */

/** Compara texto que fue libre durante años: sin tildes, sin mayúsculas. */
export function normalizarTexto(x) {
  return (x ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * El estado que nombra una dirección escrita a mano.
 *
 * Por TROZOS entre comas y por igualdad exacta, nunca por «contiene»: una
 * «Avenida Sucre» no convierte la sede en el estado Sucre. Se pierde alguna
 * dirección mal escrita —y entonces simplemente no se deduce nada— pero no se
 * inventa ninguna.
 *
 * @param {string | null | undefined} direccion
 * @param {Region[]} regiones
 * @returns {string | null} el nombre curado del estado, o null
 */
export function estadoEnLaDireccion(direccion, regiones) {
  const texto = typeof direccion === 'string' ? direccion : '';
  const lista = Array.isArray(regiones) ? regiones : [];
  if (!texto.trim() || !lista.length) return null;
  let encontrado = null;
  for (const trozo of texto.split(',').map(normalizarTexto)) {
    if (!trozo) continue;
    const region = lista.find((r) => normalizarTexto(r.name) === trozo);
    // El ÚLTIMO que casa: la dirección termina en «…, Estado, País», así que
    // si el nombre de una ciudad coincidiera con el de otro estado, el estado
    // de verdad es el de más a la derecha.
    if (region) encontrado = region.name;
  }
  return encontrado;
}

/**
 * El estado de una sede: el campo `state` si está cargado y, si no, el que
 * nombre su dirección.
 *
 * Devuelve el nombre CURADO de la región cuando casa con una, no el que
 * escribieron: la lista de ciudades del checkout se busca por igualdad exacta
 * contra `Region.name`, así que un «tachira» a mano dejaría al cliente sin
 * ciudades donde elegir.
 *
 * @param {Sede | null | undefined} sede
 * @param {Region[]} regiones
 * @returns {string | null}
 */
export function estadoDeLaSede(sede, regiones) {
  if (!sede) return null;
  const lista = Array.isArray(regiones) ? regiones : [];
  const declarado = (sede.state ?? '').trim();
  if (declarado) {
    const curada = lista.find(
      (r) => normalizarTexto(r.name) === normalizarTexto(declarado),
    );
    return curada ? curada.name : declarado;
  }
  return estadoEnLaDireccion(sede.address, lista);
}

/**
 * La sede que ya conocemos SIN preguntarle nada al cliente: la del enlace por
 * el que entró (`?sede=`) o la única que tiene el negocio.
 *
 * Un `?sede=` que no es de este negocio (QR viejo, id de una carta, enlace
 * manipulado) devuelve null a propósito: el cliente sigue el camino normal —
 * la regla de la casa es que un enlace con sede inexistente sirve el menú
 * principal, no una pantalla vacía ni un pedido atado a una sede inventada.
 *
 * `@template` para que la sede salga con el MISMO tipo con el que entró: quien
 * llama trabaja con su propia forma de sede y no tiene por qué ensancharla.
 *
 * @template {Sede} T
 * @param {T[]} sedes
 * @param {string | null | undefined} sedeDelQr
 * @returns {T | null}
 */
export function sedeYaConocida(sedes, sedeDelQr) {
  const lista = Array.isArray(sedes) ? sedes : [];
  const id = (sedeDelQr ?? '').trim();
  const delEnlace = id ? lista.find((s) => s && s.id === id) : undefined;
  if (delEnlace) return delEnlace;
  return lista.length === 1 ? lista[0] : null;
}

/**
 * Las regiones del país donde el negocio TIENE sede, en el orden del país.
 * Un negocio local no tiene por qué hacer al cliente buscar entre los 32
 * departamentos: se le muestran las suyas.
 *
 * @param {Sede[]} sedes
 * @param {Region[]} regiones
 * @returns {Region[]}
 */
export function regionesConSede(sedes, regiones) {
  const lista = Array.isArray(sedes) ? sedes : [];
  const todas = Array.isArray(regiones) ? regiones : [];
  const estados = new Set(
    lista
      .map((s) => normalizarTexto(estadoDeLaSede(s, todas) ?? ''))
      .filter(Boolean),
  );
  return todas.filter((r) => estados.has(normalizarTexto(r.name)));
}

/**
 * Las sedes que están en el estado que eligió el cliente. Es lo que rutea el
 * pedido al WhatsApp correcto cuando entra por el enlace general.
 *
 * @template {Sede} T
 * @param {T[]} sedes
 * @param {string | null | undefined} estado
 * @param {Region[]} regiones
 * @returns {T[]}
 */
export function sedesDelEstado(sedes, estado, regiones) {
  const lista = Array.isArray(sedes) ? sedes : [];
  const buscado = normalizarTexto(estado);
  if (!buscado) return [];
  return lista.filter(
    (s) => normalizarTexto(estadoDeLaSede(s, regiones) ?? '') === buscado,
  );
}

/**
 * La decisión completa del checkout: qué sede sirve el pedido, qué estado
 * lleva y si hay que preguntarlo.
 *
 * `preguntarEstado` es false en cuanto la sede está resuelta —aunque no
 * sepamos su estado—: el pedido ya sabe a qué WhatsApp va, y el estado no
 * sirve para nada más que para eso y para la línea de dirección.
 *
 * `mostrarTodos` es la salida de emergencia que ya existía («¿No está? Agrega
 * tu ubicación»): el cliente que pide desde fuera de la zona vuelve a ver el
 * país entero y elige.
 *
 * @param {{ sedes: Sede[], sedeDelQr?: string | null, regiones: Region[], mostrarTodos?: boolean }} args
 */
export function resolverSedeYEstado({
  sedes,
  sedeDelQr,
  regiones,
  mostrarTodos = false,
}) {
  const lista = Array.isArray(sedes) ? sedes : [];
  const todas = Array.isArray(regiones) ? regiones : [];
  const sedeConocida = sedeYaConocida(lista, sedeDelQr);
  const regionesDelNegocio = regionesConSede(lista, todas);
  const estadoDeLaConocida = estadoDeLaSede(sedeConocida, todas);
  // Sin sede conocida todavía queda un caso sin pregunta: el negocio tiene
  // sedes en un solo estado, así que no hay nada que elegir.
  const estadoFijo =
    estadoDeLaConocida ??
    (regionesDelNegocio.length === 1 ? regionesDelNegocio[0].name : null);

  if (mostrarTodos) {
    return {
      sedeConocida,
      estadoFijo: null,
      preguntarEstado: true,
      regionesDelNegocio,
    };
  }
  return {
    sedeConocida,
    estadoFijo,
    preguntarEstado: !sedeConocida && !estadoFijo,
    regionesDelNegocio,
  };
}
