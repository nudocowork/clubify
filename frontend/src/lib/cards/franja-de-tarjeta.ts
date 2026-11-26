/**
 * La franja de una tarjeta REAL con estilo, como SVG. Aparte del editor
 * (`EstiloDeLaFranja`) porque la usa también la vista previa del pase, que se
 * carga en páginas públicas y no debe arrastrar el editor.
 */
import {
  configDesdeTarjeta,
  dibujarFranja,
  ESTILOS_POR_TIPO,
  type DatosDeTarjeta,
  type EstiloDeTarjeta,
  type Nivel,
} from './estilos-de-franja';

/** Datos de la tarjeta que entran al dibujo (sin el avance, que pone quien llama). */
export type TarjetaParaEstilo = Omit<DatosDeTarjeta, 'sellados' | 'premiosIntermedios'> & {
  freeRewards?: Array<{ pos: number; text?: string; emoji?: string; active?: boolean }>;
};

/** Premios Free de la tarjeta, como los dibuja el servidor (`franjaDeTarjetaConEstilo`). */
export function premiosDe(t: TarjetaParaEstilo) {
  return (t.freeRewards ?? [])
    .filter((p) => p && p.active !== false && Number(p.pos) >= 1 && Number(p.pos) <= t.requeridos)
    .map((p) => ({
      pos: Math.floor(Number(p.pos)),
      // Igual que el servidor: solo el nombre (el emoji, si no hay nombre).
      texto: ((p.text ?? '').trim() || p.emoji || '').slice(0, 30),
    }));
}

export function franjaDeTarjeta(estilo: EstiloDeTarjeta, t: TarjetaParaEstilo, sellados: number): string {
  return dibujarFranja(configDesdeTarjeta(estilo, { ...t, sellados, premiosIntermedios: premiosDe(t) }));
}

/**
 * Misma regla que `estiloQueSeDibuja` del servidor: el estilo tiene que ser del
 * tipo de la tarjeta, y VIP solo con niveles por gasto (dibuja plata).
 */
export function estiloQueSeDibuja(
  tipo: string,
  estilo: EstiloDeTarjeta | null | undefined,
  tierMetric?: string | null,
): EstiloDeTarjeta | null {
  if (!estilo || !(ESTILOS_POR_TIPO[tipo] ?? []).includes(estilo.estilo)) return null;
  if (estilo.estilo === 'VIP' && (tierMetric || 'spend') !== 'spend') return null;
  return estilo;
}

/** `Card.tiers` ({ name, threshold, perks }) como los dibuja el estilo VIP. Igual que el servidor. */
export function nivelesDeLaTarjeta(tiers: unknown): Nivel[] {
  if (!Array.isArray(tiers)) return [];
  return tiers
    .filter((t) => t && typeof t.name === 'string' && Number.isFinite(Number(t.threshold)))
    .slice(0, 6)
    .map((t) => ({
      nombre: String(t.name).slice(0, 20),
      desde: Math.max(0, Number(t.threshold)),
      beneficio: Array.isArray(t.perks) && typeof t.perks[0] === 'string' ? t.perks[0].slice(0, 40) : '',
    }));
}

/** Un gasto de muestra a medio camino del segundo nivel, para que la vista previa enseñe la barra avanzando. */
export function gastoDeMuestra(niveles: Nivel[]): number {
  const orden = niveles.slice().sort((a, b) => a.desde - b.desde);
  return orden[1] ? Math.round(orden[0].desde + (orden[1].desde - orden[0].desde) * 0.6) : 0;
}
