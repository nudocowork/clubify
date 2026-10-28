/**
 * El formulario con el que el cliente obtiene su tarjeta (`/c/<cardId>`),
 * configurable por negocio. Espejo del de backend
 * (`backend/src/passes/formulario-de-registro.ts`), que es el que manda: este
 * solo pinta y avisa antes de enviar.
 */
export type ModoDeCampo = 'obligatorio' | 'opcional' | 'oculto';
export type TipoDeCampo = 'texto' | 'numero' | 'fecha' | 'opciones';

export interface CampoExtra {
  id: string;
  etiqueta: string;
  tipo: TipoDeCampo;
  obligatorio: boolean;
  opciones?: string[];
}

export interface FormularioDeRegistro {
  email: ModoDeCampo;
  cumpleanos: ModoDeCampo;
  extras: CampoExtra[];
}

export const MAX_EXTRAS = 8;

/** Sin formulario guardado (o backend viejo): Sellea exige correo y cumpleaños. */
export function formularioPorDefecto(marcaSlug: string | null | undefined): FormularioDeRegistro {
  const exige = marcaSlug === 'sellea' || marcaSlug === 'selleala';
  return { email: exige ? 'obligatorio' : 'opcional', cumpleanos: exige ? 'obligatorio' : 'opcional', extras: [] };
}
