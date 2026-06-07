'use client';
import { useEffect, useState } from 'react';
import { api, getUser } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

type Staff = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: 'TENANT_OWNER' | 'TENANT_STAFF';
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  locationId: string | null;
  location: { id: string; name: string } | null;
};

type Location = {
  id: string;
  name: string;
  isActive: boolean;
};

type StaffMetrics = {
  sinceDays: number;
  totalStamps: number;
  memberRanking: Array<{
    userId: string | null;
    fullName: string;
    role: string | null;
    locationId: string | null;
    locationName: string | null;
    stamps: number;
  }>;
  locationRanking: Array<{
    locationId: string | null;
    locationName: string;
    stamps: number;
  }>;
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
  const [locations, setLocations] = useState<Location[]>([]);
  const [metrics, setMetrics] = useState<StaffMetrics | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    role: 'TENANT_STAFF' as 'TENANT_OWNER' | 'TENANT_STAFF',
    locationId: '' as string,
  });
  const [busy, setBusy] = useState(false);
  const [tempCred, setTempCred] = useState<{
    email: string;
    tempPassword: string;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const [staff, locs, m] = await Promise.all([
        api<Staff[]>('/tenants/me/staff'),
        api<Location[]>('/locations').catch(() => []),
        api<StaffMetrics>('/tenants/me/staff/metrics').catch(() => null),
      ]);
      setList(staff);
      setLocations(locs.filter((l) => l.isActive));
      setMetrics(m);
    } catch (e: any) {
      toast(e.message || 'Error cargando empleados', 'error');
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function changeLocation(u: Staff, locationId: string) {
    try {
      await api(`/tenants/me/staff/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ locationId: locationId || null }),
      });
      toast('Sede actualizada', 'success');
      await load();
    } catch (e: any) {
      toast(e.message || 'No se pudo cambiar la sede', 'error');
    }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const body = {
        fullName: form.fullName,
        email: form.email,
        phone: form.phone || undefined,
        role: form.role,
        locationId: form.locationId || null,
      };
      const r = await api<Staff & { tempPassword: string }>('/tenants/me/staff', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setTempCred({ email: r.email, tempPassword: r.tempPassword });
      setShowInvite(false);
      setForm({ fullName: '', email: '', phone: '', role: 'TENANT_STAFF', locationId: '' });
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(u: Staff) {
    try {
      await api(`/tenants/me/staff/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !u.isActive }),
      });
      toast(u.isActive ? 'Miembro desactivado' : 'Miembro activado', 'success');
      await load();
    } catch (e: any) {
      toast(e.message || 'No se pudo actualizar', 'error');
    }
  }

  async function changeRole(u: Staff, role: 'TENANT_OWNER' | 'TENANT_STAFF') {
    try {
      await api(`/tenants/me/staff/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      toast('Rol actualizado', 'success');
      await load();
    } catch (e: any) {
      toast(e.message || 'No se pudo cambiar el rol', 'error');
    }
  }

  async function resetPwd(u: Staff) {
    if (!confirm(`¿Generar contraseña temporal para ${u.fullName}?`)) return;
    try {
      const r = await api<{ tempPassword: string }>(
        `/tenants/me/staff/${u.id}/reset-password`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      setTempCred({ email: u.email, tempPassword: r.tempPassword });
    } catch (e: any) {
      toast(e.message || 'No se pudo resetear la contraseña', 'error');
    }
  }

  async function remove(u: Staff) {
    if (!confirm(`¿Eliminar a ${u.fullName}? Esta acción es permanente.`)) return;
    try {
      await api(`/tenants/me/staff/${u.id}`, { method: 'DELETE' });
      toast('Miembro eliminado', 'success');
      await load();
    } catch (e: any) {
      toast(e.message || 'No se pudo eliminar', 'error');
    }
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
          Equipo de trabajo{' '}
          <span className="page-crumb">
            / {list.length} {list.length === 1 ? 'persona' : 'personas'}
          </span>
        </h1>
        {isOwner && (
          <button
            className="btn-primary"
            onClick={() => setShowInvite((v) => !v)}
          >
            <Icon name="plus" /> Invitar al equipo
          </button>
        )}
      </div>

      {!isOwner && (
        <div className="card card-pad text-mute mb-4">
          Solo el propietario puede gestionar el equipo. Pídele al{' '}
          <b className="text-ink">propietario</b> de la cuenta que te invite o
          actualice tus permisos.
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
                <option value="TENANT_STAFF">Equipo (escanea, ve pedidos)</option>
                <option value="TENANT_OWNER">Propietario (acceso total)</option>
              </select>
            </label>
            <label className="block">
              <span className="label">Sede asignada (opcional)</span>
              <select
                className="input"
                value={form.locationId}
                onChange={(e) =>
                  setForm({ ...form, locationId: e.target.value })
                }
              >
                <option value="">Todas las sedes</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <div className="text-[11px] text-mute mt-1">
                Si elegís una sede, esta persona aparece como operadora de
                esa ubicación en los rankings.
              </div>
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
                Solo se muestran una vez. El miembro del equipo podrá cambiarlas al ingresar.
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
        {list.length === 0 && (
          <div className="card card-pad text-center py-10">
            <div className="text-3xl mb-1">👥</div>
            <div className="font-semibold text-sm">Aún sin equipo</div>
            <p className="text-xs text-mute mt-1 max-w-md mx-auto">
              Invita a tu cajero o staff para que escaneen tarjetas y vean los
              pedidos sin compartir tu contraseña.
            </p>
          </div>
        )}
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
              {u.location && (
                <div className="text-[11px] text-mute mt-0.5">
                  📍 {u.location.name}
                </div>
              )}
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
                {u.role === 'TENANT_OWNER' ? 'Propietario' : 'Equipo'}
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
                    <option value="TENANT_STAFF">Equipo</option>
                    <option value="TENANT_OWNER">Propietario</option>
                  </select>
                  {locations.length > 0 && (
                    <select
                      className="input text-xs py-1 max-w-[160px]"
                      value={u.locationId ?? ''}
                      onChange={(e) => changeLocation(u, e.target.value)}
                      title="Sede asignada"
                    >
                      <option value="">Todas las sedes</option>
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          📍 {l.name}
                        </option>
                      ))}
                    </select>
                  )}
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

      {/* Fase F: rankings de sellos por miembro + por sede (últimos 30d). */}
      {isOwner && metrics && metrics.totalStamps > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-5">
          <div className="card overflow-hidden p-0">
            <div className="px-4 py-3 border-b border-line2 flex items-center justify-between">
              <div>
                <div className="font-semibold text-sm">
                  🏅 Sellos por miembro
                </div>
                <div className="text-[11px] text-mute">
                  Últimos 30 días · {metrics.totalStamps} sellos totales
                </div>
              </div>
            </div>
            <div className="divide-y divide-line2">
              {metrics.memberRanking.length === 0 && (
                <div className="px-4 py-6 text-center text-xs text-mute">
                  Sin sellos en los últimos 30 días.
                </div>
              )}
              {metrics.memberRanking.slice(0, 10).map((r, i) => (
                <div
                  key={r.userId ?? `noop-${i}`}
                  className="px-4 py-2.5 flex items-center gap-3"
                >
                  <div className="w-5 text-center font-bold text-mute text-xs">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {r.fullName}
                    </div>
                    {r.locationName && (
                      <div className="text-[11px] text-mute">
                        📍 {r.locationName}
                      </div>
                    )}
                  </div>
                  <div className="font-bold text-sm">{r.stamps}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card overflow-hidden p-0">
            <div className="px-4 py-3 border-b border-line2 flex items-center justify-between">
              <div>
                <div className="font-semibold text-sm">📍 Sellos por sede</div>
                <div className="text-[11px] text-mute">
                  Últimos 30 días
                </div>
              </div>
            </div>
            <div className="divide-y divide-line2">
              {metrics.locationRanking.length === 0 && (
                <div className="px-4 py-6 text-center text-xs text-mute">
                  Sin sellos por ubicación.
                </div>
              )}
              {metrics.locationRanking.map((r, i) => (
                <div
                  key={r.locationId ?? `noop-${i}`}
                  className="px-4 py-2.5 flex items-center gap-3"
                >
                  <div className="w-5 text-center font-bold text-mute text-xs">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0 text-sm font-medium truncate">
                    {r.locationName}
                  </div>
                  <div className="font-bold text-sm">{r.stamps}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
