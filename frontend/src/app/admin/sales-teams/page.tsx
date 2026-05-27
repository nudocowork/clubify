'use client';

/**
 * Super admin: gestión de Equipos de Ventas (C4).
 *
 * Lista equipos · crear/editar/borrar · gestionar miembros (agregar/quitar).
 * Cada equipo es agrupación administrativa de afiliados — NO comparten
 * pipeline ni contactos (decisión confirmada por el user). El uso real
 * del equipo (métricas agregadas, top equipos) llega en C8.
 */

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type User = {
  id: string;
  fullName: string;
  email: string;
  role?: string;
};

type Team = {
  id: string;
  name: string;
  leadUser: User | null;
  memberCount: number;
  createdAt: string;
};

type Member = {
  id: string;
  userId: string;
  joinedAt: string;
  user: User;
};

type TeamDetail = {
  id: string;
  name: string;
  leadUser: User | null;
  members: Member[];
  createdAt: string;
};

export default function SalesTeamsPage() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      const t = await api<Team[]>('/admin/sales-teams');
      setTeams(t);
    } catch (e: any) {
      toast(e?.message || 'Error cargando equipos', 'error');
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (!teams) {
    return (
      <div className="space-y-3">
        <div className="h-10 bg-bg2 rounded animate-shimmer" />
        <div className="h-32 bg-bg2 rounded animate-shimmer" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="page-head">
        <h1 className="page-title">Equipos de Ventas</h1>
        <button className="btn-primary text-sm" onClick={() => setCreating(true)}>
          ＋ Nuevo equipo
        </button>
      </div>

      {teams.length === 0 ? (
        <div className="card card-pad text-center text-mute py-12">
          <div className="text-3xl mb-2">👥</div>
          <div className="font-semibold mb-1">Aún no hay equipos</div>
          <div className="text-sm">
            Creá un equipo para agrupar afiliados (Equipo Colombia, Equipo
            Closers, etc.).
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {teams.map((t) => (
            <button
              key={t.id}
              onClick={() => setEditingId(t.id)}
              className="card card-pad text-left hover:border-ink/30 transition group"
            >
              <div className="font-semibold mb-1">{t.name}</div>
              <div className="text-xs text-mute">
                {t.memberCount} miembro{t.memberCount === 1 ? '' : 's'}
              </div>
              {t.leadUser ? (
                <div className="text-xs text-mute mt-1">
                  Lead: {t.leadUser.fullName}
                </div>
              ) : (
                <div className="text-xs text-mute/60 mt-1">Sin lead</div>
              )}
            </button>
          ))}
        </div>
      )}

      {creating && (
        <TeamFormModal
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await load();
          }}
        />
      )}

      {editingId && (
        <TeamDetailModal
          teamId={editingId}
          onClose={() => setEditingId(null)}
          onChanged={load}
          onDeleted={async () => {
            setEditingId(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

// ============================================================
//                   MODAL: CREAR EQUIPO
// ============================================================

function TeamFormModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [leadUserId, setLeadUserId] = useState('');
  const [eligibleUsers, setEligibleUsers] = useState<User[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<User[]>('/admin/sales-teams/eligible-users')
      .then(setEligibleUsers)
      .catch(() => setEligibleUsers([]));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api('/admin/sales-teams', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          leadUserId: leadUserId || null,
        }),
      });
      toast('Equipo creado', 'success');
      onSaved();
    } catch (err: any) {
      toast(err?.message || 'No se pudo crear', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="Nuevo equipo" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label">Nombre del equipo</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Equipo Colombia"
            autoFocus
            maxLength={80}
          />
        </div>
        <div>
          <label className="label">
            Lead del equipo <span className="text-mute font-normal">— opcional</span>
          </label>
          <select
            className="input"
            value={leadUserId}
            onChange={(e) => setLeadUserId(e.target.value)}
          >
            <option value="">— Sin lead —</option>
            {eligibleUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName} · {u.email}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-mute mt-1">
            El lead va a poder ver métricas agregadas del equipo. Podés
            cambiarlo después.
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Creando…' : 'Crear equipo'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ============================================================
//             MODAL: DETALLE / EDITAR EQUIPO
// ============================================================

function TeamDetailModal({
  teamId,
  onClose,
  onChanged,
  onDeleted,
}: {
  teamId: string;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [eligible, setEligible] = useState<User[]>([]);
  const [name, setName] = useState('');
  const [leadUserId, setLeadUserId] = useState('');
  const [addUserId, setAddUserId] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    const [t, el] = await Promise.all([
      api<TeamDetail>(`/admin/sales-teams/${teamId}`),
      api<User[]>(`/admin/sales-teams/eligible-users?teamId=${teamId}`),
    ]);
    setTeam(t);
    setName(t.name);
    setLeadUserId(t.leadUser?.id ?? '');
    setEligible(el);
  }

  useEffect(() => {
    load();
  }, [teamId]);

  async function save() {
    if (!team || !name.trim()) return;
    setSaving(true);
    try {
      await api(`/admin/sales-teams/${team.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim(),
          leadUserId: leadUserId || null,
        }),
      });
      toast('Equipo actualizado', 'success');
      await load();
      onChanged();
    } catch (err: any) {
      toast(err?.message || 'No se pudo guardar', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!team) return;
    if (
      !confirm(
        `¿Borrar el equipo "${team.name}"? Los miembros NO se borran, solo se quitan del equipo.`,
      )
    )
      return;
    try {
      await api(`/admin/sales-teams/${team.id}`, { method: 'DELETE' });
      toast('Equipo borrado', 'success');
      onDeleted();
    } catch (err: any) {
      toast(err?.message || 'No se pudo borrar', 'error');
    }
  }

  async function addMember() {
    if (!team || !addUserId) return;
    try {
      await api(`/admin/sales-teams/${team.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ userId: addUserId }),
      });
      setAddUserId('');
      await load();
      onChanged();
    } catch (err: any) {
      toast(err?.message || 'No se pudo agregar', 'error');
    }
  }

  async function removeMember(userId: string, userName: string) {
    if (!team) return;
    if (!confirm(`¿Quitar a "${userName}" del equipo?`)) return;
    try {
      await api(`/admin/sales-teams/${team.id}/members/${userId}`, {
        method: 'DELETE',
      });
      await load();
      onChanged();
    } catch (err: any) {
      toast(err?.message || 'No se pudo quitar', 'error');
    }
  }

  return (
    <ModalShell title={team?.name ?? 'Equipo'} onClose={onClose} wide>
      {!team ? (
        <div className="text-mute text-sm">Cargando…</div>
      ) : (
        <div className="space-y-5">
          {/* Edición de campos */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Nombre</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
              />
            </div>
            <div>
              <label className="label">Lead</label>
              <select
                className="input"
                value={leadUserId}
                onChange={(e) => setLeadUserId(e.target.value)}
              >
                <option value="">— Sin lead —</option>
                {/* Mostramos el lead actual + miembros eligible. Si el
                    lead no está en eligible (raro pero posible si fue
                    asignado fuera del flow) lo incluimos manualmente. */}
                {team.leadUser && (
                  <option value={team.leadUser.id}>
                    {team.leadUser.fullName} (actual)
                  </option>
                )}
                {eligible
                  .filter((u) => u.id !== team.leadUser?.id)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName} · {u.email}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {/* Miembros */}
          <div>
            <h3 className="font-semibold text-sm mb-2">
              Miembros ({team.members.length})
            </h3>
            <div className="space-y-1.5">
              {team.members.length === 0 && (
                <div className="text-xs text-mute italic">
                  Aún no hay miembros en este equipo.
                </div>
              )}
              {team.members.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-line"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {m.user.fullName}
                    </div>
                    <div className="text-[11px] text-mute truncate">
                      {m.user.email} · {m.user.role}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeMember(m.userId, m.user.fullName)}
                    className="text-bad text-xs hover:underline whitespace-nowrap"
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-3 flex-wrap">
              <select
                className="input flex-1 min-w-[200px]"
                value={addUserId}
                onChange={(e) => setAddUserId(e.target.value)}
              >
                <option value="">— Elegí un afiliado —</option>
                {eligible.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName} · {u.email}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-primary"
                onClick={addMember}
                disabled={!addUserId}
              >
                Agregar
              </button>
            </div>
          </div>

          {/* Footer actions */}
          <div className="flex items-center justify-between pt-2 flex-wrap gap-2 border-t border-line">
            <button type="button" className="btn-ghost text-bad" onClick={del}>
              Borrar equipo
            </button>
            <div className="flex gap-2">
              <button type="button" className="btn-ghost" onClick={onClose}>
                Cerrar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={save}
                disabled={saving}
              >
                {saving ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}
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
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
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
        className={`bg-white shadow-2xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-xl`}
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
