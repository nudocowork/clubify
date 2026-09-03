'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { api, startImpersonation } from '@/lib/api';
import { ImageUploader } from '@/components/ImageUploader';
import { ActionsMenu } from '@/components/ActionsMenu';

type WhiteLabel = {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  appDomain: string | null;
  primaryColor: string;
  logoUrl: string | null;
  iconUrl: string | null;
  faviconUrl: string | null;
  secondaryColor: string | null;
  backgroundColor: string | null;
  supportColor: string | null;
  instagram: string | null;
  contactEmail: string | null;
  notifyPhone: string | null;
  mapsApiKey: string | null;
  shareImageUrl: string | null;
  whatsappQrUrl: string | null;
  subscriptionFeatureKeys?: string[];
  installationFeeUsd?: number | string | null;
  installationPromoUsd?: number | string | null;
  // Wallet V3 — permisos "Wallet Avanzado" (6 flags). null = heredado (todo activo).
  walletAdvanced?: Record<string, boolean> | null;
  initial: string | null;
  adminEmail: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  creditsAvailable: number;
  creditsCommitted: number;
  creditsUsed: number;
  creditsUnlimited: boolean;
  createdAt: string;
  tenantsActive: number;
  tenantsSuspended: number;
  adminsCount: number;
  modules?: { module: string; enabled: boolean }[];
};

type WhiteLabelDetail = WhiteLabel & {
  planPeriodicities?: string[];
  modules: { module: string; enabled: boolean }[];
  tenants: { id: string; brandName: string; slug: string; status: string }[];
  admins: {
    id: string;
    email: string;
    fullName: string | null;
    role: string;
    isActive: boolean;
    whiteLabelId: string | null;
  }[];
};

type AdminInvite = {
  id: string;
  email: string;
  fullName: string;
  invitedBy: { email: string; fullName: string | null } | null;
  expiresAt: string;
  createdAt: string;
};

const MODULE_LABELS: Record<string, string> = {
  REFERRALS: 'Referidos',
  ORDERS: 'Pedidos',
  GROW_BUSINESS_SMS: 'GrowBusiness SMS',
  REVIEWS: 'Reseñas',
  SERVICE_RESERVATIONS: 'Reservas de servicios',
};

// Features de la suscripción (lista "Tu suscripción incluye" del panel billing).
// El orden y las keys coinciden con app/billing. La marca elige cuáles incluye;
// vacío = todas. Para Sellea se desmarcan dominio/email/automatizaciones.
const SUBSCRIPTION_FEATURES: { key: string; label: string }[] = [
  { key: 'featUnlimitedOrders', label: 'Pedidos ilimitados' },
  { key: 'featUnlimitedWalletCards', label: 'Tarjetas wallet ilimitadas' },
  { key: 'featAppleGoogleWallet', label: 'Apple & Google Wallet' },
  { key: 'featMultiLocationStaff', label: 'Multi-sede y staff' },
  { key: 'featCustomDomainAnalytics', label: 'Dominio propio + analítica' },
  { key: 'featWhatsappAutomations', label: 'Automatizaciones de WhatsApp' },
  { key: 'featEventMessages', label: 'Mensajes por eventos' },
  { key: 'featAdvancedSegmentation', label: 'Segmentación avanzada' },
  { key: 'featMessageTemplates', label: 'Plantillas de mensajes' },
  { key: 'featScannerPwa', label: 'Scanner PWA' },
  { key: 'featTransactionalEmail', label: 'Email transaccional' },
  { key: 'featChatSupport', label: 'Soporte por chat' },
];

