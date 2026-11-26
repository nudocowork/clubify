/**
 * Lo que se GUARDA de una tarjeta de Cashback o VIP por niveles.
 *
 * El PATCH de tarjetas recibe `Partial<CardBody>` y por eso el ValidationPipe no
 * mira sus campos (lo dice el propio servicio). Hasta ahora daba igual porque
 * estos tipos no se podían crear; al reactivarlos, un `cashbackPercent` de 7.5
 * o de 500, o un nivel sin nombre, terminarían en el pase del cliente.
 */
const HEX = /^#[0-9a-fA-F]{6}$/;

export type NivelGuardado = { name: string; threshold: number; perks: string[]; color?: string; icon?: string };

/** % de cashback: entero de 1 a 100. `null` si no viene un número. */
export function porcentajeDeCashback(v: unknown): number | null {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return null;
  return Math.min(100, Math.max(1, Math.round(n)));
}

/** Compra mínima para ganar cashback: monto ≥ 0; vacío o 0 = sin mínimo. */
export function compraMinima(v: unknown): number | null {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

/** Niveles: con nombre, umbral ≥ 0, a lo sumo 6, ordenados por umbral. */
export function nivelesParaGuardar(v: unknown): NivelGuardado[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((t) => t && typeof t === 'object' && typeof t.name === 'string' && t.name.trim())
    .slice(0, 6)
    .map((t) => {
      const umbral = Number(t.threshold);
      const nivel: NivelGuardado = {
        name: String(t.name).trim().slice(0, 30),
        threshold: Number.isFinite(umbral) ? Math.max(0, Math.round(umbral)) : 0,
        perks: (Array.isArray(t.perks) ? t.perks : [])
          .filter((p: unknown): p is string => typeof p === 'string' && p.trim() !== '')
          .slice(0, 5)
          .map((p: string) => p.trim().slice(0, 60)),
      };
      if (typeof t.color === 'string' && HEX.test(t.color)) nivel.color = t.color;
      if (typeof t.icon === 'string' && t.icon.length <= 16) nivel.icon = t.icon;
      return nivel;
    })
    .sort((a, b) => a.threshold - b.threshold);
}

/** Métrica de los niveles; lo desconocido cae al gasto, el default del editor. */
export function metricaParaGuardar(v: unknown): 'spend' | 'visits' | 'stamps' {
  return v === 'visits' || v === 'stamps' ? v : 'spend';
}
