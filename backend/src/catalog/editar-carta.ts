/**
 * Reglas de renombrar y borrar una carta.
 *
 * Viven fuera del servicio porque el servicio arrastra NestJS y Prisma y no se
 * puede probar sin base de datos. Y son justo las reglas que deciden si el
 * botón «Eliminar» es seguro o es una trampa: borrar una carta se lleva por
 * delante sus productos (`Product.menu` es `onDelete: Cascade`) y en las que
 * hay hoy en producción eso son entre 77 y 188 productos por carta.
 */

/**
 * El menú principal NO es una fila: es todo lo que tiene `menuId = null`. El
 * panel lo pinta como una carta más con `id: null`, así que por la URL puede
 * llegar cualquiera de las formas en que ese null se serializa.
 *
 * El candado va aquí y no en esconder el botón: renombrar o borrar «el menú
 * principal» sería renombrar o borrar el catálogo entero del negocio, que es
 * lo que existía antes de que hubiera cartas y lo que sirve a toda sede que no
 * tenga la suya.
 */
const IDS_DEL_PRINCIPAL = new Set(['', 'null', 'undefined', 'principal', 'main']);

export function esElMenuPrincipal(id: string | null | undefined): boolean {
  if (id === null || id === undefined) return true;
  return IDS_DEL_PRINCIPAL.has(id.trim().toLowerCase());
}

/**
 * Tope de largo del nombre. No es cosmético: el nombre de una carta-oficina
 * viaja al pedido («▸ Oficina: Sala de Juntas») y de ahí al WhatsApp del
 * negocio. Un nombre de 300 caracteres deja ese mensaje ilegible.
 */
export const NOMBRE_MAX = 60;

export type NombreRevisado =
  | { ok: true; nombre: string }
  | { ok: false; error: string };

/**
 * Limpia y valida el nombre de una carta.
 *
 * Colapsa los espacios de dentro además de recortar los de los lados: un salto
 * de línea pegado desde otro sitio rompería el mensaje de WhatsApp sin que
 * nadie lo vea venir en el panel.
 */
export function revisarNombreDeCarta(
  raw: string | null | undefined,
): NombreRevisado {
  const nombre = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (nombre.length < 2) {
    return { ok: false, error: 'Ponle un nombre a la carta.' };
  }
  if (nombre.length > NOMBRE_MAX) {
    return {
      ok: false,
      error: `El nombre no puede pasar de ${NOMBRE_MAX} caracteres: se ve en el pedido que le llega al negocio.`,
    };
  }
  return { ok: true, nombre };
}

/**
 * Para borrar hay que escribir el nombre exacto de la carta.
 *
 * Case-sensitive a propósito: es la única barrera antes de perder el catálogo
 * de una sede, y se compara contra el nombre que el panel tiene delante. Solo
 * se perdonan los espacios de los lados, que es lo que añade un copiar/pegar.
 */
export function confirmacionCoincide(
  escrito: string | null | undefined,
  real: string | null | undefined,
): boolean {
  // `normalize('NFC')` porque «Sala Piñón» escrita con la eñe descompuesta
  // (n + tilde, que es lo que manda macOS al copiar de algunos sitios) es otra
  // cadena aunque en pantalla sea idéntica: sin esto, una carta con acentos no
  // se podía borrar y el negocio no veía por qué.
  const a = (escrito ?? '').normalize('NFC').trim();
  const b = (real ?? '').normalize('NFC').trim();
  if (!a || !b) return false;
  return a === b;
}

