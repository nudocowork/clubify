'use client';
import { useTranslations } from 'next-intl';

/**
 * El «Cargando editor…» del editor de carteles QR.
 *
 * Vive en su propio componente porque el `loading:` de `next/dynamic` se
 * declara FUERA del componente de la pantalla, donde no hay hooks y por tanto
 * no hay traductor. Estaba escrito a mano en español en los cinco carteles.
 */
export function EditorCargando() {
  const t = useTranslations('app_qr');
  return <div className="text-mute py-8 text-center">{t('loadingEditor')}</div>;
}
