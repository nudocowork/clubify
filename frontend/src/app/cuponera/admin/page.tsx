'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, getUser, clearSession } from '@/lib/api';

const PC = '#0a90bd';

type Overview = {
  campaign: { id: string; name: string; slug: string; status: 'DRAFT' | 'ACTIVE' | 'PAUSED' };
  counts: {
    members: number; activeMembers: number; allies: number; activeAllies: number;
    benefits: number; redemptionsMonth: number; redemptionsTotal: number; walletCards: number;
  };
  topBenefits: { id: string; title: string; redemptions: number }[];
  topAllies: { id: string; name: string; redemptions: number }[];
};
type Ally = {
  id: string; name: string; slug: string; city: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  category: { id: string; name: string } | null;
  _count: { benefits: number; redemptions: number; locations: number };
};
type Member = {
  id: string; status: string; expiresAt: string | null; passId: string | null;
  customer: { id: string; fullName: string; phone: string | null; email: string | null };
  plan: { id: string; name: string } | null;
};
type Redemption = {
  id: string; createdAt: string;
  benefit: { id: string; title: string } | null;
  ally: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  customer: { id: string; fullName: string; phone: string | null } | null;
};

const card: React.CSSProperties = { background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,.06)', marginBottom: 18 };
const btn = (bg = PC, color = '#fff'): React.CSSProperties => ({ background: bg, color, border: 'none', padding: '9px 16px', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: 'pointer' });
const fecha = (s: string) => new Date(s).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });

const ALLY_STATUS: Record<Ally['status'], { t: string; bg: string; c: string }> = {
  APPROVED: { t: 'Aprobado', bg: '#dcfce7', c: '#166534' },
  PENDING: { t: 'Pendiente', bg: '#fef3c7', c: '#92400e' },
  REJECTED: { t: 'Rechazado', bg: '#fee2e2', c: '#991b1b' },
  SUSPENDED: { t: 'Suspendido', bg: '#f3f4f6', c: '#4b5563' },
};

const TABS = ['Dashboard', 'Aliados', 'Beneficiarios', 'Redenciones'] as const;
type Tab = (typeof TABS)[number];

