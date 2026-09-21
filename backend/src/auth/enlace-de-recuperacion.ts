/**
 * El enlace de «Restablece tu contraseña».
 *
 * Va SIEMPRE al panel de la marca del usuario: quien entra por Sellea recibe un
 * enlace `selleala.com`, no `soyclubify.com`. Un enlace de Clubify en un correo
 * firmado por otra marca delata la plataforma — es la fuga de marca de siempre.
 *
 * Por eso, si no se sabe a qué panel mandarlo, devuelve `''` y el llamador NO
 * envía: mejor que el usuario no reciba el correo (y pida el código por SMS) a
 * que reciba uno que lo lleva a la competencia de su proveedor.
 */
export function enlaceDeRecuperacion(
  panelUrl: string | null | undefined,
  token: string,
): string {
  const base = (panelUrl ?? '').trim().replace(/\/+$/, '');
  const t = (token ?? '').trim();
  if (!base || !/^https?:\/\//i.test(base) || !t) return '';
  return `${base}/reset/${encodeURIComponent(t)}`;
}
