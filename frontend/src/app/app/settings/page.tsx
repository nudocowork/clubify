'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, downloadFile, getUser, setSession, clearSession } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { LanguageSwitcherIntl } from '@/components/LanguageSwitcherIntl';

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
  currency?: string;
  maxStampsPerDay?: number | null;
  billingAlertsEnabled?: boolean;
  billingAlertsPhone?: string | null;
  deliveryAlertsEnabled?: boolean;
  deliveryAlertsPhones?: string[] | null;
  deliveryAlertsEvents?: string[] | null;
  plan?: { name: string } | null;
};

type MainSectionMode = 'menu' | 'services' | 'catalog' | 'custom';

/** Lista curada de monedas para LATAM + USD/EUR. Cada entrada es ISO 4217
 *  (`code`), nombre legible (`label`), y país de bandera para visual hint.
 *  Si necesitás agregar una, esta lista es la única fuente de verdad — el
 *  storefront usa `new Intl.NumberFormat(..., { currency: code })` que
 *  resuelve el símbolo automático sin más config. */
const LATAM_CURRENCIES: { code: string; label: string; flag: string }[] = [
  { code: 'COP', label: 'Peso colombiano', flag: '🇨🇴' },
  { code: 'USD', label: 'Dólar estadounidense', flag: '🇺🇸' },
  { code: 'MXN', label: 'Peso mexicano', flag: '🇲🇽' },
  { code: 'ARS', label: 'Peso argentino', flag: '🇦🇷' },
  { code: 'CLP', label: 'Peso chileno', flag: '🇨🇱' },
  { code: 'PEN', label: 'Sol peruano', flag: '🇵🇪' },
  { code: 'BRL', label: 'Real brasileño', flag: '🇧🇷' },
  { code: 'UYU', label: 'Peso uruguayo', flag: '🇺🇾' },
  { code: 'PYG', label: 'Guaraní paraguayo', flag: '🇵🇾' },
  { code: 'BOB', label: 'Boliviano', flag: '🇧🇴' },
  { code: 'VES', label: 'Bolívar venezolano', flag: '🇻🇪' },
  { code: 'DOP', label: 'Peso dominicano', flag: '🇩🇴' },
  { code: 'GTQ', label: 'Quetzal guatemalteco', flag: '🇬🇹' },
  { code: 'HNL', label: 'Lempira hondureño', flag: '🇭🇳' },
  { code: 'NIO', label: 'Córdoba nicaragüense', flag: '🇳🇮' },
  { code: 'CRC', label: 'Colón costarricense', flag: '🇨🇷' },
  { code: 'PAB', label: 'Balboa panameño', flag: '🇵🇦' },
  { code: 'EUR', label: 'Euro', flag: '🇪🇺' },
];

