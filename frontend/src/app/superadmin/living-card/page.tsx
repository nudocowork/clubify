'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ImageUploader } from '@/components/ImageUploader';
import { PhoneInput } from '@/components/PhoneInput';

const PC = '#0a90bd';

type Campaign = { id: string; name: string; slug: string; status: 'DRAFT' | 'ACTIVE' | 'PAUSED'; welcomeText: string; cardId: string | null; marketplace: Record<string, any>; mpConfigured: boolean };
type Card = { id: string; name: string; primaryColor?: string | null; secondaryColor?: string | null; logoUrl?: string | null; heroImageUrl?: string | null; rewardText?: string | null; howToEarnText?: string | null; terms?: string | null } | null;
type Plan = { id: string; name: string; priceCents: number; currency: string; interval: 'MONTHLY' | 'ANNUAL'; level: number; benefitsAllowance: number | null; description: string; isActive: boolean; sortOrder: number };
type Category = { id: string; name: string; slug: string; icon: string; sortOrder: number; isActive: boolean };
type Member = { id: string; status: string; source: string; memberLevel: number; expiresAt: string | null; passId: string | null; customer: { id: string; fullName: string; phone: string | null; email: string | null }; plan: { id: string; name: string } | null };
type Metrics = { members: number; activeMembers: number; cardsIssued: number; walletInstalled: number; plans: number; categories: number };
type Ally = { id: string; name: string; slug: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED'; city: string; whatsapp: string | null; category: { id: string; name: string } | null; admins: { email: string }[] };
type AdminBenefit = { id: string; title: string; type: string; status: string; approval: 'PENDING' | 'APPROVED' | 'REJECTED'; redemptionCount: number; ally: { id: string; name: string } | null; category: { name: string } | null };

const money = (cents: number, currency = 'COP') =>
  currency === 'COP' ? `$ ${Number(cents || 0).toLocaleString('es-CO')}` : `${currency} ${(Number(cents || 0) / 100).toFixed(2)}`;

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,.06)', marginBottom: 20 }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>{title}</div>
        {desc && <div style={{ fontSize: 12.5, color: '#6b7280', marginTop: 2 }}>{desc}</div>}
      </div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #d7dbe0', borderRadius: 9, fontSize: 13.5, outline: 'none' };
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block' };
const btn = (bg = PC, color = '#fff'): React.CSSProperties => ({ background: bg, color, border: 'none', padding: '9px 16px', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: 'pointer' });

export default function LivingCardAdminPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [card, setCard] = useState<Card>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [allies, setAllies] = useState<Ally[]>([]);
  const [benefits, setBenefits] = useState<AdminBenefit[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };

  async function loadAll() {
    setLoading(true); setErr(null);
    try {
      const [ov, mt, mem, al, bn] = await Promise.all([
        api<{ campaign: Campaign; card: Card; plans: Plan[]; categories: Category[] }>('/cuponera/admin'),
        api<Metrics>('/cuponera/admin/metrics'),
        api<Member[]>('/cuponera/admin/members'),
        api<Ally[]>('/cuponera/admin/allies'),
        api<AdminBenefit[]>('/cuponera/admin/benefits'),
      ]);
      setCampaign(ov.campaign); setCard(ov.card); setPlans(ov.plans); setCategories(ov.categories);
      setMetrics(mt); setMembers(mem); setAllies(al); setBenefits(bn);
    } catch (e: any) { setErr(e?.message || 'Error al cargar'); } finally { setLoading(false); }
  }
  useEffect(() => { loadAll(); }, []);

  if (loading) return <div style={{ padding: 20 }}>Cargando Living Card…</div>;
  if (err) return <div style={{ padding: 20, color: '#b91c1c' }}>Error: {err}</div>;
  if (!campaign) return null;

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>🎟️ Living Card</h1>
      <p style={{ color: '#6b7280', fontSize: 13.5, marginBottom: 22 }}>
        Tarjeta de comunidad — beneficios, membresías y Wallet. Marketplace público en <b>cuponera.soyclubify.com</b>.
      </p>

      {toast && <div style={{ position: 'fixed', top: 16, right: 20, background: '#111827', color: '#fff', padding: '10px 16px', borderRadius: 10, zIndex: 50, fontSize: 13 }}>{toast}</div>}

      {metrics && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
          {[['Miembros', metrics.members], ['Activos', metrics.activeMembers], ['Tarjetas emitidas', metrics.cardsIssued], ['Instaladas en Wallet', metrics.walletInstalled], ['Planes', metrics.plans], ['Categorías', metrics.categories]].map(([label, val]) => (
            <div key={label as string} style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
              <div style={{ fontSize: 26, fontWeight: 900, color: PC }}>{val as number}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{label as string}</div>
            </div>
          ))}
        </div>
      )}

      <CampaignSection campaign={campaign} onSaved={(c) => { setCampaign(c); flash('Campaña guardada'); }} />
      <CardSection card={card} onSaved={(c) => { setCard(c); flash('Tarjeta guardada'); loadAll(); }} />
      <PlansSection plans={plans} onChange={() => { loadAll(); flash('Planes actualizados'); }} />
      <CategoriesSection categories={categories} onChange={() => { loadAll(); flash('Categorías actualizadas'); }} />
      <AlliesSection allies={allies} categories={categories} onChange={() => { loadAll(); flash('Negocios actualizados'); }} />
      <BenefitsSection benefits={benefits} onChange={() => { loadAll(); flash('Beneficios actualizados'); }} />
      <StampProgramsSection categories={categories} flash={flash} />
      <GeopushSection flash={flash} />
      <PushSection plans={plans} allies={allies} flash={flash} />
      <MercadoPagoSection onSaved={() => { flash('MercadoPago guardado'); }} />
      <MembersSection members={members} plans={plans} onEnrolled={() => { loadAll(); flash('Miembro dado de alta'); }} />
    </div>
  );
}