function Stat({ n, label, hint }: { n: number; label: string; hint?: string }) {
  return (
    <div style={{ background: '#f9fafb', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1 }}>{n}</div>
      <div style={{ fontSize: 12.5, color: '#374151', marginTop: 2 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>{hint}</div>}
    </div>
  );
}

export default function CuponeraAdminPage() {
  const router = useRouter();
  // ?campaignId= lo usa el Master Admin para entrar a CUALQUIER cuponera sin
  // volver a iniciar sesión (§1). No hace falta suplantar a nadie: el backend
  // ya autoriza a PLATFORM_OWNER en resolveAdminCampaign, y a un CUPONERA_ADMIN
  // le rechaza cualquier id que no sea el suyo. La auditoría queda intacta
  // porque el owner sigue siendo él mismo.
  const params = useSearchParams();
  const campaignId = params.get('campaignId') || '';
  const qs = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : '';
  const [verComo, setVerComo] = useState(false);
  const [tab, setTab] = useState<Tab>('Dashboard');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [allies, setAllies] = useState<Ally[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [reds, setReds] = useState<Redemption[]>([]);

  useEffect(() => {
    const u = getUser();
    // PLATFORM_OWNER/SUPER_ADMIN también entran (§1: "entrar administrativamente
    // a cualquier cuponera"); el backend decide cuál les toca.
    if (!u || !['CUPONERA_ADMIN', 'PLATFORM_OWNER', 'SUPER_ADMIN'].includes(u.role)) {
      router.replace('/login');
      return;
    }
    (async () => {
      try {
        const [o, a, m, r] = await Promise.all([
          api(`/cuponera/panel/overview${qs}`),
          api(`/cuponera/panel/allies${qs}`),
          api(`/cuponera/panel/members${qs}`),
          api(`/cuponera/panel/redemptions${qs}`),
        ]);
        setOv(o as Overview);
        // api() devuelve null en respuesta vacía.
        setAllies(((a as Ally[]) ?? []));
        setMembers(((m as Member[]) ?? []));
        setReds(((r as Redemption[]) ?? []));
      } catch (e: any) {
        setErr(e?.message || 'No se pudo cargar el panel');
      } finally { setLoading(false); }
    })();
    setVerComo(!!campaignId && u.role !== 'CUPONERA_ADMIN');
  }, [router, qs, campaignId]);

  if (loading) return <div style={{ padding: 28, color: '#64748b' }}>Cargando…</div>;
  if (err) return <div style={{ padding: 28, color: '#b91c1c' }}>{err}</div>;

  const c = ov?.counts;
  const draft = ov?.campaign.status !== 'ACTIVE';

  return (
    <div style={{ padding: 22, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{ov?.campaign.name}</h1>
          <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 2 }}>Panel de la cuponera</div>
        </div>
        <button onClick={() => { clearSession(); router.replace('/login'); }}
          style={{ fontSize: 13, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>
          Salir
        </button>
      </div>

      {verComo && (
        <div style={{ background: '#eef2ff', border: '1px solid #c7d2fe', color: '#3730a3', borderRadius: 10, padding: '10px 13px', fontSize: 12.5, marginBottom: 12, display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>Estás viendo esta cuponera <b>desde la administración</b>, con tu propia cuenta.</span>
          <a href="/superadmin/cuponeras" style={{ color: '#3730a3', fontWeight: 700, textDecoration: 'underline' }}>Volver a Cuponeras</a>
        </div>
      )}

      {draft && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 10, padding: '10px 13px', fontSize: 12.5, marginBottom: 16 }}>
          Esta cuponera está <b>sin publicar</b>. Los aliados todavía no pueden canjear:
          el escáner rechaza la tarjeta hasta que se publique desde el Master Admin.
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ ...btn(tab === t ? PC : '#eef2f7', tab === t ? '#fff' : '#111827'), padding: '8px 14px' }}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Dashboard' && c && (
        <>
          <div style={card}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
              <Stat n={c.members} label="Beneficiarios" hint={`${c.activeMembers} activos`} />
              <Stat n={c.allies} label="Aliados" hint={`${c.activeAllies} aprobados`} />
              <Stat n={c.benefits} label="Beneficios activos" />
              <Stat n={c.walletCards} label="Tarjetas emitidas" />
              <Stat n={c.redemptionsMonth} label="Canjes este mes" hint="desde el 1°" />
              <Stat n={c.redemptionsTotal} label="Canjes históricos" />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 18 }}>
            <div style={card}>
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>Beneficios más usados</div>
              {ov.topBenefits.length === 0
                ? <div style={{ fontSize: 13, color: '#9ca3af' }}>Todavía no hay canjes.</div>
                : ov.topBenefits.map((b) => (
                  <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, padding: '7px 0', borderBottom: '1px solid #f3f4f6' }}>
                    <span>{b.title}</span><b>{b.redemptions}</b>
                  </div>
                ))}
            </div>
            <div style={card}>
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>Aliados con más canjes</div>
              {ov.topAllies.length === 0
                ? <div style={{ fontSize: 13, color: '#9ca3af' }}>Todavía no hay canjes.</div>
                : ov.topAllies.map((a) => (
                  <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, padding: '7px 0', borderBottom: '1px solid #f3f4f6' }}>
                    <span>{a.name}</span><b>{a.redemptions}</b>
                  </div>
                ))}
            </div>
          </div>
        </>
      )}

      {tab === 'Aliados' && (
        <div style={card}>
          {allies.length === 0
            ? <div style={{ fontSize: 13, color: '#9ca3af' }}>Todavía no hay aliados en esta cuponera.</div>
            : allies.map((a) => {
              const s = ALLY_STATUS[a.status];
              return (
                <div key={a.id} style={{ padding: '11px 0', borderBottom: '1px solid #f3f4f6' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <div>
                      <b style={{ fontSize: 14 }}>{a.name}</b>
                      <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 8 }}>
                        {a.city || '—'}{a.category ? ` · ${a.category.name}` : ''}
                      </span>
                    </div>
                    <span style={{ background: s.bg, color: s.c, padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{s.t}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 3 }}>
                    {a._count.benefits} beneficios · {a._count.locations} sedes · {a._count.redemptions} canjes
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {tab === 'Beneficiarios' && (
        <div style={card}>
          {members.length === 0
            ? <div style={{ fontSize: 13, color: '#9ca3af' }}>Todavía no hay beneficiarios registrados.</div>
            : members.map((m) => (
              <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', padding: '9px 0', borderBottom: '1px solid #f3f4f6' }}>
                <div>
                  <b style={{ fontSize: 13.5 }}>{m.customer.fullName || 'Sin nombre'}</b>
                  <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 8 }}>
                    {m.customer.phone || m.customer.email || '—'}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#374151' }}>
                  {m.plan?.name ?? 'Sin plan'} · <b>{m.status}</b>
                  {m.passId ? ' · tarjeta emitida' : ' · sin tarjeta'}
                </div>
              </div>
            ))}
        </div>
      )}

      {tab === 'Redenciones' && (
        <div style={card}>
          {reds.length === 0
            ? <div style={{ fontSize: 13, color: '#9ca3af' }}>Todavía no hay canjes.</div>
            : reds.map((r) => (
              <div key={r.id} style={{ padding: '9px 0', borderBottom: '1px solid #f3f4f6' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', fontSize: 13.5 }}>
                  <b>{r.benefit?.title ?? '(beneficio eliminado)'}</b>
                  <span style={{ color: '#6b7280', fontSize: 12 }}>{fecha(r.createdAt)}</span>
                </div>
                <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2 }}>
                  {r.ally?.name ?? '—'}{r.location ? ` · ${r.location.name}` : ''}
                  {r.customer ? ` · ${r.customer.fullName || r.customer.phone || ''}` : ''}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
