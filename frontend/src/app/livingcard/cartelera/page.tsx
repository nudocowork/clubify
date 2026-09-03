/**
 * /livingcard/cartelera — la URL pública que se comparte (pedida el 2026-08-26).
 *
 * Reexporta la cartelera en vez de duplicarla: una sola pantalla, dos caminos.
 * /cuponera/* queda como ruta interna del producto; /livingcard/* es la que ve
 * el cliente y la que va en material impreso y redes.
 */
export { default } from '../../cuponera/beneficios/page';
