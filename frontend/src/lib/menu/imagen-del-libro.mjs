/**
 * Cómo se piden las imágenes del menú libro (`/book/<slug>`).
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * El visor del libro era la única superficie pública que se quedó con un
 * `<img src={page.imageUrl}>` plano contra el bucket. El menú digital
 * hermano (`/m/<slug>`) ya pasa las fotos de producto por `next/image`, con
 * el ahorro que dice su propio comentario. El libro no, así que al cliente
 * le bajaba el ORIGINAL de cada página: medido en producción, 1.275 px de
 * ancho y 473 KB de media (mediana 370) en la carta más grande —105 páginas,
 * 48,5 MB— para pintarlas en una ranura de ~390 px de un teléfono.
 *
 * El ahorro es real pero desigual, y conviene no prometer de más: al ancho
 * que pide un móvil (w=828) la mediana de las 206 páginas baja de 420 a
 * 113 KB, un 74 %. Los PNG ahorran un 95 % y los JPEG un 87 %, pero la mitad
 * de las páginas YA eran webp y ahí la mediana es 64 %, con casos del 46 %.
 *
 * Las funciones viven aquí y no dentro del componente para poder probarlas
 * desde node sin montar React:
 *   node scripts/pruebas-libro-imagenes.mjs
 */

/**
 * Anchos que el optimizador de Next acepta por defecto (`deviceSizes`).
 * Pedirle uno que no esté en la lista responde 400 y la página se queda en
 * BLANCO — no es un degradado elegante, es una carta rota. Comprobado
 * contra producción antes de fijar la lista.
 */
const ANCHOS_PERMITIDOS = [640, 750, 828, 1080, 1200, 1920, 2048, 3840];

/**
 * Los que de verdad sirven para una página de carta a ancho completo:
 * teléfono (640/828), teléfono grande y tablet (1080/1200) y escritorio
 * (1920). El visor no limita el ancho del slider, así que en un monitor
 * 100vw son ~1920 px reales.
 */
export const ANCHOS_DEL_LIBRO = [640, 828, 1080, 1200, 1920];

/**
 * Una carta es TEXTO: precios y descripciones que el cliente tiene que
 * poder leer. Por eso 85 y no el 75 por defecto — con 85 el ahorro medido
 * sigue siendo del orden del 90 % y no aparecen artefactos sobre la letra.
 */
export const CALIDAD_DEL_LIBRO = 85;

/** `sizes` del slide: cada página ocupa el ancho completo del visor. */
export const TAMANOS_DEL_LIBRO = '100vw';

/**
 * Hosts que `next.config.js` declara en `images.remotePatterns`.
 *
 * El optimizador responde **400 a cualquier host que no esté ahí**, y un 400
 * dentro de un `srcset` deja la página EN BLANCO: cuando la candidata del
 * srcset falla, el navegador NO cae al `src`. O sea que un CDN nuevo en
 * `S3_PUBLIC_URL` no degradaría la calidad, dejaría las cartas sin imágenes.
 *
 * Por eso, si el host no está en la lista servimos la imagen **cruda**: pesa
 * más, pero se ve. Y hay una prueba que lee `next.config.js` para que las dos
 * listas no se separen en silencio.
 */
const HOSTS_OPTIMIZABLES = [
  /(^|\.)r2\.dev$/i,
  /(^|\.)r2\.cloudflarestorage\.com$/i,
  /^cdn\.soyclubify\.com$/i,
  /^lh3\.googleusercontent\.com$/i,
  /^static-media\.hotmart\.com$/i,
  /^ugbqfcogmqkuhhepecfq\.supabase\.co$/i,
  /^localhost$/i,
];

/** Si el optimizador acepta ese host (o es una ruta del propio sitio). */
export function hostOptimizable(url) {
  const u = typeof url === 'string' ? url.trim() : '';
  if (!u) return false;
  // Ruta del propio sitio: la sirve Next, no hace falta whitelist.
  if (u.startsWith('/')) return true;
  let host;
  try {
    host = new URL(u).hostname;
  } catch {
    return false;
  }
  return HOSTS_OPTIMIZABLES.some((re) => re.test(host));
}

