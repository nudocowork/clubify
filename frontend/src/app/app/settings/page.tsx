'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
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

type TenantMe = {
  id: string;
  brandName: string;
  whatsappPhone: string | null;
  whatsappOrdersPhone: string | null;
  whatsappDeliveryPhone: string | null;
  mainSectionLabelOverride: string | null;
  businessCategorySlug: string | null;
  plan?: { name: string } | null;
};

type MainSectionMode = 'menu' | 'services' | 'custom';

function detectMainMode(override: string | null): {
  mode: MainSectionMode;
  custom: string;
} {
  if (!override) return { mode: 'menu', custom: '' };
  if (override === 'Servicios') return { mode: 'services', custom: '' };
  if (override === 'Menú') return { mode: 'menu', custom: '' };
  return { mode: 'custom', custom: override };
}

export default function SettingsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Profile | null>(null);
  const [profile, setProfile] = useState({ fullName: '', email: '', phone: '' });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' });
  const [savingPwd, setSavingPwd] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [tenant, setTenant] = useState<TenantMe | null>(null);
  const [waForm, setWaForm] = useState({ ordersPhone: '', deliveryPhone: '' });
  const [savingWa, setSavingWa] = useState(false);
  const [waMsg, setWaMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [sectionMode, setSectionMode] = useState<MainSectionMode>('menu');
  const [sectionCustom, setSectionCustom] = useState<string>('');
  const [savingSection, setSavingSection] = useState(false);
  const [sectionMsg, setSectionMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api<Profile>('/users/me').then((u) => {
      setMe(u);
      setProfile({
        fullName: u.fullName || '',
        email: u.email || '',
        phone: u.phone || '',
      });
    });
    api<TenantMe>('/tenants/me')
      .then((t) => {
        setTenant(t);
        setWaForm({
          ordersPhone: t.whatsappOrdersPhone ?? '',
          deliveryPhone: t.whatsappDeliveryPhone ?? '',
        });
        const { mode, custom } = detectMainMode(t.mainSectionLabelOverride);
        setSectionMode(mode);
        setSectionCustom(custom);
      })
      .catch(() => null);
  }, []);

  async function saveSectionLabel(e: React.FormEvent) {
    e.preventDefault();
    setSectionMsg(null);
    // Resolución del valor a persistir según el modo elegido.
    let override: string | null = null;
    if (sectionMode === 'services') {
      override = 'Servicios';
    } else if (sectionMode === 'custom') {
      const trimmed = sectionCustom.trim();
      if (!trimmed) {
        setSectionMsg({
          ok: false,
          text: 'Escribí el nombre personalizado o elegí otra opción',
        });
        return;
      }
      if (trimmed.length > 24) {
        setSectionMsg({
          ok: false,
          text: 'Máximo 24 caracteres',
        });
        return;
      }
      override = trimmed;
    } else {
      // mode === 'menu' → guardamos null para que use el fallback
      // (categoría o "Menú" duro). Mantiene la columna limpia.
      override = null;
    }
    setSavingSection(true);
    try {
      const updated = await api<TenantMe>('/tenants/me', {
        method: 'PATCH',
        body: JSON.stringify({ mainSectionLabelOverride: override }),
      });
      setTenant(updated);
      // Invalidar caché del hook para que sidebar + admin se refresquen
      // al recargar la próxima ruta. Import lazy para no acoplar el bundle.
      import('@/lib/useMainSectionLabel').then((m) =>
        m.invalidateMainSectionLabel(),
      );
      setSectionMsg({
        ok: true,
        text: 'Nombre actualizado. Recargá para verlo en todo el panel.',
      });
    } catch (err: any) {
      setSectionMsg({
        ok: false,
        text: err?.message || 'No se pudo guardar',
      });
    } finally {
      setSavingSection(false);
    }
  }

  async function saveWhatsapp(e: React.FormEvent) {
    e.preventDefault();
    setWaMsg(null);
    setSavingWa(true);
    try {
      const updated = await api<TenantMe>('/tenants/me', {
        method: 'PATCH',
        body: JSON.stringify({
          whatsappOrdersPhone: waForm.ordersPhone.trim() || null,
          whatsappDeliveryPhone: waForm.deliveryPhone.trim() || null,
        }),
      });
      setTenant(updated);
      setWaMsg({ ok: true, text: 'Números actualizados' });
    } catch (e: any) {
      setWaMsg({ ok: false, text: e.message || 'No se pudo actualizar' });
    } finally {
      setSavingWa(false);
    }
  }

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

      {/* Mensajería de WhatsApp */}
      <div className="card card-pad mb-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-base font-semibold m-0 flex items-center gap-2">
              💬 Mensajería de WhatsApp
            </h2>
            <p className="text-xs text-mute mt-1 leading-relaxed">
              Configura los dos números que enrutan tus pedidos: dónde reciben
              tus clientes el pedido inicial y dónde despachas a domicilio.
            </p>
          </div>
        </div>

          <form onSubmit={saveWhatsapp} className="mt-4 grid gap-3">
            <div>
              <label className="label flex items-center gap-1.5">
                <span>🍽 Pedido a Negocio (caja)</span>
              </label>
              <input
                className="input"
                placeholder="+57 300 000 0000"
                value={waForm.ordersPhone}
                onChange={(e) =>
                  setWaForm({ ...waForm, ordersPhone: e.target.value })
                }
              />
              <p className="text-[11px] text-mute mt-1 leading-relaxed">
                Cuando un cliente envía su pedido desde el menú (mesa o
                delivery), el wa.me se abre a este número. Si lo dejas vacío,
                usa el WhatsApp principal del negocio.
              </p>
            </div>

            <div>
              <label className="label flex items-center gap-1.5">
                <span>🛵 Negocio a Domicilio (courier)</span>
              </label>
              <input
                className="input"
                placeholder="+57 300 000 0000"
                value={waForm.deliveryPhone}
                onChange={(e) =>
                  setWaForm({ ...waForm, deliveryPhone: e.target.value })
                }
              />
              <p className="text-[11px] text-mute mt-1 leading-relaxed">
                Cuando aceptes el pago de un pedido de domicilio en{' '}
                <Link href="/app/orders" className="underline">
                  /app/orders
                </Link>
                , se abre un wa.me a este número con el resumen + dirección
                listo para despachar al motorizado.
              </p>
            </div>

            {waMsg && (
              <div
                className={`text-sm rounded-lg px-3 py-2 ${
                  waMsg.ok ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad-ink'
                }`}
              >
                {waMsg.text}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingWa}
                className="btn-primary text-sm"
              >
                {savingWa ? 'Guardando…' : 'Guardar números'}
              </button>
            </div>
          </form>
      </div>

      {/* Nombre de sección principal */}
      <div className="card card-pad mb-4">
        <h2 className="text-base font-semibold m-0 flex items-center gap-2">
          🏷 Nombre de sección principal
        </h2>
        <p className="text-xs text-mute mt-1 leading-relaxed">
          Cambia cómo aparece la palabra "Menú" en tu panel y en la vista
          pública. Útil si vendés servicios (peluquería, autolavado, spa) o
          tenés algo distinto a una carta tradicional (tratamientos, planes,
          paquetes, etc.).
        </p>
        <form onSubmit={saveSectionLabel} className="mt-4 grid gap-3">
          <div>
            <label className="label">Opción</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(
                [
                  { v: 'menu', emoji: '🍽', label: 'Menú', hint: 'Por defecto' },
                  { v: 'services', emoji: '🛠', label: 'Servicios', hint: 'Peluquerías, spas, autolavados' },
                  { v: 'custom', emoji: '✏️', label: 'Personalizado', hint: 'Tratamientos, Catálogo, etc.' },
                ] as const
              ).map((opt) => {
                const active = sectionMode === opt.v;
                return (
                  <button
                    type="button"
                    key={opt.v}
                    onClick={() => setSectionMode(opt.v)}
                    className={`text-left rounded-input border-2 p-2.5 transition ${
                      active
                        ? 'border-brand bg-brand-soft'
                        : 'border-line bg-white hover:border-brand/40'
                    }`}
                  >
                    <div className="text-lg mb-0.5">{opt.emoji}</div>
                    <div className="text-sm font-semibold">{opt.label}</div>
                    <div className="text-[11px] text-mute">{opt.hint}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {sectionMode === 'custom' && (
            <div>
              <label className="label">Nombre personalizado</label>
              <input
                className="input max-w-xs"
                placeholder="Ej: Tratamientos, Catálogo, Paquetes…"
                value={sectionCustom}
                onChange={(e) => setSectionCustom(e.target.value.slice(0, 24))}
                maxLength={24}
              />
              <p className="text-[11px] text-mute mt-1">
                Máximo 24 caracteres. Vas a verlo en sidebar, botones, QR,
                tabs públicos y títulos.
              </p>
            </div>
          )}

          {sectionMsg && (
            <div
              className={`text-sm rounded-lg px-3 py-2 ${
                sectionMsg.ok ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad-ink'
              }`}
            >
              {sectionMsg.text}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingSection}
              className="btn-primary text-sm"
            >
              {savingSection ? 'Guardando…' : 'Guardar nombre'}
            </button>
          </div>
        </form>
      </div>

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