function CampaignSection({ campaign, onSaved }: { campaign: Campaign; onSaved: (c: Campaign) => void }) {
  const [name, setName] = useState(campaign.name);
  const [welcomeText, setWelcomeText] = useState(campaign.welcomeText);
  const [status, setStatus] = useState(campaign.status);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try { const c = await api<Campaign>('/cuponera/admin/campaign', { method: 'PATCH', body: JSON.stringify({ name, welcomeText, status }) }); onSaved({ ...campaign, ...c }); }
    finally { setSaving(false); }
  }
  return (
    <Section title="Campaña" desc="Estado y textos generales de Living Card.">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div><label style={labelStyle}>Nombre</label><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label style={labelStyle}>Estado</label>
          <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value as any)}>
            <option value="DRAFT">Borrador</option><option value="ACTIVE">Activa</option><option value="PAUSED">Pausada</option>
          </select>
        </div>
      </div>
      <div style={{ marginTop: 14 }}><label style={labelStyle}>Texto de bienvenida</label><input style={inputStyle} value={welcomeText} onChange={(e) => setWelcomeText(e.target.value)} /></div>
      <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
        <button style={btn()} disabled={saving} onClick={save}>{saving ? 'Guardando…' : 'Guardar campaña'}</button>
        <span style={{ fontSize: 12, color: campaign.mpConfigured ? '#16a34a' : '#9ca3af' }}>{campaign.mpConfigured ? '✓ MercadoPago configurado' : 'MercadoPago pendiente'}</span>
      </div>
    </Section>
  );
}