/** Lo que hay en juego al borrar una carta, con números de verdad. */
export type ResumenDeBorrado = {
  nombre: string;
  /** Carta sin sede = oficina: tiene enlace propio (`?oficina=`) y QR. */
  esOficina: boolean;
  productos: number;
  categorias: number;
  /** Pedidos que ya salieron del enlace de esta oficina. */
  pedidos: number;
  /**
   * Productos de OTRAS cartas que siguen a los de esta y siguen enganchados
   * (`sourceProductId` apuntando aquí, con `syncWithSource = true`).
   *
   * No se borran —`Product.sourceProductId` es `SetNull`— pero se quedan sin
   * origen: dejan de recibir los cambios de precio, nombre y foto. Y como el
   * interruptor «sigue al original» solo se pinta cuando hay origen, el
   * negocio no tendría de dónde enterarse.
   */
  copiasQueLaSiguen: number;
  /** Sede que usa esta carta, si tiene. */
  sede: string | null;
};

const plural = (n: number, uno: string, varios: string) =>
  `${n} ${n === 1 ? uno : varios}`;

/**
 * El aviso que se le enseña al negocio antes de borrar.
 *
 * Se arma en el backend, que es quien contó, para que el diálogo no pueda
 * enseñar un número distinto del que se va a borrar. Cada línea sale solo
 * cuando aplica: un aviso con frases que no vienen a cuento se deja de leer, y
 * la que importa —«se eliminarán 77 productos»— se pierde entre ellas.
 */
export function avisosDeBorrado(r: ResumenDeBorrado): string[] {
  const avisos: string[] = [];

  // Solo se nombra lo que hay. Una carta con 98 productos y ninguna categoría
  // —«Corporativos», de Serendipity— no tiene por qué leer «y 0 categorías».
  const partes: string[] = [];
  if (r.productos > 0) partes.push(plural(r.productos, 'producto', 'productos'));
  if (r.categorias > 0)
    partes.push(plural(r.categorias, 'categoría', 'categorías'));

  if (partes.length) {
    const verbo = r.productos + r.categorias === 1 ? 'Se eliminará' : 'Se eliminarán';
    avisos.push(`${verbo} ${partes.join(' y ')} de esta carta. Esto no se puede deshacer.`);
  } else {
    avisos.push('Esta carta está vacía: no se pierde ningún producto.');
  }

  // Las copias de otras cartas no se borran, pero se quedan huérfanas y dejan
  // de actualizarse EN SILENCIO. Pasa de verdad: «Sala de Juntas (1)» se
  // duplicó desde «Nudo Estudio», no desde el menú principal, así que borrar
  // Nudo Estudio congelaría los precios de la otra carta sin que nadie lo vea
  // hasta meses después.
  if (r.copiasQueLaSiguen > 0) {
    avisos.push(
      r.copiasQueLaSiguen === 1
        ? 'Un producto de otra carta sigue a esta: quedará independiente y su precio dejará de actualizarse solo.'
        : `${r.copiasQueLaSiguen} productos de otra carta siguen a esta: quedarán independientes y sus precios dejarán de actualizarse solos.`,
    );
  }

  if (r.esOficina) {
    avisos.push(
      'Es una oficina: el enlace y el QR que repartiste dejarán de abrirla. ' +
        'Quien los use verá el menú principal y se le pedirá una dirección, como en cualquier otro pedido.',
    );
    // El menú público se cachea 180 s en el borde, así que el cambio no es
    // instantáneo: quien tenga el enlace abierto en ese rato seguirá viendo la
    // oficina y, al pedir, recibirá el aviso de que ya no recibe pedidos.
    // Mejor decirlo que dejar que el negocio lo descubra por una queja.
    avisos.push(
      'Durante unos minutos, quien ya tenga el enlace abierto verá un aviso de que la oficina no recibe pedidos.',
    );
    if (r.pedidos > 0) {
      avisos.push(
        r.pedidos === 1
          ? 'El pedido que ya se hizo desde su enlace se conserva, con el nombre con el que se pidió.'
          : `Los ${r.pedidos} pedidos que ya se hicieron desde su enlace se conservan, con el nombre con el que se pidieron.`,
      );
    }
  }

  if (r.sede) {
    avisos.push(`La sede ${r.sede} pasará a servir el menú principal.`);
  }

  avisos.push('El menú principal no se toca.');
  return avisos;
}
