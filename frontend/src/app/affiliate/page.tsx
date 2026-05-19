'use client';
/**
 * Panel del afiliado (influencer / embajador). Layout y estilos
 * minimal — un solo archivo con las 3 vistas (Resumen, Clientes,
 * Comisiones) en tabs. Datos scoped por el backend al usuario logueado.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, clearSession, getImpersonationBackup, stopImpersonation } from '@/lib/api';
import { Logo } from '@/components/Logo';
import { toast } from '@/components/Toast';
import { PhoneInput } from '@/components/PhoneInput';
import { SupportWidget } from '@/components/SupportWidget';

type Tab = 'overview' | 'clients' | 'commissions' | 'materials' | 'settings';

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
  const [impersonation, setImpersonation] = useState<ReturnType<typeof getImpersonationBackup>>(null);

  useEffect(() => {
    api<Me>('/affiliate/me')
      .then(setMe)
      .catch(() => router.push('/login'))
      .finally(() => setLoading(false));
    setImpersonation(getImpersonationBackup());
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
      {impersonation && (
        <div className="bg-amber-500 text-amber-950 px-4 py-2 text-[13px] flex items-center gap-2 flex-wrap">
          <span className="font-semibold">🛡 Modo admin</span>
          <span className="opacity-80">
            Estás dentro del panel de{' '}
            <b>{impersonation.affiliate?.ownerName ?? me.user?.fullName ?? 'este afiliado'}</b>
            {impersonation.affiliate?.code && (
              <>
                {' '}· código{' '}
                <span className="font-mono">{impersonation.affiliate.code}</span>
              </>
            )}.
          </span>
          <button
            onClick={() => {
              stopImpersonation();
              router.push('/admin/referrals');
            }}
            className="ml-auto bg-amber-950 text-amber-100 px-3 py-1 rounded-md text-xs font-semibold hover:bg-amber-900 transition"
            title="Volver al panel super admin"
          >
            ← Volver al admin
          </button>
        </div>
      )}
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
            className={`tab ${tab === 'materials' ? 'tab-active' : ''}`}
            onClick={() => setTab('materials')}
          >
            📚 Material de apoyo
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
        {tab === 'materials' && <SupportMaterialsList />}
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

      {/* Mentor de ventas IA flotante — visible para todos los afiliados.
          Prompts pre-cargados de prospección, objeciones, scripts WA/IG. */}
      <SupportWidget audience="affiliate" />
    </div>
  );
}

type DashboardResp = {
  kpis: { referrals: number; conversions: number; revenueUsd: number; pendingUsd: number; paidUsd: number };
  directs: { referrals: number; conversions: number; revenueUsd: number; pendingUsd: number; paidUsd: number };
  indirects: { referrals: number; conversions: number; revenueUsd: number; pendingUsd: number; paidUsd: number };
  ambassadors: Array<{
    id: string;
    code: string;
    slug: string;
    ownerName: string;
    commissionPercent: number;
    isActive: boolean;
    referrals: number;
    conversions: number;
    revenueUsd: number;
  }>;
  timeline: Array<{ date: string; signups: number; conversions: number }>;
  sources: Array<{ source: string; referrals: number; conversions: number }>;
};