function CardSection({ card, onSaved }: { card: Card; onSaved: (c: Card) => void }) {
  const [f, setF] = useState({
    name: card?.name || 'Living Card', primaryColor: card?.primaryColor || '#0a90bd', secondaryColor: card?.secondaryColor || '#075e7d',
    logoUrl: card?.logoUrl || '', heroImageUrl: card?.heroImageUrl || '', rewardText: card?.rewardText || 'Beneficios exclusivos para miembros',
    howToEarnText: card?.howToEarnText || '', terms: card?.terms || '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  async function save() {
    setSaving(true);
    try {
      const c = await api<Card>('/cuponera/admin/card', { method: 'PUT', body: JSON.stringify({ name: f.name, primaryColor: f.primaryColor, secondaryColor: f.secondaryColor, logoUrl: f.logoUrl || undefined, heroImageUrl: f.heroImageUrl || undefined, rewardText: f.rewardText, howToEarnText: f.howToEarnText, terms: f.terms }) });
      onSaved(c);
    } finally { setSaving(false); }
  }
  return (
    <Section title="Diseño de la tarjeta (Wallet)" desc="Se aplica a Apple/Google Wallet de todos los miembros.">
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 20 }}>
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div><label style={labelStyle}>Nombre en la tarjeta</label><input style={inputStyle} value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
            <div><label style={labelStyle}>Beneficio principal</label><input style={inputStyle} value={f.rewardText} onChange={(e) => set('rewardText', e.target.value)} /></div>
            <div><label style={labelStyle}>Color de fondo</label><input type="color" style={{ ...inputStyle, height: 40, padding: 4 }} value={f.primaryColor} onChange={(e) => set('primaryColor', e.target.value)} /></div>
            <div><label style={labelStyle}>Color secundario</label><input type="color" style={{ ...inputStyle, height: 40, padding: 4 }} value={f.secondaryColor} onChange={(e) => set('secondaryColor', e.target.value)} /></div>
            <div><label style={labelStyle}>Logo (URL)</label><input style={inputStyle} placeholder="https://…/logo.png" value={f.logoUrl} onChange={(e) => set('logoUrl', e.target.value)} /></div>
            <div><label style={labelStyle}>Imagen principal (URL)</label><input style={inputStyle} placeholder="https://…/hero.png" value={f.heroImageUrl} onChange={(e) => set('heroImageUrl', e.target.value)} /></div>
          </div>
          <div style={{ marginTop: 14 }}><label style={labelStyle}>Cómo funciona</label><input style={inputStyle} value={f.howToEarnText} onChange={(e) => set('howToEarnText', e.target.value)} /></div>
          <div style={{ marginTop: 14 }}><label style={labelStyle}>Términos y condiciones</label><textarea style={{ ...inputStyle, minHeight: 60 }} value={f.terms} onChange={(e) => set('terms', e.target.value)} /></div>
          <button style={{ ...btn(), marginTop: 16 }} disabled={saving} onClick={save}>{saving ? 'Guardando…' : card ? 'Actualizar tarjeta' : 'Crear tarjeta'}</button>
        </div>
        <div>
          <label style={labelStyle}>Vista previa</label>
          <div style={{ borderRadius: 16, padding: 18, minHeight: 180, color: '#fff', background: `linear-gradient(135deg, ${f.primaryColor}, ${f.secondaryColor})`, boxShadow: '0 10px 24px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {f.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.logoUrl} alt="logo" style={{ width: 38, height: 38, borderRadius: 8, objectFit: 'contain', background: '#fff' }} />
              ) : (
                <div style={{ width: 38, height: 38, borderRadius: 8, background: 'rgba(255,255,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>{f.name[0]?.toUpperCase()}</div>
              )}
              <div style={{ fontWeight: 800, fontSize: 15 }}>{f.name}</div>
            </div>
            <div>
              <div style={{ fontSize: 12.5, opacity: 0.9 }}>{f.rewardText}</div>
              <div style={{ marginTop: 10, background: '#fff', width: 90, height: 90, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#111', fontSize: 10 }}>QR</div>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

function PlansSection({ plans, onChange }: { plans: Plan[]; onChange: () => void }) {
  const empty = { name: '', priceCents: 0, interval: 'MONTHLY' as const, level: 0, description: '' };
  const [form, setForm] = useState<any>(empty);
  const [busy, setBusy] = useState(false);
  async function add() { if (!form.name.trim()) return; setBusy(true); try { await api('/cuponera/admin/plans', { method: 'POST', body: JSON.stringify(form) }); setForm(empty); onChange(); } finally { setBusy(false); } }
  async function toggle(p: Plan) { await api(`/cuponera/admin/plans/${p.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !p.isActive }) }); onChange(); }
  async function del(p: Plan) { if (!confirm(`¿Eliminar el plan "${p.name}"?`)) return; await api(`/cuponera/admin/plans/${p.id}`, { method: 'DELETE' }); onChange(); }
  return (
    <Section title="Planes de membresía" desc="Ej: Basic $50.000 · Plus · VIP · Builder.">
      {plans.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          {plans.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #eef0f2' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{p.name} {!p.isActive && <span style={{ fontSize: 11, color: '#9ca3af' }}>(inactivo)</span>}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{money(p.priceCents, p.currency)} · {p.interval === 'ANNUAL' ? 'Anual' : 'Mensual'} · nivel {p.level}{p.benefitsAllowance != null ? ` · ${p.benefitsAllowance} beneficios` : ' · beneficios ilimitados'}</div>
              </div>
              <button onClick={() => toggle(p)} style={btn('#e5e7eb', '#374151')}>{p.isActive ? 'Desactivar' : 'Activar'}</button>
              <button onClick={() => del(p)} style={btn('#fee2e2', '#b91c1c')}>Eliminar</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 0.8fr auto', gap: 10, alignItems: 'end' }}>
        <div><label style={labelStyle}>Nombre</label><input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Living Card Basic" /></div>
        <div><label style={labelStyle}>Precio (COP)</label><input style={inputStyle} type="number" value={form.priceCents} onChange={(e) => setForm({ ...form, priceCents: Number(e.target.value) })} /></div>
        <div><label style={labelStyle}>Periodicidad</label><select style={inputStyle} value={form.interval} onChange={(e) => setForm({ ...form, interval: e.target.value })}><option value="MONTHLY">Mensual</option><option value="ANNUAL">Anual</option></select></div>
        <div><label style={labelStyle}>Nivel</label><input style={inputStyle} type="number" value={form.level} onChange={(e) => setForm({ ...form, level: Number(e.target.value) })} /></div>
        <button style={btn()} disabled={busy} onClick={add}>Añadir</button>
      </div>
    </Section>
  );
}

function CategoriesSection({ categories, onChange }: { categories: Category[]; onChange: () => void }) {
  const [name, setName] = useState(''); const [icon, setIcon] = useState(''); const [busy, setBusy] = useState(false);
  async function add() { if (!name.trim()) return; setBusy(true); try { await api('/cuponera/admin/categories', { method: 'POST', body: JSON.stringify({ name, icon }) }); setName(''); setIcon(''); onChange(); } finally { setBusy(false); } }
  async function del(c: Category) { if (!confirm(`¿Eliminar la categoría "${c.name}"?`)) return; await api(`/cuponera/admin/categories/${c.id}`, { method: 'DELETE' }); onChange(); }
  return (
    <Section title="Categorías de beneficios" desc="Restaurantes, Cafés, Belleza, Living Kids, Merch…">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {categories.map((c) => (
          <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#eef4f8', border: '1px solid #d7e6ef', borderRadius: 999, padding: '5px 12px', fontSize: 13 }}>
            <span>{c.icon || '🏷️'}</span><span>{c.name}</span>
            <button onClick={() => del(c)} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontWeight: 700 }}>×</button>
          </span>
        ))}
        {categories.length === 0 && <span style={{ fontSize: 13, color: '#9ca3af' }}>Sin categorías aún.</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr auto', gap: 10, alignItems: 'end' }}>
        <div><label style={labelStyle}>Ícono</label><input style={inputStyle} value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="🍔" /></div>
        <div><label style={labelStyle}>Nombre</label><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Restaurantes" /></div>
        <button style={btn()} disabled={busy} onClick={add}>Añadir</button>
      </div>
    </Section>
  );
}

const ALLY_STATUS: Record<string, { label: string; color: string }> = { PENDING: { label: 'Pendiente', color: '#b45309' }, APPROVED: { label: 'Aprobado', color: '#16a34a' }, REJECTED: { label: 'Rechazado', color: '#dc2626' }, SUSPENDED: { label: 'Suspendido', color: '#dc2626' } };
function AlliesSection({ allies, categories, onChange }: { allies: Ally[]; categories: Category[]; onChange: () => void }) {
  const empty = { name: '', email: '', ownerFullName: '', categoryId: '', whatsapp: '', city: '', tenantId: '', logoUrl: '', coverUrl: '', address: '', instagram: '', website: '', bTitle: '', bType: 'PERCENT_OFF', bPercent: '', bAmount: '', bMax: '', bPeriod: 'LIFETIME', bUntil: '', bTerms: '' };
  // Negocios elegibles como aliado Tipo A (§16). Se cargan aparte porque el
  // endpoint excluye los que ya son aliados de esta cuponera.
  const [tenants, setTenants] = useState<{ id: string; name: string; brandName: string | null }[]>([]);
  useEffect(() => {
    api<any[]>('/cuponera/admin/allies/tenants').then((r) => setTenants(r ?? [])).catch(() => setTenants([]));
  }, []);
  const [form, setForm] = useState<any>(empty); const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ email: string; tempPassword?: string } | null>(null); const [msg, setMsg] = useState<string | null>(null);
  async function create() {
    if (!form.name.trim() || !form.email.trim() || !form.ownerFullName.trim()) { setMsg('Nombre, email y responsable requeridos'); return; }
    setBusy(true); setMsg(null);
    try { const r = await api<{ loginEmail: string; tempPassword?: string }>('/cuponera/admin/allies', { method: 'POST', body: JSON.stringify({
        name: form.name, email: form.email, ownerFullName: form.ownerFullName,
        categoryId: form.categoryId || null,
        tenantId: form.tenantId || null,
        whatsapp: form.whatsapp, city: form.city,
        logoUrl: form.logoUrl || null, coverUrl: form.coverUrl || null,
        address: form.address, instagram: form.instagram, website: form.website,
        // El beneficio va solo si le pusieron título: sin eso no hay nada que crear.
        benefit: form.bTitle.trim() ? {
          title: form.bTitle,
          type: form.bType,
          percentOff: form.bType === 'PERCENT_OFF' ? Number(form.bPercent) || null : null,
          amountOffCents: form.bType === 'AMOUNT_OFF' ? Number(form.bAmount) || null : null,
          maxPerMember: form.bMax === '' ? null : Number(form.bMax),
          limitPeriod: form.bPeriod,
          validUntil: form.bUntil || null,
          terms: form.bTerms,
        } : null,
      }) }); setCreated({ email: r.loginEmail, tempPassword: r.tempPassword }); setForm(empty); onChange(); }
    catch (e: any) { setMsg(e?.message || 'Error al crear'); } finally { setBusy(false); }
  }
  async function setStatus(a: Ally, status: string) { await api(`/cuponera/admin/allies/${a.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); onChange(); }
  return (
    <Section title="Negocios aliados" desc="Alta de negocios + aprobación para el marketplace. Cada uno recibe su acceso a /cuponera/panel.">
      {allies.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {allies.map((a) => {
            const st = ALLY_STATUS[a.status];
            return (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #eef0f2' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{a.name} <span style={{ fontSize: 11.5, fontWeight: 700, color: st.color }}>· {st.label}</span></div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{a.category?.name || 'Sin categoría'}{a.city ? ` · ${a.city}` : ''} · {a.admins[0]?.email}</div>
                </div>
                {a.status !== 'APPROVED' && <button onClick={() => setStatus(a, 'APPROVED')} style={btn('#dcfce7', '#166534')}>Aprobar</button>}
                {a.status !== 'SUSPENDED' && <button onClick={() => setStatus(a, 'SUSPENDED')} style={btn('#fee2e2', '#b91c1c')}>Suspender</button>}
              </div>
            );
          })}
        </div>
      )}
      {created && (
        <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 12, padding: 14, marginBottom: 14, fontSize: 13 }}>
          ✓ Negocio creado. Acceso: <b>{created.email}</b>{created.tempPassword && <> · Contraseña temporal: <code style={{ background: '#fff', padding: '2px 6px', borderRadius: 6 }}>{created.tempPassword}</code></>}
          <div style={{ color: '#047857', marginTop: 4 }}>Entra en <b>/cuponera/panel</b> con esas credenciales.</div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1.3fr 1.2fr', gap: 10, alignItems: 'end' }}>
        <div><label style={labelStyle}>Nombre del negocio</label><input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><label style={labelStyle}>Email de acceso</label><input style={inputStyle} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div><label style={labelStyle}>Responsable</label><input style={inputStyle} value={form.ownerFullName} onChange={(e) => setForm({ ...form, ownerFullName: e.target.value })} /></div>
        <div><label style={labelStyle}>Categoría</label><select style={inputStyle} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}><option value="">Sin categoría</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label style={labelStyle}>Ciudad</label><input style={inputStyle} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>¿Este negocio ya es cliente de la marca? (opcional)</label>
          <select style={inputStyle} value={form.tenantId}
            onChange={(e) => setForm({ ...form, tenantId: e.target.value })}>
            <option value="">No — es un aliado externo</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.brandName || t.name}</option>
            ))}
          </select>
          <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 4 }}>
            Si lo vinculás, el negocio podrá leer la tarjeta de la cuponera con
            <b> su escáner de siempre</b>, sin instalar nada. Si lo dejás en “externo”,
            canjea desde el portal web del aliado.
          </div>
        </div>
        {/* Ficha (§5): logo adjuntable, no una URL pegada. */}
        <div>
          <label style={labelStyle}>Logo</label>
          <ImageUploader value={form.logoUrl || null} onChange={(u) => setForm({ ...form, logoUrl: u || '' })} folder="logos" />
        </div>
        <div>
          <label style={labelStyle}>Portada</label>
          <ImageUploader value={form.coverUrl || null} onChange={(u) => setForm({ ...form, coverUrl: u || '' })} folder="covers" />
        </div>
        <div>
          <label style={labelStyle}>WhatsApp</label>
          <PhoneInput value={form.whatsapp} onChange={(v) => setForm({ ...form, whatsapp: v })} />
        </div>
        <div><label style={labelStyle}>Dirección</label><input style={inputStyle} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
        <div><label style={labelStyle}>Instagram</label><input style={inputStyle} placeholder="sincuenta" value={form.instagram} onChange={(e) => setForm({ ...form, instagram: e.target.value })} /></div>
        <div><label style={labelStyle}>Sitio web</label><input style={inputStyle} placeholder="https://" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></div>

        {/* Beneficio inicial (§5, §6, §7). Un aliado sin beneficio no aparece
            en la cartelera: cargarlo acá evita dar de alta a medias. */}
        <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #e5e7eb', paddingTop: 14, marginTop: 4 }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>Su beneficio</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
            Sin beneficio el negocio no sale en la cartelera. Se puede cambiar después.
          </div>
        </div>
        <div><label style={labelStyle}>Qué ofrece</label><input style={inputStyle} placeholder="15% de descuento en day pass" value={form.bTitle} onChange={(e) => setForm({ ...form, bTitle: e.target.value })} /></div>
        <div>
          <label style={labelStyle}>Tipo</label>
          <select style={inputStyle} value={form.bType} onChange={(e) => setForm({ ...form, bType: e.target.value })}>
            <option value="PERCENT_OFF">Porcentaje de descuento</option>
            <option value="AMOUNT_OFF">Monto fijo de descuento</option>
            <option value="TWO_FOR_ONE">2x1</option>
            <option value="FREEBIE">Producto gratis</option>
            <option value="OTHER">Otro</option>
          </select>
        </div>
        {form.bType === 'PERCENT_OFF' && (
          <div><label style={labelStyle}>% de descuento</label><input type="number" style={inputStyle} value={form.bPercent} onChange={(e) => setForm({ ...form, bPercent: e.target.value })} /></div>
        )}
        {form.bType === 'AMOUNT_OFF' && (
          <div><label style={labelStyle}>Monto del descuento</label><input type="number" style={inputStyle} value={form.bAmount} onChange={(e) => setForm({ ...form, bAmount: e.target.value })} /></div>
        )}
        <div><label style={labelStyle}>Usos por beneficiario</label><input type="number" style={inputStyle} placeholder="vacío = ilimitado" value={form.bMax} onChange={(e) => setForm({ ...form, bMax: e.target.value })} /></div>
        <div>
          <label style={labelStyle}>¿Cada cuánto se renuevan?</label>
          <select style={inputStyle} value={form.bPeriod} onChange={(e) => setForm({ ...form, bPeriod: e.target.value })}>
            <option value="LIFETIME">Una sola vez</option>
            <option value="DAY">Por día</option>
            <option value="WEEK">Por semana</option>
            <option value="MONTH">Por mes</option>
            <option value="YEAR">Por año</option>
          </select>
        </div>
        <div><label style={labelStyle}>Vigencia hasta</label><input type="date" style={inputStyle} value={form.bUntil} onChange={(e) => setForm({ ...form, bUntil: e.target.value })} /></div>
        <div style={{ gridColumn: '1 / -1' }}><label style={labelStyle}>Condiciones</label><input style={inputStyle} placeholder="No acumulable con otras promociones" value={form.bTerms} onChange={(e) => setForm({ ...form, bTerms: e.target.value })} /></div>
        <button style={btn()} disabled={busy} onClick={create}>{busy ? '…' : 'Crear negocio'}</button>
      </div>
      {msg && <div style={{ fontSize: 12.5, color: '#b91c1c', marginTop: 10 }}>{msg}</div>}
    </Section>
  );
}

