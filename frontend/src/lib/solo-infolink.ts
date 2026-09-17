import { isInfoLinkOnly } from './business-types';

/**
 * «Este negocio es de SOLO InfoLink» — ESPEJO de
 * backend/src/common/solo-infolink.ts. Mantener sincronizado.
 *
 * El tipo vive en `Tenant.businessType` ('INFOLINK' vs todo lo demás, null
 * incluido). `Tenant.infolinkTier` (FREE | PRO) NO entra: decide botones y
 * publicidad del InfoLink, pero el gratuito y el de pago ven el mismo panel.
 */
export function esSoloInfolink(businessType: string | null | undefined): boolean {
  return isInfoLinkOnly(businessType);
}

/** Cada bloque de la pantalla «Configuración» del negocio (/app/settings). */
export type SeccionDeConfiguracion =
  | 'datosPersonales'
  | 'nombreDelNegocio'
  | 'politicaDeDatos'
  | 'telefonoDeReservas'
  | 'telefonosDePedidos'
  | 'idioma'
  | 'contrasena'
  | 'alertasDePago'
  | 'paisYMoneda'
  | 'sellosPorDia'
  | 'nombreDeSeccionPrincipal'
  | 'exportarDatos'
  | 'sesion';

/**
 * Lo que un negocio de solo InfoLink NO ve en «Configuración»: configura
 * módulos que no tiene (tarjeta, reservas, menú, cobros por WhatsApp). Pedido
 * de Javier, 2026-09-16. Esconder no borra — si el negocio pasa a Completo,
 * vuelve a verlo todo con sus valores intactos.
 */
export const SECCIONES_CONFIG_OCULTAS_SOLO_INFOLINK: readonly SeccionDeConfiguracion[] =
  [
    'politicaDeDatos',
    'telefonoDeReservas',
    'telefonosDePedidos',
    'alertasDePago',
    'paisYMoneda',
    'sellosPorDia',
    'nombreDeSeccionPrincipal',
  ];

/** ¿Se pinta esta sección de «Configuración» para este negocio? */
export function seVeEnConfiguracion(
  seccion: SeccionDeConfiguracion,
  businessType: string | null | undefined,
): boolean {
  if (!esSoloInfolink(businessType)) return true;
  return !SECCIONES_CONFIG_OCULTAS_SOLO_INFOLINK.includes(seccion);
}
