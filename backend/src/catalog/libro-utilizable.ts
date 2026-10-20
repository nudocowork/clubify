/**
 * Si el Menú libro de un negocio se le enseña al cliente.
 *
 * Un libro ENCENDIDO pero SIN páginas no es un libro: es una pantalla con
 * «La carta todavía se está preparando». Rápidos y Fabulosos lo encendió sin
 * subirle nada y la carta digital (19 productos) quedó escondida detrás
 * (2026-10-20). Si hay carta digital, el libro vacío no cuenta y el cliente
 * ve la carta. Si NO hay carta digital, se respeta el libro aunque esté
 * vacío: no hay nada mejor que enseñar.
 */
export function libroUtilizable(args: {
  bookMenuEnabled: boolean;
  tienePaginas: boolean;
  digitalMenuEnabled: boolean;
}): boolean {
  if (!args.bookMenuEnabled) return false;
  if (args.tienePaginas) return true;
  return !args.digitalMenuEnabled;
}
