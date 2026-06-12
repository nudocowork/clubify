import { getRequestConfig } from 'next-intl/server';
import { detectLocaleSync } from './detect';

export default getRequestConfig(async () => {
  const locale = detectLocaleSync();
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages };
});
