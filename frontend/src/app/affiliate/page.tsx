'use client';
/**
 * Panel del afiliado (influencer / embajador). Layout y estilos
 * minimal — un solo archivo con las 3 vistas (Resumen, Clientes,
 * Comisiones) en tabs. Datos scoped por el backend al usuario logueado.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, clearSession } from '@/lib/api';
import { Logo } from '@/components/Logo';
import { toast } from '@/components/Toast';
import { PhoneInput } from '@/components/PhoneInput';

type Tab = 'overview' | 'clients' | 'commissions' | 'settings';

type Me = {
  user: { id: string; email: string; fullName: string; role: string; phone?: string | null } | null;
  role: 'AFFILIATE_INFLUENCER' | 'AFFILIATE_AMBASSADOR' | 'AFFILIATE_SOCIO';
  myCode: {
    id: string;
    code: string;
    slug: string;
    commissionPercent: number;
    role: string;
    parentCode: string | null;
    parentName: string | null;
    campaignName: string | null;
  } | null;
  ambassadors: Array<{
    id: string;
    code: string;
    slug: string;
    ownerName: string;
    commissionPercent: number;
    isActive: boolean;
  }>;
};

type Client = {
  id: string;
  tenantBrand: string;
  plan: string;
  status: string;
  attribution: { code: string; role: string; ownerName: string };
  signedUpAt: string;
  convertedAt: string | null;
  commissionsCount: number;
  commissionsTotalUsd: number;
};

type CommissionResp = {
  totals: { pendingUsd: number; approvedUsd: number; paidUsd: number; count: number };
  items: Array<{
    id: string;
    amount: number;
    status: 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED';
    createdAt: string;
    paidAt: string | null;
    tenantBrand: string;
    via: string;
    codeText: string;
  }>;
};

const STATUS_CLS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-ok-soft text-ok',
  PAID: 'bg-bg2 text-mute',
  REJECTED: 'bg-red-100 text-red-800',
  SIGNED_UP: 'bg-bg2 text-mute',
  ACTIVE: 'bg-ok-soft text-ok',
  PAYING: 'bg-ok-soft text-ok',
  CHURNED: 'bg-red-100 text-red-800',
};

function fmtUsd(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}
function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function AffiliatePanel() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Me>('/affiliate/me')
      .then(setMe)
      .catch(() => router.push('/login'))
      .finally(() => setLoading(false));
  }, [router]);

  function logout() {
    clearSession();
    router.push('/login');
  }

  if (loading) return <div className="p-8 text-mute">Cargando…</div>;
  if (!me) return null;

  const isInfluencer = me.role === 'AFFILIATE_INFLUENCER';
  const isSocio = me.role === 'AFFILIATE_SOCIO';
  // Link corto público `/ref/<slug>`. El backend loguea visita (UTM +
  // referer + país + IP) y redirige a /signup?ref=CODE&via=slug.
  // Compartible en redes, mucho más memorable que /signup?ref=XYZ123.
  const shareLink =
    typeof window !== 'undefined' && me.myCode
      ? `${window.location.origin}/ref/${me.myCode.slug}`
      : '';

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-line bg-white px-5 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2">
            <Logo size={28} />
            <span className="font-semibold text-sm hidden sm:inline">Panel afiliado</span>
          </Link>
          <div className="flex items-center gap-3">
            <div className="text-xs text-mute hidden sm:block">
              {me.user?.fullName} ·{' '}
              <span className="font-medium">
                {isSocio ? '💎 Socio' : isInfluencer ? '🌟 Influencer' : '👥 Embajador'}
              </span>
            </div>
            <button onClick={logout} className="text-xs text-mute hover:text-ink">
              Salir
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5 py-6">
        <h1 className="text-2xl font-bold mb-1">
          Hola, {me.user?.fullName?.split(' ')[0]} 👋
        </h1>
        <div className="text-sm text-mute mb-5">
          {isSocio ? (
            <>
              Recibes el <strong>{me.myCode?.commissionPercent}%</strong> de
              TODAS las ventas de Clubify, sin importar qué código se use.
            </>
          ) : me.myCode?.campaignName ? (
            <>Campaña <strong>{me.myCode.campaignName}</strong></>
          ) : me.myCode?.parentName ? (
            <>Embajador en la campaña de <strong>{me.myCode.parentName}</strong></>
          ) : null}
        </div>

        {/* Código + share link */}
        {me.myCode && (
          <div className="card card-pad mb-5 flex items-center gap-4 flex-wrap">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
                {isSocio ? 'Tu código (interno)' : 'Tu código'}
              </div>
              <div className="font-mono font-bold text-2xl">{me.myCode.code}</div>
              <div className="text-xs text-mute">
                Tu comisión: <strong>{me.myCode.commissionPercent}%</strong>{' '}
                de cada venta atribuida.
                {me.myCode.parentCode && (
                  <>
                    {' '}· Reportas a{' '}
                    <span className="font-mono">{me.myCode.parentCode}</span>
                  </>
                )}
              </div>
              <div className="text-[11px] text-mute mt-1 leading-relaxed">
                <strong>Tip:</strong> tu código es de <em>atribución</em>{' '}
                — identifica quién te envió. Los cupones de descuento para el
                cliente los crea Clubify Admin y se asocian a campañas.
              </div>
            </div>
            {!isSocio && (
              <div className="flex-1 min-w-[200px]">
                <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
                  Tu link para compartir
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    className="input flex-1 text-xs"
                    readOnly
                    value={shareLink}
                    onClick={(e) => e.currentTarget.select()}
                  />
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(shareLink);
                      toast('Link copiado', 'success');
                    }}
                    className="btn-ghost text-xs"
                  >
                    Copiar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="tabs mb-5">
          <button
            className={`tab ${tab === 'overview' ? 'tab-active' : ''}`}
            onClick={() => setTab('overview')}
          >
            📊 Resumen
          </button>
          {!isSocio && (
            <button
              className={`tab ${tab === 'clients' ? 'tab-active' : ''}`}
              onClick={() => setTab('clients')}
            >
              🏢 Mis clientes
            </button>
          )}
          <button
            className={`tab ${tab === 'commissions' ? 'tab-active' : ''}`}
            onClick={() => setTab('commissions')}
          >
            💵 Comisiones
          </button>
          <button
            className={`tab ${tab === 'settings' ? 'tab-active' : ''}`}
            onClick={() => setTab('settings')}
          >
            ⚙️ Configuración
          </button>
        </div>

        {tab === 'overview' && <Overview me={me} />}
        {tab === 'clients' && <ClientsList />}
        {tab === 'commissions' && <CommissionsList />}
        {tab === 'settings' && (
          <SettingsView
            me={me}
            onUpdated={(u) =>
              setMe({
                ...me,
                user: { ...me.user!, fullName: u.fullName, phone: (u as any).phone },
              })
            }
          />
        )}
      </main>
    </div>
  );
}

