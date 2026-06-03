'use client';

import { useState } from 'react';
import {
  type SequenceTrigger,
  type StageOption,
  type TriggerKind,
  TRIGGER_KIND_META,
} from './types';

/**
 * Sección colapsable con los triggers de la secuencia. El user define
 * cuándo se enrolla un contacto automáticamente. Cada trigger tiene
 * config simple según kind (stageId para STAGE_CHANGED, tag para
 * TAG_ADDED).
 */
export function TriggersSection({
  triggers,
  stages,
  onChange,
}: {
  triggers: SequenceTrigger[];
  stages: StageOption[];
  onChange: (next: SequenceTrigger[]) => void;
}) {
  const [open, setOpen] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  function addTrigger(kind: TriggerKind) {
    onChange([
      ...triggers,
      { kind, config: {}, isActive: true },
    ]);
    setShowAdd(false);
  }

  function updateTrigger(idx: number, partial: Partial<SequenceTrigger>) {
    onChange(triggers.map((t, i) => (i === idx ? { ...t, ...partial } : t)));
  }

  function deleteTrigger(idx: number) {
    onChange(triggers.filter((_, i) => i !== idx));
  }

  return (
    <div className="rounded-input border border-line bg-bg">
      <button
        type="button"
        className="w-full p-3 flex items-center justify-between"
        onClick={() => setOpen(!open)}
      >
        <div className="text-left">
          <div className="font-semibold">⚡ Disparadores</div>
          <div className="text-xs text-mute">
            {triggers.length === 0
              ? 'Solo se enrolla manualmente desde el contacto'
              : `${triggers.length} trigger${triggers.length === 1 ? '' : 's'} configurado${triggers.length === 1 ? '' : 's'}`}
          </div>
        </div>
        <span className="text-mute">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="border-t border-line p-3 space-y-2">
          {triggers.length === 0 && (
            <p className="text-xs text-mute py-2">
              Sin triggers automáticos. Puedes agregar uno para que los
              contactos se enrollen solos cuando se cree, cambien de etapa,
              etc.
            </p>
          )}

          {triggers.map((trig, idx) => {
            const meta = TRIGGER_KIND_META[trig.kind];
            return (
              <div
                key={idx}
                className="rounded-input border border-line bg-bg2/40 p-3"
              >
                <div className="flex items-start gap-2">
                  <span className="text-lg">{meta.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm">{meta.label}</div>
                    <div className="text-xs text-mute mb-2">
                      {meta.description}
                    </div>

                    {/* Config UI según kind */}
                    {trig.kind === 'STAGE_CHANGED' && (
                      <select
                        value={(trig.config as any)?.stageId ?? ''}
                        onChange={(e) =>
                          updateTrigger(idx, {
                            config: { stageId: e.target.value || undefined },
                          })
                        }
                        className="input text-sm"
                      >
                        <option value="">— Cualquier etapa —</option>
                        {stages.map((s) => (
                          <option key={s.id} value={s.id}>
                            Cuando se mueve a "{s.name}"
                          </option>
                        ))}
                      </select>
                    )}
                    {trig.kind === 'TAG_ADDED' && (
                      <input
                        type="text"
                        value={(trig.config as any)?.tag ?? ''}
                        onChange={(e) =>
                          updateTrigger(idx, {
                            config: {
                              tag: e.target.value.trim() || undefined,
                            },
                          })
                        }
                        placeholder="Etiqueta específica (vacío = cualquiera)"
                        className="input text-sm w-full"
                      />
                    )}
                  </div>
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={trig.isActive ?? true}
                      onChange={(e) =>
                        updateTrigger(idx, { isActive: e.target.checked })
                      }
                      className="accent-brand"
                    />
                  </label>
                  <button
                    className="btn-danger text-xs"
                    onClick={() => deleteTrigger(idx)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}

          <div className="relative">
            <button
              className="btn-ghost text-sm w-full"
              onClick={() => setShowAdd(!showAdd)}
            >
              + Agregar trigger
            </button>
            {showAdd && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setShowAdd(false)}
                />
                <div className="absolute left-0 right-0 top-full mt-1 z-40 rounded-input border border-line bg-bg shadow-lg py-1">
                  {(
                    [
                      'CONTACT_CREATED',
                      'STAGE_CHANGED',
                      'TAG_ADDED',
                      'CONTACT_FROM_GB',
                    ] as TriggerKind[]
                  ).map((k) => (
                    <button
                      key={k}
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-bg2 flex items-start gap-2"
                      onClick={() => addTrigger(k)}
                    >
                      <span className="text-base mt-0.5">
                        {TRIGGER_KIND_META[k].emoji}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium">
                          {TRIGGER_KIND_META[k].label}
                        </div>
                        <div className="text-xs text-mute leading-tight">
                          {TRIGGER_KIND_META[k].description}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
