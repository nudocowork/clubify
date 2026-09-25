import { normalizeBusinessType } from './business-types';

/**
 * «Este negocio es de SOLO InfoLink».
 *
 * La línea de producto vive en `Tenant.businessType`: 'INFOLINK' = el negocio
 * solo compró el InfoLink; cualquier otro valor —incluido `null`, que es lo que
 * tienen los negocios creados antes de que existiera la columna— es un Negocio
 * Completo. Por eso la pregunta se hace SIEMPRE por esta función y no
 * comparando el string a mano: un `=== 'INFOLINK'` suelto se olvida de que el
 * valor puede venir en null/desconocido y responde mal en el borde.
 *
 * `Tenant.infolinkTier` (FREE | PRO) NO participa: ese campo decide cuántos
 * botones publica el InfoLink y si lleva la publicidad de Sellea, pero un
 * InfoLink gratuito y uno de pago ven EXACTAMENTE el mismo panel reducido. Si
 * algún día hay que tratarlos distinto, será otra regla — no esta.
 */
export function esSoloInfolink(businessType: string | null | undefined): boolean {
  return normalizeBusinessType(businessType) === 'INFOLINK';
}

/**
 * Cada bloque de la pantalla «Configuración» del negocio (/app/settings).
 * Los nombres son los que usa el dueño en pantalla, no los de la tabla.
 */
export type SeccionDeConfiguracion =
  | 'datosPersonales'
  | 'nombreDelNegocio'
  | 'politicaDeDatos'
  | 'telefonoDeReservas'
  | 'telefonosDePedidos'
  | 'horarioDeDomicilios'
  | 'idioma'
  | 'contrasena'
  | 'alertasDePago'
  | 'paisYMoneda'
  | 'sellosPorDia'
  | 'nombreDeSeccionPrincipal'
  | 'exportarDatos'
  | 'sesion';

/**
 * Lo que un negocio de solo InfoLink NO debe ver en «Configuración», porque
 * configura módulos que ese negocio no tiene (y que el backend además le
 * bloquea por URL en InfoLinkOnlyGuard). Pedido de Javier, 2026-09-16.
 *
 *   politicaDeDatos          → el PDF de tratamiento de datos solo se enseña en
 *                              el registro de la TARJETA de fidelización.
 *   telefonoDeReservas       → módulo Reservas.
 *   telefonosDePedidos       → a quién avisa el sistema de un pedido y a qué
 *                              WhatsApp escribe el cliente: un negocio de solo
 *                              InfoLink no tiene menú ni pedidos.
 *   alertasDePago            → solo se esconde el interruptor y el teléfono
 *                              alterno. El aviso de un cobro fallido sigue
 *                              saliendo por SMS al teléfono del dueño, que
 *                              está en «Datos personales»; la mora avisa
 *                              siempre por correo. No se pierde ningún aviso.
 *   paisYMoneda              → la moneda pinta precios del MENÚ; el InfoLink
 *                              público no lee `Tenant.currency`.
 *   sellosPorDia             → tope de sellos de la tarjeta wallet.
 *   nombreDeSeccionPrincipal → renombra «Menú» en el panel y en la vista
 *                              pública del menú.
 *
 * El resto (datos personales, nombre del negocio, idioma, contraseña, exportar
 * datos, sesión) sí le sirve y se queda.
 */
export const SECCIONES_CONFIG_OCULTAS_SOLO_INFOLINK: readonly SeccionDeConfiguracion[] =
  [
    'politicaDeDatos',
    'telefonoDeReservas',
    'telefonosDePedidos',
    'horarioDeDomicilios',
    'alertasDePago',
    'paisYMoneda',
    'sellosPorDia',
    'nombreDeSeccionPrincipal',
  ];

/**
 * ¿Se pinta esta sección de «Configuración» para este negocio?
 * Un Negocio Completo ve todo; uno de solo InfoLink ve todo menos la lista de
 * arriba. Esconder no borra: el dato sigue en la tabla y vuelve a verse si el
 * negocio pasa a Completo.
 */
export function seVeEnConfiguracion(
  seccion: SeccionDeConfiguracion,
  businessType: string | null | undefined,
): boolean {
  if (!esSoloInfolink(businessType)) return true;
  return !SECCIONES_CONFIG_OCULTAS_SOLO_INFOLINK.includes(seccion);
}
