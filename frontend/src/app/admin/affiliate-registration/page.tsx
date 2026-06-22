'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';

type Config = {
  enabled: boolean;
  allowInfluencer: boolean;
  allowAmbassador: boolean;
  influencerCommissionPct: number;
  ambassadorCommissionPct: number;
};

export default function AffiliateRegistrationPage() {
  const t = useTranslations('admin_affiliate_registration');
  const [config, setConfig] = useState<Config | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  useEffect(() => {
    api<Config>('/admin/affiliate-registration')
      .then(setConfig)
      .catch((e) => console.error(e));
  }, []);

  async function save(patch: Partial<Config>) {
    setSaving(true);
    try {
      const next = await api<Config>('/admin/affiliate-registration', {
        method: 'POST',
        body: JSON.stringify(patch),
      });
      setConfig(next);
      flash(t('toastSaved'));
    } catch (e: any) {
      flash(e?.message ?? t('toastSaveError'));
    } finally {
      setSaving(false);
    }
  }

  if (!config) {
    return <div className="text-sm text-mute">{t('loading')}</div>;
  }

  const publicUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/registro-afiliado`
      : '/registro-afiliado';

  return (
    <div className="max-w-2xl">
      <div className="page-head">
        <h1 className="page-title">{t('pageTitle')}</h1>
      </div>

      <div className="card card-pad space-y-4">
        <ToggleRow
          label={t('enableLabel')}
          description={t('enableDescription')}
          checked={config.enabled}
          onChange={(v) => save({ enabled: v })}
          disabled={saving}
        />

        {config.enabled && (
          <>
            <div className="rounded-lg bg-bg2/60 p-3 text-xs">
              <div className="font-semibold text-mute uppercase tracking-wider text-[10px]">
                {t('publicLink')}
              </div>
              <code className="text-ink break-all">{publicUrl}</code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(publicUrl);
                  flash(t('toastCopied'));
                }}
                className="ml-2 text-xs font-semibold text-brand hover:underline"
              >
                {t('copy')}
              </button>
            </div>

            <div className="border-t border-line pt-4">
              <div className="font-semibold text-sm mb-2">{t('allowedTypes')}</div>
              <div className="space-y-3">
                <RoleRow
                  emoji="📣"
                  title={t('influencerTitle')}
                  description={t('influencerDescription')}
                  allowed={config.allowInfluencer}
                  onAllowedChange={(v) => save({ allowInfluencer: v })}
                  pct={config.influencerCommissionPct}
                  onPctChange={(v) => save({ influencerCommissionPct: v })}
                  saving={saving}
                />
                <RoleRow
                  emoji="🤝"
                  title={t('ambassadorTitle')}
                  description={t('ambassadorDescription')}
                  allowed={config.allowAmbassador}
                  onAllowedChange={(v) => save({ allowAmbassador: v })}
                  pct={config.ambassadorCommissionPct}
                  onPctChange={(v) => save({ ambassadorCommissionPct: v })}
                  saving={saving}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-ink text-white text-sm font-semibold shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex items-start justify-between gap-3 cursor-pointer">
      <div className="flex-1">
        <div className="font-semibold text-sm">{label}</div>
        <div className="text-[12px] text-mute mt-0.5 leading-relaxed">{description}</div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="mt-1 w-5 h-5 accent-brand"
      />
    </label>
  );
}

function RoleRow({
  emoji,
  title,
  description,
  allowed,
  onAllowedChange,
  pct,
  onPctChange,
  saving,
}: {
  emoji: string;
  title: string;
  description: string;
  allowed: boolean;
  onAllowedChange: (v: boolean) => void;
  pct: number;
  onPctChange: (v: number) => void;
  saving: boolean;
}) {
  const t = useTranslations('admin_affiliate_registration');
  const [draft, setDraft] = useState<string>(String(pct));
  useEffect(() => {
    setDraft(String(pct));
  }, [pct]);
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-sm">
            {emoji} {title}
          </div>
          <div className="text-[11px] text-mute mt-0.5 leading-tight">{description}</div>
        </div>
        <label className="cursor-pointer inline-flex items-center gap-1.5 text-xs font-semibold">
          <input
            type="checkbox"
            checked={allowed}
            onChange={(e) => onAllowedChange(e.target.checked)}
            disabled={saving}
            className="w-4 h-4 accent-brand"
          />
          {allowed ? t('allowed') : t('notAllowed')}
        </label>
      </div>
      {allowed && (
        <div className="mt-3 flex items-center gap-2">
          <label className="text-xs font-semibold text-mute">{t('commissionPct')}</label>
          <input
            type="number"
            min={0}
            max={100}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              const n = Math.max(0, Math.min(100, Number(draft) || 0));
              if (n !== pct) onPctChange(n);
              else setDraft(String(pct));
            }}
            disabled={saving}
            className="input w-20 text-sm"
          />
          <span className="text-xs text-mute">{t('commissionHint')}</span>
        </div>
      )}
    </div>
  );
}
