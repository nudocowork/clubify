'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { api, downloadFile, getUser, setSession, clearSession } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { LanguageSwitcherIntl } from '@/components/LanguageSwitcherIntl';
import { PhoneInput } from '@/components/PhoneInput';

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
  whatsappReservationsPhone: string | null;
  mainSectionLabelOverride: string | null;
  businessCategorySlug: string | null;
  currency?: string;
  currencySymbol?: string | null;
  country?: string;
  timezone?: string;
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
  { code: 'BZD', label: 'Dólar beliceño', flag: '🇧🇿' },
  { code: 'EUR', label: 'Euro', flag: '🇪🇺' },
];

/** Moneda por defecto sugerida al elegir un país. Es solo un default de
 *  conveniencia — el negocio puede cambiarla. Venezuela apunta a USD
 *  porque muchos locales fijan precios en dólares (y luego rotulan "Ref."
 *  por requisito legal); Panamá usa USD en la práctica diaria. */
const COUNTRY_DEFAULT_CURRENCY: Record<string, string> = {
  CO: 'COP',
  MX: 'MXN',
  AR: 'ARS',
  CL: 'CLP',
  PE: 'PEN',
  EC: 'USD',
  VE: 'USD',
  UY: 'UYU',
  PY: 'PYG',
  BO: 'BOB',
  CR: 'CRC',
  PA: 'USD',
  GT: 'GTQ',
  HN: 'HNL',
  SV: 'USD',
  NI: 'NIO',
  BZ: 'BZD',
  DO: 'DOP',
  ES: 'EUR',
  US: 'USD',
  BR: 'BRL',
};

/** Timezones IANA más comunes en LATAM + ES/US/BR para el dropdown.
 *  Si el tenant tiene una TZ fuera de esta lista, el form muestra un
 *  input libre para editarla. */
