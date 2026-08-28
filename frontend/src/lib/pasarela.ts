/**
 * Nombre visible de la pasarela de pagos de una marca.
 *
 * Existe porque varias pantallas decían "Hotmart" a secas — incluidas dos
 * pantallas de BLOQUEO, donde el usuario no puede hacer nada más. Un cliente de
 * una marca blanca que cobra por Stripe leía el nombre de una pasarela que no
 * usa, y encima el de la plataforma que la marca no quiere mostrar.
 *
 * El fallback es genérico a propósito: si no sabemos la pasarela, decir "la
 * pasarela de pagos" es correcto siempre. Poner "Hotmart" por defecto es
 * exactamente el bug que esto viene a arreglar.
 */
const NOMBRES: Record<string, string> = {
  HOTMART: 'Hotmart',
  STRIPE: 'Stripe',
  MERCADOPAGO: 'Mercado Pago',
  CROSS: 'la pasarela de pagos',
  MANUAL: 'la pasarela de pagos',
};

export const GENERICO = 'la pasarela de pagos';

/** Ej: "Stripe", "Hotmart", o "la pasarela de pagos" si no se sabe. */
export function nombrePasarela(gateway?: string | null): string {
  if (!gateway) return GENERICO;
  return NOMBRES[gateway.toUpperCase()] ?? GENERICO;
}

/** Para frases del tipo "pago seguro con X" / "confirma en X".
 *  Devuelve "con Stripe" o "con la pasarela de pagos" — sin duplicar el "con". */
export function conPasarela(gateway?: string | null): string {
  return `con ${nombrePasarela(gateway)}`;
}

/** true si sabemos cuál es. Sirve para ocultar detalles que solo aplican a una. */
export function pasarelaConocida(gateway?: string | null): boolean {
  return !!gateway && ['HOTMART', 'STRIPE', 'MERCADOPAGO'].includes(gateway.toUpperCase());
}
