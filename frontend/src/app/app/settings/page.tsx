'use client';
import { useEffect, useState } from 'react';
import { api, downloadFile, getUser, setSession, clearSession } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';

type Profile = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: string;
};

export default function SettingsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Profile | null>(null);
  const [profile, setProfile] = useState({ fullName: '', email: '', phone: '' });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' });
  const [savingPwd, setSavingPwd] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api<Profile>('/users/me').then((u) => {
      setMe(u);
      setProfile({
        fullName: u.fullName || '',
        email: u.email || '',
        phone: u.phone || '',
      });
    });
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileMsg(null);
    setSavingProfile(true);
    try {
      const updated = await api<Profile>('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({
          fullName: profile.fullName.trim(),
          email: profile.email.trim().toLowerCase(),
          phone: profile.phone.trim() || undefined,
        }),
      });
      setMe(updated);
      // Sync localStorage user
      const u = getUser();
      if (u) {
        localStorage.setItem(
          'clubify_user',
          JSON.stringify({ ...u, email: updated.email, fullName: updated.fullName }),
        );
      }
      setProfileMsg({ ok: true, text: 'Perfil actualizado' });
    } catch (e: any) {
      setProfileMsg({ ok: false, text: e.message || 'No se pudo actualizar' });
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwdMsg(null);
    if (pwd.next.length < 8) {
      setPwdMsg({ ok: false, text: 'La nueva contraseña debe tener al menos 8 caracteres' });
      return;
    }
    if (pwd.next !== pwd.confirm) {
      setPwdMsg({ ok: false, text: 'Las contraseñas no coinciden' });
      return;
    }
    setSavingPwd(true);
    try {
      await api('/users/me/password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: pwd.current,
          newPassword: pwd.next,
        }),
      });
      setPwd({ current: '', next: '', confirm: '' });
      setPwdMsg({ ok: true, text: 'Contraseña actualizada' });
    } catch (e: any) {
      setPwdMsg({ ok: false, text: e.message || 'No se pudo cambiar' });
    } finally {
      setSavingPwd(false);
    }
  }

  function logout() {
    clearSession();
    router.push('/login');
  }

  if (!me) return <div className="text-mute">Cargando…</div>;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="page-head">
        <h1 className="page-title">Mi cuenta</h1>
      </div>

      {/* Perfil */}
      <form onSubmit={saveProfile} className="card card-pad mb-4">
        <h2 className="text-base font-semibold m-0">Datos personales</h2>
        <p className="text-xs text-mute mt-1">Tu información de contacto.</p>
        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <div>
            <label className="label">Nombre completo</label>
            <input
              className="input"
              value={profile.fullName}
              onChange={(e) => setProfile({ ...profile, fullName: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              value={profile.email}
              onChange={(e) => setProfile({ ...profile, email: e.target.value })}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Teléfono (opcional)</label>
            <input
              className="input"
              value={profile.phone}
              onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
              placeholder="+57 300 000 0000"
            />
          </div>
        </div>
        {profileMsg && (
          <div
            className={`mt-3 text-sm rounded-lg px-3 py-2 ${
              profileMsg.ok ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad-ink'
            }`}
          >
            {profileMsg.text}
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <button type="submit" className="btn-primary" disabled={savingProfile}>
            {savingProfile ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>

      {/* Password */}
      <form onSubmit={changePassword} className="card card-pad mb-4">
        <h2 className="text-base font-semibold m-0">Cambiar contraseña</h2>
        <p className="text-xs text-mute mt-1">
          Después de cambiarla seguirás logueado, pero los demás dispositivos van
          a pedir login otra vez.
        </p>
        <div className="grid gap-3 mt-4">
          <div>
            <label className="label">Contraseña actual</label>
            <input
              className="input"
              type="password"
              value={pwd.current}
              onChange={(e) => setPwd({ ...pwd, current: e.target.value })}
              required
              autoComplete="current-password"
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Nueva contraseña</label>
              <input
                className="input"
                type="password"
                value={pwd.next}
                onChange={(e) => setPwd({ ...pwd, next: e.target.value })}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="label">Confirmar nueva</label>
              <input
                className="input"
                type="password"
                value={pwd.confirm}
                onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
          </div>
        </div>
        {pwdMsg && (
          <div
            className={`mt-3 text-sm rounded-lg px-3 py-2 ${
              pwdMsg.ok ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad-ink'
            }`}
          >
            {pwdMsg.text}
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <button type="submit" className="btn-primary" disabled={savingPwd}>
            {savingPwd ? 'Cambiando…' : 'Cambiar contraseña'}
          </button>
        </div>
      </form>

      {/* Export */}
      <div className="card card-pad mb-4">
        <h2 className="text-base font-semibold m-0">Tus datos</h2>
        <p className="text-xs text-mute mt-1">
          Descarga un archivo JSON con todos tus datos (clientes, productos,
          pedidos, tarjetas). Útil para backup o si decides migrar.
        </p>
        <div className="mt-4 flex justify-end">
          <button
            onClick={() =>
              downloadFile(
                '/tenants/me/export',
                `clubify-export-${new Date().toISOString().slice(0, 10)}.json`,
              )
            }
            className="btn-ghost text-sm"
          >
            <Icon name="arrow-right" size={14} /> Descargar mis datos (JSON)
          </button>
        </div>
      </div>

      {/* Sesión */}
      <div className="card card-pad">
        <h2 className="text-base font-semibold m-0">Sesión</h2>
        <p className="text-xs text-mute mt-1">
          Estás logueado como <span className="font-medium text-ink">{me.email}</span>
        </p>
        <div className="mt-4 flex justify-end">
          <button
            onClick={logout}
            className="px-4 py-2 rounded-pill bg-bg2 text-ink text-sm font-semibold hover:bg-line"
          >
            <Icon name="arrow-right" size={14} /> Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}
