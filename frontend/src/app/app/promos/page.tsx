'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { ImageUploader } from '@/components/ImageUploader';

type Promo = {
  id: string;
  name: string;
  description: string;
  imageUrl: string | null;
  type: string;
  value: number;
  originalPrice: number | null;
  conditions: any;
  validFrom: string | null;
  validUntil: string | null;
  isActive: boolean;
};

const TYPE_LABEL_KEY: Record<string, string> = {
  DISCOUNT_PCT: 'typeDiscountPct',
  DISCOUNT_AMOUNT: 'typeDiscountAmount',
  BUY_X_GET_Y: 'typeBuyXGetY',
  COMBO: 'typeCombo',
  FREE_ITEM: 'typeFreeItem',
};

export default function PromosPage() {
  const t = useTranslations('app_promos');
  const [list, setList] = useState<Promo[]>([]);
  const [editing, setEditing] = useState<Partial<Promo> | null>(null);

  async function load() {
    try {
      setList(await api('/promotions'));
    } catch (e: any) {
      toast(e.message || t('errorLoading'), 'error');
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function save(p: Partial<Promo>) {
    const body = {
      name: p.name,
      description: p.description,
      imageUrl: p.imageUrl ?? undefined,
      type: p.type,
      value: Number(p.value ?? 0),
      originalPrice:
        p.originalPrice !== null && p.originalPrice !== undefined
          ? Number(p.originalPrice)
          : undefined,
      conditions: p.conditions ?? {},
      validFrom: p.validFrom || undefined,
      validUntil: p.validUntil || undefined,
      isActive: p.isActive ?? true,
    };
    try {
      if (p.id) {
        await api(`/promotions/${p.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      } else {
        await api('/promotions', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }
      setEditing(null);
      load();
      toast(p.id ? t('toastUpdated') : t('toastCreated'), 'success');
    } catch (e: any) {
      toast(e.message || t('errorCouldNotSave'), 'error');
    }
  }

  async function toggle(p: Promo) {
    try {
      await api(`/promotions/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !p.isActive }),
      });
      load();
    } catch (e: any) {
      toast(e.message || t('errorCouldNotUpdate'), 'error');
    }
  }

  async function remove(id: string) {
    if (!confirm(t('confirmDelete'))) return;
    try {
      await api(`/promotions/${id}`, { method: 'DELETE' });
      load();
      toast(t('toastDeleted'), 'success');
    } catch (e: any) {
      toast(e.message || t('errorCouldNotDelete'), 'error');
    }
  }

  return (
    <div>
      <Link
        href="/app/menu"
        className="text-xs text-mute hover:text-brand inline-flex items-center gap-1 mb-2"
      >
        ← {t('breadcrumbMenu')}
      </Link>
      <div className="page-head">
        <h1 className="page-title">
          {t('title')}{' '}
          <span className="page-crumb">{t('crumbConfigured', { count: list.length })}</span>
        </h1>
        <button
          className="btn-primary"
          onClick={() =>
            setEditing({
              name: '',
              description: '',
              imageUrl: null,
              type: 'DISCOUNT_AMOUNT',
              value: 0,
              originalPrice: null,
              conditions: {},
              isActive: true,
            })
          }
        >
          <Icon name="plus" /> {t('newPromo')}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {list.length === 0 && (
          <div className="card card-pad text-center py-12 md:col-span-2 lg:col-span-3">
            <div className="text-4xl mb-2">🎁</div>
            <div className="font-semibold">{t('emptyTitle')}</div>
            <p className="text-sm text-mute mt-1.5 max-w-md mx-auto">
              {t('emptyDesc')}
            </p>
            <button
              className="btn-primary mt-4 inline-flex"
              onClick={() =>
                setEditing({
                  name: '',
                  description: '',
                  type: 'DISCOUNT_PCT',
                  value: 10,
                  conditions: {},
                  isActive: true,
                })
              }
            >
              <Icon name="plus" /> {t('createFirst')}
            </button>
          </div>
        )}
        {list.map((p) => (
          <div key={p.id} className="card card-pad">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold">{p.name}</div>
                <div className="text-xs text-mute mt-0.5">{p.description}</div>
              </div>
              <span
                className={`badge ${p.isActive ? 'badge-ok' : 'badge-mute'}`}
              >
                {p.isActive ? t('statusActive') : t('statusPaused')}
              </span>
            </div>
            {p.imageUrl && (
              <img
                src={p.imageUrl}
                alt=""
                className="w-full h-32 object-cover rounded-lg mt-3"
              />
            )}
            <div className="mt-3 text-sm flex items-baseline gap-2">
              {p.originalPrice && (
                <span className="text-mute line-through text-xs">
                  ${Number(p.originalPrice).toLocaleString('es-CO')}
                </span>
              )}
              <strong className="text-base text-bad">
                {p.type === 'DISCOUNT_PCT'
                  ? `${Number(p.value)}%`
                  : `$${Number(p.value).toLocaleString('es-CO')}`}
              </strong>
            </div>
            {p.validUntil && (
              <div className="text-xs text-mute mt-1">
                {t('validUntil', {
                  date: new Date(p.validUntil).toLocaleDateString('es-CO'),
                })}
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <button className="btn-link text-xs" onClick={() => setEditing(p)}>
                {t('edit')}
              </button>
              <button className="btn-link text-xs" onClick={() => toggle(p)}>
                {p.isActive ? t('pause') : t('activate')}
              </button>
              <button
                className="text-bad text-xs underline ml-auto"
                onClick={() => remove(p.id)}
              >
                {t('delete')}
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <PromoDrawer
          value={editing}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

function PromoDrawer({
  value,
  onCancel,
  onSave,
}: {
  value: Partial<Promo>;
  onCancel: () => void;
  onSave: (p: Partial<Promo>) => void;
}) {
  const t = useTranslations('app_promos');
  const [form, setForm] = useState<Partial<Promo>>(value);

  function update<K extends keyof Promo>(k: K, v: any) {
    setForm({ ...form, [k]: v });
  }

  function updateCond(k: string, v: any) {
    setForm({ ...form, conditions: { ...(form.conditions ?? {}), [k]: v } });
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-ink/50" onClick={onCancel} />
      <div className="w-full max-w-md bg-white h-full overflow-auto p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            {form.id ? t('editPromo') : t('newPromo')}
          </h2>
          <button onClick={onCancel} className="text-mute hover:text-ink">
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">{t('labelName')}</label>
            <input
              className="input"
              value={form.name ?? ''}
              onChange={(e) => update('name', e.target.value)}
            />
          </div>
          <div>
            <label className="label">{t('labelDescription')}</label>
            <textarea
              className="input"
              rows={2}
              placeholder={t('placeholderDescription')}
              value={form.description ?? ''}
              onChange={(e) => update('description', e.target.value)}
            />
          </div>
          <div>
            <label className="label">{t('labelPhoto')}</label>
            <ImageUploader
              value={form.imageUrl ?? null}
              onChange={(url) => update('imageUrl', url)}
              folder="promotions"
            />
            <p className="text-[11px] text-mute mt-1">
              {t('hintPhoto')}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">{t('labelRegularPrice')}</label>
              <input
                type="number"
                className="input"
                placeholder={t('placeholderBefore')}
                value={form.originalPrice ?? ''}
                onChange={(e) =>
                  update(
                    'originalPrice',
                    e.target.value ? Number(e.target.value) : null,
                  )
                }
              />
              <p className="text-[11px] text-mute mt-1">
                {t('hintRegularPrice')}
              </p>
            </div>
            <div>
              <label className="label">{t('labelPromoPrice')}</label>
              <input
                type="number"
                className="input"
                placeholder={t('placeholderDiscounted')}
                value={form.value ?? 0}
                onChange={(e) => update('value', Number(e.target.value))}
              />
              <p className="text-[11px] text-mute mt-1">
                {t('hintPromoPrice')}
              </p>
            </div>
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-mute hover:text-ink">
              {t('advancedOptions')}
            </summary>
            <div className="mt-3 space-y-3">
              <div>
                <label className="label">{t('labelPromoType')}</label>
                <select
                  className="input"
                  value={form.type ?? 'DISCOUNT_AMOUNT'}
                  onChange={(e) => update('type', e.target.value)}
                >
                  {Object.entries(TYPE_LABEL_KEY).map(([k, labelKey]) => (
                    <option key={k} value={k}>
                      {t(labelKey)}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-mute mt-1">
                  {t('hintPromoType')}
                </p>
              </div>
            </div>
          </details>

          <fieldset className="border border-line rounded-lg p-3">
            <legend className="px-1 text-xs font-semibold text-mute">
              {t('conditionsOptional')}
            </legend>
            <div>
              <label className="label">{t('labelMinSubtotal')}</label>
              <input
                type="number"
                className="input"
                value={form.conditions?.minSubtotal ?? ''}
                onChange={(e) =>
                  updateCond(
                    'minSubtotal',
                    e.target.value ? Number(e.target.value) : undefined,
                  )
                }
              />
            </div>
            <div className="mt-3">
              <label className="label">{t('labelDaysOfWeek')}</label>
              <input
                className="input"
                placeholder={t('placeholderDaysOfWeek')}
                value={(form.conditions?.daysOfWeek ?? []).join(',')}
                onChange={(e) =>
                  updateCond(
                    'daysOfWeek',
                    e.target.value
                      .split(',')
                      .map((s) => parseInt(s.trim()))
                      .filter((n) => !isNaN(n)),
                  )
                }
              />
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">{t('labelValidFrom')}</label>
              <input
                type="date"
                className="input"
                value={form.validFrom?.split('T')[0] ?? ''}
                onChange={(e) => update('validFrom', e.target.value)}
              />
            </div>
            <div>
              <label className="label">{t('labelValidUntil')}</label>
              <input
                type="date"
                className="input"
                value={form.validUntil?.split('T')[0] ?? ''}
                onChange={(e) => update('validUntil', e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-2">
          <button className="btn-ghost flex-1 justify-center" onClick={onCancel}>
            {t('cancel')}
          </button>
          <button
            className="btn-primary flex-1 justify-center"
            onClick={() => onSave(form)}
          >
            <Icon name="check" /> {t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}
