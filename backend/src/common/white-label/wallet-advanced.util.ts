/**
 * Wallet V3 — permisos "Wallet Avanzado" por marca blanca.
 *
 * Semántica de HERENCIA: null / clave ausente = ACTIVADO. Las mejoras de Wallet
 * se heredan automáticamente a todas las marcas (Clubify, Sellea, futuras). Una
 * marca DESACTIVA una función poniendo su clave en `false` → sus negocios no
 * podrán usarla. A nivel negocio las funciones siguen siendo opt-in por tarjeta.
 *
 * Aislamiento: `WhiteLabel` no tiene `tenantId` (no lo cubre el middleware
 * multitenant) → todo acceso a este flag va SIEMPRE scopeado por `whiteLabelId`.
 */
export const WALLET_ADVANCED_KEYS = [
  'customBackgrounds', // Permitir fondos personalizados (imagen del área de sellos)
  'freeRewards', // Permitir Premios Free
  'removeStamps', // Permitir Restar Sellos (-1 desde el escáner)
  'showNextReward', // Mostrar "Próximo Premio"
  'showHistory', // Mostrar Historial de sellos
  'showAudit', // Mostrar Auditoría (IP/dispositivo) al negocio + Master Admin
] as const;

export type WalletAdvancedKey = (typeof WALLET_ADVANCED_KEYS)[number];
export type WalletAdvancedFlags = Record<WalletAdvancedKey, boolean>;

/**
 * Resuelve los 6 flags de una marca a booleanos explícitos. `null` o clave
 * ausente → `true` (heredado/activo). Sirve tanto para LEER (gating) como para
 * PERSISTIR (guardamos siempre el objeto completo de 6 claves).
 */
export function resolveWalletAdvanced(raw: unknown): WalletAdvancedFlags {
  const obj =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const flags = {} as WalletAdvancedFlags;
  for (const k of WALLET_ADVANCED_KEYS) {
    flags[k] = obj[k] === undefined || obj[k] === null ? true : !!obj[k];
  }
  return flags;
}