function BenefitsSection({ benefits, onChange }: { benefits: AdminBenefit[]; onChange: () => void }) {
  async function approve(b: AdminBenefit, approval: string) { await api(`/cuponera/admin/benefits/${b.id}/approval`, { method: 'PATCH', body: JSON.stringify({ approval }) }); onChange(); }
  const pend = benefits.filter((b) => b.approval === 'PENDING');
  return (
    <Section title="Beneficios de los negocios" desc="Aprueba o rechaza las promociones publicadas por los aliados.">
      {benefits.length === 0 ? <div style={{ fontSize: 13, color: '#9ca3af' }}>Los negocios aún no han publicado promociones.</div> : (
        <>
          {pend.length > 0 && <div style={{ fontSize: 12, fontWeight: 700, color: '#b45309', marginBottom: 8 }}>{pend.length} pendiente(s) de aprobación</div>}
          {benefits.map((b) => (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #eef0f2' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{b.title} <span style={{ fontSize: 11.5, color: '#6b7280' }}>· {b.ally?.name}</span></div>
                <div style={{ fontSize: 11.5, color: '#6b7280' }}>{b.type} · {b.status === 'ACTIVE' ? 'activa' : 'pausada'} · {b.redemptionCount} canjes · <span style={{ fontWeight: 700, color: b.approval === 'APPROVED' ? '#16a34a' : b.approval === 'PENDING' ? '#b45309' : '#dc2626' }}>{b.approval.toLowerCase()}</span></div>
              </div>
              {b.approval !== 'APPROVED' && <button onClick={() => approve(b, 'APPROVED')} style={btn('#dcfce7', '#166534')}>Aprobar</button>}
              {b.approval !== 'REJECTED' && <button onClick={() => approve(b, 'REJECTED')} style={btn('#fee2e2', '#b91c1c')}>Rechazar</button>}
            </div>
          ))}
        </>
      )}
    </Section>
  );
}

