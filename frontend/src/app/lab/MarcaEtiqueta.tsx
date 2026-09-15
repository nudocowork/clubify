'use client';
import { colorDeMarca, type EtiquetaMarca } from './_shared';

/**
 * Etiqueta con el nombre y el color de la marca de una propuesta. La usa la
 * moderación de la plataforma para distinguir lo que dejó el administrador de
 * una marca blanca de lo de Clubify, y así ordenarlo. Sin marca no pinta nada.
 */
export function MarcaEtiqueta({ marca }: { marca?: EtiquetaMarca | null }) {
  if (!marca?.name) return null;
  const color = colorDeMarca(marca.primaryColor);
  // El color sale de la fila de la marca, no del código: por eso va en `style`.
  return (
    <span
      className={color ? 'badge text-white' : 'badge badge-mute'}
      style={color ? { backgroundColor: color } : undefined}
      title={`Propuesta de ${marca.name}`}
    >
      {marca.name}
    </span>
  );
}
