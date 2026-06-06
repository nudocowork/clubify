'use client';

/**
 * /admin/dashboard-preview — 5 propuestas funcionales de dashboard.
 *
 * Ruta TEMPORAL para que el founder evalúe 5 diseños distintos antes de
 * decidir cuál se convierte en el dashboard oficial. La página actual
 * /admin queda INTACTA.
 *
 * Solo SUPER_ADMIN puede acceder — guard explícito acá (en vez de en
 * AppShell) porque es una ruta de preview interna que no debe llegar al
 * sidebar normal.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getUser } from '@/lib/api';
import { PreviewCeo } from '@/components/dashboard-preview/PreviewCeo';
import { PreviewOps } from '@/components/dashboard-preview/PreviewOps';
import { PreviewCom } from '@/components/dashboard-preview/PreviewCom';
import { PreviewMap } from '@/components/dashboard-preview/PreviewMap';
import { PreviewPremium } from '@/components/dashboard-preview/PreviewPremium';

type Tab = 'ceo' | 'ops' | 'com' | 'map' | 'premium';

const TABS: Array<{ key: Tab; label: string; emoji: string; hint: string }> = [
  { key: 'ceo', label: 'CEO', emoji: '📊', hint: 'Estilo Stripe' },
  { key: 'ops', label: 'Operaciones', emoji: '🔧', hint: 'Estilo CRM' },
  { key: 'com', label: 'Comercial', emoji: '💼', hint: 'Estilo Hubspot' },
  { key: 'map', label: 'Mapa', emoji: '🗺️', hint: 'SaaS premium dark' },
  { key: 'premium', label: 'Premium', emoji: '✨', hint: 'Stripe / Vercel' },
];

export default function DashboardPreviewPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('ceo');
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    const u = getUser();
    if (!u) {
      router.replace('/login');
      return;
    }
    if (u.role !== 'SUPER_ADMIN') {
      setAuthorized(false);
      return;
    }
    setAuthorized(true);
  }, [router]);

  if (authorized === null) {
    return (
      <div className="py-12 text-center text-mute text-sm">
        Verificando acceso…
      </div>
    );
  }

  if (authorized === false) {
    return (
      <div className="max-w-md mx-auto mt-12 p-6 rounded-xl border border-line2 bg-white text-center">
        <div className="text-2xl mb-2">🔒</div>
        <h1 className="text-lg font-bold text-ink">Acceso restringido</h1>
        <p className="text-sm text-mute mt-1">
          Esta vista preview es solo para SUPER_ADMIN.
        </p>
      </div>
    );
  }

  const current = TABS.find((t) => t.key === tab) ?? TABS[0];

  return (
    <div className="-mt-2">
      {/* Header sticky con tabs */}
      <div className="sticky top-0 z-20 -mx-3 md:-mx-6 px-3 md:px-6 py-3 bg-bg/95 backdrop-blur border-b border-line2 mb-4">
        <div className="flex flex-col gap-2">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
              Dashboard preview · evaluación interna
            </div>
            <h1 className="text-base md:text-lg font-bold text-ink mt-0.5">
              {current.emoji} {current.label}{' '}
              <span className="font-normal text-mute">— {current.hint}</span>
            </h1>
          </div>

          <div className="tabs">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={
                  'tab cursor-pointer select-none active:scale-[0.97] transition-transform duration-150 [-webkit-tap-highlight-color:transparent] ' +
                  (tab === t.key
                    ? 'bg-brand text-white font-semibold'
                    : 'hover:bg-bg2/80')
                }
                aria-pressed={tab === t.key}
              >
                <span className="mr-1" aria-hidden>
                  {t.emoji}
                </span>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="pb-12">
        {tab === 'ceo' && <PreviewCeo />}
        {tab === 'ops' && <PreviewOps />}
        {tab === 'com' && <PreviewCom />}
        {tab === 'map' && <PreviewMap />}
        {tab === 'premium' && <PreviewPremium />}
      </div>

      <div className="border-t border-line2 pt-4 text-[11px] text-mute">
        Ruta temporal · /admin/dashboard-preview · una vez elegida la
        propuesta favorita, se convierte en el panel oficial. La vista
        actual /admin sigue intacta.
      </div>
    </div>
  );
}
