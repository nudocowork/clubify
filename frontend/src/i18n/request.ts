import { getRequestConfig } from 'next-intl/server';
import { detectLocaleSync } from './detect';
import { BASE_LOCALE } from './config';

export default getRequestConfig(async () => {
  const locale = detectLocaleSync();
  // Variantes regionales (en-GB, pt-BR, etc) cargan el messages base
  // para no duplicar strings. Si en el futuro se necesitan overrides
  // por variante, agregar messages/<variant>.json y merge acá.
  const base = BASE_LOCALE[locale];
  const messages = (await import(`../../messages/${base}.json`)).default;
  return { locale, messages };
});
