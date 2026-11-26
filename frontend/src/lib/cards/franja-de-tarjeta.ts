/**
 * La franja de una tarjeta REAL con estilo, como SVG. Aparte del editor
 * (`EstiloDeLaFranja`) porque la usa también la vista previa del pase, que se
 * carga en páginas públicas y no debe arrastrar el editor.
 */
import { configDesdeTarjeta, dibujarFranja, type DatosDeTarjeta, type EstiloDeTarjeta } from './estilos-de-franja';

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
