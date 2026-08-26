'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getUser, clearSession } from '@/lib/api';

const PC = '#0a90bd';

type Ally = {
  id: string;
  name: string;
  slug: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  description: string;
  logoUrl: string | null;
  coverUrl: string | null;
  address: string;
  city: string;
  whatsapp: string | null;
  instagram: string | null;
  website: string | null;
};
type Benefit = {
  id: string;
  type: string;
  title: string;
  description: string;
  percentOff: number | null;
  amountOffCents: number | null;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED';
  approval: 'PENDING' | 'APPROVED' | 'REJECTED';
  maxPerMember: number | null;
  limitPeriod?: 'LIFETIME' | 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';
  redemptionCount: number;
  validUntil: string | null;
};

const inp: React.CSSProperties = { width: '100%', padding: '11px 13px', border: '1px solid #d7dbe0', borderRadius: 10, fontSize: 14, outline: 'none' };
const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5, display: 'block' };
const btn = (bg = PC, color = '#fff'): React.CSSProperties => ({ background: bg, color, border: 'none', padding: '10px 18px', borderRadius: 10, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' });
const money = (c: number) => `$ ${Number(c || 0).toLocaleString('es-CO')}`;
const STATUS: Record<string, { label: string; color: string; bg: string }> = {
  PENDING: { label: 'Pendiente de aprobación', color: '#92400e', bg: '#fef3c7' },
  APPROVED: { label: 'Aprobado — visible en el marketplace', color: '#166534', bg: '#dcfce7' },
  REJECTED: { label: 'Rechazado', color: '#991b1b', bg: '#fee2e2' },
  SUSPENDED: { label: 'Suspendido', color: '#991b1b', bg: '#fee2e2' },
};
const TABS = ['Ficha', 'Sedes', 'Promociones', 'Canjear', 'Historial'] as const;

export default function AllyPanel() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [ally, setAlly] = useState<Ally | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Ficha');
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2500); };

  useEffect(() => {
    const u = getUser();
    if (!u || u.role !== 'ALLY_BUSINESS') { router.replace('/login'); return; }
    api<Ally>('/cuponera/ally/me').then(setAlly).catch(() => null).finally(() => setReady(true));
  }, [router]);

  if (!ready) return <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Cargando…</div>;
  if (!ally) return <div style={{ padding: 40, textAlign: 'center' }}>No se encontró tu negocio.</div>;
  const st = STATUS[ally.status];

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '0 20px 80px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '22px 0' }}>
        <div style={{ fontWeight: 900, fontSize: 20, color: PC }}>🏪 {ally.name}</div>
        <button onClick={() => { clearSession(); router.replace('/login'); }} style={{ fontSize: 13, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>Salir</button>
      </header>

      {toast && <div style={{ position: 'fixed', top: 16, right: 20, background: '#111827', color: '#fff', padding: '10px 16px', borderRadius: 10, zIndex: 50, fontSize: 13 }}>{toast}</div>}

      <div style={{ background: st.bg, color: st.color, padding: '10px 16px', borderRadius: 12, fontSize: 13.5, fontWeight: 600, marginBottom: 18 }}>{st.label}</div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 20, borderBottom: '1px solid #e2e8f0' }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ background: 'none', border: 'none', padding: '10px 14px', fontSize: 14, fontWeight: 700, cursor: 'pointer', color: tab === t ? PC : '#64748b', borderBottom: tab === t ? `2.5px solid ${PC}` : '2.5px solid transparent', marginBottom: -1 }}>{t}</button>
        ))}
      </div>

      {tab === 'Ficha' && <FichaTab ally={ally} onSaved={(a) => { setAlly(a); flash('Ficha guardada'); }} />}
      {tab === 'Sedes' && <SedesTab flash={flash} />}
      {tab === 'Promociones' && <PromosTab flash={flash} />}
      {tab === 'Canjear' && <CanjearTab flash={flash} />}
      {tab === 'Historial' && <HistorialTab />}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div style={{ background: '#fff', borderRadius: 18, padding: 24, boxShadow: '0 4px 16px rgba(0,0,0,.06)' }}>{children}</div>;
}

