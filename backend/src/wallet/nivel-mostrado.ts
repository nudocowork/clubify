/**
 * El nivel que enseña el pase VIP.
 *
 * `Pass.currentTier` lo escribe el escáner en la primera compra, así que un pase
 * recién emitido no tenía nivel y salía «Miembro», aunque la tarjeta tenga un
 * nivel que empieza en $0 (Bronce). Se resuelve aquí, al mostrarlo, y no al
 * crear el pase: hay cinco sitios que crean pases y se escaparía alguno.
 */
export function nivelMostrado(currentTier: string | null | undefined, tiers: unknown): string | null {
  if (currentTier) return currentTier;
  if (!Array.isArray(tiers)) return null;
  const inicial = tiers
    .filter((t) => t && typeof t.name === 'string' && t.name.trim() && Number(t.threshold) <= 0)
    .sort((a, b) => Number(a.threshold) - Number(b.threshold))[0];
  return inicial ? String(inicial.name) : null;
}