type StampProgram = { id: string; name: string; stampsRequired: number; rewardText: string; maxPerDay: number; status: string; category: { name: string } | null; _count?: { cards: number } };
function StampProgramsSection({ categories, flash }: { categories: Category[]; flash: (m: string) => void }) {
  const [programs, setPrograms] = useState<StampProgram[]>([]);
  const empty = { name: '', stampsRequired: 5, rewardText: '', maxPerDay: 1, categoryId: '' };
  const [form, setForm] = useState<any>(empty); const [busy, setBusy] = useState(false);
  const load = () => api<StampProgram[]>('/cuponera/admin/stamp-programs').then((r) => setPrograms(r ?? [])).catch(() => setPrograms([]));
  useEffect(() => { load(); }, []);
  async function create() { if (!form.name.trim()) { flash('Nombre requerido'); return; } setBusy(true); try { await api('/cuponera/admin/stamp-programs', { method: 'POST', body: JSON.stringify({ name: form.name, stampsRequired: Number(form.stampsRequired) || 5, rewardText: form.rewardText, maxPerDay: Number(form.maxPerDay) || 1, categoryId: form.categoryId || null }) }); setForm(empty); load(); flash('Programa creado'); } finally { setBusy(false); } }
  async function del(p: StampProgram) { if (!confirm(`¿Eliminar "${p.name}"?`)) return; await api(`/cuponera/admin/stamp-programs/${p.id}`, { method: 'DELETE' }); load(); }
  return (
    <Section title="Sellos comunitarios" desc="Ej: 5 cafés en negocios aliados = 1 gratis. El negocio da el sello al escanear la tarjeta.">
      {programs.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          {programs.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #eef0f2' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{p.name} <span style={{ color: PC, fontSize: 12.5 }}>· {p.stampsRequired} sellos</span></div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{p.rewardText || 'Sin premio'} · {p.category?.name || 'cualquier negocio'} · máx {p.maxPerDay}/día · {p._count?.cards ?? 0} miembros</div>
              </div>
              <button onClick={() => del(p)} style={btn('#fee2e2', '#b91c1c')}>Eliminar</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.8fr 0.8fr 1.2fr', gap: 10, alignItems: 'end' }}>
        <div><label style={labelStyle}>Nombre</label><input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Café tour" /></div>
        <div><label style={labelStyle}>Sellos</label><input type="number" style={inputStyle} value={form.stampsRequired} onChange={(e) => setForm({ ...form, stampsRequired: e.target.value })} /></div>
        <div><label style={labelStyle}>Máx/día</label><input type="number" style={inputStyle} value={form.maxPerDay} onChange={(e) => setForm({ ...form, maxPerDay: e.target.value })} /></div>
        <div><label style={labelStyle}>Categoría (opcional)</label><select style={inputStyle} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}><option value="">Cualquier negocio</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      </div>
      <div style={{ marginTop: 12 }}><label style={labelStyle}>Premio</label><input style={inputStyle} value={form.rewardText} onChange={(e) => setForm({ ...form, rewardText: e.target.value })} placeholder="1 café gratis" /></div>
      <button style={{ ...btn(), marginTop: 14 }} disabled={busy} onClick={create}>{busy ? '…' : 'Crear programa'}</button>
    </Section>
  );
}

type Geopoint = { id: string; name: string; latitude: any; longitude: any; radiusMeters: number; walletRelevantText: string | null };
function GeopushSection({ flash }: { flash: (m: string) => void }) {
  const [points, setPoints] = useState<Geopoint[]>([]);
  const empty = { name: '', latitude: '', longitude: '', radiusMeters: 300, walletRelevantText: '' };
  const [form, setForm] = useState<any>(empty); const [busy, setBusy] = useState(false);
  const load = () => api<Geopoint[]>('/cuponera/admin/geopush').then((r) => setPoints(r ?? [])).catch(() => setPoints([]));
  useEffect(() => { load(); }, []);
  async function create() {
    const lat = Number(form.latitude), lng = Number(form.longitude);
    if (!form.name.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) { flash('Nombre y coordenadas válidas requeridas'); return; }
    setBusy(true);
    try { await api('/cuponera/admin/geopush', { method: 'POST', body: JSON.stringify({ name: form.name, latitude: lat, longitude: lng, radiusMeters: Number(form.radiusMeters) || 300, walletRelevantText: form.walletRelevantText || undefined }) }); setForm(empty); load(); flash('Punto de geopush creado'); } finally { setBusy(false); }
  }
  async function del(p: Geopoint) { if (!confirm(`¿Eliminar "${p.name}"?`)) return; await api(`/cuponera/admin/geopush/${p.id}`, { method: 'DELETE' }); load(); }
  return (
    <Section title="Geopush" desc="Puntos donde la tarjeta del miembro muestra un aviso al acercarse (geofence de Apple/Google Wallet).">
      {points.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          {points.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #eef0f2' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{p.name} <span style={{ fontSize: 11.5, color: '#6b7280' }}>· {p.radiusMeters}m</span></div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{p.walletRelevantText || 'Sin mensaje'} · {Number(p.latitude).toFixed(4)}, {Number(p.longitude).toFixed(4)}</div>
              </div>
              <button onClick={() => del(p)} style={btn('#fee2e2', '#b91c1c')}>Eliminar</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 0.8fr', gap: 10, alignItems: 'end' }}>
        <div><label style={labelStyle}>Nombre del punto</label><input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Café Aurora" /></div>
        <div><label style={labelStyle}>Latitud</label><input style={inputStyle} value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} placeholder="6.2442" /></div>
        <div><label style={labelStyle}>Longitud</label><input style={inputStyle} value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} placeholder="-75.5812" /></div>
        <div><label style={labelStyle}>Radio (m)</label><input style={inputStyle} type="number" value={form.radiusMeters} onChange={(e) => setForm({ ...form, radiusMeters: e.target.value })} /></div>
      </div>
      <div style={{ marginTop: 12 }}><label style={labelStyle}>Mensaje del aviso</label><input style={inputStyle} value={form.walletRelevantText} onChange={(e) => setForm({ ...form, walletRelevantText: e.target.value })} placeholder="Estás cerca de Café Aurora. 20% con tu Living Card." /></div>
      <button style={{ ...btn(), marginTop: 14 }} disabled={busy} onClick={create}>{busy ? '…' : 'Añadir punto'}</button>
    </Section>
  );
}

function PushSection({ plans, allies, flash }: { plans: Plan[]; allies: Ally[]; flash: (m: string) => void }) {
  const [title, setTitle] = useState(''); const [body, setBody] = useState('');
  const [target, setTarget] = useState('all'); // 'all' | 'plan:<id>' | 'ally:<id>'
  const [busy, setBusy] = useState(false); const [recent, setRecent] = useState<any[]>([]);
  const load = () => api<any[]>('/cuponera/admin/notifications').then((r) => setRecent((r ?? []).slice(0, 6))).catch(() => setRecent([]));
  useEffect(() => { load(); }, []);
  async function send() {
    if (!title.trim() || !body.trim()) { flash('Título y mensaje requeridos'); return; }
    const [kind, id] = target.split(':');
    const label = kind === 'plan' ? 'ese plan' : kind === 'ally' ? 'ese negocio' : 'TODOS los miembros';
    if (!confirm(`¿Enviar este push a ${label}?`)) return;
    setBusy(true);
    try {
      const payload: any = { title, body };
      if (kind === 'plan') payload.planId = id;
      if (kind === 'ally') payload.allyId = id;
      const r = await api<{ targeted?: number }>('/cuponera/admin/push', { method: 'POST', body: JSON.stringify(payload) });
      setTitle(''); setBody(''); load(); flash(`Push enviado${r?.targeted != null ? ` (${r.targeted})` : ''}`);
    } finally { setBusy(false); }
  }
  return (
    <Section title="Push a la comunidad" desc="Notificación a todos, o segmentada por plan o por negocio (miembros que interactuaron).">
      <div style={{ display: 'grid', gap: 12 }}>
        <div><label style={labelStyle}>Enviar a</label>
          <select style={inputStyle} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="all">Todos los miembros</option>
            <optgroup label="Por plan">{plans.map((p) => <option key={p.id} value={`plan:${p.id}`}>Plan: {p.name}</option>)}</optgroup>
            <optgroup label="Por negocio (interactuaron)">{allies.map((a) => <option key={a.id} value={`ally:${a.id}`}>Negocio: {a.name}</option>)}</optgroup>
          </select>
        </div>
        <div><label style={labelStyle}>Título</label><input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nuevo beneficio disponible 🎉" /></div>
        <div><label style={labelStyle}>Mensaje</label><input style={inputStyle} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Entra a la app y descúbrelo." /></div>
      </div>
      <button style={{ ...btn(), marginTop: 14 }} disabled={busy} onClick={send}>{busy ? 'Enviando…' : 'Enviar'}</button>
      {recent.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 6 }}>ÚLTIMOS ENVÍOS</div>
          {recent.map((n) => (
            <div key={n.id} style={{ fontSize: 13, padding: '6px 0', borderTop: '1px solid #eef0f2' }}><b>{n.title}</b> — {n.body} <span style={{ color: '#94a3b8' }}>· {n.sentAt ? new Date(n.sentAt).toLocaleString('es-CO') : 'programado'}</span></div>
          ))}
        </div>
      )}
    </Section>
  );
}