const COMMON_TIMEZONES: { value: string; label: string }[] = [
  { value: 'America/Bogota', label: '🇨🇴 Bogotá / Quito / Lima (UTC-5)' },
  { value: 'America/Mexico_City', label: '🇲🇽 Ciudad de México (UTC-6)' },
  { value: 'America/Argentina/Buenos_Aires', label: '🇦🇷 Buenos Aires (UTC-3)' },
  { value: 'America/Santiago', label: '🇨🇱 Santiago (UTC-4/-3 DST)' },
  { value: 'America/Lima', label: '🇵🇪 Lima (UTC-5)' },
  { value: 'America/Caracas', label: '🇻🇪 Caracas (UTC-4)' },
  { value: 'America/Sao_Paulo', label: '🇧🇷 São Paulo (UTC-3)' },
  { value: 'America/Montevideo', label: '🇺🇾 Montevideo (UTC-3)' },
  { value: 'America/Asuncion', label: '🇵🇾 Asunción (UTC-4/-3 DST)' },
  { value: 'America/La_Paz', label: '🇧🇴 La Paz (UTC-4)' },
  { value: 'America/Costa_Rica', label: '🇨🇷 Costa Rica (UTC-6)' },
  { value: 'America/Panama', label: '🇵🇦 Panamá (UTC-5)' },
  { value: 'America/Guatemala', label: '🇬🇹 Guatemala (UTC-6)' },
  { value: 'America/Tegucigalpa', label: '🇭🇳 Tegucigalpa (UTC-6)' },
  { value: 'America/El_Salvador', label: '🇸🇻 El Salvador (UTC-6)' },
  { value: 'America/Managua', label: '🇳🇮 Managua (UTC-6)' },
  { value: 'America/Santo_Domingo', label: '🇩🇴 Santo Domingo (UTC-4)' },
  { value: 'Europe/Madrid', label: '🇪🇸 Madrid (UTC+1/+2 DST)' },
  { value: 'America/New_York', label: '🇺🇸 New York (UTC-5/-4 DST)' },
  { value: 'America/Chicago', label: '🇺🇸 Chicago (UTC-6/-5 DST)' },
  { value: 'America/Los_Angeles', label: '🇺🇸 Los Ángeles (UTC-8/-7 DST)' },
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
  const t = useTranslations('app_settings');
  const router = useRouter();
  const [me, setMe] = useState<Profile | null>(null);
  const [profile, setProfile] = useState({ fullName: '', email: '', phone: '' });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' });
  const [savingPwd, setSavingPwd] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [tenant, setTenant] = useState<TenantMe | null>(null);

  // Bloque 3 (2026-06-12): edición del nombre del negocio. Persiste en
  // Tenant.brandName via PATCH /tenants/me. NO toca slug ni subdomain
  // (esos quedan fijos desde el create), así que solo afecta lo visible
  // en UI: storefront, wallet, headers, emails, etc.
  const [brandNameDraft, setBrandNameDraft] = useState<string>('');
  const [savingBrandName, setSavingBrandName] = useState(false);
  const [brandNameMsg, setBrandNameMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // #1 (PDF Software 2026-06-29): número receptor de avisos de reservas.
  const [resvPhone, setResvPhone] = useState<string>('');
  const [savingResv, setSavingResv] = useState(false);
  const [resvMsg, setResvMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [sectionMode, setSectionMode] = useState<MainSectionMode>('menu');
  const [sectionCustom, setSectionCustom] = useState<string>('');
  const [savingSection, setSavingSection] = useState(false);
  const [sectionMsg, setSectionMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [currency, setCurrency] = useState<string>('COP');
  const [currencySymbol, setCurrencySymbol] = useState<string>('');
  const [country, setCountry] = useState<string>('CO');
  const [timezone, setTimezone] = useState<string>('America/Bogota');
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
        setBrandNameDraft(t.brandName ?? '');
        setResvPhone(t.whatsappReservationsPhone ?? '');
        const { mode, custom } = detectMainMode(t.mainSectionLabelOverride);
        setSectionMode(mode);
        setSectionCustom(custom);
        setCurrency(t.currency ?? 'COP');
        setCurrencySymbol(t.currencySymbol ?? '');
        setCountry(t.country ?? 'CO');
        setTimezone(t.timezone ?? 'America/Bogota');
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
          text: t('sectionCustomRequired'),
        });
        return;
      }
      if (trimmed.length > 24) {
        setSectionMsg({
          ok: false,
          text: t('max24Chars'),
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
        text: t('sectionUpdatedReload'),
      });
    } catch (err: any) {
      setSectionMsg({
        ok: false,
        text: err?.message || t('couldNotSave'),
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
        text: t('stampsSaved', { count: maxStampsPerDay }),
      });
    } catch (e: any) {
      setStampsMsg({ ok: false, text: e.message || t('couldNotSave') });
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
        body: JSON.stringify({
          currency,
          currencySymbol: currencySymbol.trim() || null,
          country,
          timezone: timezone.trim() || 'America/Bogota',
        }),
      });
      setTenant(updated);
      setCurrencyMsg({
        ok: true,
        text: t('currencySaved'),
      });
    } catch (e: any) {
      setCurrencyMsg({ ok: false, text: e.message || t('couldNotSave') });
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
      setProfileMsg({ ok: true, text: t('profileUpdated') });
    } catch (e: any) {
      setProfileMsg({ ok: false, text: e.message || t('couldNotUpdate') });
    } finally {
      setSavingProfile(false);
    }
  }

  async function saveReservationsPhone(e: React.FormEvent) {
    e.preventDefault();
    setResvMsg(null);
    const trimmed = resvPhone.trim();
    setSavingResv(true);
    try {
      const updated = await api<TenantMe>('/tenants/me', {
        method: 'PATCH',
        body: JSON.stringify({ whatsappReservationsPhone: trimmed }),
      });
      setTenant(updated);
      setResvPhone(updated.whatsappReservationsPhone ?? trimmed);
      setResvMsg({ ok: true, text: t('resvSaved') });
    } catch (err: any) {
      setResvMsg({ ok: false, text: err?.message || t('couldNotSave') });
    } finally {
      setSavingResv(false);
    }
  }

  async function saveBrandName(e: React.FormEvent) {
    e.preventDefault();
    setBrandNameMsg(null);
    const trimmed = brandNameDraft.trim();
    if (!trimmed) {
      setBrandNameMsg({ ok: false, text: t('brandNameEmpty') });
      return;
    }
    if (trimmed.length > 80) {
      setBrandNameMsg({ ok: false, text: t('max80Chars') });
      return;
    }
    if (trimmed === tenant?.brandName) {
      setBrandNameMsg({ ok: true, text: t('noChanges') });
      return;
    }
    setSavingBrandName(true);
    try {
      const updated = await api<TenantMe>('/tenants/me', {
        method: 'PATCH',
        body: JSON.stringify({ brandName: trimmed }),
      });
      setTenant(updated);
      setBrandNameDraft(updated.brandName ?? trimmed);
      // Sync localStorage para que el TenantSwitcher / sidebar reflejen
      // el nombre nuevo sin reload manual.
      const u = getUser();
      if (u && u.tenant) {
        localStorage.setItem(
          'clubify_user',
          JSON.stringify({ ...u, tenant: { ...u.tenant, brandName: updated.brandName ?? trimmed } }),
        );
      }
      setBrandNameMsg({ ok: true, text: t('brandNameUpdated') });
    } catch (e: any) {
      setBrandNameMsg({ ok: false, text: e.message || t('couldNotUpdate') });
    } finally {
      setSavingBrandName(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwdMsg(null);
    if (pwd.next.length < 8) {
      setPwdMsg({ ok: false, text: t('passwordMinLength') });
      return;
    }
    if (pwd.next !== pwd.confirm) {
      setPwdMsg({ ok: false, text: t('passwordsDoNotMatch') });
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
      setPwdMsg({ ok: true, text: t('passwordUpdated') });
    } catch (e: any) {
      setPwdMsg({ ok: false, text: e.message || t('couldNotChange') });
    } finally {
      setSavingPwd(false);
    }
  }

  function logout() {
    clearSession();
    router.push('/login');
  }

  if (!me) return <div className="text-mute">{t('loading')}</div>;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="page-head">
        <h1 className="page-title">{t('myAccount')}</h1>
      </div>

      {/* Perfil */}
      <form onSubmit={saveProfile} className="card card-pad mb-4">
        <h2 className="text-base font-semibold m-0">{t('personalData')}</h2>
        <p className="text-xs text-mute mt-1">{t('personalDataDesc')}</p>
        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <div>
            <label className="label">{t('fullName')}</label>
            <input
              className="input"
              value={profile.fullName}
              onChange={(e) => setProfile({ ...profile, fullName: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label">{t('email')}</label>
            <input
              className="input"
              type="email"
              value={profile.email}
              onChange={(e) => setProfile({ ...profile, email: e.target.value })}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">{t('phoneOptional')}</label>
            {/* #25 (2026-06-16): selector internacional con banderas. */}
            <PhoneInput
              value={profile.phone}
              onChange={(combined) => setProfile({ ...profile, phone: combined })}
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
            {savingProfile ? t('saving') : t('saveChanges')}
          </button>
        </div>
      </form>

      {/* Nombre del negocio (Bloque 3 2026-06-12). Solo afecta lo visible
          (storefront, wallet, headers, emails). Slug/subdomain quedan
          fijos desde el create — cambiar brandName NO los toca. */}
      <form onSubmit={saveBrandName} className="card card-pad mb-4">
        <h2 className="text-base font-semibold m-0">{t('businessName')}</h2>
        <p className="text-xs text-mute mt-1">
          {t('businessNameDesc')}
        </p>
        <div className="mt-4">
          <label className="label">{t('commercialName')}</label>
          <input
            className="input"
            value={brandNameDraft}
            onChange={(e) => setBrandNameDraft(e.target.value)}
            placeholder={t('businessNamePlaceholder')}
            maxLength={80}
            required
          />
        </div>
        {brandNameMsg && (
          <div
            className={`mt-3 text-sm rounded-lg px-3 py-2 ${
              brandNameMsg.ok ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad-ink'
            }`}
          >
            {brandNameMsg.text}
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <button type="submit" className="btn-primary" disabled={savingBrandName}>
            {savingBrandName ? t('saving') : t('saveName')}
          </button>
        </div>
      </form>

      {/* #1 (PDF Software 2026-06-29): número receptor de avisos de reservas.
          El botón "Configurar número receptor" del módulo de reservas ancla
          aquí (/app/settings#reservas). */}
      <form
        id="reservas"
        onSubmit={saveReservationsPhone}
        className="card card-pad mb-4 scroll-mt-20"
      >
        <h2 className="text-base font-semibold m-0">{t('resvReceiverTitle')}</h2>
        <p className="text-xs text-mute mt-1">{t('resvReceiverDesc')}</p>
        <div className="mt-4">
          <label className="label">{t('resvReceiverLabel')}</label>
          <input
            className="input"
            value={resvPhone}
            onChange={(e) => setResvPhone(e.target.value)}
            placeholder="+57 300 000 0000"
            inputMode="tel"
          />
          <p className="text-[11px] text-mute mt-1">{t('resvReceiverHint')}</p>
        </div>
        {resvMsg && (
          <div
            className={`mt-3 text-sm rounded-lg px-3 py-2 ${
              resvMsg.ok ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad-ink'
            }`}
          >
            {resvMsg.text}
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <button type="submit" className="btn-primary" disabled={savingResv}>
            {savingResv ? t('saving') : t('save')}
          </button>
        </div>
      </form>

      {/* Idioma — i18n foundation 2026-06-12. El switcher persiste la
          elección en cookie + User.preferredLocale (al estar logueado)
          via POST /api/locale → POST /api/auth/locale. */}
      <section className="card card-pad mb-4">
        <h2 className="text-base font-semibold m-0">{t('language')}</h2>
        <p className="text-xs text-mute mt-1">
          {t('languageDesc')}
        </p>
        <div className="mt-4">
          <LanguageSwitcherIntl variant="panel" />
        </div>
      </section>

      {/* Password */}
      <form onSubmit={changePassword} className="card card-pad mb-4">
        <h2 className="text-base font-semibold m-0">{t('changePassword')}</h2>
        <p className="text-xs text-mute mt-1">
          {t('changePasswordDesc')}
        </p>
        <div className="grid gap-3 mt-4">
          <div>
            <label className="label">{t('currentPassword')}</label>
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
              <label className="label">{t('newPassword')}</label>
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
              <label className="label">{t('confirmNew')}</label>
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
            {savingPwd ? t('changing') : t('changePassword')}
          </button>
        </div>
      </form>

      {/* Alertas SMS de pago — solo TENANT_OWNER. Staff no debe ver
          esta configuración: contiene teléfonos administrativos y toggles
          de cobranza que no le competen. */}
      {me?.role === 'TENANT_OWNER' && (
        <BillingAlertsCard tenant={tenant} onSaved={(t) => setTenant(t)} />
      )}

      {/* #14 (2026-06-17): las alertas SMS de domicilio se configuran ahora
          desde super-admin (/admin/tenants/[id]), no desde la vista del dueño. */}

      {/* País + Moneda del menú público */}
      <form onSubmit={saveCurrency} className="card card-pad mb-4">
        <h2 className="text-base font-semibold m-0 flex items-center gap-2">
          🌎 {t('countryAndCurrency')}
        </h2>
        <p className="text-xs text-mute mt-1 leading-relaxed">
          {t('countryAndCurrencyDesc')}
        </p>

        <div className="mt-4">
          <label className="label">{t('businessCountry')}</label>
          <select
            className="input"
            value={country}
            onChange={(e) => {
              const c = e.target.value;
              setCountry(c);
              // Sugerimos la moneda del país elegido (el negocio puede
              // cambiarla después). No tocamos el símbolo personalizado.
              const suggested = COUNTRY_DEFAULT_CURRENCY[c];
              if (suggested) setCurrency(suggested);
            }}
          >
            <option value="CO">🇨🇴 {t('countryCO')}</option>
            <option value="MX">🇲🇽 {t('countryMX')}</option>
            <option value="AR">🇦🇷 {t('countryAR')}</option>
            <option value="CL">🇨🇱 {t('countryCL')}</option>
            <option value="PE">🇵🇪 {t('countryPE')}</option>
            <option value="EC">🇪🇨 {t('countryEC')}</option>
            <option value="VE">🇻🇪 {t('countryVE')}</option>
            <option value="UY">🇺🇾 {t('countryUY')}</option>
            <option value="PY">🇵🇾 {t('countryPY')}</option>
            <option value="BO">🇧🇴 {t('countryBO')}</option>
            <option value="CR">🇨🇷 {t('countryCR')}</option>
            <option value="PA">🇵🇦 {t('countryPA')}</option>
            <option value="GT">🇬🇹 {t('countryGT')}</option>
            <option value="HN">🇭🇳 {t('countryHN')}</option>
            <option value="SV">🇸🇻 {t('countrySV')}</option>
            <option value="NI">🇳🇮 {t('countryNI')}</option>
            <option value="BZ">🇧🇿 {t('countryBZ')}</option>
            <option value="DO">🇩🇴 {t('countryDO')}</option>
            <option value="ES">🇪🇸 {t('countryES')}</option>
            <option value="US">🇺🇸 {t('countryUS')}</option>
            <option value="BR">🇧🇷 {t('countryBR')}</option>
          </select>
        </div>

        <div className="mt-4">
          <label className="label">{t('timezone')}</label>
          <select
            className="input"
            value={COMMON_TIMEZONES.some((tz) => tz.value === timezone) ? timezone : '__other__'}
            onChange={(e) => {
              if (e.target.value === '__other__') {
                // mantenemos el valor actual; el input libre debajo permite editarlo
                return;
              }
              setTimezone(e.target.value);
            }}
          >
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
            <option value="__other__">{t('timezoneOther')}</option>
          </select>
          {!COMMON_TIMEZONES.some((tz) => tz.value === timezone) && (
            <input
              type="text"
              className="input mt-2"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value.slice(0, 64))}
              placeholder={t('timezonePlaceholder')}
            />
          )}
          <p className="text-[11px] text-mute mt-1.5">
            {t('timezoneHint')}
          </p>
        </div>

        <div className="mt-4">
          <label className="label">{t('currency')}</label>
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
        </div>

        <div className="mt-4">
          <label className="label">
            {t('customSymbol')}{' '}
            <span className="text-mute font-normal">{t('customSymbolHint')}</span>
          </label>
          <input
            type="text"
            className="input max-w-[160px]"
            value={currencySymbol}
            onChange={(e) => setCurrencySymbol(e.target.value.slice(0, 8))}
            placeholder={t('customSymbolPlaceholder')}
            maxLength={8}
          />
          <p className="text-[11px] text-mute mt-1.5">
            {t('preview')}{' '}
            <span className="font-mono text-ink">
              {(() => {
                try {
                  const parts = new Intl.NumberFormat('es-CO', {
                    style: 'currency',
                    currency,
                    maximumFractionDigits: 0,
                  }).formatToParts(15000);
                  const symbol = currencySymbol.trim();
                  if (symbol) {
                    return parts
                      .map((p) => (p.type === 'currency' ? symbol : p.value))
                      .join('');
                  }
                  return parts.map((p) => p.value).join('');
                } catch {
                  return `${currencySymbol.trim() || currency} 15000`;
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
            disabled={
              savingCurrency ||
              (currency === (tenant?.currency ?? 'COP') &&
                currencySymbol === (tenant?.currencySymbol ?? '') &&
                country === (tenant?.country ?? 'CO') &&
                timezone === (tenant?.timezone ?? 'America/Bogota'))
            }
          >
            {savingCurrency ? t('saving') : t('saveCurrency')}
          </button>
        </div>
      </form>

      {/* M4: máximo de sellos por día */}
      <form onSubmit={saveStamps} className="card card-pad mb-4">
        <h2 className="text-base font-semibold m-0 flex items-center gap-2">
          🎯 {t('stampsPerDay')}
        </h2>
        <p className="text-xs text-mute mt-1 leading-relaxed">
          {t('stampsPerDayDesc')}
        </p>
        <div className="mt-4 grid sm:grid-cols-4 gap-3 items-end">
          <div className="sm:col-span-1">
            <label className="label">{t('maxPerDay')}</label>
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
              ? t('stampsStandard')
              : t('stampsMultiple', { count: maxStampsPerDay })}
            <br />
            {t('stampsSuperAdminBypass')}
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
            {savingStamps ? t('saving') : t('saveMax')}
          </button>
        </div>
      </form>

      {/* Mensajería de WhatsApp: movido a /admin/tenants/[id] (Bloque 8
          2026-06-12). El cliente final ya no la edita — solo SUPER_ADMIN
          desde el panel de administración del negocio. */}

      {/* Nombre de sección principal */}
      <div className="card card-pad mb-4">
        <h2 className="text-base font-semibold m-0 flex items-center gap-2">
          🏷 {t('mainSectionName')}
        </h2>
        <p className="text-xs text-mute mt-1 leading-relaxed">
          {t('mainSectionNameDesc')}
        </p>
        <form onSubmit={saveSectionLabel} className="mt-4 grid gap-3">
          <div>
            <label className="label">{t('option')}</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(
                [
                  { v: 'menu', emoji: '🍽', label: t('optMenu'), hint: t('optMenuHint') },
                  { v: 'services', emoji: '🛠', label: t('optServices'), hint: t('optServicesHint') },
                  { v: 'catalog', emoji: '🛍', label: t('optCatalog'), hint: t('optCatalogHint') },
                  { v: 'custom', emoji: '✏️', label: t('optCustom'), hint: t('optCustomHint') },
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
              <label className="label">{t('customName')}</label>
              <input
                className="input max-w-xs"
                placeholder={t('customNamePlaceholder')}
                value={sectionCustom}
                onChange={(e) => setSectionCustom(e.target.value.slice(0, 24))}
                maxLength={24}
              />
              <p className="text-[11px] text-mute mt-1">
                {t('customNameHint')}
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
              {savingSection ? t('saving') : t('saveName')}
            </button>
          </div>
        </form>
      </div>

      {/* Export */}
      <div className="card card-pad mb-4">
        <h2 className="text-base font-semibold m-0">{t('yourData')}</h2>
        <p className="text-xs text-mute mt-1">
          {t('yourDataDesc')}
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
            <Icon name="arrow-right" size={14} /> {t('downloadMyData')}
          </button>
        </div>
      </div>

      {/* Sesión */}
      <div className="card card-pad">
        <h2 className="text-base font-semibold m-0">{t('session')}</h2>
        <p className="text-xs text-mute mt-1">
          {t('loggedInAs')} <span className="font-medium text-ink">{me.email}</span>
        </p>
        <div className="mt-4 flex justify-end">
          <button
            onClick={logout}
            className="px-4 py-2 rounded-pill bg-bg2 text-ink text-sm font-semibold hover:bg-line"
          >
            <Icon name="arrow-right" size={14} /> {t('logout')}
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
  onSaved: (updatedTenant: TenantMe) => void;
}) {
  const t = useTranslations('app_settings');
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
      toast(t('billingAlertsSaved'), 'success');
      onSaved(updated);
    } catch (e: any) {
      toast(e.message || t('couldNotSave'), 'error');
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
        toast(t('testSmsSent', { phone: res.toPhone }), 'success');
      } else {
        toast(
          t('testSmsFailed', { detail: res.response?.message || t('noDetail') }),
          'error',
        );
      }
    } catch (e: any) {
      toast(e.message || t('couldNotTest'), 'error');
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
        💳 {t('billingAlertsTitle')}
        {enabled ? (
          <span className="text-[10px] font-bold uppercase tracking-wider bg-ok/15 text-ok px-2 py-0.5 rounded-full">
            {t('active')}
          </span>
        ) : (
          <span className="text-[10px] font-bold uppercase tracking-wider bg-bg2 text-mute px-2 py-0.5 rounded-full">
            {t('paused')}
          </span>
        )}
      </h2>
      <p className="text-xs text-mute mt-1 leading-relaxed">
        {t('billingAlertsDesc')}
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
            <div className="font-semibold text-sm">{t('receiveBillingAlerts')}</div>
            <div className="text-[11px] text-mute leading-snug">
              {t('receiveBillingAlertsHint')}
            </div>
          </div>
        </label>

        <div>
          <label className="label">
            {t('destinationPhone')}
            <span className="text-mute font-normal ml-2 text-[10px]">
              {t('destinationPhoneHint')}
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
            {testing ? t('sending') : t('testSms')}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="btn-primary text-sm"
          >
            {saving ? t('saving') : t('saveChanges')}
          </button>
        </div>
      </div>
    </div>
  );
}
