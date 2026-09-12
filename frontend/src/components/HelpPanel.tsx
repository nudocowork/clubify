'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Icon } from './Icon';
import { useTranslations } from 'next-intl';

/**
 * Las preguntas frecuentes.
 *
 * Solo las CLAVES: el texto lo pone el traductor. Estaban escritas a mano en
 * español, así que un negocio en inglés abría la ayuda y la encontraba entera
 * en otro idioma.
 */
type Categoria = 'start' | 'orders' | 'cards' | 'site' | 'account' | 'billing';
type FAQ = { clave: string; categoria: Categoria; href?: string };

const FAQS: FAQ[] = [
  { clave: 'firstProduct', categoria: 'start', href: '/app/menu' },
  { clave: 'customizeSite', categoria: 'start', href: '/app/storefront' },
  { clave: 'inviteStaff', categoria: 'start', href: '/app/staff' },
  { clave: 'ordersArrive', categoria: 'orders', href: '/app/orders' },
  { clave: 'muteOrders', categoria: 'orders' },
  // La pregunta de «¿cómo imprimo el ticket de cocina?» se quitó el
  // 2026-09-11: la impresión ya no está en los negocios (solo en DEMO Clubify
  // y Nudo Cowork), así que la respuesta mandaba a un botón que no existe.
  { clave: 'dragOrders', categoria: 'orders' },
  { clave: 'wallets', categoria: 'cards' },
  { clave: 'addStamp', categoria: 'cards', href: '/scan' },
  { clave: 'bulkCards', categoria: 'cards' },
  { clave: 'ownDomain', categoria: 'site', href: '/app/storefront' },
  { clave: 'shareLink', categoria: 'site' },
  { clave: 'changePassword', categoria: 'account', href: '/app/settings' },
  { clave: 'exportData', categoria: 'account', href: '/app/settings' },
  { clave: 'whenCharged', categoria: 'billing', href: '/app/billing' },
  { clave: 'cardFails', categoria: 'billing' },
  { clave: 'changePlan', categoria: 'billing', href: '/app/billing' },
];

const CATEGORIES: Categoria[] = [
  'start',
  'orders',
  'cards',
  'site',
  'account',
  'billing',
];
const CLAVE_CATEGORIA: Record<Categoria, string> = {
  start: 'catStart',
  orders: 'catOrders',
  cards: 'catCards',
  site: 'catSite',
  account: 'catAccount',
  billing: 'catBilling',
};

export function HelpButton() {
  const t = useTranslations('help_panel');
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-30 bg-brand text-white w-12 h-12 rounded-full shadow-lg hover:shadow-xl transition flex items-center justify-center text-lg"
        title={t('helpAndFaq')}
        aria-label={t('openHelp')}
      >
        ?
      </button>
      <HelpPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function HelpPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('help_panel');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Categoria | 'todas'>('todas');

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // La búsqueda va contra el texto TRADUCIDO: buscar «stamp» en un panel en
  // inglés tenía que encontrar la pregunta de los sellos.
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return FAQS.filter((f) => {
      if (cat !== 'todas' && f.categoria !== cat) return false;
      if (!term) return true;
      const pregunta = t(`q_${f.clave}` as any).toLowerCase();
      const respuesta = t(`a_${f.clave}` as any).toLowerCase();
      return pregunta.includes(term) || respuesta.includes(term);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, cat]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="absolute inset-0 bg-ink/50 transition-opacity"
        onClick={onClose}
      />
      <div className="ml-auto relative h-full w-full max-w-md bg-white shadow-2xl flex flex-col">
        <div className="px-5 py-4 border-b border-line2 flex items-center justify-between">
          <div>
            <div className="font-bold text-lg">{t('help')}</div>
            <div className="text-xs text-mute">{t('faq')}</div>
          </div>
          <button
            onClick={onClose}
            className="text-mute hover:text-ink text-xl"
            aria-label={t('close')}
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-3 border-b border-line2 space-y-2.5">
          <div className="flex items-center gap-2 bg-bg2 rounded-pill px-3 py-1.5">
            <Icon name="search" size={14} className="text-mute" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="border-0 outline-none text-sm flex-1 bg-transparent"
            />
            {q && (
              <button
                onClick={() => setQ('')}
                className="text-mute hover:text-ink text-sm"
              >
                ✕
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {(['todas', ...CATEGORIES] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={`text-[11px] font-medium px-2.5 py-1 rounded-full border ${
                  cat === c
                    ? 'bg-brand text-white border-brand'
                    : 'bg-white text-mute border-line hover:border-brand/40'
                }`}
              >
                {c === 'todas' ? t('all') : t(CLAVE_CATEGORIA[c] as any)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto px-5 py-3">
          {filtered.length === 0 ? (
            <div className="text-center py-10">
              <div className="text-3xl mb-1">🤔</div>
              <div className="text-sm font-semibold">{t('noResults')}</div>
              <p className="text-xs text-mute mt-1">{t('noResultsBody')}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((f) => (
                <details
                  key={f.clave}
                  className="rounded-lg border border-line2 group"
                >
                  <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium hover:bg-bg2/50 list-none flex items-center justify-between">
                    <span className="flex-1 pr-3">
                      {t(`q_${f.clave}` as any)}
                    </span>
                    <span className="text-mute group-open:rotate-180 transition">
                      ▾
                    </span>
                  </summary>
                  <div className="px-3 pb-3 text-sm text-mute leading-relaxed">
                    {t(`a_${f.clave}` as any)}
                    {f.href && (
                      <div className="mt-2">
                        <Link
                          href={f.href}
                          onClick={onClose}
                          className="text-xs text-brand hover:underline"
                        >
                          {t('goToSection')}
                        </Link>
                      </div>
                    )}
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-line2 bg-bg2/40 text-xs">
          <div className="text-mute mb-2">{t('cantFind')}</div>
          <div className="flex gap-2">
            <a
              href="https://wa.me/573167689240"
              target="_blank"
              rel="noreferrer"
              className="flex-1 inline-flex items-center justify-center gap-1.5 bg-ok text-white font-semibold px-3 py-2 rounded-pill text-xs hover:bg-ok/90"
            >
              <Icon name="send" size={12} /> {t('whatsappSupport')}
            </a>
            <a
              href="mailto:hola@soyclubify.com"
              className="flex-1 inline-flex items-center justify-center gap-1.5 bg-bg2 text-ink font-semibold px-3 py-2 rounded-pill text-xs hover:bg-line"
            >
              ✉ Email
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