function detectMainMode(override: string | null): {
  mode: MainSectionMode;
  custom: string;
} {
  if (!override) return { mode: 'menu', custom: '' };
  if (override === 'Servicios') return { mode: 'services', custom: '' };
  if (override === 'Catálogo') return { mode: 'catalog', custom: '' };
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

  const [sectionMode, setSectionMode] = useState<MainSectionMode>('menu');
  const [sectionCustom, setSectionCustom] = useState<string>('');
  const [savingSection, setSavingSection] = useState(false);
  const [sectionMsg, setSectionMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [currency, setCurrency] = useState<string>('COP');
  const [savingCurrency, setSavingCurrency] = useState(false);
  const [currencyMsg, setCurrencyMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [maxStampsPerDay, setMaxStampsPerDay] = useState<number>(1);
  const [savingStamps, setSavingStamps] = useState(false);
  const [stampsMsg, setStampsMsg] = useState<{ ok: boolean; text: string } | null>(null);

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
        const { mode, custom } = detectMainMode(t.mainSectionLabelOverride);
        setSectionMode(mode);
        setSectionCustom(custom);
        setCurrency(t.currency ?? 'COP');
        setMaxStampsPerDay(Math.max(1, t.maxStampsPerDay ?? 1));
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
    } else if (sectionMode === 'catalog') {
      override = 'Catálogo';
    } else if (sectionMode === 'custom') {
      const trimmed = sectionCustom.trim();
      if (!trimmed) {
        setSectionMsg({
          ok: false,
          text: 'Escribe el nombre personalizado o elige otra opción',
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
        text: 'Nombre actualizado. Recarga para verlo en todo el panel.',
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

  async function saveStamps(e: React.FormEvent) {
    e.preventDefault();
    setStampsMsg(null);
    setSavingStamps(true);
    try {
      const updated = await api<TenantMe>('/tenants/me', {
        method: 'PATCH',
        body: JSON.stringify({ maxStampsPerDay }),
      });
      setTenant(updated);
      setStampsMsg({
        ok: true,
        text: `Tus clientes pueden recibir hasta ${maxStampsPerDay} sello${maxStampsPerDay === 1 ? '' : 's'} por día.`,
      });
    } catch (e: any) {
      setStampsMsg({ ok: false, text: e.message || 'No se pudo guardar' });
    } finally {
      setSavingStamps(false);
    }
  }

  async function saveCurrency(e: React.FormEvent) {
    e.preventDefault();
    setCurrencyMsg(null);
    setSavingCurrency(true);
    try {
      const updated = await api<TenantMe>('/tenants/me', {
        method: 'PATCH',
        body: JSON.stringify({ currency }),
      });
      setTenant(updated);
      setCurrencyMsg({
        ok: true,
        text: 'Moneda actualizada. Los precios del menú público se mostrarán en esta moneda.',
      });
    } catch (e: any) {
      setCurrencyMsg({ ok: false, text: e.message || 'No se pudo guardar' });
    } finally {
      setSavingCurrency(false);
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

      {/* Idioma — i18n foundation 2026-06-12. El switcher persiste la
          elección en cookie + User.preferredLocale (al estar logueado)
          via POST /api/locale → POST /api/auth/locale. */}
      <section className="card card-pad mb-4">
        <h2 className="text-base font-semibold m-0">Idioma</h2>
        <p className="text-xs text-mute mt-1">
          Aplica al panel y se sincroniza entre tus dispositivos.
        </p>
        <div className="mt-4">
          <LanguageSwitcherIntl variant="panel" />
        </div>
      </section>

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

      {/* Alertas SMS de pago */}
      <BillingAlertsCard tenant={tenant} onSaved={(t) => setTenant(t)} />

      {/* Alertas SMS a empresas de domicilio */}
      <DeliveryAlertsCard tenant={tenant} onSaved={(t) => setTenant(t)} />

      {/* Moneda del menú público */}
      <form onSubmit={saveCurrency} className="card card-pad mb-4">
        <h2 className="text-base font-semibold m-0 flex items-center gap-2">
          💱 Moneda del menú
        </h2>
        <p className="text-xs text-mute mt-1 leading-relaxed">
          La moneda en la que se muestran los precios del menú público (mesa
          y delivery). Cambia el símbolo, separadores y formato automático
          según el código ISO elegido.
        </p>
        <div className="mt-4">
          <label className="label">País / Moneda</label>
          <select
            className="input"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {LATAM_CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.code} — {c.label}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-mute mt-1.5">
            Vista previa:{' '}
            <span className="font-mono text-ink">
              {(() => {
                try {
                  return new Intl.NumberFormat('es-CO', {
                    style: 'currency',
                    currency,
                    maximumFractionDigits: 0,
                  }).format(15000);
                } catch {
                  return `${currency} 15000`;
                }
              })()}
            </span>
          </p>
        </div>
        {currencyMsg && (
          <div
            className={`text-sm rounded-lg px-3 py-2 mt-3 ${
              currencyMsg.ok ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad-ink'
            }`}
          >
            {currencyMsg.text}
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            className="btn-primary"
            disabled={savingCurrency || currency === (tenant?.currency ?? 'COP')}
          >
            {savingCurrency ? 'Guardando…' : 'Guardar moneda'}
          </button>
        </div>
      </form>

      {/* M4: máximo de sellos por día */}
      <form onSubmit={saveStamps} className="card card-pad mb-4">
        <h2 className="text-base font-semibold m-0 flex items-center gap-2">
          🎯 Sellos por día
        </h2>
        <p className="text-xs text-mute mt-1 leading-relaxed">
          Cuántas veces tu cliente puede recibir un sello (o visita) en el
          mismo día. Default 1. Subilo para campañas promocionales —
          cumpleaños, evento, doble sello hoy, etc.
        </p>
        <div className="mt-4 grid sm:grid-cols-4 gap-3 items-end">
          <div className="sm:col-span-1">
            <label className="label">Máximo / día</label>
            <input
              className="input"
              type="number"
              min={1}
              max={20}
              value={maxStampsPerDay}
              onChange={(e) =>
                setMaxStampsPerDay(
                  Math.max(1, Math.min(20, Number(e.target.value) || 1)),
                )
              }
            />
          </div>
          <div className="sm:col-span-3 text-[11px] text-mute leading-relaxed">
            {maxStampsPerDay === 1
              ? 'Comportamiento estándar — 1 sello cada 24 horas por cliente.'
              : `Hasta ${maxStampsPerDay} sellos por cliente cada 24 horas. Después del máximo, el cliente espera al rolling window de 24h.`}
            <br />
            El bypass de SUPER_ADMIN sigue intacto para corregir errores
            manualmente.
          </div>
        </div>
        {stampsMsg && (
          <div
            className={`text-sm rounded-lg px-3 py-2 mt-3 ${
              stampsMsg.ok ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad-ink'
            }`}
          >
            {stampsMsg.text}
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            className="btn-primary"
            disabled={
              savingStamps ||
              maxStampsPerDay === Math.max(1, tenant?.maxStampsPerDay ?? 1)
            }
          >
            {savingStamps ? 'Guardando…' : 'Guardar máximo'}
          </button>
        </div>
      </form>

      {/* Mensajería de WhatsApp: movido a /admin/tenants/[id] (Bloque 8
          2026-06-12). El cliente final ya no la edita — solo SUPER_ADMIN
          desde el panel de administración del negocio. */}

      {/* Nombre de sección principal */}
      <div className="card card-pad mb-4">
        <h2 className="text-base font-semibold m-0 flex items-center gap-2">
          🏷 Nombre de sección principal
        </h2>
        <p className="text-xs text-mute mt-1 leading-relaxed">
          Cambia cómo aparece la palabra "Menú" en tu panel y en la vista
          pública. Útil si vendés servicios (peluquería, autolavado, spa) o
          tienes algo distinto a una carta tradicional (tratamientos, planes,
          paquetes, etc.).
        </p>
        <form onSubmit={saveSectionLabel} className="mt-4 grid gap-3">
          <div>
            <label className="label">Opción</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(
                [
                  { v: 'menu', emoji: '🍽', label: 'Menú', hint: 'Por defecto' },
                  { v: 'services', emoji: '🛠', label: 'Servicios', hint: 'Spas, peluquerías' },
                  { v: 'catalog', emoji: '🛍', label: 'Catálogo', hint: 'Tienda / productos' },
                  { v: 'custom', emoji: '✏️', label: 'Personalizado', hint: 'Tratamientos, Carta…' },
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

/** Card que el owner ve en /app/settings para gestionar las alertas
 *  SMS de pago (recordatorios D-1, impago, suspensión). Toggle global
 *  + override del teléfono destino + botón probar. */
function BillingAlertsCard({
  tenant,
  onSaved,
}: {
  tenant: TenantMe | null;
  onSaved: (t: TenantMe) => void;
}) {
  const [enabled, setEnabled] = useState<boolean>(true);
  const [phone, setPhone] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    setEnabled(tenant.billingAlertsEnabled ?? true);
    setPhone(tenant.billingAlertsPhone ?? '');
  }, [tenant]);

  if (!tenant) return null;

  async function save() {
    setSaving(true);
    try {
      const updated = await api<TenantMe>('/tenants/me', {
        method: 'PATCH',
        body: JSON.stringify({
          billingAlertsEnabled: enabled,
          billingAlertsPhone: phone.trim() || null,
        }),
      });
      toast('Alertas de pago guardadas', 'success');
      onSaved(updated);
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      const res = await api<{ ok: boolean; toPhone: string; response: any }>(
        '/tenants/me/billing-alerts/test',
        { method: 'POST' },
      );
      if (res.ok) {
        toast(`SMS de prueba enviado a ${res.toPhone}`, 'success');
      } else {
        toast(
          `Falló: ${res.response?.message || 'sin detalle'}`,
          'error',
        );
      }
    } catch (e: any) {
      toast(e.message || 'No se pudo probar', 'error');
    } finally {
      setTesting(false);
    }
  }

  const dirty =
    enabled !== (tenant.billingAlertsEnabled ?? true) ||
    (phone.trim() || '') !== (tenant.billingAlertsPhone ?? '');

  return (
    <div className="card card-pad mb-4">
      <h2 className="text-base font-semibold m-0 flex items-center gap-2">
        💳 Alertas SMS de pago
        {enabled ? (
          <span className="text-[10px] font-bold uppercase tracking-wider bg-ok/15 text-ok px-2 py-0.5 rounded-full">
            Activas
          </span>
        ) : (
          <span className="text-[10px] font-bold uppercase tracking-wider bg-bg2 text-mute px-2 py-0.5 rounded-full">
            Pausadas
          </span>
        )}
      </h2>
      <p className="text-xs text-mute mt-1 leading-relaxed">
        Recordatorios automáticos sobre tu suscripción: aviso 24 horas
        antes del cobro, si un cobro falla, y antes de pausar la cuenta.
      </p>

      <div className="mt-4 space-y-3">
        <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg bg-bg2/40">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="w-5 h-5 accent-brand"
          />
          <div>
            <div className="font-semibold text-sm">Recibir alertas de pago</div>
            <div className="text-[11px] text-mute leading-snug">
              Apagalas si preferís manejar la facturación sin SMS — vas a
              ver los avisos igual en email y en el panel.
            </div>
          </div>
        </label>

        <div>
          <label className="label">
            Teléfono destino
            <span className="text-mute font-normal ml-2 text-[10px]">
              (opcional · default: tu WhatsApp)
            </span>
          </label>
          <input
            type="tel"
            className="input"
            placeholder="+57 300 000 0000"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={40}
          />
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-line">
          <button
            type="button"
            onClick={test}
            disabled={testing}
            className="btn-ghost text-sm disabled:opacity-50"
          >
            {testing ? 'Enviando…' : '📤 Probar SMS'}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="btn-primary text-sm"
          >
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  );
}

const DELIVERY_EVENT_OPTIONS: { key: string; label: string; desc: string }[] = [
  {
    key: 'created',
    label: 'Pedido nuevo',
    desc: 'Cliente acaba de hacer un pedido delivery.',
  },
  {
    key: 'confirmed',
    label: 'Confirmado',
    desc: 'Tú aceptaste el pedido en el panel.',
  },
  {
    key: 'ready',
    label: 'Listo para recoger',
    desc: 'Pedido empacado, esperando courier.',
  },
  {
    key: 'delivered',
    label: 'Entregado',
    desc: 'Pedido completado.',
  },
];

/** Card que el owner ve en /app/settings para gestionar alertas SMS a
 *  empresas de domicilio. Soporta múltiples teléfonos destino + selección
 *  de eventos del pedido que disparan el SMS. */
function DeliveryAlertsCard({
  tenant,
  onSaved,
}: {
  tenant: TenantMe | null;
  onSaved: (t: TenantMe) => void;
}) {
  const [enabled, setEnabled] = useState<boolean>(false);
  const [phones, setPhones] = useState<string[]>([]);
  const [events, setEvents] = useState<string[]>(['created']);
  const [draftPhone, setDraftPhone] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    setEnabled(tenant.deliveryAlertsEnabled ?? false);
    setPhones(
      Array.isArray(tenant.deliveryAlertsPhones)
        ? tenant.deliveryAlertsPhones
        : [],
    );
    setEvents(
      Array.isArray(tenant.deliveryAlertsEvents) && tenant.deliveryAlertsEvents.length > 0
        ? tenant.deliveryAlertsEvents
        : ['created'],
    );
  }, [tenant]);

  if (!tenant) return null;

  function addPhone() {
    const v = draftPhone.trim();
    if (!v || v.length < 6) {
      toast('Teléfono inválido', 'error');
      return;
    }
    if (phones.includes(v)) {
      toast('Ya está en la lista', 'error');
      return;
    }
    setPhones([...phones, v]);
    setDraftPhone('');
  }

  function removePhone(p: string) {
    setPhones(phones.filter((x) => x !== p));
  }

  function toggleEvent(key: string) {
    if (events.includes(key)) {
      setEvents(events.filter((e) => e !== key));
    } else {
      setEvents([...events, key]);
    }
  }

  async function save() {
    if (enabled && phones.length === 0) {
      toast('Agrega al menos un teléfono o desactiva las alertas', 'error');
      return;
    }
    if (enabled && events.length === 0) {
      toast('Elige al menos un evento que dispare el SMS', 'error');
      return;
    }
    setSaving(true);
    try {
      const updated = await api<TenantMe>('/tenants/me', {
        method: 'PATCH',
        body: JSON.stringify({
          deliveryAlertsEnabled: enabled,
          deliveryAlertsPhones: phones,
          deliveryAlertsEvents: events,
        }),
      });
      toast('Alertas de domicilio guardadas', 'success');
      onSaved(updated);
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      const res = await api<{
        ok: boolean;
        total: number;
        okCount: number;
        results: { phone: string; ok: boolean; message: string | null }[];
      }>('/tenants/me/delivery-alerts/test', { method: 'POST' });
      if (res.ok) {
        toast(`SMS enviado a ${res.okCount}/${res.total} destinos`, 'success');
      } else {
        toast('Ningún SMS pudo enviarse — revisa credenciales y números', 'error');
      }
    } catch (e: any) {
      toast(e.message || 'No se pudo probar', 'error');
    } finally {
      setTesting(false);
    }
  }

  const dirty =
    enabled !== (tenant.deliveryAlertsEnabled ?? false) ||
    JSON.stringify(phones) !==
      JSON.stringify(tenant.deliveryAlertsPhones ?? []) ||
    JSON.stringify(events) !==
      JSON.stringify(tenant.deliveryAlertsEvents ?? ['created']);

  return (
    <div className="card card-pad mb-4">
      <h2 className="text-base font-semibold m-0 flex items-center gap-2">
        🛵 Alertas SMS de domicilio
        {enabled ? (
          <span className="text-[10px] font-bold uppercase tracking-wider bg-ok/15 text-ok px-2 py-0.5 rounded-full">
            Activas
          </span>
        ) : (
          <span className="text-[10px] font-bold uppercase tracking-wider bg-bg2 text-mute px-2 py-0.5 rounded-full">
            Inactivas
          </span>
        )}
      </h2>
      <p className="text-xs text-mute mt-1 leading-relaxed">
        Mve un SMS automático a una o varias empresas/personas de
        domicilio cuando un pedido delivery cambia de estado.
      </p>

      <div className="mt-4 space-y-4">
        <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg bg-bg2/40">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="w-5 h-5 accent-brand"
          />
          <div>
            <div className="font-semibold text-sm">Activar alertas SMS</div>
            <div className="text-[11px] text-mute leading-snug">
              Si está prendido, los SMS salen automáticamente en los
              eventos que elijas abajo.
            </div>
          </div>
        </label>

        <div>
          <label className="label">Teléfonos destino</label>
          <div className="flex gap-2">
            <input
              type="tel"
              className="input flex-1"
              placeholder="+57 300 000 0000"
              value={draftPhone}
              onChange={(e) => setDraftPhone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addPhone();
                }
              }}
              maxLength={40}
            />
            <button
              type="button"
              onClick={addPhone}
              className="btn-ghost text-sm"
            >
              + Agregar
            </button>
          </div>
          {phones.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {phones.map((p) => (
                <span
                  key={p}
                  className="inline-flex items-center gap-1.5 bg-bg2 text-ink px-2 py-1 rounded-pill text-xs"
                >
                  {p}
                  <button
                    type="button"
                    onClick={() => removePhone(p)}
                    className="text-mute hover:text-bad font-bold"
                    title="Quitar"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-mute italic mt-1">
              Sin teléfonos configurados — sin esto las alertas no salen.
            </div>
          )}
        </div>

        <div>
          <label className="label">Eventos que disparan el SMS</label>
          <div className="space-y-1">
            {DELIVERY_EVENT_OPTIONS.map((opt) => (
              <label
                key={opt.key}
                className="flex items-start gap-2 cursor-pointer p-2 rounded hover:bg-bg2/40"
              >
                <input
                  type="checkbox"
                  checked={events.includes(opt.key)}
                  onChange={() => toggleEvent(opt.key)}
                  className="w-4 h-4 accent-brand mt-0.5"
                />
                <div>
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-[11px] text-mute">{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-line">
          <button
            type="button"
            onClick={test}
            disabled={testing || phones.length === 0}
            className="btn-ghost text-sm disabled:opacity-50"
            title={
              phones.length === 0
                ? 'Agrega al menos un teléfono'
                : 'Manda un SMS de prueba ya mismo'
            }
          >
            {testing ? 'Enviando…' : '📤 Probar SMS'}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="btn-primary text-sm"
          >
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  );
}
