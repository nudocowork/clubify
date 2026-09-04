import type { ReactElement } from 'react';

/**
 * Las options de día y de mes del cumpleaños.
 *
 * Vivían dentro de la página de alta (`/c/[cardId]`). El paso de registro del
 * club pide exactamente el mismo dato, y dos listas de meses en dos archivos
 * acaban siempre igual: una traducida y la otra en español para todo el mundo.
 */
export const DAY_OPTIONS: ReactElement[] = Array.from(
  { length: 31 },
  (_, i) => i + 1,
).map((d) => (
  <option key={d} value={d}>
    {d}
  </option>
));

/**
 * Nombres de mes en el idioma activo. Se piden a `Intl` en vez de tenerlos
 * escritos: estuvieron fijos en español y no se traducían en /en, /pt ni /it.
 */
export function monthOptionsFor(locale: string): ReactElement[] {
  const fmt = new Intl.DateTimeFormat(locale || 'es', { month: 'long' });
  return Array.from({ length: 12 }, (_, i) => {
    const name = fmt.format(new Date(2020, i, 1));
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    return (
      <option key={i + 1} value={i + 1}>
        {label}
      </option>
    );
  });
}
