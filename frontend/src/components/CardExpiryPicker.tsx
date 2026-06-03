'use client';
import { useEffect, useState } from 'react';

/**
 * Selector de vencimiento de la tarjeta. 3 modalidades:
 * - "unlimited": sin fecha (default)
 * - "date": vence en una fecha específica (validUntil)
 * - "days_after": vence X días después de que el cliente la agrega
 *   (validDaysAfterIssue, calculado por pass.issuedAt + N días)
 *
 * Las modalidades son mutuamente excluyentes — al cambiar de modo se
 * limpian los otros campos.
 */

export type ExpiryValue = {
  validUntil: string | null;
  validDaysAfterIssue: number | null;
};

type Mode = 'unlimited' | 'date' | 'days_after';

function modeOf(v: ExpiryValue): Mode {
  if (v.validUntil) return 'date';
  if (v.validDaysAfterIssue) return 'days_after';
  return 'unlimited';
}

export function CardExpiryPicker({
  value,
  onChange,
}: {
  value: ExpiryValue;
  onChange: (v: ExpiryValue) => void;
}) {
  const [mode, setMode] = useState<Mode>(modeOf(value));

  useEffect(() => {
    setMode(modeOf(value));
  }, [value.validUntil, value.validDaysAfterIssue]);

  function pick(m: Mode) {
    setMode(m);
    if (m === 'unlimited') {
      onChange({ validUntil: null, validDaysAfterIssue: null });
    } else if (m === 'date') {
      onChange({ validUntil: value.validUntil ?? '', validDaysAfterIssue: null });
    } else {
      onChange({ validUntil: null, validDaysAfterIssue: value.validDaysAfterIssue ?? 30 });
    }
  }

  const opts: { v: Mode; label: string; hint: string }[] = [
    { v: 'unlimited', label: 'Ilimitado', hint: 'La tarjeta nunca vence' },
    { v: 'date', label: 'Plazo definido', hint: 'Vence en una fecha específica (ej. fin de temporada)' },
    {
      v: 'days_after',
      label: 'Plazo después de la emisión',
      hint: 'Cada cliente tiene N días desde que agrega la tarjeta',
    },
  ];

  return (
    <div className="space-y-2">
      <label className="label flex items-center gap-1">
        Fecha de vencimiento de la tarjeta
        <span
          className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-bg2 text-mute text-[10px] font-bold cursor-help"
          title="Útil si quieres correr una promo temporal: la tarjeta deja de funcionar pasada la fecha."
        >
          i
        </span>
      </label>
      <div className="space-y-1.5">
        {opts.map((o) => (
          <label
            key={o.v}
            className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition ${
              mode === o.v
                ? 'border-brand bg-brand-soft/40'
                : 'border-line hover:bg-bg2/50'
            }`}
          >
            <input
              type="radio"
              name="card-expiry-mode"
              checked={mode === o.v}
              onChange={() => pick(o.v)}
              className="mt-0.5"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium leading-tight">{o.label}</div>
              <div className="text-[11px] text-mute mt-0.5 leading-snug">{o.hint}</div>
            </div>
          </label>
        ))}
      </div>

      {mode === 'date' && (
        <div className="pt-1">
          <input
            type="date"
            className="input"
            value={value.validUntil ?? ''}
            min={new Date().toISOString().split('T')[0]}
            onChange={(e) =>
              onChange({ validUntil: e.target.value || null, validDaysAfterIssue: null })
            }
          />
        </div>
      )}

      {mode === 'days_after' && (
        <div className="pt-1 flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={3650}
            className="input max-w-[120px]"
            value={value.validDaysAfterIssue ?? 30}
            onChange={(e) =>
              onChange({
                validUntil: null,
                validDaysAfterIssue: Math.max(1, Number(e.target.value) || 1),
              })
            }
          />
          <span className="text-sm text-mute">días desde la emisión</span>
        </div>
      )}
    </div>
  );
}
