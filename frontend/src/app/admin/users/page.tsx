'use client';
/**
 * Super Admin · CRUD de usuarios SUPER_ADMIN.
 *
 * El founder agrega aquí a otros miembros del equipo interno (soporte,
 * ventas, ops) que necesitan acceso a /admin/* sin estar vinculados a un
 * tenant. El backend obliga a habilitar 2FA en el primer login del nuevo
 * admin (flow existente).
 */
import { useEffect, useState } from 'react';
import { api, getUser } from '@/lib/api';
import { toast } from '@/components/Toast';

type AdminRole = 'SUPER_ADMIN' | 'MARKETING';

type AdminUser = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: AdminRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  totpEnabledAt: string | null;
};

type CreateResponse = AdminUser & { tempPassword: string };

const ROLE_LABEL: Record<AdminRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  MARKETING: 'Marketing',
};

const ROLE_DESC: Record<AdminRole, string> = {
  SUPER_ADMIN: 'Acceso total al panel /admin.',
  MARKETING:
    'Solo marketing y diseño. Sin acceso a financiero, escáner, crear negocios ni gestionar admins.',
};

export default function AdminUsersPage() {
  const me = getUser();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<{
    fullName: string;
    email: string;
    phone: string;
    password: string;
    role: AdminRole;
  }>({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    role: 'SUPER_ADMIN',
  });
  const [creating, setCreating] = useState(false);
  const [lastCreated, setLastCreated] = useState<CreateResponse | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{
    userId: string;
    tempPassword: string;
  } | null>(null);

  async function load() {
    setLoadErr(null);
    try {
      const r = await api<AdminUser[]>('/admin/users');
      setUsers(r);
    } catch (e: any) {
      setLoadErr(e?.message || 'No se pudieron cargar los administradores');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createForm.fullName.trim() || !createForm.email.trim()) {
      toast('Completá nombre y email', 'error');
      return;
    }
    setCreating(true);
    try {
      const body: any = {
        fullName: createForm.fullName.trim(),
        email: createForm.email.trim().toLowerCase(),
        role: createForm.role,
      };
      if (createForm.phone.trim()) body.phone = createForm.phone.trim();
      if (createForm.password.trim()) body.password = createForm.password.trim();
      const created = await api<CreateResponse>('/admin/users', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setLastCreated(created);
      setShowCreate(false);
      setCreateForm({
        fullName: '',
        email: '',
        phone: '',
        password: '',
        role: 'SUPER_ADMIN',
      });
      await load();
      toast('Administrador creado', 'success');
    } catch (e: any) {
      toast(e?.message || 'No se pudo crear', 'error');
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(u: AdminUser) {
    if (u.id === me?.id && u.isActive) {
      toast('No podés desactivarte a vos mismo', 'error');
      return;
    }
    if (
      !confirm(
        u.isActive
          ? `Desactivar a ${u.fullName}? No va a poder loguearse.`
          : `Reactivar a ${u.fullName}?`,
      )
    )
      return;
    try {
      await api(`/admin/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !u.isActive }),
      });
      await load();
      toast(u.isActive ? 'Desactivado' : 'Reactivado', 'success');
    } catch (e: any) {
      toast(e?.message || 'No se pudo actualizar', 'error');
    }
  }

  async function resetPassword(u: AdminUser) {
    if (
      !confirm(
        `Generar nueva contraseña temporal para ${u.fullName}? La anterior va a dejar de funcionar.`,
      )
    )
      return;
    setResetting(u.id);
    try {
      const r = await api<{ tempPassword: string }>(
        `/admin/users/${u.id}/reset-password`,
        { method: 'POST' },
      );
      setResetResult({ userId: u.id, tempPassword: r.tempPassword });
    } catch (e: any) {
      toast(e?.message || 'No se pudo resetear', 'error');
    } finally {
      setResetting(null);
    }
  }

  async function remove(u: AdminUser) {
    if (u.id === me?.id) {
      toast('No podés eliminarte a vos mismo', 'error');
      return;
    }
    if (
      !confirm(
        `Eliminar definitivamente a ${u.fullName}? Esta acción no se puede deshacer.`,
      )
    )
      return;
    try {
      await api(`/admin/users/${u.id}`, { method: 'DELETE' });
      await load();
      toast('Administrador eliminado', 'success');
    } catch (e: any) {
      toast(e?.message || 'No se pudo eliminar', 'error');
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Administradores{' '}
          <span className="page-crumb">
            / {users?.length ?? 0} con acceso al panel
          </span>
        </h1>
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            className="btn-primary"
            onClick={() => setShowCreate(true)}
          >
            + Nuevo administrador
          </button>
        </div>
      </div>

      <p className="text-sm text-mute mb-4 max-w-2xl leading-relaxed">
        Dos roles disponibles: <strong>SUPER_ADMIN</strong> con acceso total
        al panel /admin, y <strong>MARKETING</strong> con acceso solo a
        marketing y diseño (sin financiero, sin escáner, sin crear negocios).
        El nuevo usuario debe habilitar 2FA en su primer inicio de sesión.
      </p>

      {loadErr && (
        <div className="card card-pad mb-4">
          <div className="text-sm text-bad-ink">{loadErr}</div>
          <button onClick={load} className="btn-ghost text-sm mt-2">
            Reintentar
          </button>
        </div>
      )}

      {lastCreated && (
        <div className="card card-pad mb-4 bg-ok-soft border-ok/20">
          <div className="text-sm font-semibold text-ok-ink mb-1">
            ✅ Administrador creado
          </div>
          <div className="text-xs text-mute mb-2">
            Compartí estas credenciales por canal seguro (Slack/WhatsApp). No
            se vuelven a mostrar.
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <div>
              <div className="text-[11px] text-mute uppercase">Email</div>
              <div className="font-mono">{lastCreated.email}</div>
            </div>
            <div>
              <div className="text-[11px] text-mute uppercase">
                Contraseña temporal
              </div>
              <div className="font-mono">{lastCreated.tempPassword}</div>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard
                  .writeText(
                    `Email: ${lastCreated.email}\nContraseña temporal: ${lastCreated.tempPassword}`,
                  )
                  .then(() => toast('Copiado al portapapeles', 'success'));
              }}
              className="btn-ghost text-xs"
            >
              Copiar credenciales
            </button>
            <button
              type="button"
              onClick={() => setLastCreated(null)}
              className="btn-ghost text-xs"
            >
              Listo, ocultar
            </button>
          </div>
        </div>
      )}

      {resetResult && (
        <div className="card card-pad mb-4 bg-amber-50 border border-amber-200">
          <div className="text-sm font-semibold text-amber-900 mb-1">
            🔑 Contraseña reseteada
          </div>
          <div className="text-xs text-mute mb-2">
            Compartila por canal seguro. La contraseña anterior ya no funciona.
          </div>
          <div className="text-sm">
            <span className="text-[11px] text-mute uppercase block">
              Nueva contraseña
            </span>
            <span className="font-mono">{resetResult.tempPassword}</span>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard
                  .writeText(resetResult.tempPassword)
                  .then(() => toast('Copiada', 'success'));
              }}
              className="btn-ghost text-xs"
            >
              Copiar
            </button>
            <button
              type="button"
              onClick={() => setResetResult(null)}
              className="btn-ghost text-xs"
            >
              Ocultar
            </button>
          </div>
        </div>
      )}

      {users && users.length === 0 && (
        <div className="card card-pad text-center text-mute">
          No hay administradores cargados.
        </div>
      )}

      {users && users.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg2/40">
              <tr className="text-left">
                <th className="px-4 py-3 font-semibold">Nombre</th>
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold">Rol</th>
                <th className="px-4 py-3 font-semibold">2FA</th>
                <th className="px-4 py-3 font-semibold">Último login</th>
                <th className="px-4 py-3 font-semibold">Estado</th>
                <th className="px-4 py-3 font-semibold text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isMe = u.id === me?.id;
                return (
                  <tr key={u.id} className="border-t border-line">
                    <td className="px-4 py-3">
                      {u.fullName}
                      {isMe && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-brand font-semibold">
                          vos
                        </span>
                      )}
                      {u.phone && (
                        <div className="text-[11px] text-mute mt-0.5">
                          {u.phone}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{u.email}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          'text-xs px-2 py-0.5 rounded-pill ' +
                          (u.role === 'MARKETING'
                            ? 'bg-violet-50 text-violet-700 border border-violet-200'
                            : 'bg-brand-soft text-brand-ink')
                        }
                      >
                        {ROLE_LABEL[u.role]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {u.totpEnabledAt ? (
                        <span className="text-ok text-xs">✓ Activo</span>
                      ) : (
                        <span className="text-amber-600 text-xs">
                          Pendiente
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-mute">
                      {u.lastLoginAt
                        ? new Date(u.lastLoginAt).toLocaleString('es-CO', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Nunca'}
                    </td>
                    <td className="px-4 py-3">
                      {u.isActive ? (
                        <span className="text-xs px-2 py-0.5 rounded-pill bg-ok-soft text-ok">
                          Activo
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-pill bg-bg2 text-mute">
                          Inactivo
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 justify-end flex-wrap">
                        <button
                          type="button"
                          onClick={() => resetPassword(u)}
                          disabled={resetting === u.id}
                          className="btn-ghost text-xs"
                          title="Generar nueva contraseña temporal"
                        >
                          {resetting === u.id ? '…' : '🔑 Reset'}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleActive(u)}
                          disabled={isMe && u.isActive}
                          className="btn-ghost text-xs disabled:opacity-40"
                        >
                          {u.isActive ? 'Desactivar' : 'Reactivar'}
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(u)}
                          disabled={isMe}
                          className="btn-ghost text-xs text-bad-ink disabled:opacity-40"
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCreate(false);
          }}
        >
          <form
            onSubmit={handleCreate}
            className="card card-pad max-w-md w-full"
          >
            <h2 className="text-base font-semibold mb-1">
              Nuevo administrador
            </h2>
            <p className="text-xs text-mute mb-4 leading-relaxed">
              El nuevo usuario va a tener que habilitar 2FA en su primer
              login.
            </p>
            <div className="grid gap-3">
              <div>
                <label className="label">Rol</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(['SUPER_ADMIN', 'MARKETING'] as AdminRole[]).map((r) => {
                    const active = createForm.role === r;
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setCreateForm({ ...createForm, role: r })}
                        className={
                          'text-left rounded-md border p-3 transition ' +
                          (active
                            ? 'border-brand bg-brand-soft'
                            : 'border-line hover:border-brand/40')
                        }
                      >
                        <div className="text-sm font-semibold">
                          {ROLE_LABEL[r]}
                        </div>
                        <div className="text-[11px] text-mute mt-1 leading-snug">
                          {ROLE_DESC[r]}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="label">Nombre completo</label>
                <input
                  className="input"
                  required
                  value={createForm.fullName}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, fullName: e.target.value })
                  }
                  placeholder="Ej: María García"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="label">Email</label>
                <input
                  className="input"
                  type="email"
                  required
                  value={createForm.email}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, email: e.target.value })
                  }
                  placeholder="usuario@equipo.com"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="label">Teléfono (opcional)</label>
                <input
                  className="input"
                  value={createForm.phone}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, phone: e.target.value })
                  }
                  placeholder="+57 300 000 0000"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="label">
                  Contraseña inicial (opcional)
                </label>
                <input
                  className="input font-mono"
                  type="text"
                  value={createForm.password}
                  onChange={(e) =>
                    setCreateForm({ ...createForm, password: e.target.value })
                  }
                  placeholder="Si la dejás vacía, generamos una"
                  minLength={8}
                  autoComplete="new-password"
                />
                <p className="text-[11px] text-mute mt-1">
                  Mínimo 8 caracteres. Si la dejás vacía, generamos una
                  contraseña aleatoria de 10 chars y te la mostramos una sola
                  vez.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="btn-ghost"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={creating}
                className="btn-primary"
              >
                {creating ? 'Creando…' : 'Crear administrador'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
