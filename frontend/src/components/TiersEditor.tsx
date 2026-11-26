'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Editor de niveles de una tarjeta «VIP por niveles» (MEMBERSHIP).
 *
 * Vive aquí y no dentro del asistente porque la pantalla de edición también lo
 * necesita: antes solo existía en /app/cards/new y una VIP ya creada no tenía
 * forma de cambiar sus niveles ni sus beneficios.
 *
 * La forma de cada nivel es la que guarda `Card.tiers` en el backend:
 * `{ name, threshold, perks: string[], color, icon }`.
 */
export type Tier = {
  name: string;
  threshold: number;
  perks?: string[];
  color?: string;
  icon?: string;
};

export type TierMetric = 'spend' | 'visits' | 'stamps';

/** Nombre, color e ícono sugeridos para el nivel N (0-based). */
const SUGERIDOS = [
  { name: 'Bronce', color: '#B45309', icon: '🥉' },
  { name: 'Plata', color: '#9CA3AF', icon: '🥈' },
  { name: 'Oro', color: '#F59E0B', icon: '🥇' },
  { name: 'Diamante', color: '#0EA5E9', icon: '💎' },
];

function pesos(n: number) {
  return `$${Math.round(n).toLocaleString('es-CO')}`;
}

export function TiersEditor({
  tiers,
  metric,
  onChangeTiers,
  onChangeMetric,
}: {
  tiers: Tier[];
  metric: TierMetric;
  onChangeTiers: (t: Tier[]) => void;
  onChangeMetric: (m: TierMetric) => void;
}) {
  const t = useTranslations('app_cards_new');
  // El producto ofrece «VIP por niveles» = sube por GASTO. El selector solo se
  // enseña si la tarjeta ya venía con otra métrica (VIPs antiguas por visitas o
  // sellos): ocultárselo ahí haría que la tarjeta cambie de regla sin que el
  // negocio lo vea. Se fija al montar para que no desaparezca a mitad de edición.
  const [mostrarMetrica] = useState(metric !== 'spend');

  function addTier() {
    const n = tiers.length;
    const sug = SUGERIDOS[n] ?? { name: `Nivel ${n + 1}`, color: '#6366F1', icon: '⭐' };
    const ultimo = tiers[n - 1]?.threshold ?? 0;
    onChangeTiers([
      ...tiers,
      {
        name: sug.name,
        threshold: n === 0 ? 0 : ultimo + (metric === 'spend' ? 300000 : 10),
        perks: [],
        color: sug.color,
        icon: sug.icon,
      },
    ]);
  }
  function patch(i: number, p: Partial<Tier>) {
    onChangeTiers(tiers.map((tier, idx) => (idx === i ? { ...tier, ...p } : tier)));
  }
  function removeTier(i: number) {
    onChangeTiers(tiers.filter((_, idx) => idx !== i));
  }

  const metricLabel: Record<TierMetric, string> = {
    spend: t('metricSpend'),
    visits: t('metricVisits'),
    stamps: t('metricStamps'),
  };

  return (
    <div className="mt-3 space-y-3">
      {mostrarMetrica ? (
        <div>
          <label className="label">{t('tierMetricLabel')}</label>
          <select
            className="input"
            value={metric}
            onChange={(e) => onChangeMetric(e.target.value as TierMetric)}
          >
            <option value="spend">{t('metricSpendTotal')}</option>
            <option value="visits">{t('metricVisits')}</option>
            <option value="stamps">{t('metricStamps')}</option>
          </select>
          <div className="text-[11px] text-mute mt-1">
            {t('tierThresholdHint', { metric: metricLabel[metric].toLowerCase() })}{' '}
            {t('tierMetricLegacyNote')}
          </div>
        </div>
      ) : (
        <div className="text-xs p-3 rounded-lg bg-brand/10 border border-brand/30">
          <div className="font-semibold text-ink">{t('tierMetricFixed')}</div>
          <div className="text-mute mt-0.5">{t('tierMetricFixedHint')}</div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <label className="label m-0">{t('vipTiers')}</label>
        <button type="button" onClick={addTier} className="text-xs text-brand hover:underline">
          + {t('addTier')}
        </button>
      </div>

      {tiers.length === 0 && (
        <div className="text-xs text-mute p-3 rounded-lg bg-bg2/40 border border-dashed border-line">
          {t('noTiersHint')}
        </div>
      )}

      {tiers.map((tier, i) => (
        <div key={i} className="p-3 rounded-lg border border-line bg-bg2/30 space-y-2">
          <div className="flex items-center gap-2">
            <input
              className="input flex-1 min-w-0"
              placeholder={t('tierNamePlaceholder')}
              value={tier.name}
              onChange={(e) => patch(i, { name: e.target.value })}
            />
            <input
              className="input w-16 text-center"
              placeholder="🥈"
              value={tier.icon ?? ''}
              onChange={(e) => patch(i, { icon: e.target.value })}
            />
            <input
              type="color"
              className="input h-10 p-1 w-12"
              value={tier.color ?? '#9CA3AF'}
              onChange={(e) => patch(i, { color: e.target.value })}
            />
            <button
              type="button"
              onClick={() => removeTier(i)}
              className="text-xs text-rose-500 hover:underline"
            >
              {t('remove')}
            </button>
          </div>
          <div>
            <label className="label">
              {metric === 'spend'
                ? t('tierFromSpend')
                : t('tierFromOther', { metric: metricLabel[metric].toLowerCase() })}
            </label>
            <input
              type="number"
              className="input"
              min={0}
              step={metric === 'spend' ? 10000 : 1}
              value={tier.threshold}
              onChange={(e) => {
                // El backend compara `progreso >= threshold`: un vacío o un
                // negativo dejaría el nivel inalcanzable o regalado.
                const n = Math.max(0, Math.round(Number(e.target.value) || 0));
                patch(i, { threshold: n });
              }}
            />
            {metric === 'spend' && (
              <div className="text-[11px] text-mute mt-1">
                {tier.threshold === 0
                  ? t('tierFromZero')
                  : t('tierFromSpendHint', { amount: pesos(tier.threshold) })}
              </div>
            )}
          </div>
          <div>
            <label className="label">{t('perksLabel')}</label>
            <PerksInput
              value={tier.perks ?? []}
              onChange={(perks) => patch(i, { perks })}
              placeholder={t('perksPlaceholder')}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Beneficios, uno por línea. Guarda el texto crudo mientras se escribe: si se
 * limpiara en cada tecla (quitar líneas vacías), el Enter para empezar el
 * siguiente beneficio se borraría antes de poder escribirlo.
 */
function PerksInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [raw, setRaw] = useState(value.join('\n'));
  const limpiar = (s: string) =>
    s
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
  // Los niveles van con key por índice: al quitar uno, este campo pasa a
  // mostrar el nivel siguiente. Si lo crudo ya no corresponde a lo guardado,
  // manda lo guardado.
  const shown = limpiar(raw).join('\n') === value.join('\n') ? raw : value.join('\n');
  return (
    <textarea
      className="input"
      rows={2}
      value={shown}
      onChange={(e) => {
        setRaw(e.target.value);
        onChange(limpiar(e.target.value));
      }}
      placeholder={placeholder}
    />
  );
}
