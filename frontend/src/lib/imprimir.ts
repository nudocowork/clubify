/**
 * Imprimir con la MEDIDA DE PÁGINA correcta.
 *
 * Un `@page` de CSS no se puede acotar con un selector: aunque se escriba
 * dentro de `@media print { ... }` junto a otras reglas, es GLOBAL, y entre
 * varios gana el último del archivo.
 *
 * En este producto había tres —ticket de 80 mm, recibo A5 y póster A4— en la
 * misma hoja de estilos, así que el póster, por estar el último, le imponía A4
 * a todo. El ticket de cocina, maquetado a 72 mm para un rollo térmico,
 * llegaba a la impresora dentro de una página A4 con el contenido en una
 * esquina: papel EN BLANCO. Lo reportó Serendipity el 2026-09-08.
 *
 * La única forma fiable de decidirlo por impresión es inyectar el `@page` en
 * el momento, que gana por ir en un `<style>` del documento, y quitarlo al
 * terminar.
 *
 * CUÁNDO SE LIMPIA, Y POR QUÉ IMPORTA TANTO
 * -----------------------------------------
 * Antes se limpiaba con un `setTimeout` de medio segundo después de llamar a
 * `window.print()`. **`window.print()` no bloquea**: en Chrome abre la vista
 * previa y devuelve el control en el acto. Así que medio segundo más tarde se
 * borraba la marca `data-print-mode` —la que decide QUÉ bloque se ve— con el
 * diálogo todavía abierto. La vista previa salía bien, y cuando el cajero
 * pulsaba «Imprimir» unos segundos después, el bloque ya no estaba en el
 * documento: papel en blanco otra vez, ahora por otro motivo.
 *
 * Serendipity lo reportó las dos veces. La segunda parecía «le doy a imprimir
 * y no manda nada».
 *
 * Ahora se limpia con `afterprint`, que es el evento que existe exactamente
 * para esto y que dispara cuando el diálogo se cierra —imprima o cancele—.
 * El temporizador se queda solo como red de seguridad, y muy largo: si algún
 * navegador no lanza `afterprint`, la página no se queda marcada para siempre.
 */

export type MedidaDePagina = 'ticket' | 'recibo' | 'poster';

const MEDIDAS: Record<MedidaDePagina, string> = {
  /** Rollo térmico de 80 mm, alto libre. El ticket se maqueta a 72 mm. */
  ticket: '@page { size: 80mm auto; margin: 4mm; }',
  /** Recibo del cliente: A5, que es el ancho para el que está maquetado. */
  recibo: '@page { size: A5 portrait; margin: 10mm; }',
  /** Póster del QR para pegar en la pared. */
  poster: '@page { size: A4 portrait; margin: 12mm; }',
};

const ID = 'medida-de-pagina';

/** Red de seguridad por si `afterprint` no llega. Generoso a propósito: el
 *  cajero puede tardar en elegir impresora, y limpiar antes de tiempo es el
 *  fallo que esto viene a arreglar. */
const RESCATE_MS = 2 * 60 * 1000;

/**
 * Imprime aplicando la medida indicada.
 *
 * `antes` sirve para marcar el documento (por ejemplo `data-print-mode`), que
 * es lo que decide QUÉ bloque se ve. `despues` lo deshace, y se llama cuando
 * el diálogo se cierra — no en un temporizador.
 */
export function imprimirCon(
  medida: MedidaDePagina,
  opciones: { antes?: () => void; despues?: () => void } = {},
) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  document.getElementById(ID)?.remove();
  const style = document.createElement('style');
  style.id = ID;
  style.textContent = MEDIDAS[medida];
  document.head.appendChild(style);

  opciones.antes?.();

  let limpiado = false;
  let rescate: ReturnType<typeof setTimeout> | null = null;

  const limpiar = () => {
    if (limpiado) return;
    limpiado = true;
    if (rescate) clearTimeout(rescate);
    window.removeEventListener('afterprint', limpiar);
    consulta?.removeEventListener?.('change', alCambiarMedio);
    document.getElementById(ID)?.remove();
    opciones.despues?.();
  };

  // Safari no siempre lanza `afterprint`, pero sí cambia el medio a `print`
  // mientras dura el diálogo. Al volver a `screen`, se acabó.
  const consulta =
    typeof window.matchMedia === 'function' ? window.matchMedia('print') : null;
  const alCambiarMedio = (e: MediaQueryListEvent) => {
    if (!e.matches) limpiar();
  };

  window.addEventListener('afterprint', limpiar);
  consulta?.addEventListener?.('change', alCambiarMedio);
  rescate = setTimeout(limpiar, RESCATE_MS);

  // El respiro deja que el navegador aplique el estilo y el marcado antes de
  // abrir el diálogo. Sin él, Chrome llega a abrirlo con la medida vieja.
  setTimeout(() => {
    window.print();
  }, 60);
}
