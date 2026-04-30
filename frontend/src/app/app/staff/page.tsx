'use client';
import { useEffect, useState } from 'react';
import { api, getUser } from '@/lib/api';
import { Icon } from '@/components/Icon';

type Staff = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: 'TENANT_OWNER' | 'TENANT_STAFF';
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

function avatarClass(seed: string) {
  const sum = seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return `avatar-${(sum % 7) + 1}`;
}
function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

export default function StaffPage() {
  const me = typeof window !== 'undefined' ? getUser() : null;
  const [list, setList] = useState<Staff[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    role: 'TENANT_STAFF' as 'TENANT_OWNER' | 'TENANT_STAFF',
  });
  const [busy, setBusy] = useState(false);
  const [tempCred, setTempCred] = useState<{
    email: string;
    tempPassword: string;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setList(await api<Staff[]>('/tenants/me/staff'));
  }
  useEffect(() => {
    load();
  }, []);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await api<Staff & { tempPassword: string }>('/tenants/me/staff', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setTempCred({ email: r.email, tempPassword: r.tempPassword });
      setShowInvite(false);
      setForm({ fullName: '', email: '', phone: '', role: 'TENANT_STAFF' });
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(u: Staff) {
    await api(`/tenants/me/staff/${u.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !u.isActive }),
    });
    await load();
  }

  async function changeRole(u: Staff, role: 'TENANT_OWNER' | 'TENANT_STAFF') {
    await api(`/tenants/me/staff/${u.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
    await load();
  }

  async function resetPwd(u: Staff) {
    if (!confirm(`¿Generar contraseña temporal para ${u.fullName}?`)) return;
    const r = await api<{ tempPassword: string }>(
      `/tenants/me/staff/${u.id}/reset-password`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    setTempCred({ email: u.email, tempPassword: r.tempPassword });
  }

  async function remove(u: Staff) {
    if (!confirm(`¿Eliminar a ${u.fullName}? Esta acción es permanente.`)) return;
    await api(`/tenants/me/staff/${u.id}`, { method: 'DELETE' });
    await load();
  }

  function copyCred() {
    if (!tempCred) return;
    const text = `Inicia sesión en Clubify\nEmail: ${tempCred.email}\nContraseña temporal: ${tempCred.tempPassword}`;
    navigator.clipboard.writeText(text).catch(() => {});
  }

  const isOwner = me?.role === 'TENANT_OWNER';

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Empleados{' '}
          <span className="page-crumb">
            / {list.length} {list.length === 1 ? 'persona' : 'personas'}
          </span>
        </h1>
        {isOwner && (
          <button
            className="btn-primary"
            onClick={() => setShowInvite((v) => !v)}
          >
            <Icon name="plus" /> Invitar empleado
          </button>
        )}
      </div>

      {!isOwner && (
        <div className="card card-pad text-mute mb-4">
          Solo el propietario puede gestionar el equipo. Pídele a quien tenga rol
          <b> TENANT_OWNER</b> que te invite o cambie tus permisos.
        </div>
      )}

      {showInvite && isOwner && (
        <form className="card card-pad mb-5" onSubmit={invite}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="label">Nombre completo</span>
              <input
                className="input"
                required
                value={form.fullName}
                onChange={(e) =>
                  setForm({ ...form, fullName: e.target.value })
                }
              />
            </label>
            <label className="block">
              <span className="label">Email</span>
              <input
                className="input"
                required
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="label">Teléfono (opcional)</span>
              <input
                className="input"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="label">Rol</span>
              <select
                className="input"
                value={form.role}
                onChange={(e) =>
                  setForm({ ...form, role: e.target.value as any })
                }
              >
                <option value="TENANT_STAFF">Empleado (escanea, ve pedidos)</option>
                <option value="TENANT_OWNER">Propietario (acceso total)</option>
              </select>
            </label>
          </div>
          {err && (
            <div className="rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink mt-3">
              {err}
            </div>
          )}
          <div className="flex gap-2 mt-4">
            <button className="btn-primary" disabled={busy}>
              {busy ? 'Creando…' : 'Crear y generar contraseña'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setShowInvite(false)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {tempCred && (
        <div className="card card-pad mb-5 border-2 border-brand">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-brand-soft flex items-center justify-center flex-none">
              <Icon name="check" />
            </div>
            <div className="flex-1">
              <div className="font-semibold mb-1">
                Comparte estas credenciales por WhatsApp
              </div>
              <div className="text-sm text-mute mb-2">
                Solo se muestran una vez. El empleado podrá cambiarlas al ingresar.
              </div>
              <div className="bg-bg2 rounded-lg p-3 font-mono text-sm">
                <div>
                  <span className="text-mute">Email: </span>
                  {tempCred.email}
                </div>
                <div>
                  <span className="text-mute">Contraseña: </span>
                  <strong>{tempCred.tempPassword}</strong>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button className="btn-primary text-xs" onClick={copyCred}>
                  <Icon name="check" /> Copiar
                </button>
                <button
                  className="btn-ghost text-xs"
                  onClick={() => setTempCred(null)}
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-2.5">
        {list.map((u) => (
          <div
            key={u.id}
            className="card card-pad flex items-center gap-4 flex-wrap"
          >
            <div
              className={`avatar w-11 h-11 text-sm ${avatarClass(
                u.fullName,
              )}`}
            >
              {initials(u.fullName)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold flex items-center gap-2">
                {u.fullName}
                {u.id === me?.id && (
                  <span className="badge badge-info text-[10px]">Tú</span>
                )}
              </div>
              <div className="text-xs text-mute truncate">{u.email}</div>
              {u.lastLoginAt && (
                <div className="text-[11px] text-mute mt-0.5">
                  Último acceso:{' '}
                  {new Date(u.lastLoginAt).toLocaleString('es-CO')}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`badge ${
                  u.role === 'TENANT_OWNER' ? 'badge-info' : 'badge-mute'
                }`}
              >
                {u.role === 'TENANT_OWNER' ? 'Propietario' : 'Empleado'}
              </span>
              <span
                className={`badge ${u.isActive ? 'badge-ok' : 'badge-mute'}`}
              >
                {u.isActive ? 'Activo' : 'Inactivo'}
              </span>
              {isOwner && u.id !== me?.id && (
                <>
                  <select
                    className="input text-xs py-1 max-w-[140px]"
                    value={u.role}
                    onChange={(e) =>
                      changeRole(u, e.target.value as any)
                    }
                  >
                    <option value="TENANT_STAFF">Empleado</option>
                    <option value="TENANT_OWNER">Propietario</option>
                  </select>
                  <button
                    className="btn-link text-xs"
                    onClick={() => toggleActive(u)}
                  >
                    {u.isActive ? 'Desactivar' : 'Activar'}
                  </button>
                  <button
                    className="btn-link text-xs"
                    onClick={() => resetPwd(u)}
                  >
                    Reset clave
                  </button>
                  <button
                    className="text-bad text-xs underline"
                    onClick={() => remove(u)}
                  >
                    Eliminar
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
