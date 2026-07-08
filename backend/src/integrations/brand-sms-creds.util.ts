import { decryptSecret } from '../common/crypto/secret-box';

/**
 * Credenciales de Grow Business (GoHighLevel) de una MARCA blanca, listas para
 * enviar SMS. El apiKey en WhiteLabel está CIFRADO (secret-box) → se descifra
 * acá. Devuelve null si la marca no tiene subcuenta vinculada.
 *
 * Uso: como capa de fallback en los resolvers de creds SMS, DEBAJO de las creds
 * propias del negocio y ARRIBA de "no enviar". Así los SMS de un negocio de una
 * marca blanca salen de la subcuenta de SU marca, nunca de la de Clubify.
 */
export function brandGrowCreds(
  wl:
    | {
        growBusinessLocationId?: string | null;
        growBusinessApiKey?: string | null;
        growBusinessSwitchNumber?: number | null;
      }
    | null
    | undefined,
): { locationId: string; apiKey: string; switchNumber: number | null } | null {
  if (!wl?.growBusinessLocationId || !wl?.growBusinessApiKey) return null;
  return {
    locationId: wl.growBusinessLocationId,
    apiKey: decryptSecret(wl.growBusinessApiKey),
    switchNumber: wl.growBusinessSwitchNumber ?? null,
  };
}

/** Campos a seleccionar de whiteLabel para resolver sus creds GHL. */
export const BRAND_GROW_SELECT = {
  growBusinessLocationId: true,
  growBusinessApiKey: true,
  growBusinessSwitchNumber: true,
} as const;
