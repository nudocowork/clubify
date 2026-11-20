'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api, getUser } from '@/lib/api';
import { PanelHeader } from '@/components/PanelHeader';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { SECCIONES_DEL_EQUIPO } from '@/lib/permisos-de-equipo';

type Rol = 'TENANT_OWNER' | 'TENANT_STAFF' | 'TENANT_ORDERS' | 'TENANT_CUSTOM';

/** Nombres de las secciones marcadas, en el orden del catálogo. */
function nombresDeSecciones(permisos: string[] | undefined) {
  return SECCIONES_DEL_EQUIPO.filter((x) => permisos?.includes(x.clave)).map((x) => x.nombre);
}

/**
 * Casillas del rol «Personalizado»: lo que se marca es lo único que verá el
 * miembro en el panel (y lo único que el backend le deja usar).
 */
function CasillasDeSecciones({
  valor,
  onChange,
}: {
  valor: string[];
  onChange: (v: string[]) => void;
}) {
  const alternar = (clave: string) =>
    onChange(valor.includes(clave) ? valor.filter((x) => x !== clave) : [...valor, clave]);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {SECCIONES_DEL_EQUIPO.map((sec) => (
        <label
          key={sec.clave}
          className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 cursor-pointer ${
            valor.includes(sec.clave) ? 'border-brand bg-brand-soft' : 'border-line2'
          }`}
        >
          <input
            type="checkbox"
            className="mt-0.5"
            checked={valor.includes(sec.clave)}
            onChange={() => alternar(sec.clave)}
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium">{sec.nombre}</span>
            <span className="block text-[11px] text-mute">{sec.detalle}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

type Staff = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: Rol;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  locationId: string | null;
  location: { id: string; name: string } | null;
  permisos?: string[];
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
  const t = useTranslations('app_staff');
  const tc = useTranslations('common');
  const me = typeof window !== 'undefined' ? getUser() : null;
  const [list, setList] = useState<Staff[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [metrics, setMetrics] = useState<StaffMetrics | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    role: 'TENANT_STAFF' as Rol,
    locationId: '' as string,
    permisos: [] as string[],
  });
  // Miembro personalizado cuyas secciones se están editando, y el borrador.
  const [editando, setEditando] = useState<{ id: string; permisos: string[] } | null>(null);
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
      toast(e.message || t('errLoading'), 'error');
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
      toast(t('locationUpdated'), 'success');
      await load();
    } catch (e: any) {
      toast(e.message || t('errChangeLocation'), 'error');
    }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (form.role === 'TENANT_CUSTOM' && form.permisos.length === 0) {
      setErr('Marca al menos una sección para el rol personalizado.');
      return;
    }
    setBusy(true);
    try {
      const body = {
        fullName: form.fullName,
        email: form.email,
        phone: form.phone || undefined,
        role: form.role,
        locationId: form.locationId || null,
        ...(form.role === 'TENANT_CUSTOM' ? { permisos: form.permisos } : {}),
      };
      const r = await api<Staff & { tempPassword: string }>('/tenants/me/staff', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setTempCred({ email: r.email, tempPassword: r.tempPassword });
      setShowInvite(false);
      setForm({ fullName: '', email: '', phone: '', role: 'TENANT_STAFF', locationId: '', permisos: [] });
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
      toast(u.isActive ? t('memberDeactivated') : t('memberActivated'), 'success');
      await load();
    } catch (e: any) {
      toast(e.message || t('errUpdate'), 'error');
    }
  }

  async function changeRole(u: Staff, role: Rol) {
    // A «Personalizado» se pasa eligiendo sus secciones: hasta guardar, sigue
    // con su rol de antes (y sin ver nada nuevo).
    if (role === 'TENANT_CUSTOM') {
      setEditando({ id: u.id, permisos: u.role === 'TENANT_CUSTOM' ? u.permisos ?? [] : [] });
      return;
    }
    try {
      await api(`/tenants/me/staff/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      toast(t('roleUpdated'), 'success');
      if (editando?.id === u.id) setEditando(null);
      await load();
    } catch (e: any) {
      toast(e.message || t('errChangeRole'), 'error');
    }
  }

  async function guardarSecciones() {
    if (!editando) return;
    if (editando.permisos.length === 0) {
      toast('Marca al menos una sección.', 'error');
      return;
    }
    try {
      await api(`/tenants/me/staff/${editando.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: 'TENANT_CUSTOM', permisos: editando.permisos }),
      });
      toast('Secciones guardadas. Las verá la próxima vez que abra el panel.', 'success');
      setEditando(null);
      await load();
    } catch (e: any) {
      toast(e.message || t('errChangeRole'), 'error');
    }
  }

  async function resetPwd(u: Staff) {
    if (!confirm(t('confirmResetPwd', { name: u.fullName }))) return;
    try {
      const r = await api<{ tempPassword: string }>(
        `/tenants/me/staff/${u.id}/reset-password`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      setTempCred({ email: u.email, tempPassword: r.tempPassword });
    } catch (e: any) {
      toast(e.message || t('errResetPwd'), 'error');
    }
  }

  async function remove(u: Staff) {
    if (!confirm(t('confirmRemove', { name: u.fullName }))) return;
    try {
      await api(`/tenants/me/staff/${u.id}`, { method: 'DELETE' });
      toast(t('memberRemoved'), 'success');
      await load();
    } catch (e: any) {
      toast(e.message || t('errRemove'), 'error');
    }
  }

  function copyCred() {
    if (!tempCred) return;
    const text = t('credClipboard', {
      email: tempCred.email,
      password: tempCred.tempPassword,
    });
    navigator.clipboard.writeText(text).catch(() => {});
  }

  const isOwner = me?.role === 'TENANT_OWNER';

  return (
    <div>
      <PanelHeader
        title={t('title')}
        crumb={<>/ {t('peopleCount', { count: list.length })}</>}
        tutorial="equipo"
        actions={
          isOwner ? (
            <button
              className="btn-primary shrink-0 whitespace-nowrap"
              onClick={() => setShowInvite((v) => !v)}
            >
              <Icon name="plus" /> {t('inviteTeam')}
            </button>
          ) : null
        }
      />

      {!isOwner && (
        <div className="card card-pad text-mute mb-4">
          {t.rich('onlyOwnerCanManage', {
            b: (chunks) => <b className="text-ink">{chunks}</b>,
          })}
        </div>
      )}

      {showInvite && isOwner && (
        <form className="card card-pad mb-5" onSubmit={invite}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="label">{t('fullName')}</span>
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
              <span className="label">{t('email')}</span>
              <input
                className="input"
                required
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="label">{t('phoneOptional')}</span>
              <input
                className="input"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="label">{t('role')}</span>
              <select
                className="input"
                value={form.role}
                onChange={(e) =>
                  setForm({ ...form, role: e.target.value as any })
                }
              >
                <option value="TENANT_STAFF">{t('roleStaffDesc')}</option>
                <option value="TENANT_OWNER">{t('roleOwnerDesc')}</option>
                <option value="TENANT_ORDERS">Solo pedidos — solo ve la sección Pedidos</option>
                <option value="TENANT_CUSTOM">Personalizado — solo las secciones que marques</option>
              </select>
            </label>
            <label className="block">
              <span className="label">{t('assignedLocationOptional')}</span>
              <select
                className="input"
                value={form.locationId}
                onChange={(e) =>
                  setForm({ ...form, locationId: e.target.value })
                }
              >
                <option value="">{t('allLocations')}</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <div className="text-[11px] text-mute mt-1">
                {t('locationHint')}
              </div>
            </label>
          </div>
          {form.role === 'TENANT_CUSTOM' && (
            <div className="mt-4">
              <div className="label mb-2">Secciones que verá</div>
              <CasillasDeSecciones
                valor={form.permisos}
                onChange={(permisos) => setForm({ ...form, permisos })}
              />
            </div>
          )}
          {err && (
            <div className="rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink mt-3">
              {err}
            </div>
          )}
          <div className="flex gap-2 mt-4">
            <button className="btn-primary" disabled={busy}>
              {busy ? t('creating') : t('createAndGeneratePwd')}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setShowInvite(false)}
            >
              {tc('cancel')}
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
                {t('shareCredentials')}
              </div>
              <div className="text-sm text-mute mb-2">
                {t('shownOnce')}
              </div>
              <div className="bg-bg2 rounded-lg p-3 font-mono text-sm">
                <div>
                  <span className="text-mute">{t('emailLabel')} </span>
                  {tempCred.email}
                </div>
                <div>
                  <span className="text-mute">{t('passwordLabel')} </span>
                  <strong>{tempCred.tempPassword}</strong>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button className="btn-primary text-xs" onClick={copyCred}>
                  <Icon name="check" /> {t('copy')}
                </button>
                <button
                  className="btn-ghost text-xs"
                  onClick={() => setTempCred(null)}
                >
                  {tc('close')}
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
            <div className="font-semibold text-sm">{t('emptyTitle')}</div>
            <p className="text-xs text-mute mt-1 max-w-md mx-auto">
              {t('emptyDesc')}
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
                  <span className="badge badge-info text-[10px]">{t('you')}</span>
                )}
              </div>
              <div className="text-xs text-mute truncate">{u.email}</div>
              {u.location && (
                <div className="text-[11px] text-mute mt-0.5">
                  📍 {u.location.name}
                </div>
              )}
              {u.role === 'TENANT_CUSTOM' && (
                <div className="text-[11px] text-mute mt-0.5">
                  Ve: {nombresDeSecciones(u.permisos).join(' · ') || 'ninguna sección'}
                </div>
              )}
              {u.lastLoginAt && (
                <div className="text-[11px] text-mute mt-0.5">
                  {t('lastAccess')}{' '}
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
                {u.role === 'TENANT_OWNER'
                  ? t('roleOwner')
                  : u.role === 'TENANT_ORDERS'
                    ? 'Solo pedidos'
                    : u.role === 'TENANT_CUSTOM'
                      ? 'Personalizado'
                      : t('roleStaff')}
              </span>
              <span
                className={`badge ${u.isActive ? 'badge-ok' : 'badge-mute'}`}
              >
                {u.isActive ? t('active') : t('inactive')}
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
                    <option value="TENANT_STAFF">{t('roleStaff')}</option>
                    <option value="TENANT_OWNER">{t('roleOwner')}</option>
                    <option value="TENANT_ORDERS">Solo pedidos</option>
                    <option value="TENANT_CUSTOM">Personalizado</option>
                  </select>
                  {u.role === 'TENANT_CUSTOM' && editando?.id !== u.id && (
                    <button
                      className="btn-link text-xs"
                      onClick={() => setEditando({ id: u.id, permisos: u.permisos ?? [] })}
                    >
                      Secciones
                    </button>
                  )}
                  {locations.length > 0 && (
                    <select
                      className="input text-xs py-1 max-w-[160px]"
                      value={u.locationId ?? ''}
                      onChange={(e) => changeLocation(u, e.target.value)}
                      title={t('assignedLocation')}
                    >
                      <option value="">{t('allLocations')}</option>
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
                    {u.isActive ? t('deactivate') : t('activate')}
                  </button>
                  <button
                    className="btn-link text-xs"
                    onClick={() => resetPwd(u)}
                  >
                    {t('resetPwd')}
                  </button>
                  <button
                    className="text-bad text-xs underline"
                    onClick={() => remove(u)}
                  >
                    {tc('delete')}
                  </button>
                </>
              )}
            </div>
            {editando?.id === u.id && (
              <div className="w-full border-t border-line2 pt-3">
                <div className="label mb-2">Secciones que verá {u.fullName}</div>
                <CasillasDeSecciones
                  valor={editando.permisos}
                  onChange={(permisos) => setEditando({ id: u.id, permisos })}
                />
                <div className="flex gap-2 mt-3">
                  <button className="btn-primary text-xs" onClick={guardarSecciones}>
                    Guardar secciones
                  </button>
                  <button className="btn-ghost text-xs" onClick={() => setEditando(null)}>
                    {tc('cancel')}
                  </button>
                </div>
              </div>
            )}
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
                  {t('stampsByMember')}
                </div>
                <div className="text-[11px] text-mute">
                  {t('last30dStamps', { count: metrics.totalStamps })}
                </div>
              </div>
            </div>
            <div className="divide-y divide-line2">
              {metrics.memberRanking.length === 0 && (
                <div className="px-4 py-6 text-center text-xs text-mute">
                  {t('noStampsLast30d')}
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
                <div className="font-semibold text-sm">{t('stampsByLocation')}</div>
                <div className="text-[11px] text-mute">
                  {t('last30d')}
                </div>
              </div>
            </div>
            <div className="divide-y divide-line2">
              {metrics.locationRanking.length === 0 && (
                <div className="px-4 py-6 text-center text-xs text-mute">
                  {t('noStampsByLocation')}
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
