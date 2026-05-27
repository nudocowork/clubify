'use client';

/**
 * CRM Kanban — C3.
 *
 * UI principal del CRM de Ventas (Bloque C). Cada afiliado ve SU
 * pipeline + contactos propios. Soporta:
 *   - Drag & drop de cards entre columnas (móvil y desktop) via dnd-kit
 *   - Modal de creación rápida (todos los campos opcionales)
 *   - Drawer de edición de contacto
 *   - Edición de stages (nombre, color)
 *   - Mobile-first: columnas como tabs swipeables en pantallas chicas
 *
 * Endpoints consumidos (C1 + C2):
 *   GET    /crm/pipeline                  — pipeline + stages
 *   POST   /crm/stages                    — agregar columna
 *   PATCH  /crm/stages/:id                — editar nombre/color
 *   DELETE /crm/stages/:id                — borrar (mueve contactos a 1ra)
 *   GET    /crm/contacts                  — todos los contactos del user
 *   POST   /crm/contacts                  — crear contacto
 *   PATCH  /crm/contacts/:id/stage        — mover entre stages
 *   PATCH  /crm/contacts/:id              — editar
 *   DELETE /crm/contacts/:id              — borrar
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCorners,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type StageKind =
  | 'CONTACTS'
  | 'INTERESTED'
  | 'FOLLOWUP'
  | 'CLIENT'
  | 'NOT_INTERESTED'
  | 'CUSTOM';

type Stage = {
  id: string;
  name: string;
  color: string;
  order: number;
  kind: StageKind;
};

type Pipeline = {
  id: string;
  name: string;
  stages: Stage[];
};

type Contact = {
  id: string;
  stageId: string;
  name: string | null;
  phone: string | null;
  instagram: string | null;
  address: string | null;
  description: string | null;
  tags: string[];
  lastActivityAt: string;
  createdAt: string;
};

export function CrmKanban() {
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [newContactStageId, setNewContactStageId] = useState<string | null>(null);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [addingStage, setAddingStage] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  // En mobile mostramos UNA columna por vez (tab activa). En desktop
  // se muestran todas lado a lado scrollables.
  const [mobileStageIdx, setMobileStageIdx] = useState(0);

  async function load() {
    setLoading(true);
    try {
      const [pip, ct] = await Promise.all([
        api<Pipeline>('/crm/pipeline'),
        api<Contact[]>('/crm/contacts'),
      ]);
      setPipeline(pip);
      setContacts(ct);
    } catch (e: any) {
      toast(e?.message || 'Error cargando CRM', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Sensors: PointerSensor para desktop, TouchSensor con activación
  // por delay corto para móvil (evita activar drag con tap accidental).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
  );

  const contactsByStage = useMemo(() => {
    const map = new Map<string, Contact[]>();
    for (const s of pipeline?.stages ?? []) map.set(s.id, []);
    for (const c of contacts) {
      const arr = map.get(c.stageId);
      if (arr) arr.push(c);
    }
    return map;
  }, [pipeline?.stages, contacts]);

  function onDragStart(e: DragStartEvent) {
    setActiveDragId(String(e.active.id));
  }

  /**
   * onDragEnd: el id del item arrastrado es contact.id, el over.id
   * puede ser el id de otro contact (drop sobre una card) o el id de
   * la columna (drop sobre la columna vacía o footer). Resolvemos a
   * stageId destino y disparamos PATCH.
   */
  async function onDragEnd(e: DragEndEvent) {
    setActiveDragId(null);
    const { active, over } = e;
    if (!over) return;
    const contactId = String(active.id);
    const overId = String(over.id);
    const contact = contacts.find((c) => c.id === contactId);
    if (!contact) return;

    // Resolvemos targetStageId: si overId matchea una stage directa, es la
    // stage. Si matchea un contact, es el stageId de ese contact.
    let targetStageId: string | null = null;
    if (pipeline?.stages.some((s) => s.id === overId)) {
      targetStageId = overId;
    } else {
      const overContact = contacts.find((c) => c.id === overId);
      if (overContact) targetStageId = overContact.stageId;
    }
    if (!targetStageId || targetStageId === contact.stageId) return;

    // Optimistic UI: actualizamos el contacto local primero. Si el
    // PATCH falla, revertimos.
    const prevStageId = contact.stageId;
    setContacts((cs) =>
      cs.map((c) =>
        c.id === contactId
          ? { ...c, stageId: targetStageId!, lastActivityAt: new Date().toISOString() }
          : c,
      ),
    );
    try {
      await api(`/crm/contacts/${contactId}/stage`, {
        method: 'PATCH',
        body: JSON.stringify({ stageId: targetStageId }),
      });
    } catch (err: any) {
      // Rollback
      setContacts((cs) =>
        cs.map((c) => (c.id === contactId ? { ...c, stageId: prevStageId } : c)),
      );
      toast(err?.message || 'No se pudo mover el contacto', 'error');
    }
  }

  if (loading || !pipeline) {
    return (
      <div className="space-y-3">
        <div className="h-10 bg-bg2 rounded animate-shimmer" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="h-64 bg-bg2 rounded animate-shimmer" />
          <div className="h-64 bg-bg2 rounded animate-shimmer" />
          <div className="h-64 bg-bg2 rounded animate-shimmer" />
        </div>
      </div>
    );
  }

  const stages = [...pipeline.stages].sort((a, b) => a.order - b.order);
  const activeContact = activeDragId
    ? contacts.find((c) => c.id === activeDragId)
    : null;
  const currentMobileStage = stages[mobileStageIdx] ?? stages[0];

  return (
    <div>
      {/* Header */}
      <div className="page-head">
        <h1 className="page-title">
          {pipeline.name} <span className="page-crumb">/ CRM</span>
        </h1>
        <div className="flex gap-2 flex-wrap">
          <Link href="/affiliate" className="btn-ghost text-sm">
            ← Dashboard
          </Link>
          <Link href="/affiliate/crm/buttons" className="btn-ghost text-sm">
            ⚡ Botones
          </Link>
          <button
            className="btn-ghost text-sm"
            onClick={() => setAddingStage(true)}
            title="Agregar columna"
          >
            ＋ Columna
          </button>
          <button
            className="btn-primary text-sm"
            onClick={() => setNewContactStageId(stages[0]?.id ?? null)}
          >
            ＋ Contacto
          </button>
        </div>
      </div>

      {/* Mobile stage tabs (visible solo en sm:hidden) */}
      <div className="sm:hidden flex gap-1.5 overflow-x-auto pb-2 mb-2 -mx-2 px-2">
        {stages.map((s, idx) => {
          const count = contactsByStage.get(s.id)?.length ?? 0;
          return (
            <button
              key={s.id}
              onClick={() => setMobileStageIdx(idx)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition border ${
                idx === mobileStageIdx
                  ? 'border-ink text-ink bg-white'
                  : 'border-line text-mute bg-bg2'
              }`}
              style={
                idx === mobileStageIdx
                  ? { borderColor: s.color, color: s.color }
                  : undefined
              }
            >
              {s.name}
              <span className="ml-1.5 opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        {/* Desktop: scroll horizontal con todas las columnas */}
        <div className="hidden sm:flex gap-3 overflow-x-auto pb-2 -mx-2 px-2 min-h-[400px]">
          {stages.map((s) => (
            <KanbanColumn
              key={s.id}
              stage={s}
              contacts={contactsByStage.get(s.id) ?? []}
              onAddContact={() => setNewContactStageId(s.id)}
              onEditContact={setEditingContactId}
              onEditStage={() => setEditingStageId(s.id)}
            />
          ))}
        </div>
        {/* Mobile: una columna por vez según tab activo */}
        <div className="sm:hidden">
          {currentMobileStage && (
            <KanbanColumn
              stage={currentMobileStage}
              contacts={contactsByStage.get(currentMobileStage.id) ?? []}
              onAddContact={() => setNewContactStageId(currentMobileStage.id)}
              onEditContact={setEditingContactId}
              onEditStage={() => setEditingStageId(currentMobileStage.id)}
              fullWidth
            />
          )}
        </div>

        <DragOverlay>
          {activeContact ? (
            <div className="bg-white rounded-lg border border-line shadow-xl px-3 py-2.5 w-[280px] opacity-90 rotate-2">
              <div className="text-sm font-semibold truncate">
                {activeContact.name || 'Sin nombre'}
              </div>
              {activeContact.phone && (
                <div className="text-xs text-mute">{activeContact.phone}</div>
              )}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Modal: nuevo contacto */}
      {newContactStageId && (
        <NewContactModal
          stages={stages}
          defaultStageId={newContactStageId}
          onClose={() => setNewContactStageId(null)}
          onCreated={async () => {
            setNewContactStageId(null);
            await load();
          }}
        />
      )}

      {/* Drawer: editar contacto */}
      {editingContactId && (
        <ContactDrawer
          contactId={editingContactId}
          stages={stages}
          onClose={() => setEditingContactId(null)}
          onChanged={async () => {
            await load();
          }}
          onDeleted={async () => {
            setEditingContactId(null);
            await load();
          }}
        />
      )}

      {/* Modal: editar stage */}
      {editingStageId && (
        <EditStageModal
          stage={stages.find((s) => s.id === editingStageId)!}
          canDelete={stages.length > 1}
          onClose={() => setEditingStageId(null)}
          onSaved={async () => {
            setEditingStageId(null);
            await load();
          }}
        />
      )}

      {/* Modal: agregar columna */}
      {addingStage && (
        <AddStageModal
          onClose={() => setAddingStage(false)}
          onCreated={async () => {
            setAddingStage(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

// ============================================================
//                         COLUMNAS
// ============================================================

function KanbanColumn({
  stage,
  contacts,
  onAddContact,
  onEditContact,
  onEditStage,
  fullWidth,
}: {
  stage: Stage;
  contacts: Contact[];
  onAddContact: () => void;
  onEditContact: (id: string) => void;
  onEditStage: () => void;
  fullWidth?: boolean;
}) {
  // SortableContext habilita el droppable a nivel COLUMNA. Los items
  // dentro son draggables individuales (vía useSortable en
  // ContactCard).
  const ids = contacts.map((c) => c.id);
  return (
    <div
      className={`flex-none ${fullWidth ? 'w-full' : 'w-[280px]'} bg-bg2/40 rounded-xl border border-line2 flex flex-col max-h-[calc(100vh-220px)]`}
    >
      <div className="p-3 border-b border-line2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-full flex-none"
            style={{ background: stage.color }}
          />
          <div className="font-semibold text-sm truncate">{stage.name}</div>
          <div className="text-xs text-mute">{contacts.length}</div>
        </div>
        <button
          onClick={onEditStage}
          className="text-mute hover:text-ink text-base leading-none px-1"
          title="Editar columna"
        >
          ⋯
        </button>
      </div>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div
          id={stage.id}
          data-stage-id={stage.id}
          className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[80px]"
        >
          {contacts.map((c) => (
            <ContactCard key={c.id} contact={c} onOpen={() => onEditContact(c.id)} />
          ))}
          {contacts.length === 0 && (
            <DroppableEmptySlot stageId={stage.id} />
          )}
        </div>
      </SortableContext>
      <button
        onClick={onAddContact}
        className="p-2 border-t border-line2 text-xs text-mute hover:text-ink hover:bg-white/50 transition text-left"
      >
        ＋ Agregar contacto
      </button>
    </div>
  );
}

/**
 * Slot vacío que sirve como drop target cuando una columna no tiene
 * contactos. Sin esto, dnd-kit no resuelve el drop sobre una columna
 * sin items (porque el SortableContext del array vacío no tiene
 * ningún ID al que matchear).
 */
function DroppableEmptySlot({ stageId }: { stageId: string }) {
  const { setNodeRef, isOver } = useSortable({ id: stageId });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border border-dashed py-6 text-center text-xs transition ${
        isOver
          ? 'border-brand bg-brand/5 text-brand'
          : 'border-line2 text-mute/60'
      }`}
    >
      Soltá un contacto acá
    </div>
  );
}

// ============================================================
//                         CARD
// ============================================================

function ContactCard({
  contact,
  onOpen,
}: {
  contact: Contact;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: contact.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  // Stop propagation en el botón "abrir" para que el click no dispare
  // el drag pointer-down. dnd-kit ya delays con distance:6 pero el
  // botón es área más sensitive (los textos pueden ser pequeños en
  // mobile).
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="bg-white rounded-lg border border-line2 px-3 py-2.5 cursor-grab active:cursor-grabbing hover:border-ink/30 transition group"
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="w-full text-left"
      >
        <div className="text-sm font-semibold truncate">
          {contact.name || 'Sin nombre'}
        </div>
        {contact.phone && (
          <div className="text-xs text-mute mt-0.5">📞 {contact.phone}</div>
        )}
        {contact.instagram && (
          <div className="text-xs text-mute mt-0.5">@{contact.instagram}</div>
        )}
        {Array.isArray(contact.tags) && contact.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {contact.tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="text-[10px] uppercase tracking-wider bg-bg2 text-mute px-1.5 py-0.5 rounded"
              >
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="text-[10px] text-mute/70 mt-1.5">
          {timeAgo(contact.lastActivityAt)}
        </div>
      </button>
    </div>
  );
}

// ============================================================
//                     MODAL: NUEVO CONTACTO
// ============================================================

function NewContactModal({
  stages,
  defaultStageId,
  onClose,
  onCreated,
}: {
  stages: Stage[];
  defaultStageId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    stageId: defaultStageId,
    name: '',
    phone: '',
    instagram: '',
    address: '',
    description: '',
  });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api('/crm/contacts', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      toast('Contacto creado', 'success');
      onCreated();
    } catch (err: any) {
      toast(err?.message || 'No se pudo crear', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="Nuevo contacto" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label">Columna</label>
          <select
            className="input"
            value={form.stageId}
            onChange={(e) => setForm({ ...form, stageId: e.target.value })}
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Nombre</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoFocus
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Teléfono</label>
            <input
              className="input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Instagram</label>
            <input
              className="input"
              value={form.instagram}
              placeholder="sin @"
              onChange={(e) => setForm({ ...form, instagram: e.target.value })}
            />
          </div>
        </div>
        <div>
          <label className="label">Dirección</label>
          <input
            className="input"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Notas</label>
          <textarea
            className="input"
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Creando…' : 'Crear contacto'}
          </button>
        </div>
        <p className="text-[11px] text-mute">
          Todos los campos son opcionales — registrá rápido y completá después.
        </p>
      </form>
    </ModalShell>
  );
}

// ============================================================
//                  DRAWER: EDITAR CONTACTO
// ============================================================

type CrmActionButton = {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  channel: 'SMS' | 'WHATSAPP' | 'EMAIL' | 'NOTE';
  requiresConfirmation: boolean;
  moveToStage: { id: string; name: string; color: string } | null;
  addTags: string[];
};

function ContactDrawer({
  contactId,
  stages,
  onClose,
  onChanged,
  onDeleted,
}: {
  contactId: string;
  stages: Stage[];
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [contact, setContact] = useState<Contact | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<Contact>>({});
  const [buttons, setButtons] = useState<CrmActionButton[]>([]);
  const [confirmingBtn, setConfirmingBtn] = useState<CrmActionButton | null>(null);
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    api<Contact>(`/crm/contacts/${contactId}`).then((c) => {
      setContact(c);
      setForm({
        name: c.name,
        phone: c.phone,
        instagram: c.instagram,
        address: c.address,
        description: c.description,
        stageId: c.stageId,
      });
    });
    api<CrmActionButton[]>('/crm/buttons')
      .then(setButtons)
      .catch(() => setButtons([]));
  }, [contactId]);

  async function executeButton(btn: CrmActionButton) {
    if (!contact) return;
    setExecuting(true);
    try {
      const res = await api<any>(`/crm/buttons/${btn.id}/execute`, {
        method: 'POST',
        body: JSON.stringify({ contactId: contact.id }),
      });
      if (res?.channel === 'WHATSAPP' && res?.whatsappUrl) {
        window.open(res.whatsappUrl, '_blank', 'noopener,noreferrer');
        toast('WhatsApp abierto', 'success');
      } else if (res?.pending) {
        toast(
          res?.note ||
            'Acción aplicada — el envío real llega en una próxima iteración',
          'success',
        );
      } else if (res?.error) {
        toast(res.error, 'error');
      } else {
        toast('Acción aplicada', 'success');
      }
      onChanged();
      onClose();
    } catch (err: any) {
      toast(err?.message || 'No se pudo ejecutar el botón', 'error');
    } finally {
      setExecuting(false);
      setConfirmingBtn(null);
    }
  }

  function onClickButton(btn: CrmActionButton) {
    if (btn.requiresConfirmation) {
      setConfirmingBtn(btn);
    } else {
      executeButton(btn);
    }
  }

  async function save() {
    if (!contact) return;
    setSaving(true);
    try {
      // El stage move va por endpoint separado.
      if (form.stageId && form.stageId !== contact.stageId) {
        await api(`/crm/contacts/${contact.id}/stage`, {
          method: 'PATCH',
          body: JSON.stringify({ stageId: form.stageId }),
        });
      }
      await api(`/crm/contacts/${contact.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: form.name ?? null,
          phone: form.phone ?? null,
          instagram: form.instagram ?? null,
          address: form.address ?? null,
          description: form.description ?? null,
        }),
      });
      toast('Cambios guardados', 'success');
      onChanged();
      onClose();
    } catch (err: any) {
      toast(err?.message || 'No se pudo guardar', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!contact) return;
    if (!confirm(`¿Borrar a "${contact.name || 'este contacto'}"?`)) return;
    try {
      await api(`/crm/contacts/${contact.id}`, { method: 'DELETE' });
      toast('Contacto borrado', 'success');
      onDeleted();
    } catch (err: any) {
      toast(err?.message || 'No se pudo borrar', 'error');
    }
  }

  return (
    <ModalShell title="Contacto" onClose={onClose}>
      {!contact ? (
        <div className="text-mute text-sm">Cargando…</div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="label">Columna</label>
            <select
              className="input"
              value={form.stageId ?? contact.stageId}
              onChange={(e) => setForm({ ...form, stageId: e.target.value })}
            >
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Nombre</label>
            <input
              className="input"
              value={form.name ?? ''}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Teléfono</label>
              <input
                className="input"
                value={form.phone ?? ''}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Instagram</label>
              <input
                className="input"
                value={form.instagram ?? ''}
                onChange={(e) =>
                  setForm({ ...form, instagram: e.target.value })
                }
              />
            </div>
          </div>
          <div>
            <label className="label">Dirección</label>
            <input
              className="input"
              value={form.address ?? ''}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Notas</label>
            <textarea
              className="input"
              rows={4}
              value={form.description ?? ''}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </div>
          <div className="flex items-center justify-between pt-2 flex-wrap gap-2">
            <button type="button" className="btn-ghost text-bad" onClick={del}>
              Borrar
            </button>
            <div className="flex gap-2">
              <button type="button" className="btn-ghost" onClick={onClose}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={save}
                disabled={saving}
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>

          {/* Botones automáticos (C5) — solo si el user configuró alguno */}
          {buttons.length > 0 && (
            <div className="border-t border-line pt-3 mt-3">
              <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-2">
                ⚡ Acciones rápidas
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {buttons.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => onClickButton(b)}
                    disabled={executing}
                    className="px-3 py-2 rounded-lg text-white text-xs font-medium text-left hover:opacity-90 transition disabled:opacity-50"
                    style={{ background: b.color }}
                  >
                    <span className="mr-1.5">{b.icon || '⚡'}</span>
                    <span className="truncate">{b.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal confirm de botón */}
      {confirmingBtn && (
        <ConfirmButtonExecutionModal
          btn={confirmingBtn}
          onCancel={() => setConfirmingBtn(null)}
          onConfirm={() => executeButton(confirmingBtn)}
          executing={executing}
        />
      )}
    </ModalShell>
  );
}

function ConfirmButtonExecutionModal({
  btn,
  onCancel,
  onConfirm,
  executing,
}: {
  btn: CrmActionButton;
  onCancel: () => void;
  onConfirm: () => void;
  executing: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-base font-semibold mb-2">
          ¿Ejecutar "{btn.name}"?
        </div>
        <div className="text-sm text-mute leading-relaxed mb-4">
          {btn.channel === 'WHATSAPP' && 'Se abrirá WhatsApp con el mensaje precargado.'}
          {btn.channel === 'SMS' && 'Se enviará un SMS al contacto (próximamente integrado con Grow Business).'}
          {btn.channel === 'EMAIL' && 'Se enviará un email (próximamente).'}
          {btn.channel === 'NOTE' && 'Se aplicarán los cambios sin enviar mensaje.'}
          {btn.moveToStage && (
            <div className="mt-1">
              También se moverá a <strong>{btn.moveToStage.name}</strong>.
            </div>
          )}
          {btn.addTags.length > 0 && (
            <div className="mt-1">
              Etiquetas: {btn.addTags.map((t) => `[${t}]`).join(' ')}.
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onCancel} disabled={executing}>
            Cancelar
          </button>
          <button
            className="btn-primary"
            onClick={onConfirm}
            disabled={executing}
            style={{ background: btn.color }}
          >
            {executing ? 'Ejecutando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
//                  MODALES: AGREGAR/EDITAR STAGE
// ============================================================

function AddStageModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#94A3B8');
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api('/crm/stages', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), color }),
      });
      toast('Columna agregada', 'success');
      onCreated();
    } catch (err: any) {
      toast(err?.message || 'No se pudo crear', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="Nueva columna" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label">Nombre</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="Ej: Propuesta enviada"
          />
        </div>
        <div>
          <label className="label">Color</label>
          <input
            type="color"
            className="w-16 h-10 rounded-lg border border-line cursor-pointer"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Creando…' : 'Crear columna'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function EditStageModal({
  stage,
  canDelete,
  onClose,
  onSaved,
}: {
  stage: Stage;
  canDelete: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(stage.name);
  const [color, setColor] = useState(stage.color);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api(`/crm/stages/${stage.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, color }),
      });
      toast('Columna actualizada', 'success');
      onSaved();
    } catch (err: any) {
      toast(err?.message || 'No se pudo guardar', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (
      !confirm(
        `¿Borrar la columna "${stage.name}"? Los contactos se moverán a la primera columna.`,
      )
    )
      return;
    try {
      await api(`/crm/stages/${stage.id}`, { method: 'DELETE' });
      toast('Columna borrada', 'success');
      onSaved();
    } catch (err: any) {
      toast(err?.message || 'No se pudo borrar', 'error');
    }
  }

  return (
    <ModalShell title="Editar columna" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="label">Nombre</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Color</label>
          <input
            type="color"
            className="w-16 h-10 rounded-lg border border-line cursor-pointer"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </div>
        <div className="flex items-center justify-between pt-2 flex-wrap gap-2">
          {canDelete ? (
            <button type="button" className="btn-ghost text-bad" onClick={del}>
              Borrar columna
            </button>
          ) : (
            <span className="text-[11px] text-mute">
              No se puede borrar la última columna
            </span>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={save}
              disabled={saving}
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

// ============================================================
//                       MODAL SHELL
// ============================================================

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
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-line">
          <div className="font-semibold">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="text-mute hover:text-ink text-xl leading-none"
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

// ============================================================
//                          UTIL
// ============================================================

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days}d`;
  return new Date(iso).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
  });
}
