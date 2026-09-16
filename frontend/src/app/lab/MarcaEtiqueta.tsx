'use client';
import { NARANJA_MARCA, colorDeMarca, type EtiquetaMarca } from './_shared';

/**
 * Etiqueta con el nombre de la marca de una propuesta. La usa la moderación de
 * la plataforma para distinguir lo que dejó el administrador de una marca
 * blanca de lo de Clubify, y así ordenarlo. Sin marca no pinta nada.
 *
 * Va en NARANJA, el color fijo que pidió Javier para reconocer de un vistazo lo
 * que llega de una marca blanca (ver `NARANJA_MARCA`). El color propio de la
 * marca queda en el punto de la izquierda, para seguir distinguiendo entre
 * varias marcas cuando haya más de una.
 */
export function MarcaEtiqueta({ marca }: { marca?: EtiquetaMarca | null }) {
  if (!marca?.name) return null;
  const color = colorDeMarca(marca.primaryColor);
  return (
    <span
      className={`badge ${NARANJA_MARCA.chip} gap-1.5`}
      title={`Propuesta de ${marca.name}`}
    >
      {/* El color sale de la fila de la marca, no del código: por eso `style`. */}
      {color && (
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
      )}
      {marca.name}
    </span>
  );
}