/** Una URL que no podemos —o no debemos— mandar al optimizador. */
function noOptimizable(url) {
  if (typeof url !== 'string') return true;
  const u = url.trim();
  if (!u) return true;
  // Una imagen incrustada en la base (base64) no se optimiza: hay que
  // sacarla al bucket, y eso no se arregla desde el visor.
  if (u.startsWith('data:') || u.startsWith('blob:')) return true;
  // Ya viene envuelta: volver a envolverla da una URL anidada que responde 400.
  if (u.startsWith('/_next/image')) return true;
  // Host que el optimizador rechazaría: mejor cruda que en blanco.
  if (!hostOptimizable(u)) return true;
  return false;
}

/** El ancho permitido más cercano al pedido (nunca inventamos uno). */
export function anchoPermitido(ancho) {
  const n = Number(ancho);
  if (!Number.isFinite(n)) return ANCHOS_PERMITIDOS[0];
  return ANCHOS_PERMITIDOS.reduce((mejor, a) =>
    Math.abs(a - n) < Math.abs(mejor - n) ? a : mejor,
  );
}

/**
 * URL de una página pasada por el optimizador de Next.
 *
 * RELATIVA a propósito: el libro también se sirve desde el dominio propio
 * del negocio y desde el de una marca blanca. Un host escrito a mano metería
 * `soyclubify.com` dentro de la carta de otra marca.
 *
 * Devuelve la URL original cuando no se puede optimizar, para que la página
 * se siga viendo.
 */
export function urlOptimizada(url, ancho) {
  if (noOptimizable(url)) return typeof url === 'string' ? url : '';
  const w = anchoPermitido(ancho);
  return `/_next/image?url=${encodeURIComponent(url.trim())}&w=${w}&q=${CALIDAD_DEL_LIBRO}`;
}

/**
 * `srcset` para que el navegador pida el tamaño que de verdad va a pintar.
 * Devuelve null cuando la URL no es optimizable: en ese caso el componente
 * deja el `<img>` como estaba y no escribe un srcset roto.
 */
export function srcSetDelLibro(url) {
  if (noOptimizable(url)) return null;
  return ANCHOS_DEL_LIBRO.map((w) => `${urlOptimizada(url, w)} ${w}w`).join(', ');
}

/**
 * Cómo se carga cada página según dónde esté el lector.
 *
 * La que se está mirando es la ÚNICA que importa para el primer pintado, y
 * hasta ahora era `loading="lazy"` sin prioridad: se le decía al navegador
 * que dejara para después justo la imagen que el cliente está esperando.
 *
 * La siguiente se precarga, pero con prioridad baja para no competir con la
 * que se ve. El resto, perezosas.
 *
 * Esto sustituye al `new window.Image()` que había en el visor: aquel
 * precargaba la URL ORIGINAL del bucket, así que se bajaba el archivo
 * completo de todas formas y anulaba el ahorro.
 */
export function cargaDeLaPagina(indice, indiceActivo) {
  if (indice === indiceActivo) return { loading: 'eager', fetchPriority: 'high' };
  if (indice === indiceActivo + 1) return { loading: 'eager', fetchPriority: 'low' };
  return { loading: 'lazy', fetchPriority: 'auto' };
}

/**
 * Si el salto entre páginas se anima o es instantáneo.
 *
 * Un `scrollTo` suave ARRASTRA la ventana por todas las páginas que hay en
 * medio, y cada una que asoma dispara su imagen. En la carta de 105 páginas,
 * tocar el chip de la última sección se bajaba el libro entero de golpe.
 *
 * Pasar de una en una (los botones ← →) sí se anima: ahí solo hay una página
 * en medio y la animación es lo que hace que se sienta un libro.
 */
export function desplazamientoDelSalto(desde, hasta) {
  // `'instant'` y NO `'auto'`: según la spec, `auto` significa «usa el
  // `scroll-behavior` computado del elemento», y el scroller lleva la clase
  // `scroll-smooth`. O sea que `auto` ahí es EXACTAMENTE lo contrario de lo
  // que parece — seguía animando el salto y arrastrando la ventana por todas
  // las páginas de en medio. `instant` no anima, diga lo que diga el CSS.
  return Math.abs(Number(hasta) - Number(desde)) <= 1 ? 'smooth' : 'instant';
}
