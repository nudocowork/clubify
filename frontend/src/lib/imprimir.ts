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

/**
 * Imprime aplicando la medida indicada.
 *
 * `antes` sirve para marcar el documento (por ejemplo `data-print-mode`), que
 * es lo que decide QUÉ bloque se ve. `despues` lo deshace.
 */
export function imprimirCon(
  medida: MedidaDePagina,
  opciones: { antes?: () => void; despues?: () => void } = {},
) {
  if (typeof document === 'undefined') return;

  document.getElementById(ID)?.remove();
  const style = document.createElement('style');
  style.id = ID;
  style.textContent = MEDIDAS[medida];
  document.head.appendChild(style);

  opciones.antes?.();

  // El respiro deja que el navegador aplique el estilo y el marcado antes de
  // abrir el diálogo. Sin él, Chrome llega a abrirlo con la medida vieja.
  setTimeout(() => {
    window.print();
    setTimeout(() => {
      document.getElementById(ID)?.remove();
      opciones.despues?.();
    }, 500);
  }, 60);
}
