'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { api, startImpersonation } from '@/lib/api';

type WhiteLabel = {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  appDomain: string | null;
  primaryColor: string;
  initial: string | null;
  adminEmail: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  creditsAvailable: number;
  creditsCommitted: number;
  creditsUsed: number;
  createdAt: string;
  tenantsActive: number;
  tenantsSuspended: number;
  adminsCount: number;
  modules?: { module: string; enabled: boolean }[];
};

type WhiteLabelDetail = WhiteLabel & {
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
};

export default function MarcasBlancasPage() {
  const params = useSearchParams();
  const router = useRouter();
  const [items, setItems] = useState<WhiteLabel[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'todas' | 'activas' | 'suspendidas'>('todas');
  const [drawerId, setDrawerId] = useState<string | null>(null);
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
                  onClick={() => setDrawerId(w.id)}
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
                      color: w.creditsAvailable < w.creditsCommitted ? '#b45309' : '#16a34a',
                      fontWeight: 700,
                    }}
                  >
                    {w.creditsAvailable}
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'center', color: '#2563eb', fontWeight: 600 }}>
                    {w.creditsCommitted}
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
                    <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setDrawerId(w.id)}
                        className="text-xs font-semibold px-3 py-1.5 rounded-md transition"
                        style={{ background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' }}
                      >
                        Entrar
                      </button>
                      <button
                        onClick={() => toggleStatus(w)}
                        className="text-xs font-semibold px-3 py-1.5 rounded-md transition"
                        style={{
                          background: 'white',
                          color: w.status === 'ACTIVE' ? '#b91c1c' : '#15803d',
                          border: `1px solid ${w.status === 'ACTIVE' ? '#fecaca' : '#bbf7d0'}`,
                        }}
                      >
                        {w.status === 'ACTIVE' ? 'Suspender' : 'Activar'}
                      </button>
                    </div>
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

      {drawerId && (
        <Drawer
          id={drawerId}
          onClose={() => setDrawerId(null)}
          onChanged={(msg) => {
            flashToast(msg);
            load();
          }}
        />
      )}

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
            setDrawerId(w.id);
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

function Drawer({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: (msg: string) => void;
}) {
  const router = useRouter();
  const [w, setW] = useState<WhiteLabelDetail | null>(null);
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [entering, setEntering] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

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
        tenant: { id: r.whiteLabel.id, brandName: r.whiteLabel.name },
      });
      // Llevar al admin de la marca
      router.push('/admin');
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
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,.32)' }}
      />
      <div
        className="fixed right-0 top-0 bottom-0 z-50 overflow-y-auto"
        style={{
          width: 440,
          background: 'white',
          boxShadow: '-12px 0 40px rgba(0,0,0,.14)',
        }}
      >
        {!w ? (
          <div className="p-6 text-sm" style={{ color: '#9aa4af' }}>
            Cargando…
          </div>
        ) : (
          <>
            <div
              className="px-5 py-4 flex items-center gap-3 border-b"
              style={{ borderColor: '#eef0f2' }}
            >
              <div
                className="w-12 h-12 rounded-[13px] flex items-center justify-center text-white font-bold shrink-0"
                style={{ background: w.primaryColor }}
              >
                {w.initial ?? w.name[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-[17px]" style={{ color: '#16241c' }}>
                  {w.name}
                </div>
                <div className="text-xs" style={{ color: '#6b7785' }}>
                  {w.domain ?? '—'}
                </div>
              </div>
              <button onClick={onClose} className="text-xl leading-none" style={{ color: '#9aa4af' }}>
                ×
              </button>
            </div>

            <div className="p-5 space-y-5">
              <div className="flex items-center gap-3 flex-wrap">
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

              <div>
                <SectionTitle>Créditos</SectionTitle>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <CreditCard label="Disponibles" value={w.creditsAvailable} color="#16a34a" bg="#f0fdf4" />
                  <CreditCard label="Comprometidos" value={w.creditsCommitted} color="#2563eb" bg="#eff6ff" />
                  <CreditCard label="Usados" value={w.creditsUsed} color="#6b7785" bg="#f7fbf8" />
                </div>
              </div>

              <div>
                <SectionTitle>Branding</SectionTitle>
                <div className="mt-2 space-y-1.5 text-sm" style={{ color: '#2b3a30' }}>
                  <div className="flex justify-between">
                    <span style={{ color: '#9aa4af' }}>Dominio</span>
                    <span className="font-medium">{w.domain ?? '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ color: '#9aa4af' }}>Dominio app</span>
                    <span className="font-medium">{w.appDomain ?? '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ color: '#9aa4af' }}>Color</span>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-block w-5 h-5 rounded"
                        style={{ background: w.primaryColor }}
                      />
                      <span className="font-mono text-xs">{w.primaryColor}</span>
                    </span>
                  </div>
                </div>
              </div>

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

              <div>
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
                    + Invitar
                  </button>
                </div>
                {w.admins.length === 0 && invites.length === 0 ? (
                  <p className="text-sm italic" style={{ color: '#9aa4af' }}>
                    Sin admins registrados todavía. Invitá al primero.
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

            <div
              className="sticky bottom-0 px-5 py-4 border-t flex gap-2"
              style={{ background: 'white', borderColor: '#eef0f2' }}
            >
              <button
                onClick={enterAs}
                disabled={entering || w.status === 'SUSPENDED'}
                className="flex-1 py-2.5 rounded-[10px] text-sm font-bold text-white disabled:opacity-50"
                style={{
                  background: 'linear-gradient(180deg, #28c95f, #16a34a)',
                  boxShadow: '0 2px 6px rgba(22,163,74,.35)',
                }}
                title={w.status === 'SUSPENDED' ? 'Reactivá la marca primero' : 'Iniciar sesión como super admin de esta marca'}
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
            {inviteOpen && (
              <InviteWhiteLabelAdminModal
                whiteLabelId={w.id}
                whiteLabelName={w.name}
                primaryColor={w.primaryColor}
                onClose={() => setInviteOpen(false)}
                onCreated={() => {
                  setInviteOpen(false);
                  reloadAdmins();
                  onChanged('Invitación enviada');
                }}
              />
            )}
          </>
        )}
      </div>
    </>
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
  onCreated: () => void;
}) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!email.trim() || !fullName.trim()) return;
    setSaving(true);
    try {
      await api(`/superadmin/white-labels/${whiteLabelId}/admin-invites`, {
        method: 'POST',
        body: JSON.stringify({ email: email.trim().toLowerCase(), fullName: fullName.trim() }),
      });
      onCreated();
    } catch (e: any) {
      alert('Error: ' + (e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

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
          Invitar admin de {whiteLabelName}
        </h3>
        <p className="text-sm mt-1.5 mb-5" style={{ color: '#6b7785' }}>
          Le va a llegar un email con un link para definir su contraseña. Una vez aceptado,
          va a poder administrar los negocios de la marca. El link vence en 7 días.
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
              style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid #d7dbe0', fontSize: 13.5, outline: 'none', background: 'white' }}
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
              style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid #d7dbe0', fontSize: 13.5, outline: 'none', background: 'white' }}
            />
          </label>
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
            disabled={!email.trim() || !fullName.trim() || saving}
            className="text-sm font-semibold"
            style={{
              padding: '9px 18px',
              borderRadius: 9,
              background: !email.trim() || !fullName.trim() ? '#cbd5d2' : primaryColor,
              color: 'white',
              border: 'none',
            }}
          >
            {saving ? 'Enviando…' : 'Enviar invitación'}
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
