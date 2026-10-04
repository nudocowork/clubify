'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { esRutaPublica } from '@/i18n/textos-publicos';

/**
 * Seguro de las páginas públicas con textos recortados (ver
 * `textos-publicos.ts`). El layout raíz no se vuelve a montar al navegar
 * dentro de la app: si desde un menú se llegara a otra página sin recarga, esa
 * página no tendría sus textos. Hoy las páginas públicas no tienen enlaces
 * internos de Next, pero un `<Link>` nuevo lo rompería en silencio: aquí se
 * recarga para traer el diccionario completo.
 */
export function RecargaConTextosCompletos() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname && !esRutaPublica(pathname)) window.location.reload();
  }, [pathname]);
  return null;
}
