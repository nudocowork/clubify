'use client';
/**
 * Wallet V3 — editor de "Premios Free" (premios intermedios ilimitados).
 * Cada premio: posición del sello, texto (≤2 palabras), emoji opcional,
 * color del círculo, color del texto, activo/inactivo. Se dibujan dentro del
 * círculo del sello en su posición, con un badge 🎁 en la esquina.
 *
 * Reutilizado por el wizard (/app/cards/new) y el editor (/app/cards/[id]).
 */
import { useState } from 'react';

export type FreeReward = {
  id?: string;
  pos: number;
  text?: string;
  emoji?: string;
  circleColor?: string | null;
  textColor?: string | null;
  active?: boolean;
};

const uid = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return `fr_${Math.random().toString(36).slice(2)}`;
  }
};

export function FreeRewardsEditor({
  value,
  onChange,
  maxPos,
}: {
  value: FreeReward[];
  onChange: (v: FreeReward[]) => void;
  maxPos: number;
}) {
  const [open, setOpen] = useState(value.length > 0);
  const rewards = value ?? [];

  function patch(i: number, p: Partial<FreeReward>) {
    onChange(rewards.map((r, j) => (j === i ? { ...r, ...p } : r)));
  }
  function add() {
    // Sugerir la próxima posición libre.
    const used = new Set(rewards.map((r) => r.pos));
    let pos = 1;
    while (used.has(pos) && pos < Math.max(maxPos, 1)) pos++;
    onChange([
      ...rewards,
      { id: uid(), pos, text: '', emoji: '', circleColor: '#F59E0B', textColor: '#111827', active: true },
    ]);
    setOpen(true);
  }
  function remove(i: number) {
    onChange(rewards.filter((_, j) => j !== i));
  }

  return (
    <div className="pt-3 border-t border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full"
      >
        <label className="label m-0 cursor-pointer">🎁 Premios Free (intermedios)</label>
        <span className="text-xs text-mute">
          {rewards.length ? `${rewards.length} premio(s)` : 'Ninguno'} {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {rewards.length === 0 && (
            <p className="text-xs text-mute">
              Agrega premios que el cliente gana ANTES del premio final (ej. café al sello 3,
              cookie al 5). Se muestran dentro del sello con un badge 🎁.
            </p>
          )}
          {rewards.map((r, i) => (
            <div
              key={r.id ?? i}
              className="rounded-lg border border-line p-2.5 space-y-2"
              style={{ opacity: r.active === false ? 0.55 : 1 }}
            >
              <div className="flex items-center gap-2">
                <div className="w-16 shrink-0">
                  <label className="text-[10px] text-mute block">Sello #</label>
                  <input
                    type="number"
                    min={1}
                    max={maxPos || undefined}
                    className="input h-9"
                    value={r.pos}
                    onChange={(e) => patch(i, { pos: Math.max(1, Number(e.target.value) || 1) })}
                  />
                </div>
                <div className="w-14 shrink-0">
                  <label className="text-[10px] text-mute block">Emoji</label>
                  <input
                    className="input h-9 text-center"
                    maxLength={4}
                    placeholder="☕"
                    value={r.emoji ?? ''}
                    onChange={(e) => patch(i, { emoji: e.target.value })}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <label className="text-[10px] text-mute block">Texto (≤2 palabras)</label>
                  <input
                    className="input h-9"
                    maxLength={24}
                    placeholder="Café"
                    value={r.text ?? ''}
                    onChange={(e) => patch(i, { text: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-[10px] text-mute flex items-center gap-1.5">
                  Círculo
                  <input
                    type="color"
                    className="w-8 h-7 rounded border border-line p-0"
                    value={r.circleColor ?? '#F59E0B'}
                    onChange={(e) => patch(i, { circleColor: e.target.value })}
                  />
                </label>
                <label className="text-[10px] text-mute flex items-center gap-1.5">
                  Texto
                  <input
                    type="color"
                    className="w-8 h-7 rounded border border-line p-0"
                    value={r.textColor ?? '#111827'}
                    onChange={(e) => patch(i, { textColor: e.target.value })}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => patch(i, { active: r.active === false })}
                  className={`text-[11px] font-semibold px-2 py-1 rounded ${
                    r.active === false ? 'bg-bg2 text-mute' : 'bg-brand/10 text-brand'
                  }`}
                >
                  {r.active === false ? 'Inactivo' : 'Activo'}
                </button>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="ml-auto text-[11px] font-semibold text-red-500 hover:underline"
                >
                  Eliminar
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={add}
            className="w-full rounded-lg border-2 border-dashed border-line py-2 text-sm font-semibold text-brand hover:bg-brand/5"
          >
            + Agregar Premio
          </button>
        </div>
      )}
    </div>
  );
}