function MercadoPagoSection({ onSaved }: { onSaved: () => void }) {
  const [st, setSt] = useState<{ configured: boolean; webhookUrl: string } | null>(null);
  const [accessToken, setAccessToken] = useState(''); const [publicKey, setPublicKey] = useState(''); const [webhookSecret, setWebhookSecret] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ configured: boolean; webhookUrl: string }>('/cuponera/admin/mercadopago').then(setSt).catch(() => null); }, []);
  async function save() {
    setBusy(true);
    try {
      const body: any = {}; if (accessToken) body.accessToken = accessToken; if (publicKey) body.publicKey = publicKey; if (webhookSecret) body.webhookSecret = webhookSecret;
      await api('/cuponera/admin/mercadopago', { method: 'PATCH', body: JSON.stringify(body) });
      setAccessToken(''); setWebhookSecret(''); api<{ configured: boolean; webhookUrl: string }>('/cuponera/admin/mercadopago').then(setSt).catch(() => null); onSaved();
    } finally { setBusy(false); }
  }
  return (
    <Section title="Pagos — MercadoPago (recurrente)" desc="Suscripción de membresías. Se guarda cifrado.">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}><span style={{ fontSize: 12.5, fontWeight: 700, color: st?.configured ? '#16a34a' : '#9ca3af' }}>{st?.configured ? '✓ Configurado' : '○ Sin configurar'}</span></div>
      {st?.webhookUrl && <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 14, wordBreak: 'break-all' }}><b>Webhook URL</b> (pégala en MercadoPago → Notificaciones): <code>{st.webhookUrl}</code></div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div><label style={labelStyle}>Access Token {st?.configured && <span style={{ color: '#9ca3af' }}>(vacío = sin cambio)</span>}</label><input style={inputStyle} type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder="APP_USR-…" /></div>
        <div><label style={labelStyle}>Public Key</label><input style={inputStyle} value={publicKey} onChange={(e) => setPublicKey(e.target.value)} placeholder="APP_USR-…" /></div>
        <div><label style={labelStyle}>Webhook Secret</label><input style={inputStyle} type="password" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} placeholder="clave de firma" /></div>
      </div>
      <button style={{ ...btn(), marginTop: 16 }} disabled={busy} onClick={save}>{busy ? 'Guardando…' : 'Guardar credenciales'}</button>
    </Section>
  );
}

