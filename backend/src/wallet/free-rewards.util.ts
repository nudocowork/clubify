/**
 * Wallet V3 — "Premios Free" (premios intermedios) y cálculo del "Próximo Premio".
 *
 * El próximo premio es POSICIONAL: el siguiente hito (premio intermedio activo o
 * el premio final) con posición > sellos actuales. Se recalcula solo con el
 * conteo → funciona igual al sumar o restar sellos, y nunca muestra un premio
 * ya alcanzado.
 */
export type FreeReward = {
  id?: string;
  pos: number;
  text?: string | null;
  emoji?: string | null;
  circleColor?: string | null;
  textColor?: string | null;
  active?: boolean;
};

export function parseFreeRewards(raw: unknown): FreeReward[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is FreeReward =>
      !!r && typeof r === 'object' && Number.isFinite(Number((r as any).pos)),
  );
}

/** Etiqueta legible de un premio: "emoji texto" (lo que exista). */
export function freeRewardLabel(fr: FreeReward): string {
  return [fr.emoji, fr.text].map((s) => (s ?? '').trim()).filter(Boolean).join(' ').trim();
}

/**
 * Devuelve el próximo hito con posición > `current`, considerando los premios
 * intermedios activos y el premio final (`rewardText` en `stampsRequired`).
 * null si ya no hay próximo (todo alcanzado) o no hay premios configurados.
 */
export function nextRewardLabel(opts: {
  freeRewards?: unknown;
  rewardText?: string | null;
  stampsRequired?: number | null;
  current: number;
}): { pos: number; label: string } | null {
  const candidates: Array<{ pos: number; label: string }> = [];
  for (const fr of parseFreeRewards(opts.freeRewards)) {
    if (fr.active === false) continue;
    const pos = Math.floor(Number(fr.pos));
    if (!Number.isFinite(pos) || pos < 1) continue;
    const label = freeRewardLabel(fr);
    if (label) candidates.push({ pos, label });
  }
  const finalText = (opts.rewardText ?? '').trim();
  if (opts.stampsRequired && finalText) {
    candidates.push({ pos: Math.floor(opts.stampsRequired), label: finalText });
  }
  const upcoming = candidates
    .filter((c) => c.pos > opts.current)
    .sort((a, b) => a.pos - b.pos);
  return upcoming[0] ?? null;
}