export default function MarcasBlancasPage() {
  const params = useSearchParams();
  const router = useRouter();
  const [items, setItems] = useState<WhiteLabel[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'todas' | 'activas' | 'suspendidas'>('todas');
  // El detalle de una marca es una PÁGINA COMPLETA, no un drawer: la marca
  // seleccionada vive en la URL (?brand=<id>) → addressable + botón atrás.
  const brandId = params.get('brand');
  const [createOpen, setCreateOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (params.get('crear') === '1') {
      setCreateOpen(true);
    }
  }, [params]);

  async function load() {
    try {
      const data = await api<WhiteLabel[]>('/superadmin/white-labels');
      setItems(data);
    } catch (e: any) {
      console.error(e);
    }
  }
  useEffect(() => {
    load();
  }, []);

  function flashToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  }

  const filtered = useMemo(() => {
    return items.filter((w) => {
      if (filter === 'activas' && w.status !== 'ACTIVE') return false;
      if (filter === 'suspendidas' && w.status !== 'SUSPENDED') return false;
      if (query.trim()) {
        const q = query.toLowerCase().trim();
        if (!w.name.toLowerCase().includes(q) && !(w.domain || '').toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [items, query, filter]);

  async function toggleStatus(w: WhiteLabel) {
    const next = w.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    if (next === 'SUSPENDED') {
      const ok = window.confirm(
        `¿Suspender la marca "${w.name}"?\n\nSus negocios dejarán de funcionar (acceso bloqueado) hasta que la reactives.`,
      );
      if (!ok) return;
    }
    try {
      await api(`/superadmin/white-labels/${w.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      });
      flashToast(`${w.name} ${next === 'SUSPENDED' ? 'suspendida' : 'reactivada'}`);
      load();
    } catch (e: any) {
      flashToast(e.message ?? 'Error');
    }
  }

  // Página completa de administración de una marca (reemplaza la lista).
  if (brandId) {
    return (
      <BrandDetailFull
        id={brandId}
        onBack={() => {
          load();
          router.push('/superadmin/marcas');
        }}
      />
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <div>
          <h1
            className="m-0"
            style={{ fontSize: 26, fontWeight: 800, color: '#16241c', letterSpacing: -0.6 }}
          >
            Marcas Blancas
          </h1>
          <p className="text-sm mt-1" style={{ color: '#6b7785' }}>
            {items.length} empresa{items.length === 1 ? '' : 's'} revendiendo el servicio · cada
            una completamente aislada
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-[10px] text-sm font-bold text-white"
          style={{
            background: 'linear-gradient(180deg, #28c95f, #16a34a)',
            boxShadow: '0 2px 6px rgba(22,163,74,.35)',
          }}
        >
          + Crear Marca Blanca
        </button>
      </div>

      <div className="flex items-center gap-3 mt-5 mb-4 flex-wrap">
        <div className="flex-1 relative min-w-[280px]">
          <span
            className="absolute"
            style={{ left: 14, top: '50%', transform: 'translateY(-50%)', color: '#9aa4af' }}
          >
            🔍
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar marca o dominio…"
            className="w-full text-sm"
            style={{
              padding: '11px 14px 11px 40px',
              borderRadius: 9,
              border: '1px solid #d7dbe0',
              background: 'white',
              color: '#16241c',
            }}
          />
        </div>
        <div className="flex gap-1.5">
          {([
            { v: 'todas', l: 'Todas' },
            { v: 'activas', l: 'Activas' },
            { v: 'suspendidas', l: 'Suspendidas' },
          ] as const).map((f) => (
            <button
              key={f.v}
              onClick={() => setFilter(f.v)}
              className="text-sm font-semibold transition"
              style={{
                padding: '9px 14px',
                borderRadius: 10,
                background: filter === f.v ? '#16241c' : 'white',
                color: filter === f.v ? 'white' : '#2b3a30',
                border: '1px solid #d7dbe0',
              }}
            >
              {f.l}
            </button>
          ))}
        </div>
      </div>

      <div
        className="rounded-[14px] overflow-hidden"
        style={{
          background: 'white',
          border: '1px solid #e7e9ec',
          boxShadow: '0 1px 2px rgba(16,24,40,.04)',
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left" style={{ minWidth: 1180, borderCollapse: 'collapse' }}>
            <thead style={{ background: '#fafbfc', borderBottom: '1px solid #eef0f2' }}>
              <tr>
                {['Marca', 'Estado', 'Admins', 'Créditos disp.', 'Comprometidos', 'Neg. activos', 'Neg. susp.', 'Creada', 'Acciones'].map(
                  (h, i) => (
                    <th
                      key={h}
                      className="text-[11px] font-bold uppercase whitespace-nowrap"
                      style={{
                        padding: '14px 16px',
                        letterSpacing: 0.5,
                        color: '#9aa4af',
                        textAlign: i === 2 || (i >= 3 && i <= 6) ? 'center' : 'left',
                      }}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((w) => (
                <tr
                  key={w.id}
                  onClick={() => router.push('/superadmin/marcas?brand=' + w.id)}
                  className="cursor-pointer transition"
                  style={{ borderBottom: '1px solid #eef0f2' }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#f7fbf8')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'white')}
                >
                  <td style={{ padding: '14px 16px' }}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-10 h-10 rounded-[10px] flex items-center justify-center text-white font-bold shrink-0 text-sm"
                        style={{ background: w.primaryColor }}
                      >
                        {w.initial ?? w.name[0]?.toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-[13.5px]" style={{ color: '#16241c' }}>
                          {w.name}
                        </div>
                        <div className="text-xs" style={{ color: '#6b7785' }}>
                          {w.domain ?? '—'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <StatusBadge status={w.status} />
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'center', color: '#16241c' }}>
                    {w.adminsCount}
                  </td>
                  <td
                    style={{
                      padding: '14px 16px',
                      textAlign: 'center',
                      color: w.creditsUnlimited
                        ? '#15803d'
                        : w.creditsAvailable < w.creditsCommitted
                        ? '#b45309'
                        : '#16a34a',
                      fontWeight: 700,
                    }}
                  >
                    {w.creditsUnlimited ? '∞' : w.creditsAvailable}
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'center', color: '#2563eb', fontWeight: 600 }}>
                    {w.creditsUnlimited ? '—' : w.creditsCommitted}
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'center', color: '#16241c' }}>
                    {w.tenantsActive}
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'center', color: '#6b7785' }}>
                    {w.tenantsSuspended}
                  </td>
                  <td style={{ padding: '14px 16px', color: '#6b7785', fontSize: 12 }}>
                    {new Date(w.createdAt).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <BrandRowActions
                      status={w.status}
                      onEnter={() => router.push('/superadmin/marcas?brand=' + w.id)}
                      onToggle={() => toggleStatus(w)}
                    />
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ padding: 30, textAlign: 'center', color: '#9aa4af', fontSize: 14 }}>
                    Sin marcas con los filtros actuales.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {createOpen && (
        <CreateModal
          onClose={() => {
            setCreateOpen(false);
            router.replace('/superadmin/marcas');
          }}
          onCreated={(w) => {
            setCreateOpen(false);
            router.replace('/superadmin/marcas');
            flashToast(`${w.name} creada`);
            load();
            router.push('/superadmin/marcas?brand=' + w.id);
          }}
        />
      )}

      {toast && (
        <div
          className="fixed left-1/2 bottom-7 -translate-x-1/2 px-4 py-2.5 rounded-[10px] text-sm font-semibold shadow-lg z-50"
          style={{
            background: '#0f172a',
            color: 'white',
            boxShadow: '0 12px 30px rgba(0,0,0,.25)',
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: 'ACTIVE' | 'SUSPENDED' }) {
  const isActive = status === 'ACTIVE';
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-[7px]"
      style={{
        background: isActive ? '#dcfce7' : '#fee2e2',
        color: isActive ? '#15803d' : '#b91c1c',
      }}
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ background: isActive ? '#16a34a' : '#b91c1c' }}
      />
      {isActive ? 'Activa' : 'Suspendida'}
    </span>
  );
}

function BrandDetailFull({
  id,
  onBack,
}: {
  id: string;
  onBack: () => void;
}) {
  const router = useRouter();
  const [w, setW] = useState<WhiteLabelDetail | null>(null);
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [entering, setEntering] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Página completa (no drawer): gestiona su propio toast y refresca sus datos
  // al cambiar. `onClose` = volver a la lista de marcas.
  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2400);
  };
  const onClose = onBack;
  const onChanged = (msg: string) => {
    flash(msg);
    reloadAdmins();
  };

  async function reloadAdmins() {
    try {
      const [detail, inv] = await Promise.all([
        api<WhiteLabelDetail>(`/superadmin/white-labels/${id}`),
        api<AdminInvite[]>(`/superadmin/white-labels/${id}/admin-invites`),
      ]);
      setW(detail);
      setInvites(inv);
    } catch (e: any) {
      console.error(e);
    }
  }

  async function toggleAdminActive(userId: string, next: boolean) {
    if (!confirm(`¿${next ? 'Reactivar' : 'Desactivar'} este admin?`)) return;
    try {
      await api(`/superadmin/white-label-admins/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: next }),
      });
      reloadAdmins();
    } catch (e: any) {
      onChanged(e.message ?? 'Error');
    }
  }

  async function revokeInvite(inviteId: string) {
    if (!confirm('¿Revocar invitación?')) return;
    try {
      await api(`/superadmin/white-label-admin-invites/${inviteId}`, { method: 'DELETE' });
      reloadAdmins();
    } catch (e: any) {
      onChanged(e.message ?? 'Error');
    }
  }

  async function enterAs() {
    if (!w) return;
    setEntering(true);
    try {
      const r = await api<{ accessToken: string; user: any; whiteLabel: any }>(
        `/superadmin/white-labels/${w.id}/impersonate`,
        { method: 'POST' },
      );
      startImpersonation({
        accessToken: r.accessToken,
        user: r.user,
        tenant: {
          id: r.whiteLabel.id,
          brandName: r.whiteLabel.name,
          primaryColor: r.whiteLabel.primaryColor,
          slug: w.slug,
        },
      });
      // Llevar al panel de la marca por su slug (ej. /admin/sellea). El
      // middleware reescribe a /admin sirviendo el mismo panel. Clubify u
      // otra marca sin slug cae al /admin global.
      router.push(w.slug ? `/admin/${w.slug}` : '/admin');
    } catch (e: any) {
      onChanged(e.message ?? 'No se pudo entrar');
    } finally {
      setEntering(false);
    }
  }
  useEffect(() => {
    reloadAdmins();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function toggleStatus() {
    if (!w) return;
    const next = w.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    if (next === 'SUSPENDED') {
      const ok = window.confirm(
        `¿Suspender la marca "${w.name}"?\n\nSus negocios dejarán de funcionar (acceso bloqueado) hasta que la reactives.`,
      );
      if (!ok) return;
    }
    try {
      await api(`/superadmin/white-labels/${w.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      });
      onChanged(`${w.name} ${next === 'SUSPENDED' ? 'suspendida' : 'reactivada'}`);
      onClose();
    } catch (e: any) {
      onChanged(e.message ?? 'Error');
    }
  }

  return (
    <div className="max-w-6xl mx-auto pb-12">
      {/* Barra superior: volver + acciones principales */}
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <button
          onClick={onClose}
          className="inline-flex items-center gap-1.5 text-sm font-semibold"
          style={{
            color: '#16241c',
            padding: '8px 13px',
            borderRadius: 9,
            background: 'white',
            border: '1px solid #d7dbe0',
          }}
        >
          ← Volver a marcas
        </button>
        {w && (
          <div className="flex gap-2">
            <button
              onClick={enterAs}
              disabled={entering || w.status === 'SUSPENDED'}
              className="py-2.5 px-4 rounded-[10px] text-sm font-bold text-white disabled:opacity-50"
              style={{
                background: 'linear-gradient(180deg, #28c95f, #16a34a)',
                boxShadow: '0 2px 6px rgba(22,163,74,.35)',
              }}
              title={
                w.status === 'SUSPENDED'
                  ? 'Reactiva la marca primero'
                  : 'Iniciar sesión como super admin de esta marca'
              }
            >
              {entering ? 'Entrando…' : 'Entrar como empresa'}
            </button>
            <button
              onClick={toggleStatus}
              className="text-sm font-semibold px-4 py-2.5 rounded-[10px]"
              style={{
                background: 'white',
                color: w.status === 'ACTIVE' ? '#b91c1c' : '#15803d',
                border: `1px solid ${w.status === 'ACTIVE' ? '#fecaca' : '#bbf7d0'}`,
              }}
            >
              {w.status === 'ACTIVE' ? 'Suspender' : 'Activar'}
            </button>
          </div>
        )}
      </div>

      {!w ? (
        <div className="p-6 text-sm" style={{ color: '#9aa4af' }}>
          Cargando…
        </div>
      ) : (
        <>
          {/* Cabecera de la marca */}
          <div
            className="flex items-center gap-3 p-5 rounded-[14px] mb-5 flex-wrap"
            style={{
              background: 'white',
              border: '1px solid #e7e9ec',
              boxShadow: '0 1px 2px rgba(16,24,40,.04)',
            }}
          >
            <div
              className="w-14 h-14 rounded-[14px] flex items-center justify-center text-white font-bold shrink-0 text-lg"
              style={{ background: w.primaryColor }}
            >
              {w.initial ?? w.name[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-[20px]" style={{ color: '#16241c' }}>
                {w.name}
              </div>
              <div className="text-sm" style={{ color: '#6b7785' }}>
                {w.domain ?? '—'}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge status={w.status} />
              <span className="text-xs" style={{ color: '#6b7785' }}>
                Creada el{' '}
                {new Date(w.createdAt).toLocaleDateString('es-MX', {
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
            </div>
          </div>

          {/* Secciones en grid amplio (2 columnas en pantallas grandes) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
              <div>
                <SectionTitle>Créditos</SectionTitle>
                {w.creditsUnlimited ? (
                  <div
                    className="mt-2 p-4 rounded-[12px] flex items-center gap-3"
                    style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}
                  >
                    <div
                      className="w-12 h-12 rounded-[10px] flex items-center justify-center text-xl font-black"
                      style={{ background: '#dcfce7', color: '#15803d' }}
                    >
                      ∞
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold" style={{ color: '#15803d' }}>
                        Créditos ilimitados
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: '#16241c' }}>
                        Sin descuento en renovaciones · {w.creditsUsed} usados históricos
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    <CreditCard label="Disponibles" value={w.creditsAvailable} color="#16a34a" bg="#f0fdf4" />
                    <CreditCard label="Comprometidos" value={w.creditsCommitted} color="#2563eb" bg="#eff6ff" />
                    <CreditCard label="Usados" value={w.creditsUsed} color="#6b7785" bg="#f7fbf8" />
                  </div>
                )}
                <button
                  onClick={async () => {
                    const next = !w.creditsUnlimited;
                    const verb = next ? 'activar' : 'desactivar';
                    if (!confirm(`¿${verb[0].toUpperCase() + verb.slice(1)} créditos ilimitados para ${w.name}?`)) return;
                    try {
                      await api(`/superadmin/white-labels/${w.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ creditsUnlimited: next }),
                      });
                      onChanged(`Créditos ilimitados ${next ? 'activados' : 'desactivados'}`);
                      // refresca drawer
                      const fresh = await api<WhiteLabelDetail>(`/superadmin/white-labels/${id}`);
                      setW(fresh);
                    } catch (e: any) {
                      onChanged(e.message ?? 'Error');
                    }
                  }}
                  className="text-xs font-semibold mt-2"
                  style={{
                    padding: '5px 11px',
                    borderRadius: 7,
                    background: 'white',
                    color: w.creditsUnlimited ? '#b91c1c' : '#15803d',
                    border: '1px solid #d7dbe0',
                  }}
                >
                  {w.creditsUnlimited ? 'Desactivar ilimitados' : 'Activar ilimitados'}
                </button>
              </div>

              <div className="lg:col-span-2">
              <BrandingConfig
                whiteLabelId={w.id}
                initial={{
                  logoUrl: w.logoUrl,
                  iconUrl: w.iconUrl,
                  faviconUrl: w.faviconUrl,
                  primaryColor: w.primaryColor,
                  secondaryColor: w.secondaryColor,
                  backgroundColor: w.backgroundColor,
                  supportColor: w.supportColor,
                  instagram: w.instagram,
                  contactEmail: w.contactEmail,
                  notifyPhone: w.notifyPhone,
                  mapsApiKey: w.mapsApiKey,
                  shareImageUrl: w.shareImageUrl ?? null,
                  subscriptionFeatureKeys: w.subscriptionFeatureKeys ?? [],
                  installationFeeUsd:
                    w.installationFeeUsd != null ? Number(w.installationFeeUsd) : null,
                  installationPromoUsd:
                    w.installationPromoUsd != null ? Number(w.installationPromoUsd) : null,
                }}
                onSaved={(msg) => {
                  reloadAdmins();
                  onChanged(msg);
                }}
              />
              </div>

              <DomainConfig
                whiteLabelId={w.id}
                slug={w.slug}
                domain={w.domain}
                appDomain={w.appDomain}
                onSaved={(msg) => {
                  reloadAdmins();
                  onChanged(msg);
                }}
              />

              <PaymentGatewayConfig whiteLabelId={w.id} brandSlug={w.slug} onSaved={onChanged} />

              <BrandSmsAccountConfig whiteLabelId={w.id} onSaved={onChanged} />

              <WhatsAppQrConfig
                whiteLabelId={w.id}
                initial={w.whatsappQrUrl ?? ''}
                onSaved={(msg) => {
                  reloadAdmins();
                  onChanged(msg);
                }}
              />

              <HotmartCreditConfig whiteLabelId={w.id} onSaved={onChanged} />

              <PlanPeriodicitiesConfig
                whiteLabelId={w.id}
                initial={w.planPeriodicities ?? []}
                onSaved={onChanged}
              />

              <WalletAdvancedConfig
                whiteLabelId={w.id}
                initial={w.walletAdvanced ?? null}
                onSaved={onChanged}
              />

              <div>
                <SectionTitle>Módulos activos</SectionTitle>
                <div className="mt-2 space-y-1.5">
                  {w.modules.map((m) => (
                    <div
                      key={m.module}
                      className="flex items-center justify-between text-sm"
                      style={{ color: '#2b3a30' }}
                    >
                      <span>{MODULE_LABELS[m.module] ?? m.module}</span>
                      <span
                        className="text-[11px] font-bold px-2 py-0.5 rounded-[7px]"
                        style={{
                          background: m.enabled ? '#dcfce7' : '#f3f4f6',
                          color: m.enabled ? '#15803d' : '#9aa4af',
                        }}
                      >
                        {m.enabled ? 'Activo' : 'Inactivo'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="lg:col-span-2">
                <div className="flex items-center justify-between mb-2">
                  <SectionTitle>Administradores ({w.admins.length})</SectionTitle>
                  <button
                    onClick={() => setInviteOpen(true)}
                    className="text-xs font-semibold"
                    style={{
                      padding: '6px 11px',
                      borderRadius: 8,
                      background: w.primaryColor,
                      color: 'white',
                      border: 'none',
                    }}
                  >
                    + Admin
                  </button>
                </div>
                {w.admins.length === 0 && invites.length === 0 ? (
                  <p className="text-sm italic" style={{ color: '#9aa4af' }}>
                    Sin admins registrados todavía. Invita al primero.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {w.admins.map((a) => {
                      const isDedicated = a.whiteLabelId === w.id;
                      return (
                        <div key={a.id} className="flex items-center gap-2.5">
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                            style={{
                              background: a.isActive ? '#f0fdf4' : '#f3f4f6',
                              color: a.isActive ? '#15803d' : '#9aa4af',
                            }}
                          >
                            {(a.fullName || a.email)[0]?.toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0 text-sm">
                            <div className="font-semibold truncate flex items-center gap-1.5" style={{ color: '#16241c' }}>
                              {a.fullName ?? a.email}
                              {isDedicated && (
                                <span
                                  className="text-[9px] font-bold uppercase px-1 py-0.5 rounded"
                                  style={{ background: '#dcfce7', color: '#15803d', letterSpacing: 0.4 }}
                                >
                                  De la marca
                                </span>
                              )}
                              {!a.isActive && (
                                <span
                                  className="text-[9px] font-bold uppercase px-1 py-0.5 rounded"
                                  style={{ background: '#fee2e2', color: '#991b1b', letterSpacing: 0.4 }}
                                >
                                  Inactivo
                                </span>
                              )}
                            </div>
                            <div className="text-xs truncate" style={{ color: '#6b7785' }}>
                              {a.email} · {a.role.replace('_', ' ').toLowerCase()}
                            </div>
                          </div>
                          {isDedicated && (
                            <button
                              onClick={() => toggleAdminActive(a.id, !a.isActive)}
                              className="text-[11px] font-semibold shrink-0"
                              style={{
                                padding: '5px 9px',
                                borderRadius: 7,
                                background: 'white',
                                color: a.isActive ? '#b91c1c' : '#15803d',
                                border: '1px solid #d7dbe0',
                              }}
                            >
                              {a.isActive ? 'Desactivar' : 'Reactivar'}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {invites.length > 0 && (
                  <>
                    <div
                      className="text-[10px] font-bold uppercase mt-3 mb-1.5"
                      style={{ letterSpacing: 0.7, color: '#9aa4af' }}
                    >
                      Invitaciones pendientes
                    </div>
                    <div className="space-y-1.5">
                      {invites.map((inv) => {
                        const days = Math.max(
                          0,
                          Math.ceil((new Date(inv.expiresAt).getTime() - Date.now()) / 86400000),
                        );
                        return (
                          <div
                            key={inv.id}
                            className="flex items-center justify-between text-xs px-2.5 py-2 rounded-[8px]"
                            style={{ background: '#fefce8', border: '1px solid #fde68a' }}
                          >
                            <div className="min-w-0">
                              <div className="font-semibold truncate" style={{ color: '#854d0e' }}>
                                {inv.fullName}
                              </div>
                              <div className="truncate" style={{ color: '#a16207' }}>
                                {inv.email} · vence en {days}d
                              </div>
                            </div>
                            <button
                              onClick={() => revokeInvite(inv.id)}
                              className="text-[11px] font-semibold shrink-0 ml-2"
                              style={{
                                padding: '5px 9px',
                                borderRadius: 7,
                                background: 'white',
                                color: '#b91c1c',
                                border: '1px solid #fde68a',
                              }}
                            >
                              Revocar
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>

            {inviteOpen && (
              <InviteWhiteLabelAdminModal
                whiteLabelId={w.id}
                whiteLabelName={w.name}
                primaryColor={w.primaryColor}
                onClose={() => setInviteOpen(false)}
                onCreated={(msg) => {
                  setInviteOpen(false);
                  reloadAdmins();
                  onChanged(msg ?? 'Listo');
                }}
              />
            )}
          </>
        )}
        {toast && (
          <div
            className="fixed left-1/2 bottom-7 -translate-x-1/2 px-4 py-2.5 rounded-[10px] text-sm font-semibold shadow-lg z-50"
            style={{
              background: '#0f172a',
              color: 'white',
              boxShadow: '0 12px 30px rgba(0,0,0,.25)',
            }}
          >
            {toast}
          </div>
        )}
    </div>
  );
}

function InviteWhiteLabelAdminModal({
  whiteLabelId,
  whiteLabelName,
  primaryColor,
  onClose,
  onCreated,
}: {
  whiteLabelId: string;
  whiteLabelName: string;
  primaryColor: string;
  onClose: () => void;
  onCreated: (message?: string) => void;
}) {
  // Default: creación DIRECTA con contraseña (queda listo para ingresar). La
  // invitación por email es opcional (toggle).
  const [mode, setMode] = useState<'password' | 'invite'>('password');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const passwordValid = mode === 'invite' || password.trim().length >= 8;
  const canSubmit = !!email.trim() && !!fullName.trim() && passwordValid;

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      if (mode === 'password') {
        await api(`/superadmin/white-labels/${whiteLabelId}/admins`, {
          method: 'POST',
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            fullName: fullName.trim(),
            password: password.trim(),
          }),
        });
        onCreated('Administrador creado');
      } else {
        await api(`/superadmin/white-labels/${whiteLabelId}/admin-invites`, {
          method: 'POST',
          body: JSON.stringify({ email: email.trim().toLowerCase(), fullName: fullName.trim() }),
        });
        onCreated('Invitación enviada');
      }
    } catch (e: any) {
      alert('Error: ' + (e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = {
    padding: '9px 12px',
    borderRadius: 8,
    border: '1px solid #d7dbe0',
    fontSize: 13.5,
    outline: 'none',
    background: 'white',
  } as const;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,30,22,.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-[16px] p-6"
        style={{ background: 'white', boxShadow: '0 20px 50px rgba(0,0,0,.25)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="m-0" style={{ fontSize: 18, fontWeight: 800, color: '#16241c' }}>
          Nuevo admin de {whiteLabelName}
        </h3>

        {/* Toggle modo */}
        <div className="flex gap-1 p-1 rounded-lg mt-4 mb-4" style={{ background: '#eef1f0' }}>
          {(
            [
              { v: 'password', label: 'Crear con contraseña' },
              { v: 'invite', label: 'Invitar por email' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.v}
              onClick={() => setMode(opt.v)}
              className="flex-1 text-[12.5px] font-semibold py-2 rounded-md transition"
              style={
                mode === opt.v
                  ? { background: 'white', color: '#16241c', boxShadow: '0 1px 2px rgba(0,0,0,.08)' }
                  : { background: 'transparent', color: '#6b7785' }
              }
            >
              {opt.label}
            </button>
          ))}
        </div>

        <p className="text-sm mb-5" style={{ color: '#6b7785' }}>
          {mode === 'password'
            ? 'El admin queda creado y listo para ingresar de inmediato con esta contraseña.'
            : 'Le llegará un email con un link para definir su contraseña. El link vence en 7 días.'}
        </p>

        <div className="space-y-3">
          <label className="block">
            <div className="text-[11px] font-bold uppercase mb-1.5" style={{ letterSpacing: 0.6, color: '#6b7785' }}>
              Nombre completo
            </div>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="María Pérez"
              autoFocus
              className="w-full"
              style={inputStyle}
            />
          </label>
          <label className="block">
            <div className="text-[11px] font-bold uppercase mb-1.5" style={{ letterSpacing: 0.6, color: '#6b7785' }}>
              Email
            </div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="maria@empresa.com"
              className="w-full"
              style={inputStyle}
            />
          </label>
          {mode === 'password' && (
            <label className="block">
              <div className="text-[11px] font-bold uppercase mb-1.5" style={{ letterSpacing: 0.6, color: '#6b7785' }}>
                Contraseña
              </div>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                className="w-full"
                style={inputStyle}
              />
              {password.length > 0 && password.length < 8 && (
                <div className="text-[11px] mt-1" style={{ color: '#b91c1c' }}>
                  Mínimo 8 caracteres.
                </div>
              )}
            </label>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            disabled={saving}
            className="text-sm font-semibold"
            style={{ padding: '9px 14px', borderRadius: 9, background: 'white', color: '#6b7785', border: '1px solid #d7dbe0' }}
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit || saving}
            className="text-sm font-semibold"
            style={{
              padding: '9px 18px',
              borderRadius: 9,
              background: !canSubmit ? '#cbd5d2' : primaryColor,
              color: 'white',
              border: 'none',
            }}
          >
            {saving
              ? mode === 'password'
                ? 'Creando…'
                : 'Enviando…'
              : mode === 'password'
              ? 'Crear admin'
              : 'Enviar invitación'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (w: WhiteLabel) => void;
}) {
  const PALETTE = ['#16a34a', '#2563eb', '#7c3aed', '#ea580c', '#0891b2', '#db2777', '#ca8a04'];
  const [form, setForm] = useState({
    name: '',
    domain: '',
    appDomain: '',
    primaryColor: '#16a34a',
    adminEmail: '',
    creditsUnlimited: false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const created = await api<WhiteLabel>('/superadmin/white-labels', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      onCreated(created);
    } catch (e: any) {
      setErr(e.message ?? 'Error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,.4)' }}
      onClick={onClose}
    >
      <div
        className="rounded-[14px] p-6 w-full"
        style={{
          maxWidth: 520,
          background: 'white',
          boxShadow: '0 24px 70px rgba(0,0,0,.28)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="m-0" style={{ fontSize: 20, fontWeight: 800, color: '#16241c' }}>
            Crear Marca Blanca
          </h2>
          <button onClick={onClose} className="text-xl leading-none" style={{ color: '#9aa4af' }}>
            ×
          </button>
        </div>
        <p className="text-sm mt-1 mb-5" style={{ color: '#6b7785' }}>
          Una nueva empresa que revenderá el servicio bajo su propia marca.
        </p>

        <form onSubmit={submit} className="space-y-3">
          <Field label="Nombre comercial">
            <input
              required
              className="w-full text-sm"
              style={{
                padding: '10px 12px',
                borderRadius: 9,
                border: '1px solid #d7dbe0',
              }}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="LoyalMX"
            />
          </Field>
          <Field label="Dominio principal">
            <input
              className="w-full text-sm"
              style={{
                padding: '10px 12px',
                borderRadius: 9,
                border: '1px solid #d7dbe0',
              }}
              value={form.domain}
              onChange={(e) => setForm({ ...form, domain: e.target.value })}
              placeholder="loyalmx.app"
            />
          </Field>
          <Field label="Dominio del panel">
            <input
              className="w-full text-sm"
              style={{
                padding: '10px 12px',
                borderRadius: 9,
                border: '1px solid #d7dbe0',
              }}
              value={form.appDomain}
              onChange={(e) => setForm({ ...form, appDomain: e.target.value })}
              placeholder="app.loyalmx.app"
            />
          </Field>
          <Field label="Color corporativo">
            <div className="flex gap-2">
              {PALETTE.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setForm({ ...form, primaryColor: c })}
                  className="w-9 h-9 rounded-[10px]"
                  style={{
                    background: c,
                    border: form.primaryColor === c ? '2.5px solid #16241c' : '2.5px solid transparent',
                  }}
                />
              ))}
            </div>
          </Field>
          <Field label="Admin principal (email)">
            <input
              type="email"
              className="w-full text-sm"
              style={{
                padding: '10px 12px',
                borderRadius: 9,
                border: '1px solid #d7dbe0',
              }}
              value={form.adminEmail}
              onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
              placeholder="admin@loyalmx.app"
            />
          </Field>

          <label
            className="flex items-start gap-3 p-3 rounded-[10px] cursor-pointer"
            style={{
              background: form.creditsUnlimited ? '#f0fdf4' : '#f7fbf8',
              border: `1px solid ${form.creditsUnlimited ? '#bbf7d0' : '#e7e9ec'}`,
            }}
          >
            <input
              type="checkbox"
              checked={form.creditsUnlimited}
              onChange={(e) => setForm({ ...form, creditsUnlimited: e.target.checked })}
              className="mt-0.5"
              style={{ width: 16, height: 16 }}
            />
            <div className="flex-1">
              <div className="text-sm font-bold" style={{ color: '#16241c' }}>
                Créditos ilimitados ∞
              </div>
              <div className="text-xs mt-0.5" style={{ color: '#6b7785' }}>
                La marca nunca se queda sin créditos: el cron de renovaciones extiende los negocios sin descontar y los packs Hotmart no incrementan.
              </div>
            </div>
          </label>

          {err && (
            <div className="text-sm" style={{ color: '#b91c1c' }}>
              {err}
            </div>
          )}

          <div className="flex gap-2 justify-end pt-3">
            <button
              type="button"
              onClick={onClose}
              className="text-sm font-semibold px-4 py-2.5 rounded-[10px]"
              style={{ background: 'white', color: '#2b3a30', border: '1px solid #d7dbe0' }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="text-sm font-bold px-5 py-2.5 rounded-[10px] text-white"
              style={{
                background: 'linear-gradient(180deg, #28c95f, #16a34a)',
                boxShadow: '0 2px 6px rgba(22,163,74,.35)',
              }}
            >
              {busy ? 'Creando…' : 'Crear marca'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[12px] font-bold uppercase" style={{ letterSpacing: 0.8, color: '#9aa4af' }}>
      {children}
    </div>
  );
}

function CreditCard({
  label,
  value,
  color,
  bg,
}: {
  label: string;
  value: number;
  color: string;
  bg: string;
}) {
  return (
    <div className="rounded-[10px] p-3" style={{ background: bg, border: `1px solid ${color}25` }}>
      <div className="text-[10px] font-bold uppercase" style={{ color, letterSpacing: 0.5 }}>
        {label}
      </div>
      <div className="mt-1" style={{ fontSize: 20, fontWeight: 800, color }}>
        {value}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label
        className="block text-[11.5px] font-bold uppercase mb-1.5"
        style={{ letterSpacing: 0.5, color: '#6b7785' }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

/** Acciones de una marca blanca como menú desplegable (Entrar / Suspender /
 *  Activar). Reemplaza los botones sueltos para dejar la fila más limpia y
 *  poder sumar acciones futuras sin ensanchar la tabla. */
function BrandRowActions({
  status,
  onEnter,
  onToggle,
}: {
  status: string;
  onEnter: () => void;
  onToggle: () => void;
}) {
  // Portal + posicionamiento inteligente (abre hacia arriba si no hay espacio)
  // → ya NO se recorta en la última fila por el overflow-x-auto de la tabla.
  return (
    <ActionsMenu
      label="Acciones ▾"
      buttonClassName="text-xs font-semibold px-3 py-1.5 rounded-md transition"
      buttonStyle={{ background: 'white', color: '#374151', border: '1px solid #e5e7eb' }}
      menuWidth={160}
    >
      {(close) => (
        <>
          <button
            onClick={() => {
              close();
              onEnter();
            }}
            className="block w-full text-left text-xs font-semibold px-3 py-2 transition hover:bg-gray-50"
            style={{ color: '#15803d' }}
          >
            Entrar
          </button>
          <button
            onClick={() => {
              close();
              onToggle();
            }}
            className="block w-full text-left text-xs font-semibold px-3 py-2 transition hover:bg-gray-50"
            style={{ color: status === 'ACTIVE' ? '#b91c1c' : '#15803d' }}
          >
            {status === 'ACTIVE' ? 'Suspender' : 'Activar'}
          </button>
        </>
      )}
    </ActionsMenu>
  );
}

// ── Pasarela de pago por marca ──────────────────────────────────────────────

type PayLink = {
  id: string;
  gateway: string;
  name: string;
  periodicity: string;
  amountUsd: number;
  url: string | null;
  active: boolean;
  sortOrder: number;
  stripePriceId: string | null;
  stripeProductId: string | null;
  // Producto especial freemium: INFOLINK_PRO (sube FREE→PRO) / FULL (negocio
  // completo). null = suscripción normal. El webhook lo usa para saber qué
  // otorga el pago (matchea por stripePriceId → aplica el entitlement).
  productKey: string | null;
};

const GATEWAYS = [
  { key: 'HOTMART', label: 'Hotmart' },
  { key: 'STRIPE', label: 'Stripe' },
  { key: 'CROSS', label: 'Cross' },
  { key: 'MANUAL', label: 'Manual' },
];
// Campos secretos (deben coincidir con PAYMENT_SECRET_FIELDS del backend): se
// muestran enmascarados y se mandan solo si el usuario tipea uno nuevo.
const PAYMENT_SECRET_UI = new Set(['apiKey', 'clientSecret', 'webhookSecret', 'secretKey']);
const PERIODICITIES = ['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL', 'CUSTOM'];

// Campos por pasarela: secret = se cifra (input vacío conserva el actual),
// plain = editable directo.
const GATEWAY_FIELDS: Record<string, { secret: { key: string; label: string }[]; plain: { key: string; label: string; placeholder?: string }[] }> = {
  HOTMART: {
    secret: [
      { key: 'apiKey', label: 'API Key' },
      { key: 'clientSecret', label: 'Client Secret' },
      { key: 'webhookSecret', label: 'Webhook Secret (HOTTOK)' },
    ],
    plain: [
      { key: 'clientId', label: 'Client ID' },
      { key: 'productCode', label: 'Código de producto' },
      { key: 'webhookUrl', label: 'URL Webhook', placeholder: 'https://api…/webhooks/hotmart/<slug>' },
    ],
  },
  STRIPE: {
    secret: [
      { key: 'secretKey', label: 'Secret Key (sk_live…)' },
      { key: 'webhookSecret', label: 'Webhook Secret (whsec…)' },
    ],
    plain: [
      { key: 'publishableKey', label: 'Publishable Key (pk_live…)' },
      { key: 'customerPortalUrl', label: 'Customer Portal URL' },
      { key: 'webhookUrl', label: 'URL Webhook', placeholder: 'https://api…/webhooks/stripe/<slug>' },
    ],
  },
  CROSS: {
    secret: [
      { key: 'apiKey', label: 'API Key' },
      { key: 'webhookSecret', label: 'Webhook Secret (firma HMAC)' },
    ],
    plain: [
      { key: 'companyId', label: 'Company ID (X-Company-Id)' },
      { key: 'companyName', label: 'Company Name (cliente registrado en Cross)', placeholder: 'Nombre exacto de tu empresa en Cross' },
      { key: 'paymentMethod', label: 'Método de pago', placeholder: 'card · pse' },
      { key: 'environment', label: 'Ambiente', placeholder: 'sandbox · production · dev' },
      { key: 'webhookUrl', label: 'URL Webhook', placeholder: 'https://api…/webhooks/cross/<slug>' },
    ],
  },
  MANUAL: { secret: [], plain: [] },
};

const payInput = {
  width: '100%',
  marginTop: 4,
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid #d7dbe0',
  background: 'white',
  color: '#16241c',
  fontSize: 13,
} as const;

/** Sección "Pasarela de pago": selector Hotmart/Stripe/Manual, campos por
 *  pasarela (secretos cifrados server-side, enmascarados al volver) y gestor
 *  de links de pago. Todo aislado por marca. */

/**
 * Periodicidades de plan que ofrece la marca. Controla qué opciones de
 * periodicidad muestra el form "Nuevo negocio" del admin (/admin/tenants/new).
 * Ej: Sellea solo Mensual + Anual.
 */
const PERIODICITY_OPTS = [
  { v: 'MENSUAL', label: 'Mensual' },
  { v: 'TRIMESTRAL', label: 'Trimestral' },
  { v: 'SEMESTRAL', label: 'Semestral' },
  { v: 'ANUAL', label: 'Anual' },
] as const;
function PlanPeriodicitiesConfig({
  whiteLabelId,
  initial,
  onSaved,
}: {
  whiteLabelId: string;
  initial: string[];
  onSaved: (msg: string) => void;
}) {
  const [sel, setSel] = useState<string[]>(
    initial?.length ? initial : PERIODICITY_OPTS.map((o) => o.v),
  );
  const [busy, setBusy] = useState(false);

  function toggle(v: string) {
    setSel((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));
  }

  async function save() {
    if (sel.length === 0) {
      onSaved('Elegí al menos una periodicidad');
      return;
    }
    setBusy(true);
    try {
      // Mantener el orden canónico.
      const ordered = PERIODICITY_OPTS.map((o) => o.v).filter((v) => sel.includes(v));
      await api(`/superadmin/white-labels/${whiteLabelId}`, {
        method: 'PATCH',
        body: JSON.stringify({ planPeriodicities: ordered }),
      });
      onSaved('Periodicidades actualizadas');
    } catch (e: any) {
      onSaved(e?.message ?? 'Error al guardar periodicidades');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SectionTitle>Planes / Periodicidades</SectionTitle>
      <div className="text-[11px] mt-1 mb-2" style={{ color: '#9aa4af' }}>
        Qué periodicidades ofrece esta marca (form &quot;Nuevo negocio&quot;).
      </div>
      <div className="grid grid-cols-2 gap-2">
        {PERIODICITY_OPTS.map((o) => {
          const on = sel.includes(o.v);
          return (
            <button
              key={o.v}
              type="button"
              onClick={() => toggle(o.v)}
              className="rounded-[8px] px-3 py-2 text-sm font-semibold text-left transition"
              style={{
                border: `2px solid ${on ? '#16a34a' : '#d6dcd9'}`,
                background: on ? '#dcfce7' : 'white',
                color: on ? '#15803d' : '#6b7785',
              }}
            >
              {on ? '✓ ' : ''}{o.label}
            </button>
          );
        })}
      </div>
      <button
        onClick={save}
        disabled={busy}
        className="mt-2.5 rounded-[8px] px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
        style={{ background: '#16a34a' }}
      >
        {busy ? 'Guardando…' : 'Guardar periodicidades'}
      </button>
    </div>
  );
}

// Wallet V3 — permisos "Wallet Avanzado" por marca. null / clave ausente =
// heredado (activo). La marca desactiva poniendo la clave en false.
const WALLET_ADVANCED_OPTS: { key: string; label: string; hint: string }[] = [
  { key: 'customBackgrounds', label: 'Permitir fondos personalizados', hint: 'Imagen de fondo del área de sellos' },
  { key: 'freeRewards', label: 'Permitir Premios Free', hint: 'Premios intermedios dentro de los sellos' },
  { key: 'removeStamps', label: 'Permitir Restar Sellos', hint: 'Botón −1 en el escáner' },
  { key: 'showNextReward', label: 'Mostrar Próximo Premio', hint: 'Mensaje dinámico del siguiente premio' },
  { key: 'showHistory', label: 'Mostrar Historial', hint: 'Historial de ajustes de sellos' },
  { key: 'showAudit', label: 'Mostrar Auditoría', hint: 'IP/dispositivo de cada ajuste' },
];

function WalletAdvancedConfig({
  whiteLabelId,
  initial,
  onSaved,
}: {
  whiteLabelId: string;
  initial: Record<string, boolean> | null;
  onSaved: (msg: string) => void;
}) {
  // Herencia: clave ausente/null = true (activo). La marca apaga poniendo false.
  const [flags, setFlags] = useState<Record<string, boolean>>(() => {
    const f: Record<string, boolean> = {};
    for (const o of WALLET_ADVANCED_OPTS) f[o.key] = initial?.[o.key] === false ? false : true;
    return f;
  });
  const [busy, setBusy] = useState(false);

  function toggle(k: string) {
    setFlags((s) => ({ ...s, [k]: !s[k] }));
  }

  async function save() {
    setBusy(true);
    try {
      await api(`/superadmin/white-labels/${whiteLabelId}`, {
        method: 'PATCH',
        body: JSON.stringify({ walletAdvanced: flags }),
      });
      onSaved('Wallet Avanzado actualizado');
    } catch (e: any) {
      onSaved(e?.message ?? 'Error al guardar Wallet Avanzado');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SectionTitle>Wallet Avanzado</SectionTitle>
      <div className="text-[11px] mt-1 mb-2" style={{ color: '#9aa4af' }}>
        Funciones nuevas de Wallet que esta marca permite a sus negocios. Apagar
        una oculta la función para todos sus negocios.
      </div>
      <div className="space-y-1.5">
        {WALLET_ADVANCED_OPTS.map((o) => {
          const on = flags[o.key];
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => toggle(o.key)}
              className="w-full rounded-[8px] px-3 py-2 text-left transition flex items-center justify-between gap-2"
              style={{
                border: `2px solid ${on ? '#16a34a' : '#d6dcd9'}`,
                background: on ? '#dcfce7' : 'white',
              }}
            >
              <span>
                <span className="block text-sm font-semibold" style={{ color: on ? '#15803d' : '#6b7785' }}>
                  {o.label}
                </span>
                <span className="block text-[11px]" style={{ color: '#9aa4af' }}>{o.hint}</span>
              </span>
              <span
                className="text-[11px] font-bold px-2 py-0.5 rounded-[7px] shrink-0"
                style={{
                  background: on ? '#16a34a' : '#f3f4f6',
                  color: on ? 'white' : '#9aa4af',
                }}
              >
                {on ? 'Activo' : 'Apagado'}
              </span>
            </button>
          );
        })}
      </div>
      <button
        onClick={save}
        disabled={busy}
        className="mt-2.5 rounded-[8px] px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
        style={{ background: '#16a34a' }}
      >
        {busy ? 'Guardando…' : 'Guardar Wallet Avanzado'}
      </button>
    </div>
  );
}

/**
 * Configuración de Créditos por MARCA BLANCA. La acreditación automática de
 * créditos identifica la marca por (Product ID + Offer ID) → este link →
 * whiteLabelId, INDEPENDIENTE del correo del comprador. Cada marca define sus
 * packs de 1 / 10 / 20 créditos con su Product ID y Offer ID de Hotmart.
 */
const CREDIT_PACKS = [1, 10, 20] as const;
function HotmartCreditConfig({
  whiteLabelId,
  onSaved,
}: {
  whiteLabelId: string;
  onSaved: (msg: string) => void;
}) {
  type Row = {
    id: string | null;
    credits: number;
    productId: string;
    offerCode: string;
  };
  const [rows, setRows] = useState<Row[]>(
    CREDIT_PACKS.map((c) => ({ id: null, credits: c, productId: '', offerCode: '' })),
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Ofertas COMPARTIDAS con url (típicamente las de Clubify): la marca compra por
  // esos links + su token ?src=wl_<id> (Modelo B). Se muestran abajo para copiar.
  const [sharedLinks, setSharedLinks] = useState<any[]>([]);

  async function load() {
    setLoading(true);
    try {
      const links =
        (await api(`/superadmin/hotmart-links?whiteLabelId=${whiteLabelId}`)) ?? [];
      setRows(
        CREDIT_PACKS.map((c) => {
          const l = (links as any[]).find((x) => x.credits === c);
          return {
            id: l?.id ?? null,
            credits: c,
            productId: l?.hotmartProductId ?? '',
            offerCode: l?.hotmartOfferCode ?? '',
          };
        }),
      );
      // Links compartidos (con url) para generar los de esta marca con token.
      const all = (await api(`/superadmin/hotmart-links`)) ?? [];
      setSharedLinks(
        (all as any[]).filter((x) => x?.isActive && x?.url && x?.hotmartProductId),
      );
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [whiteLabelId]);

  function setRow(credits: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.credits === credits ? { ...r, ...patch } : r)));
  }

  async function save() {
    setBusy(true);
    try {
      for (const r of rows) {
        const productId = r.productId.trim();
        const offerCode = r.offerCode.trim();
        const hasData = productId || offerCode;
        if (r.id) {
          // Existe: actualizar productId/offerCode (o desactivar si quedó vacío).
          await api(`/superadmin/hotmart-links/${r.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              hotmartProductId: productId || null,
              hotmartOfferCode: offerCode || null,
              isActive: !!hasData,
            }),
          });
        } else if (hasData) {
          // Nuevo: crear el pack para esta marca.
          await api(`/superadmin/hotmart-links`, {
            method: 'POST',
            body: JSON.stringify({
              credits: r.credits,
              label: `${r.credits} crédito${r.credits === 1 ? '' : 's'}`,
              hotmartProductId: productId || null,
              hotmartOfferCode: offerCode || null,
              whiteLabelId,
            }),
          });
        }
      }
      onSaved('Configuración de créditos guardada');
      await load();
    } catch (e: any) {
      onSaved(e?.message ?? 'Error al guardar créditos');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SectionTitle>Configuración de Créditos (Hotmart)</SectionTitle>
      <div className="text-[11px] mt-1 mb-2" style={{ color: '#9aa4af' }}>
        La acreditación automática identifica la marca por Product ID + Offer ID
        (no por el correo del comprador). Cargá los IDs de Hotmart de cada pack.
      </div>
      {loading ? (
        <div className="text-sm" style={{ color: '#9aa4af' }}>Cargando…</div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div
              key={r.credits}
              className="rounded-[10px] p-2.5"
              style={{ background: '#f8faf9', border: '1px solid #e5e9e7' }}
            >
              <div className="text-[12px] font-bold mb-1.5" style={{ color: '#2b3a30' }}>
                {r.credits} crédito{r.credits === 1 ? '' : 's'}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={r.productId}
                  onChange={(e) => setRow(r.credits, { productId: e.target.value })}
                  placeholder="Product ID"
                  className="w-full rounded-[8px] px-2 py-1.5 text-sm"
                  style={{ border: '1px solid #d6dcd9' }}
                />
                <input
                  value={r.offerCode}
                  onChange={(e) => setRow(r.credits, { offerCode: e.target.value })}
                  placeholder="Offer ID"
                  className="w-full rounded-[8px] px-2 py-1.5 text-sm"
                  style={{ border: '1px solid #d6dcd9' }}
                />
              </div>
            </div>
          ))}
          <button
            onClick={save}
            disabled={busy}
            className="rounded-[8px] px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
            style={{ background: '#16a34a' }}
          >
            {busy ? 'Guardando…' : 'Guardar créditos'}
          </button>
        </div>
      )}

      {sharedLinks.length > 0 && (
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid #e5e9e7' }}>
          <div className="text-[12px] font-bold mb-1" style={{ color: '#2b3a30' }}>
            Links de compra de esta marca (con token)
          </div>
          <div className="text-[11px] mb-2" style={{ color: '#9aa4af' }}>
            Comparte estos links con el dueño de la marca. El token{' '}
            <code>?src=wl_…</code> hace que los créditos se acrediten a ESTA marca
            sin importar con qué correo pague.
          </div>
          <div className="space-y-1.5">
            {sharedLinks.map((l) => {
              const base = String(l.url);
              const link =
                base + (base.includes('?') ? '&' : '?') + 'src=wl_' + whiteLabelId;
              return (
                <div
                  key={l.id}
                  className="flex items-center gap-2 rounded-[8px] p-2"
                  style={{ background: '#f8faf9', border: '1px solid #e5e9e7' }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-bold" style={{ color: '#2b3a30' }}>
                      {l.credits} crédito{l.credits === 1 ? '' : 's'}
                      {l.price ? ` · ${l.price} ${l.currency || ''}` : ''}
                    </div>
                    <div className="text-[10px] truncate" style={{ color: '#6b7280' }}>
                      {link}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      navigator.clipboard
                        ?.writeText(link)
                        .then(
                          () => onSaved('Link copiado'),
                          () => onSaved('No se pudo copiar'),
                        )
                    }
                    className="rounded-[7px] px-2 py-1 text-[11px] font-bold text-white shrink-0"
                    style={{ background: '#2b3a30' }}
                  >
                    Copiar
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Subcuenta Grow Business (GoHighLevel) de la MARCA — desde donde salen TODOS
 *  los SMS de sus negocios (cobros, domicilio, reseñas). apiKey se guarda
 *  cifrado server-side; se muestra enmascarado. */
function BrandSmsAccountConfig({
  whiteLabelId,
  onSaved,
}: {
  whiteLabelId: string;
  onSaved: (msg: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [locationId, setLocationId] = useState('');
  const [switchNumber, setSwitchNumber] = useState('');
  const [apiKeyMask, setApiKeyMask] = useState<string | null>(null);
  const [apiKeyNew, setApiKeyNew] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const d = await api(`/superadmin/white-labels/${whiteLabelId}/sms-account`);
      if (d) {
        setLocationId(d.locationId ?? '');
        setSwitchNumber(d.switchNumber != null ? String(d.switchNumber) : '');
        setApiKeyMask(d.apiKeyMask ?? null);
        setApiKeyNew('');
      }
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [whiteLabelId]);

  async function save() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        locationId: locationId.trim() || null,
        switchNumber: switchNumber.trim() ? Number(switchNumber) : null,
      };
      if (apiKeyNew.trim()) body.apiKey = apiKeyNew.trim();
      await api(`/superadmin/white-labels/${whiteLabelId}/sms-account`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      onSaved('Subcuenta SMS actualizada');
      await load();
    } catch (e: any) {
      onSaved(e.message ?? 'Error al guardar subcuenta SMS');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div>
        <SectionTitle>Subcuenta SMS de la marca (Grow Business)</SectionTitle>
        <div className="mt-2 text-sm" style={{ color: '#9aa4af' }}>Cargando…</div>
      </div>
    );
  }

  return (
    <div>
      <SectionTitle>Subcuenta SMS de la marca (Grow Business)</SectionTitle>
      <div className="mt-2 space-y-3">
        <div
          className="rounded-lg p-3 text-xs"
          style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af' }}
        >
          Los SMS de los negocios de esta marca (cobros, domicilio, reseñas)
          salen de esta subcuenta. Si se deja vacía, los negocios sin
          credenciales propias no envían SMS — nunca sale de la cuenta de Clubify.
        </div>
        <Field label="Location ID (ID de la subcuenta)">
          <input
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            placeholder="ej. mgAdQO7Rg7KiBRxuSs6M"
            className="font-mono"
            style={payInput}
          />
        </Field>
        <Field label="API key / Integración privada (pit-…)">
          <input
            type="password"
            autoComplete="new-password"
            value={apiKeyNew}
            onChange={(e) => setApiKeyNew(e.target.value)}
            placeholder={
              apiKeyMask
                ? `Actual: ${apiKeyMask} — deja vacío para conservar`
                : 'pit-…'
            }
            className="font-mono"
            style={payInput}
          />
        </Field>
        <Field label="Switch number (prioridad del número · opcional)">
          <input
            value={switchNumber}
            onChange={(e) => setSwitchNumber(e.target.value.replace(/\D/g, ''))}
            placeholder="ej. 1 (subcuenta de un solo número)"
            className="font-mono"
            style={payInput}
          />
        </Field>
        <button
          onClick={save}
          disabled={busy}
          className="text-sm font-semibold rounded-[9px] py-2 px-4 transition"
          style={{
            border: '2px solid #16a34a',
            background: '#16a34a',
            color: 'white',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'Guardando…' : 'Guardar subcuenta SMS'}
        </button>
      </div>
    </div>
  );
}

function PaymentGatewayConfig({
  whiteLabelId,
  brandSlug,
  onSaved,
}: {
  whiteLabelId: string;
  brandSlug?: string;
  onSaved: (msg: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [gateway, setGateway] = useState<string>('HOTMART');
  const [plain, setPlain] = useState<Record<string, string>>({});
  const [secretSet, setSecretSet] = useState<Record<string, boolean>>({});
  const [secretMasked, setSecretMasked] = useState<Record<string, string>>({});
  const [secretNew, setSecretNew] = useState<Record<string, string>>({});
  const [links, setLinks] = useState<PayLink[]>([]);
  const [busy, setBusy] = useState(false);
  // Enlace de PRUEBA de la marca (página dedicada /prueba). Guardado en Settings
  // por-marca; el cliente entra, ancla tarjeta y a los N días se le cobra.
  const [trialUrl, setTrialUrl] = useState('');
  const [trialDays, setTrialDays] = useState(7);

  async function load() {
    setLoading(true);
    try {
      const d = await api(`/superadmin/white-labels/${whiteLabelId}/payment-config`);
      if (d) {
        setGateway(d.gateway ?? 'HOTMART');
        const cfg = (d.config ?? {}) as Record<string, any>;
        const p: Record<string, string> = {};
        const sSet: Record<string, boolean> = {};
        const sMask: Record<string, string> = {};
        for (const [k, v] of Object.entries(cfg)) {
          if (k.endsWith('_set')) {
            sSet[k.slice(0, -4)] = !!v;
          } else if (PAYMENT_SECRET_UI.has(k)) {
            sMask[k] = (v as string) ?? '';
          } else {
            p[k] = (v as string) ?? '';
          }
        }
        setPlain(p);
        setSecretSet(sSet);
        setSecretMasked(sMask);
        setSecretNew({});
        setLinks((d.links ?? []) as PayLink[]);
      }
      const tc = await api(`/superadmin/white-labels/${whiteLabelId}/trial-config`).catch(() => null);
      if (tc) {
        setTrialUrl((tc as any).trialCheckoutUrl ?? '');
        setTrialDays((tc as any).trialDays ?? 7);
      }
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [whiteLabelId]);

  async function saveConfig() {
    setBusy(true);
    try {
      const config: Record<string, any> = { ...plain };
      // Solo mandamos secretos con valor nuevo (vacío = conservar el actual).
      for (const [k, v] of Object.entries(secretNew)) {
        if (v && v.trim()) config[k] = v.trim();
      }
      const d = await api(`/superadmin/white-labels/${whiteLabelId}/payment-config`, {
        method: 'PATCH',
        body: JSON.stringify({ gateway, config }),
      });
      onSaved('Pasarela actualizada');
      if (d) await load();
    } catch (e: any) {
      onSaved(e.message ?? 'Error al guardar pasarela');
    } finally {
      setBusy(false);
    }
  }

  async function saveTrial() {
    setBusy(true);
    try {
      await api(`/superadmin/white-labels/${whiteLabelId}/trial-config`, {
        method: 'PATCH',
        body: JSON.stringify({
          trialCheckoutUrl: trialUrl.trim() || null,
          trialDays: Math.max(1, Math.min(90, Number(trialDays) || 7)),
        }),
      });
      onSaved('Enlace de prueba guardado');
      await load();
    } catch (e: any) {
      onSaved(e.message ?? 'Error al guardar la prueba');
    } finally {
      setBusy(false);
    }
  }

  async function addLink() {
    setBusy(true);
    try {
      await api(`/superadmin/white-labels/${whiteLabelId}/payment-links`, {
        method: 'POST',
        body: JSON.stringify({
          gateway: gateway === 'MANUAL' ? 'HOTMART' : gateway,
          // Default editable: "Plan Mensual" (no "Nuevo plan"). El usuario lo
          // renombra en el input de nombre del plan.
          name: 'Plan Mensual',
          periodicity: 'MENSUAL',
          amountUsd: 0,
          active: true,
          sortOrder: links.length,
        }),
      });
      await load();
      onSaved('Link agregado');
    } catch (e: any) {
      onSaved(e.message ?? 'Error al agregar link');
    } finally {
      setBusy(false);
    }
  }

  async function saveLink(l: PayLink) {
    setBusy(true);
    try {
      await api(`/superadmin/white-labels/${whiteLabelId}/payment-links/${l.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          gateway: l.gateway,
          name: l.name,
          periodicity: l.periodicity,
          amountUsd: Number(l.amountUsd) || 0,
          url: l.url,
          active: l.active,
          stripePriceId: l.stripePriceId,
          stripeProductId: l.stripeProductId,
          productKey: l.productKey ?? null,
        }),
      });
      onSaved('Link guardado');
      await load();
    } catch (e: any) {
      onSaved(e.message ?? 'Error al guardar link');
    } finally {
      setBusy(false);
    }
  }

  async function deleteLink(id: string) {
    if (!confirm('¿Eliminar este link de pago?')) return;
    setBusy(true);
    try {
      await api(`/superadmin/white-labels/${whiteLabelId}/payment-links/${id}`, { method: 'DELETE' });
      await load();
      onSaved('Link eliminado');
    } catch (e: any) {
      onSaved(e.message ?? 'Error al eliminar');
    } finally {
      setBusy(false);
    }
  }

  function patchLink(id: string, patch: Partial<PayLink>) {
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  if (loading) {
    return (
      <div>
        <SectionTitle>Pasarela de pago</SectionTitle>
        <div className="mt-2 text-sm" style={{ color: '#9aa4af' }}>Cargando…</div>
      </div>
    );
  }

  const fields = GATEWAY_FIELDS[gateway] ?? GATEWAY_FIELDS.MANUAL;

  return (
    <div>
      <SectionTitle>Pasarela de pago</SectionTitle>
      <div className="mt-2 space-y-3">
        {/* Selector de método de cobro */}
        <Field label="Método de cobro">
          <div className="flex gap-2">
            {GATEWAYS.map((g) => (
              <button
                key={g.key}
                onClick={() => setGateway(g.key)}
                className="flex-1 text-sm font-semibold rounded-[9px] py-2 transition"
                style={{
                  border: gateway === g.key ? '2px solid #16a34a' : '1px solid #d7dbe0',
                  background: gateway === g.key ? '#f0fdf4' : 'white',
                  color: gateway === g.key ? '#15803d' : '#4b5563',
                }}
              >
                {g.label}
              </button>
            ))}
          </div>
        </Field>

        {gateway === 'MANUAL' && (
          <div
            className="rounded-lg p-3 text-xs"
            style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}
          >
            Esta Marca Blanca no tiene cobro automático conectado. Las
            activaciones, suspensiones y renovaciones deberán gestionarse
            manualmente.
          </div>
        )}

        {/* Campos no-secretos */}
        {fields.plain.map((f) => (
          <Field key={f.key} label={f.label}>
            <input
              value={plain[f.key] ?? ''}
              onChange={(e) => setPlain((p) => ({ ...p, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              className="font-mono"
              style={payInput}
            />
          </Field>
        ))}

        {/* Campos secretos: vacío = conservar el actual */}
        {fields.secret.map((f) => (
          <Field key={f.key} label={f.label}>
            <input
              type="password"
              autoComplete="new-password"
              value={secretNew[f.key] ?? ''}
              onChange={(e) => setSecretNew((s) => ({ ...s, [f.key]: e.target.value }))}
              placeholder={
                secretSet[f.key]
                  ? `${secretMasked[f.key] || '••••'} — vacío para conservar`
                  : 'Sin configurar'
              }
              className="font-mono"
              style={payInput}
            />
          </Field>
        ))}

        {gateway !== 'MANUAL' && (
          <button
            onClick={saveConfig}
            disabled={busy}
            className="w-full text-sm font-bold text-white rounded-[10px]"
            style={{
              padding: '10px',
              background: busy ? '#9ca3af' : 'linear-gradient(180deg, #28c95f, #16a34a)',
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            {busy ? 'Guardando…' : 'Guardar pasarela'}
          </button>
        )}

        {gateway === 'CROSS' && (
          <div
            className="rounded-lg p-3 text-xs space-y-1"
            style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af' }}
          >
            <div>
              Registrá este webhook en Cross:{' '}
              <code style={{ wordBreak: 'break-all' }}>
                https://api.soyclubify.com/webhooks/cross/{brandSlug ?? '<slug>'}
              </code>
            </div>
            <div style={{ opacity: 0.85 }}>
              Campos: <b>companyName</b> (cliente en Cross, ej. VIRTUALPRO S.A.S.),
              <b> paymentMethod</b> = card, <b>environment</b> = production. El cobro
              se prueba desde el checkout con una tarjeta real.
            </div>
          </div>
        )}

        {/* Enlace de PRUEBA (página dedicada /prueba). Pegar la URL de Stripe con
            prueba de N días; el cliente ancla tarjeta y a los N días se le cobra
            (ahí se descuenta 1 crédito). Vacío = la marca no ofrece prueba. */}
        <div className="pt-1">
          <SectionTitle>Enlace de prueba ({trialDays} días)</SectionTitle>
          <p className="text-xs text-mute mb-2 mt-1 leading-relaxed">
            URL de Stripe con período de prueba. El cliente entra por{' '}
            <code className="bg-bg2 px-1 rounded">/prueba</code>, ancla la tarjeta,
            y a los {trialDays} días se le cobra (ahí se descuenta 1 crédito de la
            marca). Vacío = no ofrece prueba.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <input
              className="input flex-1 min-w-0"
              placeholder="https://buy.stripe.com/…"
              value={trialUrl}
              onChange={(e) => setTrialUrl(e.target.value)}
            />
            <input
              className="input w-full sm:w-20 flex-none"
              type="number"
              min={1}
              max={90}
              value={trialDays}
              onChange={(e) => setTrialDays(Number(e.target.value))}
              title="Días de prueba"
            />
            <button onClick={saveTrial} disabled={busy} className="btn-primary text-sm flex-none">
              {busy ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>

        {/* Links de pago */}
        <div className="pt-1">
          <div className="flex items-center justify-between mb-2">
            <SectionTitle>Links de pago ({links.length})</SectionTitle>
            <button
              onClick={addLink}
              disabled={busy}
              className="text-xs font-semibold"
              style={{ padding: '6px 11px', borderRadius: 8, background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' }}
            >
              + Agregar link
            </button>
          </div>

          {links.length === 0 && (
            <div className="text-xs" style={{ color: '#9aa4af' }}>
              Sin links todavía. Agregá uno (mensual, anual, personalizado…).
            </div>
          )}

          <div className="space-y-2.5">
            {links.map((l) => (
              <div key={l.id} className="rounded-[10px] p-2.5" style={{ border: '1px solid #e5e7eb', background: '#fcfdfc' }}>
                <div className="flex gap-2">
                  <input
                    value={l.name}
                    onChange={(e) => patchLink(l.id, { name: e.target.value })}
                    placeholder="Nombre del plan"
                    style={{ ...payInput, flex: 2, marginTop: 0 }}
                  />
                  <select
                    value={l.periodicity}
                    onChange={(e) => patchLink(l.id, { periodicity: e.target.value })}
                    style={{ ...payInput, flex: 1, marginTop: 0 }}
                  >
                    {PERIODICITIES.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2 mt-2">
                  <input
                    type="number"
                    value={l.amountUsd}
                    onChange={(e) => patchLink(l.id, { amountUsd: Number(e.target.value) })}
                    placeholder="USD"
                    style={{ ...payInput, flex: 1, marginTop: 0 }}
                  />
                  <input
                    value={l.url ?? ''}
                    onChange={(e) => patchLink(l.id, { url: e.target.value })}
                    placeholder="URL de pago"
                    className="font-mono"
                    style={{ ...payInput, flex: 3, marginTop: 0 }}
                  />
                </div>
                {gateway === 'STRIPE' && (
                  <div className="flex gap-2 mt-2">
                    <input
                      value={l.stripePriceId ?? ''}
                      onChange={(e) => patchLink(l.id, { stripePriceId: e.target.value })}
                      placeholder="price_…"
                      className="font-mono"
                      style={{ ...payInput, flex: 1, marginTop: 0 }}
                    />
                    <input
                      value={l.stripeProductId ?? ''}
                      onChange={(e) => patchLink(l.id, { stripeProductId: e.target.value })}
                      placeholder="prod_…"
                      className="font-mono"
                      style={{ ...payInput, flex: 1, marginTop: 0 }}
                    />
                  </div>
                )}
                <div className="mt-2">
                  <label className="block text-[11px] font-semibold mb-1" style={{ color: '#4b5563' }}>
                    Producto especial (freemium)
                  </label>
                  <select
                    value={l.productKey ?? ''}
                    onChange={(e) => patchLink(l.id, { productKey: e.target.value || null })}
                    style={{ ...payInput, marginTop: 0 }}
                  >
                    <option value="">Ninguno (suscripción normal)</option>
                    <option value="INFOLINK_PRO">InfoLink PRO (sube FREE→PRO al pagar)</option>
                    <option value="FULL">Sellea Completo (activa negocio completo)</option>
                  </select>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <label className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: '#4b5563' }}>
                    <input
                      type="checkbox"
                      checked={l.active}
                      onChange={(e) => patchLink(l.id, { active: e.target.checked })}
                    />
                    Activo
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveLink(l)}
                      disabled={busy}
                      className="text-xs font-semibold"
                      style={{ padding: '5px 12px', borderRadius: 7, background: '#16a34a', color: 'white' }}
                    >
                      Guardar
                    </button>
                    <button
                      onClick={() => deleteLink(l.id)}
                      disabled={busy}
                      className="text-xs font-semibold"
                      style={{ padding: '5px 10px', borderRadius: 7, background: 'white', color: '#b91c1c', border: '1px solid #fecaca' }}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Config de dominio propio + instrucciones DNS para una marca blanca.
 *  Edita appDomain/domain (PATCH /superadmin/white-labels/:id) y muestra el
 *  CNAME a crear + la URL de fallback por path (/admin/<slug>) que ya
 *  funciona sin dominio conectado (lo que pidió el spec). */
function DomainConfig({
  whiteLabelId,
  slug,
  domain,
  appDomain,
  onSaved,
}: {
  whiteLabelId: string;
  slug: string;
  domain: string | null;
  appDomain: string | null;
  onSaved: (msg: string) => void;
}) {
  const [d, setD] = useState(domain ?? '');
  const [app, setApp] = useState(appDomain ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api(`/superadmin/white-labels/${whiteLabelId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          domain: d.trim() || null,
          appDomain: app.trim() || null,
        }),
      });
      onSaved('Dominio actualizado');
    } catch (e: any) {
      onSaved(e.message ?? 'Error al guardar dominio');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SectionTitle>Dominio propio</SectionTitle>
      <div className="mt-2 space-y-3">
        <div>
          <label className="text-xs font-semibold" style={{ color: '#6b7785' }}>
            Dominio del panel (app)
          </label>
          <input
            value={app}
            onChange={(e) => setApp(e.target.value)}
            placeholder="app.tudominio.com"
            className="w-full mt-1 text-sm font-mono"
            style={{
              padding: '9px 12px',
              borderRadius: 8,
              border: '1px solid #d7dbe0',
              background: 'white',
              color: '#16241c',
            }}
          />
        </div>
        <div>
          <label className="text-xs font-semibold" style={{ color: '#6b7785' }}>
            Dominio de marketing (opcional)
          </label>
          <input
            value={d}
            onChange={(e) => setD(e.target.value)}
            placeholder="tudominio.com"
            className="w-full mt-1 text-sm font-mono"
            style={{
              padding: '9px 12px',
              borderRadius: 8,
              border: '1px solid #d7dbe0',
              background: 'white',
              color: '#16241c',
            }}
          />
        </div>

        <div
          className="rounded-lg p-3 text-xs"
          style={{ background: '#f7fbf8', border: '1px solid #d9eadf' }}
        >
          <div className="font-bold mb-1" style={{ color: '#15803d' }}>
            📡 Configuración DNS
          </div>
          <div className="space-y-1.5" style={{ color: '#4b5563' }}>
            <div>
              En el proveedor DNS del dominio, creá un registro <b>CNAME</b>:
            </div>
            <div
              className="font-mono"
              style={{
                background: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: 6,
                padding: '6px 8px',
              }}
            >
              {app || 'app.tudominio.com'} &nbsp;&rarr;&nbsp; cname.vercel-dns.com
            </div>
            <div className="mt-1">
              Despu&eacute;s, el dominio debe agregarse al proyecto en <b>Vercel</b>{' '}
              (equipo Clubify). La propagaci&oacute;n DNS puede tardar hasta 48 h.
            </div>
          </div>
        </div>

        <div
          className="rounded-lg p-3 text-xs"
          style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}
        >
          Mientras el dominio no est&eacute; conectado, el panel ya funciona en:
          <div className="font-mono font-semibold mt-1">
            soyclubify.com/admin/{slug}
          </div>
        </div>

        <button
          onClick={save}
          disabled={busy}
          className="w-full text-sm font-bold text-white rounded-[10px]"
          style={{
            padding: '10px',
            background: busy ? '#9ca3af' : 'linear-gradient(180deg, #28c95f, #16a34a)',
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          {busy ? 'Guardando…' : 'Guardar dominio'}
        </button>
      </div>
    </div>
  );
}

/** Enlace de conexión de WhatsApp de la marca (proveedor tipo wazzap.mx). Se
 *  guarda por marca y el panel /admin (Automatizaciones → QR WhatsApp) lo pinta
 *  como QR para que el dueño lo escanee. El enlace NO se muestra al cliente,
 *  solo el QR. PATCH a /superadmin/white-labels/:id. */
function WhatsAppQrConfig({
  whiteLabelId,
  initial,
  onSaved,
}: {
  whiteLabelId: string;
  initial: string;
  onSaved: (msg: string) => void;
}) {
  const [url, setUrl] = useState(initial ?? '');
  const [busy, setBusy] = useState(false);
  const trimmed = url.trim();
  const valid = /^https?:\/\//i.test(trimmed);

  async function save() {
    setBusy(true);
    try {
      await api(`/superadmin/white-labels/${whiteLabelId}`, {
        method: 'PATCH',
        body: JSON.stringify({ whatsappQrUrl: trimmed || null }),
      });
      onSaved(trimmed ? 'Enlace de QR WhatsApp guardado' : 'Enlace de QR WhatsApp eliminado');
    } catch (e: any) {
      onSaved(e.message ?? 'Error al guardar el enlace');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SectionTitle>QR WhatsApp</SectionTitle>
      <div className="mt-2 space-y-3">
        <p className="text-xs" style={{ color: '#6b7785' }}>
          Pegá la URL de la <b>página embebida</b> (Embedded Page) de conexión de
          WhatsApp de esta marca (ej. wazzap.mx, tipo <b>/g/…</b>). El panel de la
          marca la muestra embebida en <b>Automatizaciones → QR WhatsApp</b>, para que
          el dueño escanee el código con WhatsApp. El enlace no se muestra como texto.
        </p>
        <div>
          <label className="text-xs font-semibold" style={{ color: '#6b7785' }}>
            URL de la página embebida
          </label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://app.wazzap.mx/g/…"
            className="w-full mt-1 text-sm font-mono"
            style={{
              padding: '9px 12px',
              borderRadius: 8,
              border: '1px solid #d7dbe0',
              background: 'white',
              color: '#16241c',
            }}
          />
        </div>

        {valid && (
          <a
            href={trimmed}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-xs font-semibold"
            style={{ color: '#15803d' }}
          >
            Abrir para verificar el código ↗
          </a>
        )}

        <button
          onClick={save}
          disabled={busy || (!!trimmed && !valid)}
          className="w-full text-sm font-bold text-white rounded-[10px] disabled:opacity-50"
          style={{
            padding: '10px',
            background: busy ? '#9ca3af' : 'linear-gradient(180deg, #28c95f, #16a34a)',
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          {busy ? 'Guardando…' : 'Guardar enlace'}
        </button>
      </div>
    </div>
  );
}

/** Edita la identidad visual de una marca: logo, paleta de colores (primario/
 *  secundario/fondo/apoyo), Instagram y email de contacto. PATCH a
 *  /superadmin/white-labels/:id. El panel de la marca toma estos valores. */
/** Preview en vivo de las variantes que el sistema genera del símbolo de la
 *  marca (favicon transparente, ícono iPhone opaco, ícono Android maskable).
 *  Es una aproximación client-side de lo que produce el endpoint /icon — se
 *  actualiza al instante con la imagen seleccionada, aún sin guardar. */
function BrandIconPreview({
  source,
  backgroundColor,
}: {
  source: string;
  backgroundColor: string;
}) {
  const tile = (
    label: string,
    bg: string,
    radius: number,
    padPct: number,
    circle: boolean,
  ) => (
    <div className="flex flex-col items-center gap-1">
      <div
        style={{
          width: 56,
          height: 56,
          background: bg,
          borderRadius: circle ? '50%' : radius,
          border: '1px solid #e6eae8',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        }}
      >
        {source ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={source}
            alt={label}
            style={{
              width: `${100 - padPct * 2}%`,
              height: `${100 - padPct * 2}%`,
              objectFit: 'contain',
            }}
          />
        ) : (
          <span style={{ fontSize: 10, color: '#9aa3ad' }}>—</span>
        )}
      </div>
      <span className="text-[10px]" style={{ color: '#6b7785' }}>
        {label}
      </span>
    </div>
  );
  return (
    <div
      className="rounded-lg"
      style={{ background: '#f4f6f5', border: '1px solid #e6eae8', padding: 10 }}
    >
      <div
        className="text-[11px] font-semibold mb-2"
        style={{ color: '#16241c' }}
      >
        Vista previa — se generan automáticamente
      </div>
      <div className="flex items-center gap-4">
        {tile('Favicon', 'transparent', 12, 6, false)}
        {tile('iPhone', backgroundColor || '#ffffff', 12, 10, false)}
        {tile('Android', backgroundColor || '#ffffff', 0, 18, true)}
      </div>
      <p className="text-[10px] mt-2" style={{ color: '#9aa3ad' }}>
        Al guardar, el favicon, el acceso directo de iPhone/Android y la PWA se
        actualizan en todos los dispositivos (con limpieza de caché automática).
        {!source && ' Sube el símbolo arriba para ver el resultado.'}
      </p>
    </div>
  );
}

function BrandingConfig({
  whiteLabelId,
  initial,
  onSaved,
}: {
  whiteLabelId: string;
  initial: {
    logoUrl: string | null;
    iconUrl: string | null;
    faviconUrl: string | null;
    primaryColor: string;
    secondaryColor: string | null;
    backgroundColor: string | null;
    supportColor: string | null;
    instagram: string | null;
    contactEmail: string | null;
    notifyPhone: string | null;
    mapsApiKey: string | null;
    shareImageUrl: string | null;
    subscriptionFeatureKeys: string[];
    installationFeeUsd: number | null;
    installationPromoUsd: number | null;
  };
  onSaved: (msg: string) => void;
}) {
  const [f, setF] = useState({
    logoUrl: initial.logoUrl ?? '',
    iconUrl: initial.iconUrl ?? '',
    faviconUrl: initial.faviconUrl ?? '',
    shareImageUrl: initial.shareImageUrl ?? '',
    primaryColor: initial.primaryColor ?? '#16a34a',
    secondaryColor: initial.secondaryColor ?? '',
    backgroundColor: initial.backgroundColor ?? '',
    supportColor: initial.supportColor ?? '',
    instagram: initial.instagram ?? '',
    contactEmail: initial.contactEmail ?? '',
    notifyPhone: initial.notifyPhone ?? '',
    mapsApiKey: initial.mapsApiKey ?? '',
    installationFeeUsd:
      initial.installationFeeUsd != null ? String(initial.installationFeeUsd) : '',
    installationPromoUsd:
      initial.installationPromoUsd != null ? String(initial.installationPromoUsd) : '',
  });
  const [featureKeys, setFeatureKeys] = useState<string[]>(
    initial.subscriptionFeatureKeys ?? [],
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api(`/superadmin/white-labels/${whiteLabelId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          logoUrl: f.logoUrl.trim() || null,
          iconUrl: f.iconUrl.trim() || null,
          faviconUrl: f.faviconUrl.trim() || null,
          primaryColor: f.primaryColor || undefined,
          secondaryColor: f.secondaryColor.trim() || null,
          backgroundColor: f.backgroundColor.trim() || null,
          supportColor: f.supportColor.trim() || null,
          instagram: f.instagram.trim() || null,
          contactEmail: f.contactEmail.trim() || null,
          notifyPhone: f.notifyPhone.trim() || null,
          mapsApiKey: f.mapsApiKey.trim() || null,
          shareImageUrl: f.shareImageUrl.trim() || null,
          subscriptionFeatureKeys: featureKeys,
          installationFeeUsd: f.installationFeeUsd.trim()
            ? Number(f.installationFeeUsd)
            : null,
          installationPromoUsd: f.installationPromoUsd.trim()
            ? Number(f.installationPromoUsd)
            : null,
        }),
      });
      onSaved('Branding actualizado');
    } catch (e: any) {
      onSaved(e.message ?? 'Error al guardar branding');
    } finally {
      setBusy(false);
    }
  }

  const colorRow = (
    label: string,
    key: 'primaryColor' | 'secondaryColor' | 'backgroundColor' | 'supportColor',
  ) => (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs" style={{ color: '#6b7785' }}>
        {label}
      </span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(f[key]) ? f[key] : '#000000'}
          onChange={(e) => setF((s) => ({ ...s, [key]: e.target.value }))}
          style={{ width: 28, height: 28, border: 'none', background: 'none', padding: 0 }}
        />
        <input
          value={f[key]}
          onChange={(e) => setF((s) => ({ ...s, [key]: e.target.value }))}
          placeholder="#000000"
          className="text-xs font-mono"
          style={{
            width: 90,
            padding: '6px 8px',
            borderRadius: 7,
            border: '1px solid #d7dbe0',
          }}
        />
      </div>
    </div>
  );

  const textInput = (
    label: string,
    key: 'logoUrl' | 'instagram' | 'contactEmail' | 'notifyPhone' | 'mapsApiKey',
    placeholder: string,
  ) => (
    <div>
      <label className="text-xs font-semibold" style={{ color: '#6b7785' }}>
        {label}
      </label>
      <input
        value={f[key]}
        onChange={(e) => setF((s) => ({ ...s, [key]: e.target.value }))}
        placeholder={placeholder}
        className="w-full mt-1 text-sm"
        style={{
          padding: '8px 11px',
          borderRadius: 8,
          border: '1px solid #d7dbe0',
          background: 'white',
          color: '#16241c',
        }}
      />
    </div>
  );

  const logoField = (
    key: 'logoUrl' | 'iconUrl' | 'faviconUrl' | 'shareImageUrl',
    title: string,
    guide: { formato: string; tamano: string; ratio?: string; peso: string; uso: string },
    opts: { crop: boolean; aspect?: number },
  ) => (
    <div>
      <label className="text-xs font-semibold" style={{ color: '#16241c' }}>
        {title}
      </label>
      <div
        className="text-[11px] mt-1 mb-1.5 rounded-lg"
        style={{
          background: '#f4f6f5',
          border: '1px solid #e6eae8',
          padding: '7px 10px',
          color: '#6b7785',
          lineHeight: 1.55,
        }}
      >
        <b>Formato:</b> {guide.formato} · <b>Tamaño:</b> {guide.tamano}
        {guide.ratio ? (
          <>
            {' '}· <b>Relación:</b> {guide.ratio}
          </>
        ) : null}{' '}
        · <b>Peso máx:</b> {guide.peso}
        <br />
        <b>Uso:</b> {guide.uso}
      </div>
      <ImageUploader
        value={f[key] || null}
        onChange={(url) => setF((s) => ({ ...s, [key]: url ?? '' }))}
        folder="branding"
        crop={opts.crop}
        aspect={opts.aspect ?? 1}
        maxSizeMb={2}
        minDimensionWarn={false}
      />
    </div>
  );

  return (
    <div>
      <SectionTitle>Identidad visual</SectionTitle>
      <div className="mt-2 space-y-3">
        {logoField(
          'logoUrl',
          'Logo header',
          {
            formato: 'PNG transparente',
            tamano: '1200 × 400 px',
            ratio: '3:1',
            peso: '500 KB',
            uso: 'Landing, login y páginas públicas.',
          },
          { crop: false },
        )}
        {logoField(
          'iconUrl',
          'Logo dashboard',
          {
            formato: 'PNG transparente',
            tamano: '512 × 512 px',
            ratio: '1:1',
            peso: '300 KB',
            uso: 'Panel administrativo y menú lateral.',
          },
          { crop: true, aspect: 1 },
        )}
        {logoField(
          'faviconUrl',
          'Favicon / símbolo',
          {
            formato: 'PNG / SVG / WEBP',
            tamano: '512 × 512 px',
            ratio: '1:1',
            peso: '200 KB',
            uso: 'Solo el símbolo (sin texto ni slogan). De aquí se generan automáticamente el favicon, el ícono de iPhone/Android y el de la PWA.',
          },
          { crop: true, aspect: 1 },
        )}
        <BrandIconPreview
          source={f.faviconUrl || f.iconUrl || f.logoUrl || ''}
          backgroundColor={f.backgroundColor || '#ffffff'}
        />
        {logoField(
          'shareImageUrl',
          'Imagen al compartir (Open Graph)',
          {
            formato: 'PNG / JPG',
            tamano: '1200 × 630 px',
            ratio: '1.91:1',
            peso: '500 KB',
            uso: 'Previsualización al compartir el enlace de la marca por WhatsApp/redes. Si no se sube, se usa el logo de la marca.',
          },
          { crop: false },
        )}
        <div className="space-y-2">
          {colorRow('Color principal', 'primaryColor')}
          {colorRow('Color secundario', 'secondaryColor')}
          {colorRow('Color de fondos', 'backgroundColor')}
          {colorRow('Color de apoyo', 'supportColor')}
        </div>
        {textInput('Instagram', 'instagram', '@marca')}
        {textInput('Email de contacto', 'contactEmail', 'hola@marca.com')}
        {textInput(
          'Teléfono notificaciones (SMS de créditos)',
          'notifyPhone',
          '+52 1 55 1234 5678',
        )}
        <p className="text-[11px]" style={{ color: '#9aa3ad', marginTop: -4 }}>
          Recibe los avisos de créditos (compra, saldo bajo, pendientes).
        </p>
        {textInput('Google Maps API key (mapa del panel)', 'mapsApiKey', 'AIza…')}
        <p className="text-[11px]" style={{ color: '#9aa3ad', marginTop: -4 }}>
          Browser key del Google Cloud de la marca, restringida por referrer a su
          dominio. Sin ella, el mapa usa la key global de Clubify.
        </p>

        {/* ── Suscripción y precios ── */}
        <SectionTitle>Suscripción y precios</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-semibold" style={{ color: '#6b7785' }}>
              Instalación (USD)
            </label>
            <input
              type="number"
              min={0}
              value={f.installationFeeUsd}
              onChange={(e) => setF((s) => ({ ...s, installationFeeUsd: e.target.value }))}
              placeholder="250"
              className="w-full mt-1 text-sm"
              style={{ padding: '8px 11px', borderRadius: 8, border: '1px solid #d7dbe0', background: 'white', color: '#16241c' }}
            />
          </div>
          <div>
            <label className="text-xs font-semibold" style={{ color: '#6b7785' }}>
              Promo instalación (USD)
            </label>
            <input
              type="number"
              min={0}
              value={f.installationPromoUsd}
              onChange={(e) => setF((s) => ({ ...s, installationPromoUsd: e.target.value }))}
              placeholder="100"
              className="w-full mt-1 text-sm"
              style={{ padding: '8px 11px', borderRadius: 8, border: '1px solid #d7dbe0', background: 'white', color: '#16241c' }}
            />
          </div>
        </div>
        <p className="text-[11px]" style={{ color: '#9aa3ad', marginTop: -4 }}>
          Página de precios: muestra el costo tachado + “PRECIO PROMOCIONAL” y lo
          suma al total hoy (el plan anual lo incluye gratis). Vacío = sin línea
          de instalación.
        </p>

        <div>
          <label className="text-xs font-semibold" style={{ color: '#16241c' }}>
            Features incluidos en la suscripción
          </label>
          <p className="text-[11px] mb-1.5" style={{ color: '#9aa3ad' }}>
            Lista “Tu suscripción incluye” del panel. Sin nada marcado = se
            muestran todos (default Clubify).
          </p>
          <div className="grid grid-cols-1 gap-1">
            {SUBSCRIPTION_FEATURES.map((feat) => {
              const on = featureKeys.includes(feat.key);
              return (
                <label key={feat.key} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) =>
                      setFeatureKeys((prev) =>
                        e.target.checked
                          ? [...prev, feat.key]
                          : prev.filter((k) => k !== feat.key),
                      )
                    }
                  />
                  <span style={{ color: '#16241c' }}>{feat.label}</span>
                </label>
              );
            })}
          </div>
        </div>

        <button
          onClick={save}
          disabled={busy}
          className="w-full text-sm font-bold text-white rounded-[10px]"
          style={{
            padding: '10px',
            background: busy
              ? '#9ca3af'
              : 'linear-gradient(180deg, #28c95f, #16a34a)',
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          {busy ? 'Guardando…' : 'Guardar branding'}
        </button>
      </div>
    </div>
  );
}