function Overview({ me }: { me: Me }) {
  const [data, setData] = useState<DashboardResp | null>(null);
  useEffect(() => {
    api<DashboardResp>('/affiliate/dashboard').then(setData).catch(() => {});
  }, []);

  const isInfluencer = me.role === 'AFFILIATE_INFLUENCER';
  const isSocio = me.role === 'AFFILIATE_SOCIO';

  return (
    <div className="space-y-5">
      {/* KPIs globales — siempre visibles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total referidos" value={data ? String(data.kpis.referrals) : '—'} />
        <Stat
          label="Conversiones"
          value={data ? String(data.kpis.conversions) : '—'}
          tone="ok"
        />
        <Stat
          label="Pendiente"
          value={data ? fmtUsd(data.kpis.pendingUsd) : '—'}
          tone="amber"
        />
        <Stat
          label="Pagado"
          value={data ? fmtUsd(data.kpis.paidUsd) : '—'}
          tone="brand"
        />
      </div>

      {/* Separación visual exigida por el spec: directos vs vía embajadores.
          Solo para INFLUENCER — AMBASSADOR/SOCIO no tienen indirectos. */}
      {isInfluencer && data && (
        <div className="card card-pad">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-semibold">Origen de tus referidos</div>
              <div className="text-[11px] text-mute">
                Lo que traés vos directo vs. lo que traen tus embajadores.
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <BreakdownCard
              title="🎯 Tus referidos directos"
              accent="bg-emerald-50 border-emerald-200"
              accentText="text-emerald-700"
              kpis={data.directs}
            />
            <BreakdownCard
              title="👥 Vía tus embajadores"
              accent="bg-violet-50 border-violet-200"
              accentText="text-violet-700"
              kpis={data.indirects}
              hint="Te pagamos 5% indirecto sobre estas ventas."
            />
          </div>
        </div>
      )}

      {/* Timeline 30 días — barra simple inline (sin lib externa) */}
      {data && <ActivitySparkline timeline={data.timeline} />}

      {/* Ranking embajadores estilo Pedro: 5 · Laura: 9 · Camila: 2 */}
      {isInfluencer && data && data.ambassadors.length > 0 && (
        <AmbassadorsRanking rows={data.ambassadors} />
      )}

      {/* Sources (UTM) — solo si hay datos no-triviales */}
      {data && data.sources.length > 1 && <SourcesPanel rows={data.sources} />}

      {/* Crear embajador (solo INFLUENCER + toggle on) */}
      {isInfluencer && (
        <InfluencerAmbassadorsPanel
          ambassadors={me.ambassadors}
          myCode={me.myCode?.code ?? null}
        />
      )}

      {/* Material de apoyo: scripts WA + copies IG + tips. Siempre visible
          excepto para SOCIO (que no necesita "vender" su código). */}
      {!isSocio && <ResourcesPanel me={me} />}
    </div>
  );
}

function BreakdownCard({
  title,
  accent,
  accentText,
  kpis,
  hint,
}: {
  title: string;
  accent: string;
  accentText: string;
  kpis: DashboardResp['directs'];
  hint?: string;
}) {
  return (
    <div className={`rounded-xl border p-4 ${accent}`}>
      <div className={`text-xs font-semibold uppercase tracking-wider ${accentText}`}>
        {title}
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3">
        <div>
          <div className="text-[11px] text-mute">Referidos</div>
          <div className="text-xl font-bold">{kpis.referrals}</div>
        </div>
        <div>
          <div className="text-[11px] text-mute">Conversiones</div>
          <div className="text-xl font-bold">{kpis.conversions}</div>
        </div>
        <div>
          <div className="text-[11px] text-mute">Revenue</div>
          <div className="text-xl font-bold">{fmtUsd(kpis.revenueUsd)}</div>
        </div>
      </div>
      {hint && (
        <div className={`text-[11px] mt-2 ${accentText} opacity-80`}>{hint}</div>
      )}
    </div>
  );
}

