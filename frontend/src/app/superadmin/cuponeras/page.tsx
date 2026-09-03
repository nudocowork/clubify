'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const PC = '#0a90bd';

type WhiteLabel = { id: string; name: string; slug: string };
type Counts = { allies: number; members: number; benefits: number; redemptions: number };
type Cuponera = {
  id: string;
  name: string;
  slug: string;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED';
  whiteLabel: WhiteLabel | null;
  createdAt: string;
  counts: Counts;
};
type AdminRow = { id: string; email: string; fullName: string; isActive: boolean; createdAt: string };

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

const STATUS_LABEL: Record<Cuponera['status'], { t: string; bg: string; c: string }> = {
  DRAFT: { t: 'Borrador', bg: '#fef3c7', c: '#92400e' },
  ACTIVE: { t: 'Activa', bg: '#dcfce7', c: '#166534' },
  PAUSED: { t: 'Pausada', bg: '#f3f4f6', c: '#4b5563' },
};

export default function CuponerasPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [rows, setRows] = useState<Cuponera[]>([]);
  const [brands, setBrands] = useState<WhiteLabel[]>([]);

  // Alta
  const [openNew, setOpenNew] = useState(false);
  const [form, setForm] = useState({
    name: '', whiteLabelId: '', city: '', country: '', currency: 'COP', domain: '', description: '',
  });
  const [saving, setSaving] = useState(false);

  // Administradores por cuponera
  const [adminsOf, setAdminsOf] = useState<string | null>(null);
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [adminForm, setAdminForm] = useState({ email: '', fullName: '' });
  // La clave temporal se muestra UNA vez: después queda hasheada y no se recupera.
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const say = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3200); };

  async function load() {
    setLoading(true); setErr(null);
    try {
      const [cs, bs] = await Promise.all([
        api('/cuponera/admin/campaigns'),
        api('/superadmin/white-labels'),
      ]);
      // api() devuelve null si la respuesta viene vacía.
      setRows((cs as Cuponera[]) ?? []);
      const list = (bs as any) ?? [];
      setBrands(Array.isArray(list) ? list : (list.items ?? []));
    } catch (e: any) {
      setErr(e?.message || 'No se pudieron cargar las cuponeras');
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    if (!form.name.trim()) return say('Ponele un nombre');
    if (!form.whiteLabelId) return say('Elegí la marca blanca');
    setSaving(true);
    try {
      await api('/cuponera/admin/campaigns', { method: 'POST', body: JSON.stringify(form) });
      say('Cuponera creada (queda en Borrador)');
      setOpenNew(false);
      setForm({ name: '', whiteLabelId: '', city: '', country: '', currency: 'COP', domain: '', description: '' });
      load();
    } catch (e: any) { say(e?.message || 'No se pudo crear'); }
    finally { setSaving(false); }
  }

  async function setStatus(c: Cuponera, status: Cuponera['status']) {
    try {
      await api(`/cuponera/admin/campaigns/${c.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      say(status === 'ACTIVE' ? `${c.name} publicada` : `${c.name}: ${STATUS_LABEL[status].t}`);
      load();
    } catch (e: any) { say(e?.message || 'No se pudo cambiar el estado'); }
  }

  async function openAdmins(c: Cuponera) {
    setAdminsOf(c.id); setTempPassword(null); setAdminForm({ email: '', fullName: '' });
    try { setAdmins(((await api(`/cuponera/admin/campaigns/${c.id}/admins`)) as AdminRow[]) ?? []); }
    catch { setAdmins([]); }
  }

  async function createAdmin(c: Cuponera) {
    if (!adminForm.email.includes('@')) return say('Email inválido');
    if (!adminForm.fullName.trim()) return say('Falta el nombre');
    try {
      const r: any = await api(`/cuponera/admin/campaigns/${c.id}/admins`, {
        method: 'POST', body: JSON.stringify(adminForm),
      });
      setTempPassword(r?.tempPassword ?? null);
      setAdminForm({ email: '', fullName: '' });
      openAdmins(c);
      say('Administrador creado');
    } catch (e: any) { say(e?.message || 'No se pudo crear el administrador'); }
  }

  return (
    <div style={{ padding: 22, maxWidth: 1180, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Cuponeras</h1>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 3 }}>
            Cada cuponera se vincula a una Marca Blanca y tiene sus propios aliados, beneficiarios y tarjeta.
          </div>
        </div>
        <button style={btn()} onClick={() => setOpenNew((v) => !v)}>
          {openNew ? 'Cancelar' : '+ Crear cuponera'}
        </button>
      </div>

      {toast && (
        <div style={{ background: '#111827', color: '#fff', padding: '10px 14px', borderRadius: 10, fontSize: 13, marginBottom: 14 }}>
          {toast}
        </div>
      )}

      {openNew && (
        <Section title="Nueva cuponera" desc="Nace en Borrador: no acepta canjes hasta que la publiques.">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
            <div>
              <label style={labelStyle}>Nombre</label>
              <input style={inputStyle} value={form.name} placeholder="Cuponera Card"
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Marca Blanca</label>
              <select style={inputStyle} value={form.whiteLabelId}
                onChange={(e) => setForm({ ...form, whiteLabelId: e.target.value })}>
                <option value="">Elegí una…</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3 }}>
                Obligatoria. Define a qué ecosistema pertenece la cuponera.
              </div>
            </div>
            <div>
              <label style={labelStyle}>Ciudad</label>
              <input style={inputStyle} value={form.city} placeholder="Bucaramanga"
                onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>País</label>
              <input style={inputStyle} value={form.country} placeholder="Colombia"
                onChange={(e) => setForm({ ...form, country: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Moneda</label>
              <input style={inputStyle} value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
            </div>
            <div>
              <label style={labelStyle}>Dominio</label>
              <input style={inputStyle} value={form.domain} placeholder="cuponera.soyclubify.com"
                onChange={(e) => setForm({ ...form, domain: e.target.value })} />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={labelStyle}>Descripción</label>
            <input style={inputStyle} value={form.description} placeholder="Bienvenido a Cuponera Card"
              onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div style={{ marginTop: 14 }}>
            <button style={btn()} disabled={saving} onClick={create}>
              {saving ? 'Creando…' : 'Crear cuponera'}
            </button>
          </div>
        </Section>
      )}

      {loading && <div style={{ color: '#6b7280', fontSize: 13 }}>Cargando…</div>}
      {err && <div style={{ color: '#b91c1c', fontSize: 13 }}>{err}</div>}

      {!loading && !err && rows.length === 0 && (
        <Section title="Todavía no hay cuponeras">
          <div style={{ fontSize: 13, color: '#6b7280' }}>
            Creá la primera con el botón de arriba. Después le cargás aliados, beneficios y su administrador.
          </div>
        </Section>
      )}

      {rows.map((c) => {
        const s = STATUS_LABEL[c.status];
        return (
          <Section key={c.id} title={c.name} desc={`/${c.slug}`}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
              <span style={{ background: s.bg, color: s.c, padding: '3px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700 }}>
                {s.t}
              </span>
              <span style={{ fontSize: 12.5, color: '#374151' }}>
                Marca Blanca: <b>{c.whiteLabel?.name ?? '— sin vincular —'}</b>
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10, marginBottom: 14 }}>
              {([['Aliados', c.counts.allies], ['Beneficiarios', c.counts.members],
                 ['Beneficios', c.counts.benefits], ['Canjes', c.counts.redemptions]] as const).map(([k, v]) => (
                <div key={k} style={{ background: '#f9fafb', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>{v}</div>
                  <div style={{ fontSize: 11.5, color: '#6b7280' }}>{k}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {c.status !== 'ACTIVE' && (
                <button style={btn('#16a34a')} onClick={() => setStatus(c, 'ACTIVE')}>Publicar</button>
              )}
              {c.status === 'ACTIVE' && (
                <button style={btn('#6b7280')} onClick={() => setStatus(c, 'PAUSED')}>Pausar</button>
              )}
              {/* Entrar sin volver a iniciar sesión (§1). Es un link con el id de
                  la cuponera, no una suplantación: el backend ya autoriza al
                  Master Admin en cualquier cuponera, así que el owner entra
                  siendo él mismo y la auditoría no se pierde. */}
              <a
                href={`/cuponera/admin?campaignId=${encodeURIComponent(c.id)}`}
                style={{ ...btn(), textDecoration: 'none', display: 'inline-block' }}
              >
                Entrar al panel
              </a>
              <button style={btn('#eef2f7', '#111827')} onClick={() => openAdmins(c)}>
                Administradores
              </button>
            </div>

            {c.status !== 'ACTIVE' && (
              <div style={{ fontSize: 11.5, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px', marginTop: 10 }}>
                Mientras no esté publicada, los aliados <b>no pueden canjear</b>: el escáner rechaza la tarjeta.
              </div>
            )}

            {adminsOf === c.id && (
              <div style={{ marginTop: 14, borderTop: '1px solid #eef0f3', paddingTop: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>Administradores de {c.name}</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
                  Entran solo al panel de esta cuponera. No ven el Master Admin ni las otras cuponeras.
                </div>

                {admins.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    {admins.map((a) => (
                      <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
                        <span>{a.fullName} · <span style={{ color: '#6b7280' }}>{a.email}</span></span>
                        <span style={{ color: a.isActive ? '#166534' : '#b91c1c', fontSize: 11.5, fontWeight: 700 }}>
                          {a.isActive ? 'Activo' : 'Inactivo'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {tempPassword && (
                  <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 9, padding: '10px 12px', marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#065f46' }}>Clave temporal</div>
                    <div style={{ fontFamily: 'monospace', fontSize: 15, marginTop: 3 }}>{tempPassword}</div>
                    <div style={{ fontSize: 11.5, color: '#065f46', marginTop: 4 }}>
                      Copiala ahora: no se puede volver a ver.
                    </div>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
                  <input style={inputStyle} placeholder="Nombre" value={adminForm.fullName}
                    onChange={(e) => setAdminForm({ ...adminForm, fullName: e.target.value })} />
                  <input style={inputStyle} placeholder="correo@ejemplo.com" value={adminForm.email}
                    onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })} />
                  <button style={btn()} onClick={() => createAdmin(c)}>Crear administrador</button>
                </div>
              </div>
            )}
          </Section>
        );
      })}
    </div>
  );
}
