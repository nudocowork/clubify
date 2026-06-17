'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ImageUploader } from '@/components/ImageUploader';
import type { StorefrontPopupItem } from '@/lib/storefront-popups';
import type { PopupSchedule } from '@/lib/info-link-extras';

// #5 (2026-06-17): admin de popups MÚLTIPLES + programados del menú storefront.
// Se guardan en Storefront.theme.menuPopups (sin migración). El padre persiste
// vía el `theme` que ya manda en PATCH /storefront.

const DOW: { i: number; l: string }[] = [
  { i: 1, l: 'Lun' },
  { i: 2, l: 'Mar' },
  { i: 3, l: 'Mié' },
  { i: 4, l: 'Jue' },
  { i: 5, l: 'Vie' },
  { i: 6, l: 'Sáb' },
  { i: 0, l: 'Dom' },
];

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `p_${Date.now()}_${Math.round(Math.random() * 1e6)}`;
  }
}

export function MenuPopupsCard({
  popups,
  onChange,
}: {
  popups: StorefrontPopupItem[];
  onChange: (popups: StorefrontPopupItem[]) => void;
}) {
  const [cards, setCards] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    api<any[]>('/cards')
      .then((arr) =>
        setCards(
          (arr ?? [])
            .filter((c) => c?.name && c.name.trim().length > 0)
            .map((c) => ({ id: c.id, name: c.name })),
        ),
      )
      .catch(() => setCards([]));
  }, []);

  const list = Array.isArray(popups) ? popups : [];

  function patchAt(idx: number, part: Partial<StorefrontPopupItem>) {
    onChange(list.map((p, i) => (i === idx ? { ...p, ...part } : p)));
  }
  function patchSchedule(idx: number, part: Partial<PopupSchedule>) {
    const cur = list[idx]?.schedule ?? {};
    patchAt(idx, { schedule: { ...cur, ...part } });
  }
  function add() {
    onChange([
      ...list,
      {
        id: newId(),
        enabled: true,
        imageUrl: '',
        cardId: null,
        delaySeconds: 10,
        name: '',
        schedule: null,
      },
    ]);
  }
  function remove(idx: number) {
    onChange(list.filter((_, i) => i !== idx));
  }
  function toggleDay(idx: number, day: number) {
    const cur = list[idx]?.schedule?.daysOfWeek ?? [];
    const next = cur.includes(day)
      ? cur.filter((d) => d !== day)
      : [...cur, day];
    patchSchedule(idx, { daysOfWeek: next.length > 0 ? next : null });
  }

  return (
    <div className="card card-pad mb-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold m-0">📣 Popups programados</h3>
        <button type="button" onClick={add} className="btn-ghost text-sm">
          + Agregar popup
        </button>
      </div>
      <p className="text-mute text-xs mt-1 leading-relaxed">
        Crea varios popups y programá cuándo aparece cada uno (días de la semana,
        rango horario y/o fechas). Si hay varios activos al mismo tiempo, se
        muestra el primero de la lista. Tienen prioridad sobre el popup simple de
        arriba.
      </p>

      {list.length === 0 && (
        <div className="text-[12px] text-mute italic mt-3">
          Sin popups programados. Usá “+ Agregar popup”.
        </div>
      )}

      <div className="mt-3 space-y-4">
        {list.map((p, idx) => {
          const sched = p.schedule ?? {};
          const days = sched.daysOfWeek ?? [];
          return (
            <div
              key={p.id}
              className="rounded-xl border border-line p-3 bg-bg2/30 space-y-3"
            >
              <div className="flex items-center gap-2">
                <input
                  className="input flex-1 text-sm"
                  placeholder="Nombre interno (ej: Promo lunes)"
                  value={p.name ?? ''}
                  onChange={(e) => patchAt(idx, { name: e.target.value })}
                  maxLength={60}
                />
                <label className="flex items-center gap-1.5 text-xs font-semibold shrink-0 cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-brand"
                    checked={p.enabled}
                    onChange={(e) => patchAt(idx, { enabled: e.target.checked })}
                  />
                  Activo
                </label>
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  className="text-mute hover:text-bad text-lg shrink-0"
                  title="Eliminar popup"
                >
                  🗑
                </button>
              </div>

              <div>
                <label className="label">Imagen del popup</label>
                <ImageUploader
                  value={p.imageUrl || null}
                  onChange={(url) => patchAt(idx, { imageUrl: url || '' })}
                  folder="products"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Al tocar (opcional)</label>
                  <select
                    className="input"
                    value={p.cardId ?? ''}
                    onChange={(e) =>
                      patchAt(idx, { cardId: e.target.value || null })
                    }
                  >
                    <option value="">— Solo mostrar imagen —</option>
                    {cards.map((c) => (
                      <option key={c.id} value={c.id}>
                        Inscribir a: {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Aparece a los (seg)</label>
                  <input
                    type="number"
                    className="input"
                    min={0}
                    max={120}
                    value={p.delaySeconds ?? 10}
                    onChange={(e) => {
                      const raw = Number(e.target.value);
                      patchAt(idx, {
                        delaySeconds: Math.max(
                          0,
                          Math.min(120, Number.isFinite(raw) ? raw : 10),
                        ),
                      });
                    }}
                  />
                  <p className="text-[10px] text-mute mt-0.5">0 = inmediato</p>
                </div>
              </div>

              {/* Programación */}
              <div className="rounded-lg border border-line2 p-2.5 bg-white/60 space-y-2.5">
                <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
                  Programación
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label className="label mb-0">Días</label>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="text-[10px] text-brand hover:underline"
                        onClick={() => patchSchedule(idx, { daysOfWeek: null })}
                      >
                        Todos
                      </button>
                      <span className="text-line2">·</span>
                      <button
                        type="button"
                        className="text-[10px] text-brand hover:underline"
                        onClick={() =>
                          patchSchedule(idx, { daysOfWeek: [1, 2, 3, 4, 5] })
                        }
                      >
                        Entre semana
                      </button>
                      <span className="text-line2">·</span>
                      <button
                        type="button"
                        className="text-[10px] text-brand hover:underline"
                        onClick={() => patchSchedule(idx, { daysOfWeek: [6, 0] })}
                      >
                        Finde
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {DOW.map((d) => {
                      const on = days.includes(d.i);
                      return (
                        <button
                          key={d.i}
                          type="button"
                          onClick={() => toggleDay(idx, d.i)}
                          className={`text-xs font-semibold px-2.5 py-1 rounded-pill border transition ${
                            on
                              ? 'bg-brand text-white border-brand'
                              : 'bg-bg2 text-mute border-line hover:bg-line'
                          }`}
                        >
                          {d.l}
                        </button>
                      );
                    })}
                  </div>
                  {days.length === 0 && (
                    <p className="text-[10px] text-mute mt-1">
                      Sin selección = todos los días.
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label">Desde (hora)</label>
                    <input
                      type="time"
                      className="input"
                      value={sched.startTime ?? ''}
                      onChange={(e) =>
                        patchSchedule(idx, { startTime: e.target.value || null })
                      }
                    />
                  </div>
                  <div>
                    <label className="label">Hasta (hora)</label>
                    <input
                      type="time"
                      className="input"
                      value={sched.endTime ?? ''}
                      onChange={(e) =>
                        patchSchedule(idx, { endTime: e.target.value || null })
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label">Desde (fecha)</label>
                    <input
                      type="date"
                      className="input"
                      value={sched.startDate ?? ''}
                      onChange={(e) =>
                        patchSchedule(idx, { startDate: e.target.value || null })
                      }
                    />
                  </div>
                  <div>
                    <label className="label">Hasta (fecha)</label>
                    <input
                      type="date"
                      className="input"
                      value={sched.endDate ?? ''}
                      onChange={(e) =>
                        patchSchedule(idx, { endDate: e.target.value || null })
                      }
                    />
                  </div>
                </div>
                <p className="text-[10px] text-mute">
                  Vacío = sin restricción. Hora/fecha usan la zona del cliente.
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
