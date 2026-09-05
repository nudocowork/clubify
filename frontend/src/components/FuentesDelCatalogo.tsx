'use client';
import { useEffect } from 'react';

/**
 * Las tipografías del catálogo, cargadas SIN bloquear el primer pintado.
 *
 * Son las 129 familias que el negocio puede elegir en el editor del cartel QR,
 * en las portadas del menú y en la página del link. Estaban como
 * `<link rel="stylesheet">` en el `<head>`, y eso las hace **bloqueantes**: el
 * navegador no pinta nada hasta que responden tres peticiones a Google. En el
 * panel, con wifi, no se nota. En el menú de un negocio abierto con datos
 * móviles, es tiempo en blanco delante del cliente que iba a pedir — y esas
 * páginas ni siquiera usan esas familias.
 *
 * Inyectarlas después de hidratar deja el primer pintado libre y no le quita
 * ninguna fuente a nadie: donde se usan, entran un instante después.
 *
 * Nota de rendimiento real: el navegador solo DESCARGA los archivos de las
 * familias que la página usa de verdad; lo que se ahorra aquí son las tres
 * peticiones que frenaban el render, no un megabyte de fuentes.
 */
export function FuentesDelCatalogo({ urls }: { urls: string[] }) {
  useEffect(() => {
    for (const href of urls) {
      // Idempotente: si el usuario navega entre páginas del panel, el link ya
      // está puesto y no hay que duplicarlo.
      if (document.querySelector(`link[data-fuente="${href}"]`)) continue;
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = href;
      l.setAttribute('data-fuente', href);
      document.head.appendChild(l);
    }
  }, [urls]);
  return null;
}
