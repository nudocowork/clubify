/**
 * QUÉ SE PIDIÓ Y DE DÓNDE VIENE, dentro del aviso interno al negocio.
 *
 * El aviso que manda la plataforma al teléfono del negocio («Nuevo pedido
 * YD6J7P - Javier Prueba - $20.000 - Domicilio. Detalle y direccion en tu
 * panel: …») decía cuánto y de quién, pero no **qué** se pidió ni **desde
 * dónde**. En un negocio con varias oficinas o varias sedes —Nudo Cowork pide
 * desde «Sala de Juntas»— eso es justo lo que hace falta para reaccionar sin
 * abrir el panel: a qué puerta llevarlo.
 *
 * Las funciones viven aquí, fuera del servicio, porque el servicio necesita
 * Prisma y Grow Business para existir y esto es texto puro: así se prueba de
 * verdad en `aviso-de-pedido.spec.ts`, sin base de datos.
 *
 * DOS CUIDADOS QUE NO SON CAPRICHO, y por eso van escritos:
 *
 * 1. LA LONGITUD. Esto sale por SMS y cada segmento lo paga el negocio, en
 *    cada pedido. Por eso se listan pocos productos y el resto se resume en
 *    «y otros N» en vez de volcar el pedido entero.
 * 2. LOS CARACTERES, y aquí hay un detalle que se cuenta mal. No es que «una
 *    tilde» rompa el SMS: **é, ñ y ü SÍ están en GSM-7; á, í, ó y ú no**. Y
 *    los nombres de producto las llevan casi siempre, así que «1x Mocca frío»
 *    —una sola «í»— fuerza la codificación de 16 bits, que parte el segmento
 *    de 160 a 70 caracteres. Medido: el aviso pasaba de 1 segmento a 2 al
 *    añadirle origen y productos, y a **4** por culpa de esa «í».
 *
 *    Por eso se limpian las partes DINÁMICAS —nombre de producto, de oficina
 *    y de sede— con `paraSms`: fuera emojis (las promociones se guardan con un
 *    🎁 delante, ver `orders.service`) y fuera diacríticos. El negocio lee
 *    «Mocca frio» en su SMS, que es un precio muy pequeño por no cuadruplicar
 *    lo que paga en cada pedido; el nombre bonito lo tiene en el panel.
 *
 *    Las palabras que ponemos NOSOTROS («Oficina», «Sede», «y otros») son
 *    GSM-7 puro por la misma razón.
 */

/** Un artículo del pedido tal como se guarda en `Order.items` (Json). */
export type ItemDelAviso = { qty?: unknown; name?: unknown };

/**
 * Emojis y pictogramas fuera. Incluye el selector de variación y el unificador
 * de cero ancho, que viajan pegados a muchos emojis y solos no se ven pero
 * cuentan como carácter.
 */
const PICTOGRAMAS = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu;

export function sinPictogramas(texto: string): string {
  return texto.replace(PICTOGRAMAS, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Fuera los diacríticos: «Mocca frío» → «Mocca frio».
 *
 * Se descompone en letra + acento (NFD) y se tira el acento. La ñ se
 * descompone igual —n + tilde— y volvería «n», así que se protege antes: la ñ
 * SÍ está en GSM-7 y quitarla sería estropear el texto sin ganar nada. Lo
 * mismo con ü y con é.
 */
const GSM7_CON_ACENTO = /[éèùìòÉÈÙÌÒñÑüÜçÇöÖäÄåÅæÆøØßàÀ]/;

export function sinTildes(texto: string): string {
  return texto
    .split('')
    .map((ch) =>
      GSM7_CON_ACENTO.test(ch)
        ? ch
        : ch.normalize('NFD').replace(/[̀-ͯ]/g, ''),
    )
    .join('');
}

/** Lo que se puede meter en un SMS sin multiplicar su precio. */
export function paraSms(texto: string): string {
  return sinTildes(sinPictogramas(texto));
}

/**
 * Recorta un nombre largo sin dejar media palabra colgando: «Frappuccino de
 * caramelo con crema y…» queda en la última palabra entera que cabe. Sin
 * puntos suspensivos, que en SMS son tres caracteres más por producto.
 */
function corto(nombre: string, tope: number): string {
  if (nombre.length <= tope) return nombre;
  // Si el corte cae JUSTO en un límite de palabra, lo que hay dentro ya son
  // palabras enteras: quitar la última sobraba y se llevaba una de más
  // («Torre de pan» con tope 12 se quedaba en «Torre de»).
  if (/\s/.test(nombre[tope])) return nombre.slice(0, tope).trim();
  return nombre.slice(0, tope).replace(/\s+\S*$/, '').trim() || nombre.slice(0, tope).trim();
}

/**
 * «1x Mocca frío (Deslactosada), 2x Capuchino y otros 3».
 *
 * La variante ya viene dentro del nombre del artículo (`orders.service` guarda
 * `p.name + sufijo`), así que no hay que recomponer nada.
 *
 * Devuelve '' si el pedido no trae artículos legibles — un aviso sin la línea
 * de productos es el de siempre, que es mejor que uno con «undefined».
 */
export function lineaDeProductos(
  items: unknown,
  opciones: { tope?: number; topeNombre?: number } = {},
): string {
  const tope = opciones.tope ?? 2;
  const topeNombre = opciones.topeNombre ?? 34;
  const lista = Array.isArray(items) ? items : [];
  const piezas: string[] = [];
  let resumidos = 0;

  for (const it of lista as ItemDelAviso[]) {
    const nombre = paraSms(typeof it?.name === 'string' ? it.name : '');
    if (!nombre) continue; // un artículo sin nombre no se puede nombrar
    if (piezas.length >= tope) {
      resumidos++;
      continue;
    }
    const n = Number(it?.qty);
    const cantidad = Number.isFinite(n) && n > 0 ? Math.round(n) : 1;
    piezas.push(`${cantidad}x ${corto(nombre, topeNombre)}`);
  }

  if (!piezas.length) return '';
  // «y otros N» y no «y N más»: «más» lleva tilde, y una tilde en el texto
  // fijo convierte TODO el SMS a 16 bits — justo en los pedidos largos, que
  // son los que ya iban a ser caros. Ver la cabecera de este archivo.
  return resumidos ? `${piezas.join(', ')} y otros ${resumidos}` : piezas.join(', ');
}

/**
 * De dónde viene el pedido: la OFICINA si entró por el enlace de una, la SEDE
 * si entró por el de una sede, y nada si es el menú general del negocio — ahí
 * no hay origen que contar y una etiqueta vacía solo alarga el mensaje.
 *
 * La oficina manda sobre la sede: un pedido de oficina no tiene sede asignada,
 * pero si algún día la tuviera, lo que resuelve a quién llevárselo es la
 * oficina.
 */
export function origenDelPedido(args: {
  oficina?: { nombre?: string | null } | null;
  sede?: { name?: string | null } | null;
}): string {
  const oficina = paraSms((args.oficina?.nombre ?? '').trim());
  if (oficina) return `Oficina: ${oficina}`;
  const sede = paraSms((args.sede?.name ?? '').trim());
  if (sede) return `Sede: ${sede}`;
  return '';
}
