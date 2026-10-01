/**
 * Reglas del plan FAMILIAR: el titular paga una suscripción y puede enlazar
 * hasta `maxLinkedMembers` tarjetas más (las define su plan). Los enlaces no
 * pagan: heredan la vigencia del titular — renueva él, renuevan todos.
 *
 * Puras a propósito: son las guardas de un endpoint público (Mi tarjeta) y del
 * panel a la vez, y lo que protegen es plata — un enlace de más es una tarjeta
 * gratis canjeando en los aliados.
 */
export type DatosEnlace = {
  /** La membresía destino ¿es ella misma un enlace? (no se encadenan) */
  titularEsEnlace: boolean;
  /** Tope de tarjetas enlazadas del plan del titular. 0 = plan individual. */
  maxEnlaces: number;
  /** Enlaces vivos (no cancelados) que ya cuelgan del titular. */
  enlacesActivos: number;
  /** ¿La membresía del titular canjea hoy? (estado + vencimiento). */
  titularUsable: boolean;
};

/** Devuelve el motivo por el que NO se puede enlazar, o null si se puede. */
export function porQueNoSePuedeEnlazar(d: DatosEnlace): string | null {
  if (d.titularEsEnlace) {
    return 'Esa tarjeta ya es un enlace de un plan familiar: los enlaces no se encadenan.';
  }
  if (d.maxEnlaces <= 0) {
    return 'El plan de este beneficiario no incluye tarjetas enlazadas.';
  }
  if (!d.titularUsable) {
    return 'La membresía del titular no está al día: primero hay que renovarla.';
  }
  if (d.enlacesActivos >= d.maxEnlaces) {
    return `Este plan permite ${d.maxEnlaces} ${
      d.maxEnlaces === 1 ? 'tarjeta enlazada' : 'tarjetas enlazadas'
    } y ya están todas en uso.`;
  }
  return null;
}
