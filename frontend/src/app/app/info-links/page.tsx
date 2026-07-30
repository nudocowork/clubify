'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { api, getUser } from '@/lib/api';
import { publicHostForTenant } from '@/lib/public-domain';
import { Icon } from '@/components/Icon';

type InfoLink = {
  id: string;
  slug: string;
  rootSlug: string | null;
  title: string;
  subtitle: string | null;
  heroImageUrl: string | null;
  isActive: boolean;
  views: number;
  updatedAt: string;
  _count: { events: number };
};

export default function InfoLinksList() {
  const t = useTranslations('app_info_links');
  const router = useRouter();
  const [list, setList] = useState<InfoLink[]>([]);
  const [tenant, setTenant] = useState<any>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    const data = await api<InfoLink[]>('/info-links');
    setList(data);
    setTenant(await api('/tenants/me'));
  }
  useEffect(() => {
    load();
  }, []);

  async function create() {
    setCreating(true);
    try {
      const r = await api<{ id: string }>('/info-links', {
        method: 'POST',
        body: JSON.stringify({
          title: t('sampleTitle'),
          subtitle: t('sampleSubtitle'),
          sections: [
            { type: 'paragraph', text: t('sampleParagraph') },
          ],
          buttons: [],
          theme: { primaryColor: '#22C55E' },
        }),
      });
      router.push(`/app/info-links/${r.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function toggle(l: InfoLink) {
    await api(`/info-links/${l.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !l.isActive }),
    });
    load();
  }

  async function remove(id: string) {
    if (!confirm(t('confirmDelete'))) return;
    await api(`/info-links/${id}`, { method: 'DELETE' });
    load();
  }

  async function duplicate(l: InfoLink) {
    const r = await api<{ id: string }>(`/info-links/${l.id}/duplicate`, {
      method: 'POST',
    });
    // Vamos directo al editor del duplicado para que el dueño le ajuste
    // título/slug/etc. La lista se ve cuando vuelve.
    router.push(`/app/info-links/${r.id}`);
  }

  // Dominio público del negocio: customDomain (propio) > marca > soyclubify.com.
  const vanityDomain = publicHostForTenant(tenant);

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          {t('heading')}{' '}
          <span className="page-crumb">
            / {t('countCrumb', { count: list.length })}
          </span>
        </h1>
        <button className="btn-primary" onClick={create} disabled={creating}>
          <Icon name="plus" /> {creating ? t('creating') : t('newLink')}
        </button>
      </div>

      <p className="text-mute mb-5 max-w-2xl">{t('intro')}</p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {list.length === 0 && (
          <div className="card card-pad text-mute md:col-span-2 lg:col-span-3">
            {t('empty')}
          </div>
        )}
        {list.map((l) => (
          <div key={l.id} className="card overflow-hidden">
            <Link href={`/app/info-links/${l.id}`} className="block">
              <div
                className="h-32 bg-bg2"
                style={
                  l.heroImageUrl
                    ? {
                        backgroundImage: `url(${l.heroImageUrl})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                      }
                    : {
                        background:
                          'linear-gradient(135deg,#6366F1,#A855F7)',
                      }
                }
              />
            </Link>
            <div className="card-pad">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/app/info-links/${l.id}`}
                    className="font-semibold hover:text-brand"
                  >
                    {l.title}
                  </Link>
                  {l.subtitle && (
                    <div className="text-xs text-mute mt-0.5 truncate">
                      {l.subtitle}
                    </div>
                  )}
                </div>
                <span
                  className={`badge ${l.isActive ? 'badge-ok' : 'badge-mute'}`}
                >
                  {l.isActive ? t('statusActive') : t('statusPaused')}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-mute mt-3">
                <span>{t('views', { count: l.views })}</span>
                <code className="text-[11px] truncate max-w-[180px] select-all">
                  {l.rootSlug
                    ? `${vanityDomain}/${l.rootSlug}`
                    : `/i/${tenant?.slug}/${l.slug}`}
                </code>
              </div>
              <div className="flex gap-2 mt-3">
                <Link
                  className="btn-link text-xs"
                  href={`/app/info-links/${l.id}`}
                >
                  {t('edit')}
                </Link>
                <button className="btn-link text-xs" onClick={() => toggle(l)}>
                  {l.isActive ? t('pause') : t('activate')}
                </button>
                <button
                  className="btn-link text-xs"
                  onClick={() => duplicate(l)}
                  title={t('duplicateTitle')}
                >
                  {t('duplicate')}
                </button>
                <a
                  href={
                    l.rootSlug
                      ? `https://${vanityDomain}/${l.rootSlug}`
                      : `/i/${tenant?.slug}/${l.slug}`
                  }
                  target="_blank"
                  className="btn-link text-xs"
                >
                  {t('view')}
                </a>
                <button
                  className="text-bad text-xs underline ml-auto"
                  onClick={() => remove(l.id)}
                >
                  {t('delete')}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