function MembersSection({ members, plans, onEnrolled }: { members: Member[]; plans: Plan[]; onEnrolled: () => void }) {
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', planId: '' }); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  async function enroll() {
    if (!form.fullName.trim() || form.phone.replace(/\D/g, '').length < 8) { setMsg('Nombre y teléfono válidos requeridos'); return; }
    setBusy(true); setMsg(null);
    try { await api('/cuponera/admin/members', { method: 'POST', body: JSON.stringify({ fullName: form.fullName, phone: form.phone, email: form.email || undefined, planId: form.planId || null }) }); setForm({ fullName: '', phone: '', email: '', planId: '' }); onEnrolled(); }
    catch (e: any) { setMsg(e?.message || 'Error'); } finally { setBusy(false); }
  }
  return (
    <Section title="Miembros" desc="Alta manual (sin cobro) — emite la tarjeta al instante.">
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1.2fr 1fr auto', gap: 10, alignItems: 'end', marginBottom: 18 }}>
        <div><label style={labelStyle}>Nombre completo</label><input style={inputStyle} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div>
        <div><label style={labelStyle}>Teléfono</label><input style={inputStyle} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+57 300 000 0000" /></div>
        <div><label style={labelStyle}>Email (opcional)</label><input style={inputStyle} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div><label style={labelStyle}>Plan</label><select style={inputStyle} value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })}><option value="">Sin plan</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <button style={btn()} disabled={busy} onClick={enroll}>{busy ? '…' : 'Dar de alta'}</button>
      </div>
      {msg && <div style={{ fontSize: 12.5, color: '#b91c1c', marginBottom: 10 }}>{msg}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', color: '#6b7280', fontSize: 11.5, textTransform: 'uppercase' }}>
            <th style={{ padding: '8px 6px' }}>Miembro</th><th style={{ padding: '8px 6px' }}>Teléfono</th><th style={{ padding: '8px 6px' }}>Plan</th><th style={{ padding: '8px 6px' }}>Estado</th><th style={{ padding: '8px 6px' }}>Origen</th><th style={{ padding: '8px 6px' }}>Vence</th>
          </tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} style={{ borderTop: '1px solid #eef0f2' }}>
                <td style={{ padding: '8px 6px', fontWeight: 600 }}>{m.customer.fullName}</td>
                <td style={{ padding: '8px 6px', color: '#6b7280' }}>{m.customer.phone}</td>
                <td style={{ padding: '8px 6px' }}>{m.plan?.name || '—'}</td>
                <td style={{ padding: '8px 6px' }}><span style={{ fontSize: 11.5, fontWeight: 700, color: m.status === 'ACTIVE' ? '#16a34a' : '#9ca3af' }}>{m.status}</span></td>
                <td style={{ padding: '8px 6px', color: '#6b7280' }}>{m.source}</td>
                <td style={{ padding: '8px 6px', color: '#6b7280' }}>{m.expiresAt ? new Date(m.expiresAt).toLocaleDateString('es-CO') : '—'}</td>
              </tr>
            ))}
            {members.length === 0 && <tr><td colSpan={6} style={{ padding: 16, color: '#9ca3af', textAlign: 'center' }}>Sin miembros aún.</td></tr>}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