function ActivitySparkline({
  timeline,
}: {
  timeline: DashboardResp['timeline'];
}) {
  if (!timeline.length) return null;
  const max = Math.max(1, ...timeline.map((t) => t.signups));
  const totalSignups = timeline.reduce((s, t) => s + t.signups, 0);
  const totalConversions = timeline.reduce((s, t) => s + t.conversions, 0);

  return (
    <div className="card card-pad">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <div className="font-semibold text-sm">Actividad últimos 30 días</div>
          <div className="text-[11px] text-mute">
            {totalSignups} signups · {totalConversions} conversiones
          </div>
        </div>
      </div>
      <div className="flex items-end gap-[2px] h-20">
        {timeline.map((t) => {
          const h = (t.signups / max) * 100;
          return (
            <div
              key={t.date}
              className="flex-1 relative group"
              title={`${t.date}: ${t.signups} signups · ${t.conversions} conversiones`}
            >
              <div
                className="absolute bottom-0 left-0 right-0 bg-brand/30 rounded-t"
                style={{ height: `${Math.max(h, t.signups > 0 ? 6 : 0)}%` }}
              />
              <div
                className="absolute bottom-0 left-0 right-0 bg-brand rounded-t"
                style={{
                  height: `${Math.max(
                    (t.conversions / max) * 100,
                    t.conversions > 0 ? 6 : 0,
                  )}%`,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-4 mt-2 text-[10px] text-mute">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-brand/30" /> Signups
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-brand" /> Conversiones
        </span>
      </div>
    </div>
  );
}

function AmbassadorsRanking({
  rows,
}: {
  rows: DashboardResp['ambassadors'];
}) {
  const max = Math.max(1, ...rows.map((r) => r.referrals));
  return (
    <div className="card overflow-hidden p-0">
      <div className="px-4 py-3 border-b border-line2 flex items-center justify-between">
        <div>
          <div className="font-semibold text-sm">🏆 Ranking de tus embajadores</div>
          <div className="text-[11px] text-mute">Ordenado por revenue generado.</div>
        </div>
        <div className="text-[11px] text-mute">{rows.length} en total</div>
      </div>
      <div className="divide-y divide-line2">
        {rows.map((r, i) => {
          const pct = (r.referrals / max) * 100;
          return (
            <div key={r.id} className="px-4 py-3 flex items-center gap-3">
              <div className="w-6 text-center font-bold text-mute">{i + 1}</div>
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-100 to-violet-200 text-violet-700 flex items-center justify-center font-bold text-sm flex-none">
                {initials(r.ownerName)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{r.ownerName}</div>
                <div className="text-[11px] text-mute font-mono">
                  {r.code} · {r.commissionPercent}%
                </div>
                <div className="mt-1 h-1.5 bg-bg2 rounded overflow-hidden">
                  <div
                    className="h-full bg-violet-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              <div className="text-right text-xs flex-none w-32">
                <div className="font-bold text-base">{r.referrals} <span className="text-mute font-normal">referidos</span></div>
                <div className="text-mute">
                  {r.conversions} conv · {fmtUsd(r.revenueUsd)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SourcesPanel({ rows }: { rows: DashboardResp['sources'] }) {
  const total = rows.reduce((s, r) => s + r.referrals, 0);
  return (
    <div className="card card-pad">
      <div className="font-semibold text-sm mb-3">📡 Por fuente</div>
      <div className="space-y-2">
        {rows.slice(0, 6).map((r) => {
          const pct = total ? Math.round((r.referrals / total) * 100) : 0;
          return (
            <div key={r.source} className="flex items-center gap-3">
              <div className="text-xs font-mono w-24 truncate text-mute">
                {r.source}
              </div>
              <div className="flex-1 h-2 bg-bg2 rounded overflow-hidden">
                <div
                  className="h-full bg-brand"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="text-xs w-24 text-right">
                {r.referrals} · {r.conversions} conv
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

function ResourcesPanel({ me }: { me: Me }) {
  const link =
    typeof window !== 'undefined' && me.myCode
      ? `${window.location.origin}/ref/${me.myCode.slug}`
      : '';
  const role = me.role;

  const waTemplates = [
    {
      title: 'Mensaje frío (primer contacto)',
      text: `Hola 👋 vi tu negocio y se me ocurrió compartirte Clubify: una plataforma que combina pedidos por WhatsApp, tarjetas de fidelización en Apple/Google Wallet y automatizaciones — todo en una sola cuenta. Si te interesa probarlo, te dejo mi link: ${link}`,
    },
    {
      title: 'Mensaje cálido (alguien que ya te conoce)',
      text: `Hola! Te quería compartir Clubify, lo estoy usando con varios negocios locales y los resultados son muy buenos: más pedidos por WhatsApp y clientes que vuelven más seguido. Te dejo mi link para que lo veas: ${link}`,
    },
    {
      title: 'Mensaje seguimiento (no me contestaron)',
      text: `Hola! ¿Pudiste mirar Clubify? Si querés te muestro una demo de 5 min sin compromiso — me decís y coordinamos. Acá el link por si lo quisieras explorar primero: ${link}`,
    },
  ];

  const igCopies = [
    {
      title: 'Story bloque 1: gancho',
      text: '¿Sabías que tus clientes pueden tener tu tarjeta de fidelización en su Apple Wallet sin descargar nada? 👀',
    },
    {
      title: 'Story bloque 2: solución',
      text: 'Con Clubify vendés por WhatsApp, premiás clientes recurrentes y todo automático. Sin apps, sin tarjetas físicas. 💳',
    },
    {
      title: 'CTA final',
      text: `Activá tu cuenta hoy 👇 ${link}`,
    },
  ];

  const tips =
    role === 'AFFILIATE_AMBASSADOR'
      ? [
          'Tu cuota mensual es realista: 2-3 negocios al mes con seguimiento.',
          'Foco: pedile referidos a los dueños que ya cerraste. Es el canal #1.',
          'Cuando alguien diga "está caro", llevá la conversación al ROI: 1 cliente que vuelve más seguido cubre 6 meses de Clubify.',
        ]
      : [
          'Tu link corto /ref/<tu-slug> tiene tracking de visitas — vas a ver el click-through en este panel.',
          'Compartilo en Stories de Instagram con sticker de link — funciona mejor que en posts.',
          'Para tu equipo de embajadores: armá un grupo de WhatsApp y compartí resultados semanales — incentivá la competencia sana.',
        ];

  return (
    <div className="space-y-5">
      <div>
        <div className="font-semibold text-base mb-1">📚 Material de apoyo</div>
        <div className="text-xs text-mute">
          Scripts, copies y tips para vender Clubify. Copialos y editalos a tu estilo.
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="card card-pad">
          <div className="font-semibold text-sm mb-2 flex items-center gap-2">
            💬 Templates WhatsApp
          </div>
          <div className="space-y-3">
            {waTemplates.map((t) => (
              <CopyableSnippet key={t.title} title={t.title} text={t.text} />
            ))}
          </div>
        </div>

        <div className="card card-pad">
          <div className="font-semibold text-sm mb-2 flex items-center gap-2">
            📸 Copies Instagram
          </div>
          <div className="space-y-3">
            {igCopies.map((t) => (
              <CopyableSnippet key={t.title} title={t.title} text={t.text} />
            ))}
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="font-semibold text-sm mb-2">💡 Tips para vender</div>
        <ul className="text-sm text-ink/85 space-y-1.5 leading-relaxed list-disc pl-5">
          {tips.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function CopyableSnippet({ title, text }: { title: string; text: string }) {
  return (
    <div className="bg-bg2/50 rounded-lg p-3 border border-line2">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="text-[11px] uppercase tracking-wider text-mute font-semibold flex-1">
          {title}
        </div>
        <button
          className="text-[11px] text-brand hover:underline whitespace-nowrap"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              toast('Copiado', 'success');
            } catch {
              toast('No se pudo copiar', 'error');
            }
          }}
        >
          Copiar
        </button>
      </div>
      <div className="text-xs text-ink/85 leading-relaxed whitespace-pre-wrap">
        {text}
      </div>
    </div>
  );
}

function InfluencerAmbassadorsPanel({
  ambassadors: initial,
  myCode,
}: {
  ambassadors: Me['ambassadors'];
  /** Code del influencer — se usa para construir el link público de
   *  registro de embajadores `/refer/<code>`. Si está null (raro), la
   *  card de "copiar link" no aparece. */
  myCode: string | null;
}) {
  const [ambassadors, setAmbassadors] = useState(initial);
  const [showForm, setShowForm] = useState(false);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    whatsapp: '',
    commissionPercent: 25,
    password: '',
    confirmPassword: '',
  });
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createdInfo, setCreatedInfo] = useState<
    { email: string; password: string } | null
  >(null);

  function genReadablePassword(len = 12): string {
    // Mismo alfabeto que genera el backend (sin chars ambiguos)
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz';
    let out = '';
    for (let i = 0; i < len; i++) {
      out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
  }
  function autoFillPassword() {
    const p = genReadablePassword();
    setForm({ ...form, password: p, confirmPassword: p });
    setShowPwd(true);
  }

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
    if (form.password && form.password.length < 8) {
      toast('La contraseña debe tener al menos 8 caracteres', 'error');
      return;
    }
    if (form.password && form.password !== form.confirmPassword) {
      toast('Las contraseñas no coinciden', 'error');
      return;
    }
    setBusy(true);
    try {
      const payload: any = {
        fullName: form.fullName,
        email: form.email,
        whatsapp: form.whatsapp,
        commissionPercent: form.commissionPercent,
      };
      if (form.password) payload.password = form.password;
      const created = await api<any>('/affiliate/ambassadors', {
        method: 'POST',
        body: JSON.stringify(payload),
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
      const credPassword =
        created?.affiliateCredentials?.password || form.password;
      if (credPassword) {
        setCreatedInfo({ email: form.email, password: credPassword });
      }
      setForm({
        fullName: '',
        email: '',
        whatsapp: '',
        commissionPercent: 25,
        password: '',
        confirmPassword: '',
      });
      setShowForm(false);
      setShowPwd(false);
      toast(
        created.approvedAt
          ? 'Embajador agregado — credenciales creadas'
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

  const signupLink =
    myCode && typeof window !== 'undefined'
      ? `${window.location.origin}/refer/${myCode}`
      : '';

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

      {signupLink && (
        <div className="rounded-lg bg-brand-soft/40 border border-brand/20 p-3 mb-3">
          <div className="text-[11px] uppercase tracking-wider text-brand font-bold mb-1.5">
            🔗 Link de registro de embajadores
          </div>
          <div className="text-xs text-mute mb-2 leading-snug">
            Compartí este link con personas que quieras sumar a tu equipo.
            Quien lo abra se registra solo y queda automáticamente vinculado
            a vos.
          </div>
          <div className="flex items-center gap-2">
            <input
              className="input flex-1 text-xs font-mono"
              readOnly
              value={signupLink}
              onClick={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              className="btn-ghost text-xs whitespace-nowrap"
              onClick={async () => {
                await navigator.clipboard.writeText(signupLink);
                toast('Link copiado', 'success');
              }}
            >
              📋 Copiar
            </button>
          </div>
        </div>
      )}

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
          <div className="border-t border-line2 pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-ink">
                Contraseña de acceso
              </label>
              <div className="flex items-center gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={autoFillPassword}
                  className="text-brand hover:underline"
                >
                  ⚡ Generar
                </button>
                <button
                  type="button"
                  onClick={() => setShowPwd((s) => !s)}
                  className="text-mute hover:text-ink"
                >
                  {showPwd ? '🙈 Ocultar' : '👁 Ver'}
                </button>
              </div>
            </div>
            <input
              type={showPwd ? 'text' : 'password'}
              className="input"
              placeholder="Mín 8 caracteres (o usá Generar)"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              autoComplete="new-password"
              minLength={8}
            />
            <input
              type={showPwd ? 'text' : 'password'}
              className="input"
              placeholder="Confirmar contraseña"
              value={form.confirmPassword}
              onChange={(e) =>
                setForm({ ...form, confirmPassword: e.target.value })
              }
              autoComplete="new-password"
            />
            <div className="text-[11px] text-mute leading-snug">
              El embajador entra a su panel con su email + esta contraseña. Si la
              dejás vacía, le mandamos un email con instrucciones para crearla.
            </div>
          </div>
          <button type="submit" disabled={busy} className="btn-primary w-full text-sm">
            {busy ? 'Creando…' : 'Agregar embajador'}
          </button>
        </form>
      )}

      {createdInfo && (
        <div className="rounded-lg bg-ok-soft border border-ok/30 px-3 py-3 mb-3 text-xs">
          <div className="font-semibold text-ok mb-2">
            ✓ Credenciales de acceso creadas correctamente
          </div>
          <div className="space-y-1.5 font-mono text-ink bg-white rounded p-2.5">
            <div>
              <span className="text-mute">Email: </span>
              <strong>{createdInfo.email}</strong>
            </div>
            <div>
              <span className="text-mute">Contraseña: </span>
              <strong>{createdInfo.password}</strong>
            </div>
          </div>
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              className="btn-ghost text-[11px]"
              onClick={() => {
                navigator.clipboard.writeText(
                  `Email: ${createdInfo.email}\nContraseña: ${createdInfo.password}\nPanel: ${window.location.origin}/login`,
                );
                toast('Credenciales copiadas', 'success');
              }}
            >
              📋 Copiar
            </button>
            <button
              type="button"
              className="btn-ghost text-[11px]"
              onClick={() => setCreatedInfo(null)}
            >
              Cerrar
            </button>
          </div>
        </div>
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

// =====================================================
// SupportMaterialsList — biblioteca de recursos del afiliado
// =====================================================
//
// Lee /affiliate/support-materials que devuelve solo lo que el rol del
// usuario puede ver (filtra por audience + scope). Cards con ícono por
// tipo, buscador, filtro de categoría, acciones contextuales (descargar,
// abrir link, copiar script).

type SupportMaterialType =
  | 'PDF'
  | 'IMAGE'
  | 'VIDEO'
  | 'AUDIO'
  | 'LINK'
  | 'SCRIPT'
  | 'PRESENTATION'
  | 'TEMPLATE'
  | 'OTHER';

type SupportMaterial = {
  id: string;
  title: string;
  description: string | null;
  type: SupportMaterialType;
  fileUrl: string | null;
  externalUrl: string | null;
  thumbnailUrl: string | null;
  scriptBody: string | null;
  category: string;
  createdAt: string;
};

const M_TYPE_ICON: Record<SupportMaterialType, string> = {
  PDF: '📄',
  IMAGE: '🖼',
  VIDEO: '🎬',
  AUDIO: '🎵',
  LINK: '🔗',
  SCRIPT: '📝',
  PRESENTATION: '🎤',
  TEMPLATE: '📋',
  OTHER: '📦',
};

const M_TYPE_LABEL: Record<SupportMaterialType, string> = {
  PDF: 'PDF',
  IMAGE: 'Imagen',
  VIDEO: 'Video',
  AUDIO: 'Audio',
  LINK: 'Link',
  SCRIPT: 'Script',
  PRESENTATION: 'Presentación',
  TEMPLATE: 'Plantilla',
  OTHER: 'Recurso',
};

function SupportMaterialsList() {
  const [items, setItems] = useState<SupportMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [previewScript, setPreviewScript] = useState<SupportMaterial | null>(null);

  useEffect(() => {
    api<SupportMaterial[]>('/affiliate/support-materials')
      .then((r) => setItems(r ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const categories = useMemo(() => {
    const s = new Set<string>();
    items.forEach((m) => s.add(m.category));
    return Array.from(s).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((m) => {
      if (category && m.category !== category) return false;
      if (term) {
        const hay = `${m.title} ${m.description ?? ''} ${m.category}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [items, search, category]);

  const grouped = useMemo(() => {
    const byCat: Record<string, SupportMaterial[]> = {};
    filtered.forEach((m) => {
      byCat[m.category] = byCat[m.category] ?? [];
      byCat[m.category].push(m);
    });
    return Object.entries(byCat).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  if (loading) {
    return <div className="card card-pad text-mute text-sm">Cargando…</div>;
  }

  if (items.length === 0) {
    return (
      <div className="card card-pad text-center py-10">
        <div className="text-4xl mb-2">📚</div>
        <div className="font-semibold mb-1">Aún no hay materiales</div>
        <div className="text-xs text-mute leading-relaxed max-w-sm mx-auto">
          El equipo Clubify sube acá scripts, videos, PDFs y plantillas que te
          ayudan a vender. Volvé en unos días si todavía no hay nada disponible.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="card card-pad">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_220px] gap-3">
          <input
            className="input"
            placeholder="🔍 Buscar material…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Todas las categorías</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="text-[11px] text-mute mt-2 leading-snug">
          {filtered.length} de {items.length} materiales disponibles para vos.
        </div>
      </div>

      {grouped.length === 0 ? (
        <div className="card card-pad text-center text-mute text-sm py-6">
          Sin resultados para la búsqueda.
        </div>
      ) : (
        grouped.map(([cat, list]) => (
          <div key={cat}>
            <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-2">
              {cat} <span className="text-mute/60">· {list.length}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {list.map((m) => (
                <SupportMaterialCard
                  key={m.id}
                  m={m}
                  onPreviewScript={() => setPreviewScript(m)}
                />
              ))}
            </div>
          </div>
        ))
      )}

      {previewScript && (
        <ScriptPreviewModal
          material={previewScript}
          onClose={() => setPreviewScript(null)}
        />
      )}
    </div>
  );
}

function SupportMaterialCard({
  m,
  onPreviewScript,
}: {
  m: SupportMaterial;
  onPreviewScript: () => void;
}) {
  const url = m.fileUrl || m.externalUrl;
  const isScript = m.type === 'SCRIPT' && !!m.scriptBody;

  async function copyLink() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    toast('Link copiado', 'success');
  }

  async function copyScript() {
    if (!m.scriptBody) return;
    await navigator.clipboard.writeText(m.scriptBody);
    toast('Script copiado al portapapeles', 'success');
  }

  return (
    <div className="card card-pad flex flex-col gap-2.5 hover:shadow-md transition">
      {m.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={m.thumbnailUrl}
          alt=""
          className="w-full h-32 object-cover rounded-lg"
        />
      ) : (
        <div className="w-full h-32 rounded-lg bg-bg2 flex items-center justify-center text-5xl">
          {M_TYPE_ICON[m.type]}
        </div>
      )}

      <div>
        <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
          {M_TYPE_LABEL[m.type]}
        </div>
        <div className="font-semibold text-sm leading-tight mt-0.5">
          {m.title}
        </div>
        {m.description && (
          <div className="text-xs text-mute leading-snug mt-1 line-clamp-2">
            {m.description}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 mt-auto pt-1.5">
        {isScript && (
          <>
            <button
              onClick={onPreviewScript}
              className="btn-ghost text-[11px] flex-1"
            >
              👁 Ver
            </button>
            <button onClick={copyScript} className="btn-primary text-[11px] flex-1">
              📋 Copiar
            </button>
          </>
        )}
        {!isScript && url && (
          <>
            {m.fileUrl ? (
              <a
                href={url}
                download
                target="_blank"
                rel="noreferrer"
                className="btn-primary text-[11px] flex-1 text-center"
              >
                ⬇ Descargar
              </a>
            ) : (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="btn-primary text-[11px] flex-1 text-center"
              >
                ↗ Abrir
              </a>
            )}
            <button onClick={copyLink} className="btn-ghost text-[11px]" title="Copiar link">
              🔗
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ScriptPreviewModal({
  material,
  onClose,
}: {
  material: SupportMaterial;
  onClose: () => void;
}) {
  async function copy() {
    if (material.scriptBody) {
      await navigator.clipboard.writeText(material.scriptBody);
      toast('Copiado', 'success');
    }
  }
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-5 animate-in zoom-in-95 fade-in duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
              {M_TYPE_LABEL[material.type]} · {material.category}
            </div>
            <h2 className="font-bold text-lg leading-tight">{material.title}</h2>
          </div>
          <button onClick={onClose} className="text-mute hover:text-ink text-xl">
            ×
          </button>
        </div>
        {material.description && (
          <div className="text-xs text-mute mb-3 leading-relaxed">
            {material.description}
          </div>
        )}
        <pre className="bg-bg2 rounded-lg p-3 text-xs whitespace-pre-wrap font-mono leading-relaxed max-h-[50vh] overflow-y-auto">
          {material.scriptBody}
        </pre>
        <div className="flex justify-end gap-2 pt-3">
          <button onClick={onClose} className="btn-ghost text-sm">
            Cerrar
          </button>
          <button onClick={copy} className="btn-primary text-sm">
            📋 Copiar todo
          </button>
        </div>
      </div>
    </div>
  );
}