// ─────────── Ficha ───────────
function FichaTab({ ally, onSaved }: { ally: Ally; onSaved: (a: Ally) => void }) {
  const [f, setF] = useState({
    name: ally.name || '', description: ally.description || '', logoUrl: ally.logoUrl || '', coverUrl: ally.coverUrl || '',
    address: ally.address || '', city: ally.city || '', whatsapp: ally.whatsapp || '', instagram: ally.instagram || '', website: ally.website || '',
  });
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try { onSaved(await api<Ally>('/cuponera/ally/profile', { method: 'PATCH', body: JSON.stringify(f) })); }
    finally { setSaving(false); }
  }
  return (
    <Card>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Nombre</label><input style={inp} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Descripción</label><textarea style={{ ...inp, minHeight: 70 }} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        <div><label style={lbl}>Logo (URL)</label><input style={inp} value={f.logoUrl} onChange={(e) => setF({ ...f, logoUrl: e.target.value })} /></div>
        <div><label style={lbl}>Portada (URL)</label><input style={inp} value={f.coverUrl} onChange={(e) => setF({ ...f, coverUrl: e.target.value })} /></div>
        <div><label style={lbl}>Dirección</label><input style={inp} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
        <div><label style={lbl}>Ciudad</label><input style={inp} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></div>
        <div><label style={lbl}>WhatsApp</label><input style={inp} value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} /></div>
        <div><label style={lbl}>Instagram</label><input style={inp} value={f.instagram} onChange={(e) => setF({ ...f, instagram: e.target.value })} /></div>
        <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Sitio web</label><input style={inp} value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></div>
      </div>
      <button onClick={save} disabled={saving} style={{ ...btn(), marginTop: 20 }}>{saving ? 'Guardando…' : 'Guardar ficha'}</button>
    </Card>
  );
}

