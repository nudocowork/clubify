'use client';
// Panel admin · Traducciones del menú (Fase 4 i18n).
// El dueño ve todas las strings traducibles + su estado por idioma
// (auto / manual / missing / stale) y puede editarlas o regenerarlas.

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';

type Locale = 'en' | 'pt';

type TranslationStatus = {
  text: string;
  source: 'auto' | 'manual';
  stale: boolean;
};

type Row = {
  entityType: string;
  entityId: string;
  field: string;
  sourceText: string;
  contextLabel: string;
  group: string;
  en: TranslationStatus | null;
  pt: TranslationStatus | null;
};

type Stats = {
  total: number;
  missing: Record<Locale, number>;
  manual: Record<Locale, number>;
  stale: Record<Locale, number>;
};

type Filter = 'all' | 'missing' | 'manual' | 'stale';
type EntityFilter =
  | 'all'
  | 'storefront'
  | 'category'
  | 'product'
  | 'variant'
  | 'extra'
  | 'promotion'
  | 'infolink'
  | 'card';

export default function TranslationsPage() {
  const t = useTranslations('app_translations');
  const [rows, setRows] = useState<Row[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [entityFilter, setEntityFilter] = useState<EntityFilter>('all');
  const [search, setSearch] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api<{ rows: Row[]; stats: Stats }>(
        '/catalog/translations',
      );
      setRows(r.rows);
      setStats(r.stats);
    } catch (e: any) {
      setErr(e?.message ?? t('errLoading'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (entityFilter !== 'all' && r.entityType !== entityFilter) return false;
      if (filter === 'missing') {
        if (r.en && r.pt) return false;
      } else if (filter === 'manual') {
        const anyManual =
          r.en?.source === 'manual' || r.pt?.source === 'manual';
        if (!anyManual) return false;
      } else if (filter === 'stale') {
        const anyStale = !!r.en?.stale || !!r.pt?.stale;
        if (!anyStale) return false;
      }
      if (term) {
        const hay =
          `${r.contextLabel} ${r.sourceText} ${r.en?.text ?? ''} ${r.pt?.text ?? ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [rows, filter, entityFilter, search]);

  // Agrupar visualmente por `group` para que el contexto sea claro.
  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of filtered) {
      const arr = map.get(r.group) ?? [];
      arr.push(r);
      map.set(r.group, arr);
    }
    return [...map.entries()];
  }, [filtered]);

  const keyFor = (r: Row, l: Locale) =>
    `${r.entityType}:${r.entityId}:${r.field}:${l}`;

  const setText = async (r: Row, l: Locale, text: string) => {
    const k = keyFor(r, l);
    setBusyKey(k);
    try {
      await api(
        `/catalog/translations/${r.entityType}/${r.entityId}/${r.field}/${l}`,
        { method: 'PATCH', body: JSON.stringify({ text }) },
      );
      await load();
    } catch (e: any) {
      alert(e?.message ?? t('errSaving'));
    } finally {
      setBusyKey(null);
    }
  };

  const clearText = async (r: Row, l: Locale) => {
    const k = keyFor(r, l);
    if (!confirm(t('confirmClear', { locale: l.toUpperCase() }))) return;
    setBusyKey(k);
    try {
      await api(
        `/catalog/translations/${r.entityType}/${r.entityId}/${r.field}/${l}`,
        { method: 'DELETE' },
      );
      await load();
    } catch (e: any) {
      alert(e?.message ?? t('errDeleting'));
    } finally {
      setBusyKey(null);
    }
  };

  const regenerate = async (r: Row, l: Locale) => {
    const k = keyFor(r, l);
    setBusyKey(k);
    try {
      await api(
        `/catalog/translations/${r.entityType}/${r.entityId}/${r.field}/${l}/regenerate`,
        { method: 'POST' },
      );
      await load();
    } catch (e: any) {
      alert(e?.message ?? t('errRegenerating'));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="px-4 py-6 max-w-7xl mx-auto space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-text">{t('title')}</h1>
        <p className="text-sm text-mute mt-1">{t('subtitle')}</p>
      </header>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <StatCard label={t('statTotal')} value={stats.total} />
          <StatCard
            label={t('statMissing')}
            value={stats.missing.en + stats.missing.pt}
            sub={t('statByLocale', { en: stats.missing.en, pt: stats.missing.pt })}
            tone={
              stats.missing.en + stats.missing.pt > 0 ? 'warn' : 'neutral'
            }
          />
          <StatCard
            label={t('statManual')}
            value={stats.manual.en + stats.manual.pt}
            sub={t('statByLocale', { en: stats.manual.en, pt: stats.manual.pt })}
            tone="info"
          />
          <StatCard
            label={t('statStale')}
            value={stats.stale.en + stats.stale.pt}
            sub={t('statByLocale', { en: stats.stale.en, pt: stats.stale.pt })}
            tone={stats.stale.en + stats.stale.pt > 0 ? 'warn' : 'neutral'}
          />
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-pill bg-bg2 p-1">
          {(
            [
              ['all', 'filterAll'],
              ['missing', 'filterMissing'],
              ['manual', 'filterManual'],
              ['stale', 'filterStale'],
            ] as const
          ).map(([k, labelKey]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-pill transition ${
                filter === k
                  ? 'bg-white shadow-sm text-text'
                  : 'text-mute hover:text-text'
              }`}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
        <select
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value as EntityFilter)}
          className="rounded-pill bg-bg2 border-0 text-xs font-semibold px-3 py-2"
        >
          <option value="all">{t('entityAll')}</option>
          <option value="storefront">{t('entityStorefront')}</option>
          <option value="category">{t('entityCategory')}</option>
          <option value="product">{t('entityProduct')}</option>
          <option value="variant">{t('entityVariant')}</option>
          <option value="extra">{t('entityExtra')}</option>
          <option value="promotion">{t('entityPromotion')}</option>
          <option value="infolink">{t('entityInfolink')}</option>
          <option value="card">{t('entityCard')}</option>
        </select>
        <input
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[180px] rounded-pill bg-bg2 border-0 text-sm px-4 py-2"
        />
        <button
          onClick={load}
          className="rounded-pill bg-bg2 text-xs font-semibold px-3 py-2 hover:bg-bg3"
        >
          {t('reload')}
        </button>
      </div>

      {/* Body */}
      {loading && <div className="text-mute py-12 text-center">{t('loading')}</div>}
      {err && (
        <div className="rounded-card bg-red-50 text-red-700 px-4 py-3 text-sm">
          {err}
        </div>
      )}
      {!loading && !err && filtered.length === 0 && (
        <div className="text-mute py-12 text-center">{t('emptyFilter')}</div>
      )}

      {!loading && !err && filtered.length > 0 && (
        <div className="space-y-4">
          {grouped.map(([group, items]) => (
            <section
              key={group}
              className="rounded-card bg-white overflow-hidden ring-1 ring-black/5"
            >
              <header className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-mute bg-bg2/50">
                {group}
              </header>
              <div className="divide-y divide-black/5">
                {items.map((r) => (
                  <RowEditor
                    key={`${r.entityType}:${r.entityId}:${r.field}`}
                    row={r}
                    busyKey={busyKey}
                    onSave={(l, text) => setText(r, l, text)}
                    onClear={(l) => clearText(r, l)}
                    onRegenerate={(l) => regenerate(r, l)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  sub?: string;
  tone?: 'neutral' | 'warn' | 'info';
}) {
  const toneClasses =
    tone === 'warn'
      ? 'text-amber-700 bg-amber-50'
      : tone === 'info'
        ? 'text-indigo-700 bg-indigo-50'
        : 'text-text bg-bg2';
  return (
    <div className={`rounded-card px-3 py-2.5 ${toneClasses}`}>
      <div className="text-xs font-semibold opacity-70">{label}</div>
      <div className="text-2xl font-bold leading-tight">{value}</div>
      {sub && <div className="text-[10px] opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
}

function RowEditor({
  row,
  busyKey,
  onSave,
  onClear,
  onRegenerate,
}: {
  row: Row;
  busyKey: string | null;
  onSave: (l: Locale, text: string) => Promise<void> | void;
  onClear: (l: Locale) => Promise<void> | void;
  onRegenerate: (l: Locale) => Promise<void> | void;
}) {
  const t = useTranslations('app_translations');
  return (
    <div className="px-4 py-3">
      <div className="text-[11px] font-semibold uppercase text-mute mb-1.5">
        {row.contextLabel}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        <div>
          <FlagLabel flag="🇪🇸" label={t('esSource')} />
          <div className="mt-1 px-3 py-2 rounded-card bg-bg2 text-text whitespace-pre-wrap break-words">
            {row.sourceText}
          </div>
        </div>
        <LocaleCell
          row={row}
          locale="en"
          flag="🇺🇸"
          label="EN"
          busyKey={busyKey}
          onSave={onSave}
          onClear={onClear}
          onRegenerate={onRegenerate}
        />
        <LocaleCell
          row={row}
          locale="pt"
          flag="🇧🇷"
          label="PT"
          busyKey={busyKey}
          onSave={onSave}
          onClear={onClear}
          onRegenerate={onRegenerate}
        />
      </div>
    </div>
  );
}

function FlagLabel({ flag, label }: { flag: string; label: string }) {
  return (
    <div className="text-[11px] font-semibold text-mute">
      <span className="mr-1">{flag}</span>
      {label}
    </div>
  );
}

function LocaleCell({
  row,
  locale,
  flag,
  label,
  busyKey,
  onSave,
  onClear,
  onRegenerate,
}: {
  row: Row;
  locale: Locale;
  flag: string;
  label: string;
  busyKey: string | null;
  onSave: (l: Locale, text: string) => Promise<void> | void;
  onClear: (l: Locale) => Promise<void> | void;
  onRegenerate: (l: Locale) => Promise<void> | void;
}) {
  const t = useTranslations('app_translations');
  const k = `${row.entityType}:${row.entityId}:${row.field}:${locale}`;
  const busy = busyKey === k;
  const ts = locale === 'en' ? row.en : row.pt;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const startEdit = () => {
    setDraft(ts?.text ?? '');
    setEditing(true);
  };

  const commit = async () => {
    if (!draft.trim()) return;
    await onSave(locale, draft);
    setEditing(false);
  };

  const cancel = () => {
    setEditing(false);
    setDraft('');
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <FlagLabel flag={flag} label={label} />
        {ts && (
          <div className="flex items-center gap-1.5 text-[10px] font-semibold">
            {ts.source === 'manual' && (
              <span className="px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                {t('badgeManual')}
              </span>
            )}
            {ts.stale && (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                {t('badgeStale')}
              </span>
            )}
          </div>
        )}
      </div>

      {editing ? (
        <div className="mt-1 space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.max(2, Math.min(6, Math.ceil((draft.length || 1) / 50)))}
            className="w-full rounded-card border border-black/10 bg-white text-sm px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-200"
            autoFocus
          />
          <div className="flex gap-1.5">
            <button
              onClick={commit}
              disabled={busy || !draft.trim()}
              className="rounded-pill text-xs font-semibold bg-indigo-600 text-white px-3 py-1.5 disabled:opacity-50"
            >
              {busy ? t('saving') : t('save')}
            </button>
            <button
              onClick={cancel}
              className="rounded-pill text-xs font-semibold bg-bg2 text-text px-3 py-1.5"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div
            onClick={() => !busy && startEdit()}
            className={`mt-1 px-3 py-2 rounded-card cursor-pointer transition whitespace-pre-wrap break-words ${
              ts
                ? 'bg-white ring-1 ring-black/5 hover:ring-indigo-300 text-text'
                : 'bg-amber-50 text-amber-700 hover:bg-amber-100 italic'
            }`}
          >
            {ts ? ts.text : t('untranslated')}
          </div>
          <div className="flex gap-1.5 mt-1.5">
            {ts && (
              <button
                onClick={() => onRegenerate(locale)}
                disabled={busy}
                className="text-[11px] font-semibold text-indigo-600 hover:underline disabled:opacity-50"
                title={t('regenerateTitle')}
              >
                {busy ? t('regenerating') : t('regenerateAi')}
              </button>
            )}
            {!ts && (
              <button
                onClick={() => onRegenerate(locale)}
                disabled={busy}
                className="text-[11px] font-semibold text-indigo-600 hover:underline disabled:opacity-50"
              >
                {busy ? t('generating') : t('generateAi')}
              </button>
            )}
            {ts && (
              <button
                onClick={() => onClear(locale)}
                disabled={busy}
                className="text-[11px] font-semibold text-mute hover:text-red-600 disabled:opacity-50"
              >
                {t('delete')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
