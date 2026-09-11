import { randomUUID } from 'node:crypto';

/**
 * Premios intermedios de una tarjeta de sellos («Premios Free»).
 *
 * Son los premios que el cliente gana ANTES del premio final: el café al sello
 * 3, la galleta al 5. Se dibujan DENTRO del círculo del sello que les toca, con
 * un badge 🎁 en la esquina.
 *
 * POR QUÉ VIVE AQUÍ Y NO DENTRO DE `CardsService`
 * ----------------------------------------------
 * Era un método privado del servicio de tarjetas, así que el panel validaba y
 * el **Onboarding no podía**: `datosDeTarjetaDeSellos` ni siquiera miraba el
 * campo, y todo lo que mandara se tiraba en silencio. El cliente configuraba
 * sus premios intermedios en el formulario y no aparecían en ningún sitio.
 *
 * Una sola copia de la regla, o las dos puertas divergen — que es exactamente
 * lo que ya pasó con el cobro de créditos.
 */

export type PremioIntermedioEntrada = {
  id?: string;
  pos?: unknown;
  text?: unknown;
  emoji?: unknown;
  circleColor?: unknown;
  textColor?: unknown;
  active?: unknown;
};

export type PremioIntermedio = {
  id: string;
  pos: number;
  text: string;
  emoji: string;
  circleColor: string | null;
  textColor: string | null;
  active: boolean;
};

const esHex = (v: unknown): v is string =>
  typeof v === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim());

/**
 * Normaliza la lista. Reglas, todas con su motivo:
 *
 * - `pos` fuera de `1..stampsRequired` **se descarta**: un premio más allá del
 *   último sello no se dibuja nunca, así que guardarlo solo engaña a quien lo
 *   configuró.
 * - **Una posición, un premio.** Gana el primero. Dos en el mismo círculo se
 *   pintarían encima.
 * - `text` se recorta a 24 caracteres y `emoji` a 8: entran dentro del círculo.
 * - Color que no sea hex → `null` (el de por defecto). Sin esto, cualquier
 *   texto se guardaba como color y rompía la tarjeta en silencio.
 * - Sin `active` → `true`: quien manda un premio lo quiere encendido.
 * - **Sin tope de cantidad.**
 *
 * `undefined` de entrada devuelve `undefined` — «no lo toques», distinto de
 * `[]`, que es «bórralos todos».
 */
export function sanearPremiosIntermedios(
  raw: PremioIntermedioEntrada[] | undefined,
  stampsRequired?: number | null,
): PremioIntermedio[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return [];
  const vistas = new Set<number>();
  const maxPos =
    typeof stampsRequired === 'number' && stampsRequired > 0
      ? stampsRequired
      : Number.MAX_SAFE_INTEGER;
  return raw
    .map((r) => {
      const pos = Math.floor(Number((r as any)?.pos));
      if (!Number.isFinite(pos) || pos < 1 || pos > maxPos) return null;
      return {
        id:
          typeof (r as any)?.id === 'string' && (r as any).id
            ? (r as any).id
            : randomUUID(),
        pos,
        text: String((r as any)?.text ?? '').trim().slice(0, 24),
        emoji: String((r as any)?.emoji ?? '').trim().slice(0, 8),
        circleColor: esHex((r as any)?.circleColor)
          ? (r as any).circleColor.trim()
          : null,
        textColor: esHex((r as any)?.textColor) ? (r as any).textColor.trim() : null,
        active: (r as any)?.active === undefined ? true : !!(r as any).active,
      };
    })
    .filter((r): r is PremioIntermedio => r !== null)
    .filter((r) => {
      if (vistas.has(r.pos)) return false;
      vistas.add(r.pos);
      return true;
    })
    .sort((a, b) => a.pos - b.pos);
}