function Overview({ me }: { me: Me }) {
  const [comm, setComm] = useState<CommissionResp | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  useEffect(() => {
    api<CommissionResp>('/affiliate/commissions').then(setComm).catch(() => {});
    api<Client[]>('/affiliate/clients').then(setClients).catch(() => {});
  }, []);

  const activeClients = clients.filter(
    (c) => c.status === 'PAYING' || c.status === 'ACTIVE',
  ).length;

  // Breakdown: ventas atribuidas a MI código vs a códigos de mis
  // embajadores. Útil para que el influencer vea cuánto trae solo
  // versus apalancado por su equipo (item 19 del spec).
  const myCode = me.myCode?.code ?? null;
  const directs = myCode
    ? clients.filter((c) => c.attribution?.code === myCode).length
    : 0;
  const indirects = clients.length - directs;
  const activeDirects = myCode
    ? clients.filter(
        (c) =>
          c.attribution?.code === myCode &&
          (c.status === 'PAYING' || c.status === 'ACTIVE'),
      ).length
    : 0;
  const activeIndirects = activeClients - activeDirects;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Negocios activos" value={String(activeClients)} tone="ok" />
        <Stat label="Total negocios" value={String(clients.length)} />
        <Stat
          label="Pendiente"
          value={comm ? fmtUsd(comm.totals.pendingUsd + comm.totals.approvedUsd) : '—'}
          tone="amber"
        />
        <Stat label="Pagado" value={comm ? fmtUsd(comm.totals.paidUsd) : '—'} tone="brand" />
      </div>

      {me.role === 'AFFILIATE_INFLUENCER' && clients.length > 0 && (
        <div className="card card-pad">
          <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-3">
            Origen de tus negocios
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-bg2/50 rounded-lg p-3">
              <div className="text-xs text-mute">
                🎯 Directas (tu código)
              </div>
              <div className="text-2xl font-bold mt-1">{directs}</div>
              <div className="text-[11px] text-mute mt-0.5">
                {activeDirects} activas
              </div>
            </div>
            <div className="bg-bg2/50 rounded-lg p-3">
              <div className="text-xs text-mute">
                👥 De tus embajadores
              </div>
              <div className="text-2xl font-bold mt-1">{indirects}</div>
              <div className="text-[11px] text-mute mt-0.5">
                {activeIndirects} activas
              </div>
            </div>
          </div>
        </div>
      )}

      {me.role === 'AFFILIATE_INFLUENCER' && (
        <InfluencerAmbassadorsPanel ambassadors={me.ambassadors} />
      )}
    </div>
  );
}

