'use client';

/**
 * /affiliate/crm/buttons — gestión de botones automáticos del CRM (C5).
 * Cada afiliado configura sus propios botones que después aparecen en
 * el drawer de detalle de cada contacto del kanban.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { FileUploader } from '@/components/FileUploader';
import { MessageEditor } from '@/components/MessageEditor';

type Channel = 'SMS' | 'WHATSAPP' | 'EMAIL' | 'NOTE';

type Stage = { id: string; name: string; color: string };

type CrmButton = {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  order: number;
  channel: Channel;
  messageBody: string | null;
  attachmentUrl: string | null;
  attachmentName: string | null;
  moveToStageId: string | null;
  moveToStage: Stage | null;
  addTags: string[];
  delaySeconds: number;
  requiresConfirmation: boolean;
};

export default function CrmButtonsPage() {
  const [buttons, setButtons] = useState<CrmButton[] | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [editing, setEditing] = useState<CrmButton | 'new' | null>(null);

  async function load() {
    try {
      const [btns, pip] = await Promise.all([
        api<CrmButton[]>('/crm/buttons'),
        api<{ stages: Stage[] }>('/crm/pipeline'),
      ]);
      setButtons(btns);
      setStages(pip.stages);
    } catch (e: any) {
      toast(e?.message || 'Error cargando botones', 'error');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function del(b: CrmButton) {
    if (!confirm(`¿Borrar el botón "${b.name}"?`)) return;
    try {
      await api(`/crm/buttons/${b.id}`, { method: 'DELETE' });
      toast('Botón borrado', 'success');
      await load();
    } catch (e: any) {
      toast(e?.message || 'No se pudo borrar', 'error');
    }
  }

  if (!buttons) {
    return (
      <div className="space-y-3">
        <div className="h-10 bg-bg2 rounded animate-shimmer" />
        <div className="h-32 bg-bg2 rounded animate-shimmer" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="page-head">
        <h1 className="page-title">
          Botones automáticos <span className="page-crumb">/ CRM</span>
        </h1>
        <div className="flex gap-2 flex-wrap">
          <Link href="/affiliate/crm" className="btn-ghost text-sm">
            ← Kanban
          </Link>
          <button
            className="btn-primary text-sm"
            onClick={() => setEditing('new')}
          >
            ＋ Nuevo botón
          </button>
        </div>
      </div>

      <p className="text-mute text-sm mb-4 max-w-prose">
        Configura acciones rápidas que aparecen al abrir un contacto del
        kanban. Cada botón puede enviar un mensaje, mover el contacto a
        otra columna y agregar etiquetas — todo con un solo click.
      </p>

      {buttons.length === 0 ? (
        <div className="card card-pad text-center text-mute py-12">
          <div className="text-3xl mb-2">⚡</div>
          <div className="font-semibold mb-1">Sin botones todavía</div>
          <div className="text-sm">
            Crea tu primer botón — ejemplo: "Reunión finalizada" que mueve
            a Seguimiento y manda un mensaje de gracias por WhatsApp.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {buttons.map((b) => (
            <button
              key={b.id}
              onClick={() => setEditing(b)}
              className="card card-pad w-full text-left hover:border-ink/30 transition flex items-center gap-3"
            >
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold flex-none"
                style={{ background: b.color }}
              >
                {b.icon || b.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{b.name}</div>
                <div className="text-xs text-mute mt-0.5 flex flex-wrap gap-2">
                  {b.moveToStage && (
                    <span>
                      → <strong>{b.moveToStage.name}</strong>
                    </span>
                  )}
                  {b.addTags.length > 0 && (
                    <span>+ {b.addTags.length} etiqueta(s)</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  del(b);
                }}
                className="text-bad text-xs hover:underline whitespace-nowrap"
              >
                Borrar
              </button>
            </button>
          ))}
        </div>
      )}

      {editing && (
        <ButtonFormModal
          initial={editing === 'new' ? null : editing}
          stages={stages}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

// ============================================================
//              MODAL: CREAR / EDITAR BOTÓN
// ============================================================

function ButtonFormModal({
  initial,
  stages,
  onClose,
  onSaved,
}: {
  initial: CrmButton | null;
  stages: Stage[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    color: initial?.color ?? '#6366F1',
    icon: initial?.icon ?? '',
    // Channel siempre SMS por decisión del founder — el user no elige
    // canal y la UI no lo menciona. Mantenemos el field por compat con
    // botones viejos creados antes del cambio (que pueden tener
    // WHATSAPP/EMAIL/NOTE). Al guardar siempre va SMS.
    channel: 'SMS' as Channel,
    messageBody: initial?.messageBody ?? '',
    attachmentUrl: initial?.attachmentUrl ?? '',
    attachmentName: initial?.attachmentName ?? '',
    moveToStageId: initial?.moveToStageId ?? '',
    addTagsRaw: (initial?.addTags ?? []).join(', '),
    requiresConfirmation: initial?.requiresConfirmation ?? true,
  });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        color: form.color,
        icon: form.icon || null,
        channel: form.channel,
        messageBody: form.messageBody || null,
        attachmentUrl: form.attachmentUrl || null,
        attachmentName: form.attachmentName || null,
        moveToStageId: form.moveToStageId || null,
        addTags: form.addTagsRaw
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 10),
        requiresConfirmation: form.requiresConfirmation,
      };
      if (initial) {
        await api(`/crm/buttons/${initial.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      } else {
        await api('/crm/buttons', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }
      toast(initial ? 'Botón actualizado' : 'Botón creado', 'success');
      onSaved();
    } catch (err: any) {
      toast(err?.message || 'No se pudo guardar', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title={initial ? 'Editar botón' : 'Nuevo botón'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_auto_auto] gap-3 items-end">
          <div>
            <label className="label">Nombre</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ej: Reunión finalizada"
              autoFocus
              required
              maxLength={80}
            />
          </div>
          <div>
            <label className="label">Icono</label>
            <input
              className="input w-16 text-center"
              value={form.icon}
              onChange={(e) => setForm({ ...form, icon: e.target.value })}
              placeholder="🎯"
              maxLength={4}
            />
          </div>
          <div>
            <label className="label">Color</label>
            <input
              type="color"
              className="w-12 h-10 rounded-lg border border-line cursor-pointer"
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
            />
          </div>
        </div>

        {/* Canal de envío oculto al user — siempre SMS internamente.
            Decisión del founder: simplificar la UX, el usuario no
            elige canal, el sistema sabe qué hacer. El channel se setea
            a 'SMS' en el initial state del form y al submit. */}

        <div>
          <label className="label">Mensaje</label>
          <MessageEditor
            value={form.messageBody}
            onChange={(next) => setForm({ ...form, messageBody: next })}
            rows={4}
            placeholder="Hola {nombre}, gracias por la reunión..."
          />
        </div>

        <div>
          <label className="label">
            Adjunto <span className="text-mute font-normal">— imagen, audio, video o PDF</span>
          </label>
          <FileUploader
            value={form.attachmentUrl || null}
            onChange={(url, meta) =>
              setForm({
                ...form,
                attachmentUrl: url ?? '',
                attachmentName: url
                  ? (url.split('/').pop() ?? '')
                  : '',
              })
            }
            folder="crm-buttons"
            kind="any"
          />
        </div>

        <div>
          <label className="label">Mover a columna (side effect)</label>
          <select
            className="input"
            value={form.moveToStageId}
            onChange={(e) =>
              setForm({ ...form, moveToStageId: e.target.value })
            }
          >
            <option value="">— Sin movimiento —</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">
            Etiquetas a agregar <span className="text-mute font-normal">— separadas por coma</span>
          </label>
          <input
            className="input"
            value={form.addTagsRaw}
            onChange={(e) => setForm({ ...form, addTagsRaw: e.target.value })}
            placeholder="reunion-finalizada, propuesta-enviada"
          />
        </div>

        <label className="flex items-center gap-2 text-sm pt-1 cursor-pointer">
          <input
            type="checkbox"
            checked={form.requiresConfirmation}
            onChange={(e) =>
              setForm({ ...form, requiresConfirmation: e.target.checked })
            }
          />
          Pedir confirmación antes de ejecutar
        </label>

        <div className="flex justify-end gap-2 pt-2 border-t border-line">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Guardando…' : initial ? 'Guardar' : 'Crear botón'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white z-10 flex items-center justify-between px-5 py-3 border-b border-line">
          <div className="font-semibold">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="text-mute hover:text-ink text-2xl leading-none w-9 h-9 flex items-center justify-center -mr-2"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
