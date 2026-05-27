'use client';

import { useState } from 'react';
import { FileUploader } from '@/components/FileUploader';
import { MessageEditor } from '@/components/MessageEditor';
import {
  type MessageType,
  type SequenceStep,
  type StageOption,
  STEP_KIND_META,
  WAIT_UNIT_LABELS,
} from './types';

/**
 * Editor de un step de la secuencia. F4 es la versión básica — el editor
 * premium (emoji picker + variables clickeables) llega en F5 sobre este
 * mismo componente.
 *
 * Soporta adjuntos multimedia (audio/video/PDF/imagen) usando el
 * FileUploader genérico de F1.
 */
export function StepEditor({
  step,
  stages,
  onClose,
  onSave,
}: {
  step: SequenceStep;
  stages: StageOption[];
  onClose: () => void;
  onSave: (updated: SequenceStep) => void;
}) {
  const [draft, setDraft] = useState<SequenceStep>(step);
  const meta = STEP_KIND_META[draft.kind];

  const update = (partial: Partial<SequenceStep>) =>
    setDraft((d) => ({ ...d, ...partial }));

  // Folder + kind del FileUploader según messageType.
  const uploaderKind = draft.messageType
    ? mapMessageTypeToFileKind(draft.messageType)
    : 'image';

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/70 flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center text-lg"
            style={{ backgroundColor: `${meta.color}22`, color: meta.color }}
          >
            {meta.emoji}
          </div>
          <div>
            <div className="text-xs text-mute font-semibold uppercase tracking-wide">
              Configurar paso
            </div>
            <div className="font-semibold">{meta.label}</div>
          </div>
        </div>

        {/* Body por kind */}
        {draft.kind === 'SEND_MESSAGE' && (
          <div className="space-y-3">
            <div>
              <div className="text-xs text-mute mb-1">Tipo de mensaje</div>
              <div className="grid grid-cols-5 gap-1">
                {(['TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'PDF'] as MessageType[]).map(
                  (t) => (
                    <button
                      key={t}
                      type="button"
                      className={`text-xs py-2 rounded-lg border ${
                        draft.messageType === t
                          ? 'border-brand bg-brand-soft text-brand font-semibold'
                          : 'border-line bg-bg2'
                      }`}
                      onClick={() =>
                        update({
                          messageType: t,
                          // Si cambia el tipo, limpiar attachment.
                          attachmentUrl:
                            t !== draft.messageType ? null : draft.attachmentUrl,
                          attachmentName:
                            t !== draft.messageType ? null : draft.attachmentName,
                        })
                      }
                    >
                      {t === 'TEXT' && '📝 Texto'}
                      {t === 'IMAGE' && '🖼️ Imagen'}
                      {t === 'AUDIO' && '🎵 Audio'}
                      {t === 'VIDEO' && '🎬 Video'}
                      {t === 'PDF' && '📄 PDF'}
                    </button>
                  ),
                )}
              </div>
            </div>

            <div>
              <div className="text-xs text-mute mb-1">Mensaje</div>
              <MessageEditor
                value={draft.messageBody ?? ''}
                onChange={(next) => update({ messageBody: next })}
                rows={4}
                placeholder="Ej. Hola {nombre} 👋 gracias por sumarte!"
              />
            </div>

            {draft.messageType && draft.messageType !== 'TEXT' && (
              <div>
                <div className="text-xs text-mute mb-1">Archivo adjunto</div>
                <FileUploader
                  value={draft.attachmentUrl ?? null}
                  contentType={
                    draft.messageType === 'AUDIO'
                      ? 'audio/mpeg'
                      : draft.messageType === 'VIDEO'
                        ? 'video/mp4'
                        : draft.messageType === 'PDF'
                          ? 'application/pdf'
                          : 'image/jpeg'
                  }
                  onChange={(url, meta) =>
                    update({
                      attachmentUrl: url,
                      attachmentName: url
                        ? meta?.contentType ?? null
                        : null,
                    })
                  }
                  folder="sequences-attachments"
                  kind={uploaderKind}
                />
              </div>
            )}
          </div>
        )}

        {draft.kind === 'WAIT' && (
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              value={draft.waitAmount ?? ''}
              onChange={(e) =>
                update({
                  waitAmount: e.target.value ? parseInt(e.target.value, 10) : null,
                })
              }
              className="input w-24"
              placeholder="1"
            />
            <select
              value={draft.waitUnit ?? 'HOURS'}
              onChange={(e) => update({ waitUnit: e.target.value as any })}
              className="input flex-1"
            >
              {(['MINUTES', 'HOURS', 'DAYS', 'WEEKS'] as const).map((u) => (
                <option key={u} value={u}>
                  {WAIT_UNIT_LABELS[u]}
                </option>
              ))}
            </select>
          </div>
        )}

        {draft.kind === 'MOVE_STAGE' && (
          <select
            value={draft.moveToStageId ?? ''}
            onChange={(e) =>
              update({ moveToStageId: e.target.value || null })
            }
            className="input w-full"
          >
            <option value="">— Elegí una etapa —</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}

        {(draft.kind === 'ADD_TAG' || draft.kind === 'REMOVE_TAG') && (
          <TagsInput
            value={draft.tags ?? []}
            onChange={(tags) => update({ tags })}
            placeholder={
              draft.kind === 'ADD_TAG'
                ? 'Etiquetas a agregar (Enter para sumar)'
                : 'Etiquetas a quitar'
            }
          />
        )}

        {draft.kind === 'ASSIGN_USER' && (
          <input
            type="text"
            value={draft.assignToUserId ?? ''}
            onChange={(e) => update({ assignToUserId: e.target.value || null })}
            className="input w-full"
            placeholder="userId del nuevo dueño (avanzado)"
          />
        )}

        {draft.kind === 'END' && (
          <p className="text-sm text-mute">
            Este paso marca el final de la secuencia. No tiene configuración.
          </p>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={() => onSave(draft)}>
            Guardar paso
          </button>
        </div>
      </div>
    </div>
  );
}

function mapMessageTypeToFileKind(
  t: MessageType,
): 'audio' | 'video' | 'document' | 'image' {
  if (t === 'AUDIO') return 'audio';
  if (t === 'VIDEO') return 'video';
  if (t === 'PDF') return 'document';
  return 'image';
}

// ─────────────────────────────────────────────────────────────────────
// Tags chip input
// ─────────────────────────────────────────────────────────────────────

function TagsInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState('');

  function add() {
    const t = text.trim();
    if (!t) return;
    if (!value.includes(t)) onChange([...value, t]);
    setText('');
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-2">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-brand-soft text-brand"
          >
            {tag}
            <button
              type="button"
              className="hover:text-bad"
              onClick={() => onChange(value.filter((t) => t !== tag))}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className="input flex-1"
        />
        <button type="button" className="btn-ghost" onClick={add}>
          +
        </button>
      </div>
    </div>
  );
}