function InfluencerAmbassadorsPanel({
  ambassadors: initial,
}: {
  ambassadors: Me['ambassadors'];
}) {
  const [ambassadors, setAmbassadors] = useState(initial);
  const [showForm, setShowForm] = useState(false);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [form, setForm] = useState({ fullName: '', email: '', whatsapp: '', commissionPercent: 25 });
  const [busy, setBusy] = useState(false);

  // El backend rechaza si el toggle no está activo, pero para evitar mostrar
  // el botón inutilizable hacemos un probe ligero al GET /affiliate/me la
  // primera vez (alternativamente podríamos exponer la flag en /me).
  // Por simplicidad: intentamos un POST con datos vacíos solo cuando se
  // hace click — si el toggle está off, mostramos el mensaje.
  useEffect(() => {
    setAllowed(true); // optimista; el POST resuelve.
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const created = await api<any>('/affiliate/ambassadors', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setAmbassadors([
        {
          id: created.id,
          code: created.code,
          slug: created.slug ?? String(created.code).toLowerCase(),
          ownerName: created.ownerName,
          commissionPercent: Number(created.commissionPercent),
          isActive: true,
        },
        ...ambassadors,
      ]);
      setForm({ fullName: '', email: '', whatsapp: '', commissionPercent: 25 });
      setShowForm(false);
      toast(
        created.approvedAt
          ? 'Embajador agregado'
          : 'Embajador creado — pendiente de aprobación del admin',
        'success',
      );
    } catch (e: any) {
      if (String(e.message || '').includes('habilitó la creación')) {
        setAllowed(false);
      }
      toast(e.message || 'Error', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold m-0">Tus embajadores ({ambassadors.length})</h3>
        {allowed !== false && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="btn-ghost text-xs"
          >
            {showForm ? 'Cancelar' : '+ Embajador'}
          </button>
        )}
      </div>

      {allowed === false && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900 mb-3">
          El admin no habilitó la creación de embajadores desde tu panel.
          Pide que active el toggle en su configuración.
        </div>
      )}

      {showForm && allowed !== false && (
        <form onSubmit={add} className="border border-line rounded-lg p-3 mb-3 space-y-2 bg-bg2/30">
          <div className="grid grid-cols-2 gap-2">
            <input
              className="input"
              placeholder="Nombre completo"
              required
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            />
            <input
              className="input"
              type="email"
              placeholder="Email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div>
            <PhoneInput
              value={form.whatsapp}
              onChange={(v) => setForm({ ...form, whatsapp: v })}
              placeholder="WhatsApp del embajador"
            />
          </div>
          <input
            type="number"
            min={0}
            max={100}
            className="input"
            placeholder="% comisión (ej: 25)"
            value={form.commissionPercent}
            onChange={(e) => setForm({ ...form, commissionPercent: Number(e.target.value) })}
          />
          <button type="submit" disabled={busy} className="btn-primary w-full text-sm">
            {busy ? 'Creando…' : 'Agregar embajador'}
          </button>
        </form>
      )}

      {ambassadors.length === 0 ? (
        <div className="text-sm text-mute text-center py-4">
          Aún no tienes embajadores
        </div>
      ) : (
        <div className="space-y-2">
          {ambassadors.map((a) => (
            <div
              key={a.id}
              className={`flex items-center justify-between p-2 rounded-lg bg-bg2/40 ${
                a.isActive ? '' : 'opacity-50'
              }`}
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{a.ownerName}</div>
                <div className="text-xs text-mute font-mono">{a.code}</div>
              </div>
              <div className="text-xs text-mute">{a.commissionPercent}%</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'amber' | 'brand';
}) {
  const cls =
    tone === 'ok'
      ? 'text-ok'
      : tone === 'amber'
      ? 'text-amber-700'
      : tone === 'brand'
      ? 'text-brand'
      : 'text-ink';
  return (
    <div className="card card-pad">
      <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
        {label}
      </div>
      <div className={`text-2xl font-bold mt-1 ${cls}`}>{value}</div>
    </div>
  );
}

function ClientsList() {
  const [rows, setRows] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api<Client[]>('/affiliate/clients').then(setRows).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="card card-pad h-32 animate-shimmer" />;
  if (rows.length === 0) {
    return (
      <div className="card card-pad text-center py-12">
        <div className="text-4xl mb-2">🌱</div>
        <div className="font-semibold">Aún no hay clientes inscritos con tu código</div>
        <div className="text-sm text-mute mt-1">
          Comparte tu link y empieza a sumar referidos.
        </div>
      </div>
    );
  }
  return (
    <div className="card overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-bg2">
            <tr>
              {['Negocio', 'Plan', 'Vía', 'Estado', 'Inscrito', 'Comisiones'].map((h) => (
                <th
                  key={h}
                  className="text-left px-4 py-3 text-[11px] uppercase tracking-[0.1em] text-mute font-semibold"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line2 hover:bg-[#FAFAFB]">
                <td className="px-4 py-3 font-medium">{r.tenantBrand}</td>
                <td className="px-4 py-3 text-xs">{r.plan}</td>
                <td className="px-4 py-3 text-xs">
                  <div className="font-mono">{r.attribution.code}</div>
                  <div className="text-mute text-[10px]">{r.attribution.ownerName}</div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${
                      STATUS_CLS[r.status] ?? 'bg-bg2 text-mute'
                    }`}
                  >
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-mute">{fmtDate(r.signedUpAt)}</td>
                <td className="px-4 py-3 text-xs">
                  {r.commissionsCount} · {fmtUsd(r.commissionsTotalUsd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CommissionsList() {
  const [data, setData] = useState<CommissionResp | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api<CommissionResp>('/affiliate/commissions').then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="card card-pad h-32 animate-shimmer" />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Pendiente" value={fmtUsd(data.totals.pendingUsd)} />
        <Stat label="Disponible" value={fmtUsd(data.totals.approvedUsd)} tone="ok" />
        <Stat label="Pagado" value={fmtUsd(data.totals.paidUsd)} tone="brand" />
        <Stat label="Registros" value={String(data.totals.count)} />
      </div>
      {data.items.length === 0 ? (
        <div className="card card-pad text-center py-12 text-mute text-sm">
          Aún no se han generado comisiones.
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg2">
                <tr>
                  {['Cliente', 'Vía', 'Monto', 'Estado', 'Creada', 'Pagada'].map((h) => (
                    <th
                      key={h}
                      className="text-left px-4 py-3 text-[11px] uppercase tracking-[0.1em] text-mute font-semibold"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id} className="border-t border-line2 hover:bg-[#FAFAFB]">
                    <td className="px-4 py-3 font-medium">{c.tenantBrand}</td>
                    <td className="px-4 py-3 text-xs text-mute">{c.via}</td>
                    <td className="px-4 py-3 font-bold">{fmtUsd(c.amount)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${
                          STATUS_CLS[c.status] ?? 'bg-bg2 text-mute'
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-mute">{fmtDate(c.createdAt)}</td>
                    <td className="px-4 py-3 text-xs text-mute">{fmtDate(c.paidAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsView({
  me,
  onUpdated,
}: {
  me: Me;
  onUpdated: (u: { fullName: string; phone?: string | null }) => void;
}) {
  const [fullName, setFullName] = useState(me.user?.fullName ?? '');
  const [phone, setPhone] = useState(me.user?.phone ?? '');
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const u = await api<{ fullName: string; phone?: string | null }>('/affiliate/me', {
        method: 'PATCH',
        body: JSON.stringify({ fullName: fullName.trim(), phone: phone.trim() || null }),
      });
      toast('Datos actualizados', 'success');
      onUpdated(u);
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card card-pad max-w-md space-y-3">
      <h3 className="font-semibold m-0 mb-1">Tus datos</h3>
      <div className="text-xs text-mute mb-3">
        Estos datos los ve el administrador de Clubify y se usan para enviarte
        notificaciones por WhatsApp cuando hay eventos en tus clientes.
      </div>
      <div>
        <label className="label">Nombre completo</label>
        <input
          className="input"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="label">Email</label>
        <input className="input" value={me.user?.email ?? ''} disabled />
        <div className="text-[11px] text-mute mt-1">
          El email no se puede cambiar (es tu identidad para login).
        </div>
      </div>
      <div>
        <label className="label">WhatsApp</label>
        <input
          className="input"
          placeholder="+57 ..."
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  );
}