// ─────────── Promociones ───────────
function PromosTab({ flash }: { flash: (m: string) => void }) {
  const [benefits, setBenefits] = useState<Benefit[]>([]);
  const [verHist, setVerHist] = useState<string | null>(null);
  const empty = { title: '', type: 'PERCENT_OFF', percentOff: 10, amountOffCents: 0, description: '', maxPerMember: 1, limitPeriod: 'LIFETIME', validUntil: '' };
  const [form, setForm] = useState<any>(empty);
  const [busy, setBusy] = useState(false);

  const load = () => api<Benefit[]>('/cuponera/ally/benefits').then(setBenefits).catch(() => setBenefits([]));
  useEffect(() => { load(); }, []);

  async function create() {
    if (!form.title.trim()) return;
    setBusy(true);
    try {
      const body: any = { title: form.title, type: form.type, description: form.description, maxPerMember: Number(form.maxPerMember) || null, limitPeriod: form.limitPeriod };
      if (form.type === 'PERCENT_OFF') body.percentOff = Number(form.percentOff);
      if (form.type === 'AMOUNT_OFF') body.amountOffCents = Number(form.amountOffCents);
      if (form.validUntil) body.validUntil = new Date(form.validUntil).toISOString();
      await api('/cuponera/ally/benefits', { method: 'POST', body: JSON.stringify(body) });
      setForm(empty); load(); flash('Promoción creada');
    } finally { setBusy(false); }
  }
  async function toggle(b: Benefit) {
    await api(`/cuponera/ally/benefits/${b.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: b.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }) });
    load();
  }
  async function del(b: Benefit) {
    if (!confirm(`¿Eliminar "${b.title}"?`)) return;
    await api(`/cuponera/ally/benefits/${b.id}`, { method: 'DELETE' }); load();
  }
  const valueLabel = (b: Benefit) => b.type === 'PERCENT_OFF' ? `${b.percentOff}% OFF` : b.type === 'AMOUNT_OFF' ? `${money(b.amountOffCents || 0)} OFF` : b.type === 'TWO_FOR_ONE' ? '2x1' : b.type;

  return (
    <Card>
      {benefits.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          {benefits.map((b) => (
            <div key={b.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #eef0f2' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{b.title} <span style={{ color: PC, fontSize: 12.5 }}>· {valueLabel(b)}</span></div>
                <div style={{ fontSize: 11.5, color: '#6b7280' }}>
                  {b.status === 'ACTIVE' ? 'Activa' : 'Pausada'} · {b.approval === 'APPROVED' ? 'aprobada' : b.approval === 'PENDING' ? 'pend. aprobación' : 'rechazada'} · {b.redemptionCount} canjes
                </div>
              </div>
              <button onClick={() => toggle(b)} style={btn('#e5e7eb', '#374151')}>{b.status === 'ACTIVE' ? 'Pausar' : 'Activar'}</button>
              <button onClick={() => del(b)} style={btn('#fee2e2', '#b91c1c')}>Eliminar</button>
              <button onClick={() => setVerHist(verHist === b.id ? null : b.id)} style={btn('#eef2f7', '#111827')}>Historial</button>
              </div>
              {verHist === b.id && <HistorialBeneficio benefitId={b.id} />}
            </div>
          ))}
        </div>
      )}
      <h3 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 12px' }}>Nueva promoción</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Título</label><input style={inp} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="20% en toda la carta" /></div>
        <div><label style={lbl}>Tipo</label>
          <select style={inp} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="PERCENT_OFF">% de descuento</option>
            <option value="AMOUNT_OFF">Descuento en $</option>
            <option value="TWO_FOR_ONE">2x1</option>
            <option value="FREEBIE">Regalo</option>
            <option value="PRODUCT">Producto especial</option>
            <option value="OTHER">Otro</option>
          </select>
        </div>
        {form.type === 'PERCENT_OFF' && <div><label style={lbl}>% descuento</label><input type="number" style={inp} value={form.percentOff} onChange={(e) => setForm({ ...form, percentOff: e.target.value })} /></div>}
        {form.type === 'AMOUNT_OFF' && <div><label style={lbl}>Descuento (COP)</label><input type="number" style={inp} value={form.amountOffCents} onChange={(e) => setForm({ ...form, amountOffCents: e.target.value })} /></div>}
        <div><label style={lbl}>Usos por miembro (vacío = ilimitado)</label><input type="number" style={inp} value={form.maxPerMember} onChange={(e) => setForm({ ...form, maxPerMember: e.target.value })} /></div>
        <div>
          <label style={lbl}>¿Cada cuánto se renuevan?</label>
          <select style={inp} value={form.limitPeriod} onChange={(e) => setForm({ ...form, limitPeriod: e.target.value })}>
            <option value="LIFETIME">Una sola vez (no se renuevan)</option>
            <option value="DAY">Por día</option>
            <option value="WEEK">Por semana</option>
            <option value="MONTH">Por mes</option>
            <option value="YEAR">Por año</option>
          </select>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
            Ejemplo: 2 usos + “Por mes” = cada miembro puede canjear 2 veces al mes.
            Los períodos son de calendario: quien canjea el 31 recupera sus usos el 1°.
          </div>
        </div>
        <div><label style={lbl}>Vence (opcional)</label><input type="date" style={inp} value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} /></div>
        <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Descripción</label><input style={inp} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
      </div>
      <button onClick={create} disabled={busy} style={{ ...btn(), marginTop: 16 }}>{busy ? '…' : 'Crear promoción'}</button>
    </Card>
  );
}

// ─────────── Canjear ───────────
function CanjearTab({ flash }: { flash: (m: string) => void }) {
  const [qr, setQr] = useState('');
  const [scan, setScan] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function doScan() {
    if (!qr.trim()) return;
    setBusy(true); setErr(null); setScan(null);
    try { setScan(await api('/cuponera/ally/scan', { method: 'POST', body: JSON.stringify({ qrToken: qr.trim() }) })); }
    catch (e: any) { setErr(e?.message || 'No se encontró la tarjeta'); }
    finally { setBusy(false); }
  }
  async function redeem(benefitId: string) {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ benefitTitle: string }>('/cuponera/ally/redeem', { method: 'POST', body: JSON.stringify({ passId: scan.passId, benefitId }) });
      flash(`Canjeado: ${r.benefitTitle}`);
      await doScan(); // refresca disponibilidad
    } catch (e: any) { setErr(e?.message || 'No se pudo canjear'); }
    finally { setBusy(false); }
  }
  async function giveStamp(programId: string) {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ stampsCount: number; stampsRequired: number }>('/cuponera/ally/stamp', { method: 'POST', body: JSON.stringify({ passId: scan.passId, programId }) });
      flash(`Sello dado (${r.stampsCount}/${r.stampsRequired})`);
      await doScan();
    } catch (e: any) { setErr(e?.message || 'No se pudo dar el sello'); }
    finally { setBusy(false); }
  }
  async function redeemStamp(programId: string) {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ rewardText: string }>('/cuponera/ally/stamp/redeem', { method: 'POST', body: JSON.stringify({ passId: scan.passId, programId }) });
      flash(`Premio canjeado: ${r.rewardText || 'listo'}`);
      await doScan();
    } catch (e: any) { setErr(e?.message || 'No se pudo canjear el premio'); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <label style={lbl}>Código QR del miembro</label>
      <div style={{ display: 'flex', gap: 10 }}>
        <input style={inp} value={qr} onChange={(e) => setQr(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doScan()} placeholder="Pega o escanea el código (QR-…)" />
        <button onClick={doScan} disabled={busy} style={btn()}>{busy ? '…' : 'Buscar'}</button>
      </div>
      <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>Usa un lector de QR físico o pega el código. El escaneo con cámara llega pronto.</p>

      {err && <div style={{ marginTop: 16, padding: 14, background: '#fef2f2', borderRadius: 12, color: '#991b1b', fontSize: 13.5 }}>{err}</div>}

      {scan && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 17 }}>{scan.memberName}</div>
            <span style={{ fontSize: 12, fontWeight: 700, color: scan.membershipActive ? '#16a34a' : '#dc2626' }}>
              {scan.membershipActive ? `Miembro activo${scan.planName ? ` · ${scan.planName}` : ''}` : 'Membresía inactiva'}
            </span>
          </div>
          {scan.benefits.length === 0 ? (
            <div style={{ color: '#94a3b8', fontSize: 13.5 }}>No tienes promociones activas.</div>
          ) : (
            scan.benefits.map((b: any) => (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid #eef0f2' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{b.title}</div>
                  <div style={{ fontSize: 11.5, color: '#6b7280' }}>
                    {b.perMemberLeft == null ? 'Sin límite por miembro' : `${b.perMemberLeft} usos restantes`}
                    {b.totalLeft != null ? ` · ${b.totalLeft} en total` : ''}
                  </div>
                </div>
                <button onClick={() => redeem(b.id)} disabled={busy || !b.canRedeem} style={btn(b.canRedeem ? PC : '#cbd5e1')}>
                  {b.canRedeem ? 'Canjear' : 'No disponible'}
                </button>
              </div>
            ))
          )}

          {scan.stampPrograms && scan.stampPrograms.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 6 }}>SELLOS</div>
              {scan.stampPrograms.map((p: any) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid #eef0f2' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{p.name} <span style={{ color: PC, fontSize: 12.5 }}>· {p.stampsCount}/{p.stampsRequired}</span></div>
                    <div style={{ fontSize: 11.5, color: '#6b7280' }}>{p.rewardReady ? `🎁 Premio listo: ${p.rewardText}` : p.rewardText}</div>
                  </div>
                  {p.rewardReady ? (
                    <button onClick={() => redeemStamp(p.id)} disabled={busy} style={btn('#84cc16', '#1a2e05')}>Canjear premio</button>
                  ) : (
                    <button onClick={() => giveStamp(p.id)} disabled={busy || !p.canStamp} style={btn(p.canStamp ? PC : '#cbd5e1')}>Dar sello</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ─────────── Historial ───────────
function HistorialTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [m, setM] = useState<any>(null);
  useEffect(() => {
    api<any[]>('/cuponera/ally/redemptions').then(setRows).catch(() => setRows([]));
    api('/cuponera/ally/metrics').then(setM).catch(() => null);
  }, []);
  return (
    <Card>
      {m && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px,1fr))', gap: 12, marginBottom: 20 }}>
          {[['Promociones', m.benefits], ['Activas', m.activeBenefits], ['Canjes', m.redemptions], ['Miembros únicos', m.uniqueMembers]].map(([l, v]) => (
            <div key={l as string} style={{ background: '#f8fafc', borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: PC }}>{v as number}</div>
              <div style={{ fontSize: 11.5, color: '#64748b' }}>{l as string}</div>
            </div>
          ))}
        </div>
      )}
      <h3 style={{ fontSize: 15, fontWeight: 800, margin: '0 0 10px' }}>Últimos canjes</h3>
      {rows.length === 0 ? (
        <div style={{ color: '#94a3b8', fontSize: 13.5 }}>Aún no hay canjes.</div>
      ) : (
        rows.map((r) => (
          <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderTop: '1px solid #eef0f2', fontSize: 13.5 }}>
            <span><b>{r.member}</b> — {r.benefit}</span>
            <span style={{ color: '#94a3b8' }}>{new Date(r.at).toLocaleString('es-CO')}</span>
          </div>
        ))
      )}
    </Card>
  );
}

// ── SEDES (spec §5 y §9) ──────────────────────────────────────────────────────
// Un aliado puede tener varias, cada una con su geofence. El aviso de que el
// geopush necesita coordenadas está en la UI porque el backend lo rechaza: sin
// lat/lng el geofence no dispara nunca y quedaría "activo" mintiendo.
type Sede = {
  id: string;
  name: string;
  address: string;
  city: string;
  latitude: string | number | null;
  longitude: string | number | null;
  radiusMeters: number;
  geopushMessage: string;
  geopushActive: boolean;
  isActive: boolean;
};

const SEDE_VACIA = {
  name: '', address: '', city: '',
  latitude: '' as string | number, longitude: '' as string | number,
  radiusMeters: 150, geopushMessage: '', geopushActive: false,
};

function SedesTab({ flash }: { flash: (m: string) => void }) {
  const [rows, setRows] = useState<Sede[]>([]);
  const [loading, setLoading] = useState(true);
  const [nueva, setNueva] = useState({ ...SEDE_VACIA });
  const [abierta, setAbierta] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const cargar = async () => {
    setLoading(true);
    try { setRows(((await api('/cuponera/ally/locations')) as Sede[]) ?? []); }
    catch { setRows([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { cargar(); }, []);

  const num = (v: string | number) =>
    v === '' || v === null ? null : Number(v);

  async function crear() {
    if (!nueva.name.trim()) return flash('La sede necesita un nombre');
    setGuardando(true);
    try {
      await api('/cuponera/ally/locations', {
        method: 'POST',
        body: JSON.stringify({
          ...nueva,
          latitude: num(nueva.latitude),
          longitude: num(nueva.longitude),
        }),
      });
      flash('Sede creada');
      setNueva({ ...SEDE_VACIA });
      setAbierta(false);
      cargar();
    } catch (e: any) { flash(e?.message || 'No se pudo crear'); }
    finally { setGuardando(false); }
  }

  async function guardar(s: Sede, cambios: Partial<Sede>) {
    try {
      await api(`/cuponera/ally/locations/${s.id}`, {
        method: 'PATCH', body: JSON.stringify(cambios),
      });
      cargar();
    } catch (e: any) { flash(e?.message || 'No se pudo guardar'); }
  }

  async function borrar(s: Sede) {
    if (!confirm(`¿Eliminar la sede "${s.name}"? Los canjes ya hechos conservan su historial.`)) return;
    try { await api(`/cuponera/ally/locations/${s.id}`, { method: 'DELETE' }); flash('Sede eliminada'); cargar(); }
    catch (e: any) { flash(e?.message || 'No se pudo eliminar'); }
  }

  if (loading) return <div style={{ color: '#64748b', fontSize: 14 }}>Cargando sedes…</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: '#64748b' }}>
          Tus locales. Cada uno puede avisar a quien pase cerca con su tarjeta.
        </div>
        <button style={btn()} onClick={() => setAbierta((v) => !v)}>
          {abierta ? 'Cancelar' : '+ Agregar sede'}
        </button>
      </div>

      {abierta && (
        <div style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.06)', marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12 }}>
            <div>
              <label style={lbl}>Nombre de la sede</label>
              <input style={inp} placeholder="Cabecera" value={nueva.name}
                onChange={(e) => setNueva({ ...nueva, name: e.target.value })} />
            </div>
            <div>
              <label style={lbl}>Dirección</label>
              <input style={inp} placeholder="Calle 42 #30-15" value={nueva.address}
                onChange={(e) => setNueva({ ...nueva, address: e.target.value })} />
            </div>
            <div>
              <label style={lbl}>Ciudad</label>
              <input style={inp} value={nueva.city}
                onChange={(e) => setNueva({ ...nueva, city: e.target.value })} />
            </div>
            <div>
              <label style={lbl}>Latitud</label>
              <input style={inp} placeholder="7.1193" value={nueva.latitude}
                onChange={(e) => setNueva({ ...nueva, latitude: e.target.value })} />
            </div>
            <div>
              <label style={lbl}>Longitud</label>
              <input style={inp} placeholder="-73.1227" value={nueva.longitude}
                onChange={(e) => setNueva({ ...nueva, longitude: e.target.value })} />
            </div>
            <div>
              <label style={lbl}>Radio (metros)</label>
              <input style={inp} type="number" value={nueva.radiusMeters}
                onChange={(e) => setNueva({ ...nueva, radiusMeters: Number(e.target.value) })} />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={lbl}>Mensaje del aviso</label>
            <input style={inp} placeholder="Estás cerca: 15% OFF con tu tarjeta" value={nueva.geopushMessage}
              onChange={(e) => setNueva({ ...nueva, geopushMessage: e.target.value })} />
          </div>
          <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 8 }}>
            Las coordenadas las sacás de Google Maps: clic derecho sobre el local → el primer número es la latitud.
            Sin ellas la sede sirve para la ficha, pero no puede avisar a nadie.
          </div>
          <div style={{ marginTop: 14 }}>
            <button style={btn()} disabled={guardando} onClick={crear}>
              {guardando ? 'Creando…' : 'Crear sede'}
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 && !abierta && (
        <div style={{ background: '#fff', borderRadius: 14, padding: 20, textAlign: 'center', color: '#64748b', fontSize: 13.5 }}>
          Todavía no cargaste ninguna sede.
        </div>
      )}

      {rows.map((s) => {
        const sinCoords = s.latitude === null || s.longitude === null;
        return (
          <div key={s.id} style={{ background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,.06)', marginBottom: 12, opacity: s.isActive ? 1 : 0.6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <b style={{ fontSize: 15 }}>{s.name}</b>
                <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 2 }}>
                  {[s.address, s.city].filter(Boolean).join(' · ') || 'Sin dirección'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <button style={{ ...btn('#eef2f7', '#111827'), padding: '7px 12px' }}
                  onClick={() => guardar(s, { isActive: !s.isActive })}>
                  {s.isActive ? 'Desactivar' : 'Activar'}
                </button>
                <button style={{ ...btn('#fee2e2', '#991b1b'), padding: '7px 12px' }} onClick={() => borrar(s)}>
                  Eliminar
                </button>
              </div>
            </div>

            <div style={{ marginTop: 12, borderTop: '1px solid #f1f5f9', paddingTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 13 }}>
                  <b>Aviso al pasar cerca</b>
                  <span style={{ color: '#64748b', marginLeft: 6 }}>· radio {s.radiusMeters} m</span>
                </div>
                <button
                  style={{ ...btn(s.geopushActive ? '#16a34a' : '#eef2f7', s.geopushActive ? '#fff' : '#111827'), padding: '6px 12px' }}
                  disabled={sinCoords}
                  onClick={() => guardar(s, { geopushActive: !s.geopushActive })}
                >
                  {s.geopushActive ? 'Activo' : 'Apagado'}
                </button>
              </div>
              {sinCoords && (
                <div style={{ fontSize: 11.5, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '7px 10px', marginTop: 8 }}>
                  Esta sede no tiene latitud y longitud, así que el aviso no puede activarse: un geofence sin
                  coordenadas no se dispara nunca.
                </div>
              )}
              {s.geopushMessage && !sinCoords && (
                <div style={{ fontSize: 12.5, color: '#334155', marginTop: 6, fontStyle: 'italic' }}>
                  “{s.geopushMessage}”
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── HISTORIAL DE UN BENEFICIO (spec §6) ───────────────────────────────────────
// Muestra qué cambió, quién y cuándo. El nombre y el rol vienen congelados de la
// fila: si la cuenta se borró, el historial igual se lee.
type Cambio = {
  id: string;
  action: 'CREATE' | 'UPDATE' | 'APPROVAL' | 'DELETE';
  actorName: string;
  actorRole: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  createdAt: string;
};

const CAMPO_ES: Record<string, string> = {
  type: 'tipo', title: 'título', description: 'descripción', terms: 'condiciones',
  percentOff: '% de descuento', amountOffCents: 'monto de descuento',
  normalPriceCents: 'precio normal', memberPriceCents: 'precio para miembros',
  currency: 'moneda', validFrom: 'vigente desde', validUntil: 'vigente hasta',
  maxRedemptions: 'canjes totales', maxPerMember: 'usos por miembro',
  limitPeriod: 'período del límite', status: 'estado', approval: 'aprobación',
  categoryId: 'categoría',
};
const ACCION_ES: Record<Cambio['action'], string> = {
  CREATE: 'creó la promoción', UPDATE: 'editó', APPROVAL: 'cambió la aprobación', DELETE: 'eliminó',
};
const valor = (v: unknown) =>
  v === null || v === undefined || v === '' ? '—' : String(v);

function HistorialBeneficio({ benefitId }: { benefitId: string }) {
  const [rows, setRows] = useState<Cambio[] | null>(null);
  useEffect(() => {
    (async () => {
      try { setRows(((await api(`/cuponera/ally/benefits/${benefitId}/history`)) as Cambio[]) ?? []); }
      catch { setRows([]); }
    })();
  }, [benefitId]);

  if (rows === null) return <div style={{ fontSize: 12.5, color: '#94a3b8', padding: '8px 0 12px' }}>Cargando historial…</div>;
  if (rows.length === 0) return (
    <div style={{ fontSize: 12.5, color: '#94a3b8', padding: '8px 0 12px' }}>
      Sin cambios registrados todavía.
    </div>
  );

  return (
    <div style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 12px', margin: '2px 0 12px' }}>
      {rows.map((c) => (
        <div key={c.id} style={{ padding: '7px 0', borderBottom: '1px solid #eef2f7' }}>
          <div style={{ fontSize: 12, color: '#334155' }}>
            <b>{c.actorName || 'Alguien'}</b>
            {c.actorRole ? <span style={{ color: '#94a3b8' }}> ({c.actorRole === 'ALLY_BUSINESS' ? 'aliado' : 'administración'})</span> : null}
            {' '}{ACCION_ES[c.action]}
            <span style={{ color: '#94a3b8' }}> · {new Date(c.createdAt).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</span>
          </div>
          {Object.entries(c.changes || {}).map(([campo, d]) => (
            <div key={campo} style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>
              {CAMPO_ES[campo] ?? campo}: <s style={{ color: '#94a3b8' }}>{valor(d.from)}</s> → <b>{valor(d.to)}</b>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
