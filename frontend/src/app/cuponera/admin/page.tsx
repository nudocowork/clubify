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

type Category = { id: string; name: string; icon: string };
type Plan = {
  id: string; name: string; priceCents: number; currency: string;
  interval?: 'MONTHLY' | 'ANNUAL'; isActive?: boolean; description?: string;
};
type Settings = {
  name: string; status: string; welcomeText: string;
  requireBenefitApproval: boolean; allyPushPerWeek: number;
};
type TenantOpt = { id: string; name: string; brandName: string | null };
type PanelBenefit = {
  id: string; title: string; type: string; status: string;
  approval: 'PENDING' | 'APPROVED' | 'REJECTED';
  percentOff: number | null; amountOffCents: number | null;
  ally: { id: string; name: string } | null;
};

const TABS = ['Dashboard', 'Aliados', 'Beneficiarios', 'Beneficios', 'Comunidad', 'Redenciones', 'Configuración'] as const;
type Tab = (typeof TABS)[number];

const inp: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #d7dbe0', borderRadius: 9, fontSize: 13.5, outline: 'none', boxSizing: 'border-box' };
const lbl: React.CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 700, color: '#475569', marginBottom: 4 };
const money = (c: number, cur = 'COP') => cur === 'COP' ? `$ ${Number(c || 0).toLocaleString('es-CO')}` : `${(c / 100).toFixed(2)} ${cur}`;

const APPROVAL: Record<PanelBenefit['approval'], { t: string; bg: string; c: string }> = {
  APPROVED: { t: 'Publicado', bg: '#dcfce7', c: '#166534' },
  PENDING: { t: 'Por revisar', bg: '#fef3c7', c: '#92400e' },
  REJECTED: { t: 'Rechazado', bg: '#fee2e2', c: '#991b1b' },
};

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={lbl}>{label}</label>{children}</div>;
}

function Stat({ n, label, hint }: { n: number; label: string; hint?: string }) {
  return (
    <div style={{ background: '#f9fafb', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1 }}>{n}</div>
      <div style={{ fontSize: 12.5, color: '#374151', marginTop: 2 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>{hint}</div>}
    </div>
  );
}

/**
 * Alta de aliado. Incluye el PRIMER BENEFICIO en el mismo formulario a
 * propósito: un aliado sin beneficio no aparece en la cartelera, así que
 * crearlo sin eso deja el trabajo a medias y a alguien volviendo después.
 */
function FormAliado({
  cats, tenants, onCreado, onCancelar,
}: {
  cats: Category[]; tenants: TenantOpt[];
  onCreado: (r: any) => void; onCancelar: () => void;
}) {
  const vacio = {
    name: '', email: '', ownerFullName: '', categoryId: '', city: '', whatsapp: '',
    description: '', tenantId: '',
    benTitle: '', benType: 'PERCENT_OFF', benPercent: 10, benAmount: 0, benTerms: '',
  };
  const [f, setF] = useState(vacio);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: any) => setF({ ...f, [k]: v });

  async function crear() {
    setErr(null);
    if (!f.name.trim()) return setErr('Falta el nombre del negocio.');
    if (!f.email.trim()) return setErr('Falta el email: con ese correo entra el aliado a su portal.');
    if (!f.ownerFullName.trim()) return setErr('Falta el nombre de la persona de contacto.');
    setBusy(true);
    try {
      const body: any = {
        name: f.name.trim(), email: f.email.trim(), ownerFullName: f.ownerFullName.trim(),
        categoryId: f.categoryId || null, city: f.city, whatsapp: f.whatsapp,
        description: f.description, tenantId: f.tenantId || null,
      };
      if (f.benTitle.trim()) {
        body.benefit = {
          title: f.benTitle.trim(), type: f.benType, terms: f.benTerms,
          percentOff: f.benType === 'PERCENT_OFF' ? Number(f.benPercent) || 0 : null,
          amountOffCents: f.benType === 'AMOUNT_OFF' ? Number(f.benAmount) || 0 : null,
        };
      }
      onCreado(await api('/cuponera/panel/allies' + (window.location.search || ''), {
        method: 'POST', body: JSON.stringify(body),
      }));
      setF(vacio);
    } catch (e: any) {
      setErr(e?.message || 'No se pudo crear el aliado.');
    } finally { setBusy(false); }
  }

  return (
    <div style={{ ...card, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
      <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 12 }}>Nuevo aliado</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12 }}>
        <Campo label="Nombre del negocio *">
          <input style={inp} value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Café Aurora" />
        </Campo>
        <Campo label="Email de acceso *">
          <input style={inp} value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="hola@cafeaurora.com" />
        </Campo>
        <Campo label="Persona de contacto *">
          <input style={inp} value={f.ownerFullName} onChange={(e) => set('ownerFullName', e.target.value)} placeholder="María Pérez" />
        </Campo>
        <Campo label="Categoría">
          <select style={inp} value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">Sin categoría</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ''}{c.name}</option>)}
          </select>
        </Campo>
        <Campo label="Ciudad">
          <input style={inp} value={f.city} onChange={(e) => set('city', e.target.value)} />
        </Campo>
        <Campo label="WhatsApp">
          <input style={inp} value={f.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} placeholder="+57 300 000 0000" />
        </Campo>
        <div style={{ gridColumn: '1 / -1' }}>
          <Campo label="Descripción">
            <input style={inp} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Café de origen en el centro" />
          </Campo>
        </div>
      </div>

      {tenants.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <Campo label="¿Ya es cliente de la plataforma?">
            <select style={inp} value={f.tenantId} onChange={(e) => set('tenantId', e.target.value)}>
              <option value="">No — es un negocio externo (usará el portal web)</option>
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Campo>
          <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 5 }}>
            Si lo vinculás, el negocio canjea con <b>su escáner de siempre</b>, sin cuenta aparte.
          </div>
        </div>
      )}

      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px dashed #cbd5e1' }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 3 }}>Primer beneficio</div>
        <div style={{ fontSize: 11.5, color: '#64748b', marginBottom: 10 }}>
          Un aliado <b>sin beneficio no aparece</b> en la cartelera. Podés cargarlo ahora o dejar que lo haga él desde su portal.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12 }}>
          <Campo label="Título">
            <input style={inp} value={f.benTitle} onChange={(e) => set('benTitle', e.target.value)} placeholder="20% en toda la carta" />
          </Campo>
          <Campo label="Tipo">
            <select style={inp} value={f.benType} onChange={(e) => set('benType', e.target.value)}>
              <option value="PERCENT_OFF">Descuento %</option>
              <option value="AMOUNT_OFF">Monto fijo</option>
              <option value="TWO_FOR_ONE">2x1</option>
              <option value="FREEBIE">Gratis</option>
            </select>
          </Campo>
          {f.benType === 'PERCENT_OFF' && (
            <Campo label="Porcentaje">
              <input type="number" style={inp} value={f.benPercent} onChange={(e) => set('benPercent', e.target.value)} />
            </Campo>
          )}
          {f.benType === 'AMOUNT_OFF' && (
            <Campo label="Monto (COP)">
              <input type="number" style={inp} value={f.benAmount} onChange={(e) => set('benAmount', e.target.value)} />
            </Campo>
          )}
          <div style={{ gridColumn: '1 / -1' }}>
            <Campo label="Condiciones">
              <input style={inp} value={f.benTerms} onChange={(e) => set('benTerms', e.target.value)} placeholder="No acumulable con otras promociones" />
            </Campo>
          </div>
        </div>
      </div>

      {err && <div style={{ marginTop: 12, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 9, padding: '9px 12px', fontSize: 12.5 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={crear} disabled={busy} style={btn()}>{busy ? 'Creando…' : 'Crear aliado'}</button>
        <button onClick={onCancelar} style={btn('#eef2f7', '#111827')}>Cancelar</button>
      </div>
    </div>
  );
}

/** Alta manual de beneficiario: el que pagó por fuera, o el invitado. */
function FormMiembro({
  plans, onCreado, onCancelar,
}: { plans: Plan[]; onCreado: (r: any) => void; onCancelar: () => void }) {
  const vacio = { fullName: '', phone: '', email: '', planId: '' };
  const [f, setF] = useState(vacio);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function crear() {
    setErr(null);
    if (!f.fullName.trim()) return setErr('Falta el nombre.');
    // Uno de los dos alcanza: el teléfono es la identidad fuerte, pero quien
    // compra por Hotmart o Stripe a veces solo deja correo.
    if (!f.phone.trim() && !f.email.trim()) return setErr('Dejá un teléfono o un correo: sin eso no hay cómo entregarle la tarjeta.');
    setBusy(true);
    try {
      onCreado(await api('/cuponera/panel/members' + (window.location.search || ''), {
        method: 'POST',
        body: JSON.stringify({ ...f, planId: f.planId || null }),
      }));
      setF(vacio);
    } catch (e: any) {
      setErr(e?.message || 'No se pudo dar de alta.');
    } finally { setBusy(false); }
  }

  return (
    <div style={{ ...card, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
      <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 12 }}>Dar de alta un beneficiario</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
        <Campo label="Nombre *"><input style={inp} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Campo>
        <Campo label="Teléfono"><input style={inp} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+57 300 000 0000" /></Campo>
        <Campo label="Email"><input style={inp} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Campo>
        <Campo label="Plan">
          <select style={inp} value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })}>
            <option value="">Sin plan</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {money(p.priceCents, p.currency)}</option>)}
          </select>
        </Campo>
      </div>
      <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 8 }}>
        Se le emite la tarjeta al instante. Puede recuperarla en <b>Mi tarjeta</b> con el mismo teléfono o correo.
      </div>
      {err && <div style={{ marginTop: 12, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 9, padding: '9px 12px', fontSize: 12.5 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={crear} disabled={busy} style={btn()}>{busy ? 'Dando de alta…' : 'Dar de alta'}</button>
        <button onClick={onCancelar} style={btn('#eef2f7', '#111827')}>Cancelar</button>
      </div>
    </div>
  );
}

/**
 * Configuración de la cuponera: categorías, planes y ajustes.
 *
 * Sin categorías, el desplegable del alta de aliado queda vacío para siempre.
 * Sin planes, no se le puede asignar nada a un beneficiario ni vender nada.
 * Y el interruptor de revisión es lo que le da sentido a la bandeja de
 * beneficios: si está apagado, todo se publica solo.
 */
function TabConfig({
  qs, cats, plans, onCambio, flash,
}: {
  qs: string; cats: Category[]; plans: Plan[];
  onCambio: () => Promise<void>; flash: (m: string) => void;
}) {
  const [cfg, setCfg] = useState<Settings | null>(null);
  const [nuevaCat, setNuevaCat] = useState({ name: '', icon: '' });
  const [nuevoPlan, setNuevoPlan] = useState({ name: '', priceCents: 0, interval: 'MONTHLY' as const });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Settings>(`/cuponera/panel/settings${qs}`).then(setCfg).catch(() => setCfg(null));
  }, [qs]);

  async function guardarCfg(patch: Partial<Settings>) {
    setBusy(true);
    try {
      setCfg(await api<Settings>(`/cuponera/panel/settings${qs}`, { method: 'PATCH', body: JSON.stringify(patch) }));
      flash('Ajustes guardados');
    } finally { setBusy(false); }
  }

  async function crearCat() {
    if (!nuevaCat.name.trim()) return;
    await api(`/cuponera/panel/categories${qs}`, { method: 'POST', body: JSON.stringify(nuevaCat) });
    setNuevaCat({ name: '', icon: '' });
    await onCambio();
    flash('Categoría creada');
  }

  async function borrarCat(c: Category) {
    if (!confirm(`¿Eliminar la categoría "${c.name}"? Los aliados que la tengan quedan sin categoría.`)) return;
    await api(`/cuponera/panel/categories/${c.id}${qs}`, { method: 'DELETE' });
    await onCambio();
  }

  async function crearPlan() {
    if (!nuevoPlan.name.trim()) return;
    await api(`/cuponera/panel/plans${qs}`, {
      method: 'POST',
      body: JSON.stringify({ ...nuevoPlan, priceCents: Number(nuevoPlan.priceCents) || 0 }),
    });
    setNuevoPlan({ name: '', priceCents: 0, interval: 'MONTHLY' });
    await onCambio();
    flash('Plan creado');
  }

  async function togglePlan(p: Plan) {
    await api(`/cuponera/panel/plans/${p.id}${qs}`, { method: 'PATCH', body: JSON.stringify({ isActive: !p.isActive }) });
    await onCambio();
  }

  async function borrarPlan(p: Plan) {
    if (!confirm(`¿Eliminar el plan "${p.name}"?`)) return;
    try {
      await api(`/cuponera/panel/plans/${p.id}${qs}`, { method: 'DELETE' });
      await onCambio();
    } catch (e: any) {
      flash(e?.message || 'No se pudo eliminar: puede tener beneficiarios asignados.');
    }
  }

  return (
    <>
      <div style={card}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 3 }}>Categorías</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
          Agrupan a los aliados en la cartelera. Sin categorías, el desplegable del alta de aliado queda vacío.
        </div>
        {cats.map((c) => (
          <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
            <span style={{ fontSize: 13.5 }}>{c.icon ? `${c.icon} ` : ''}{c.name}</span>
            <button onClick={() => borrarCat(c)} style={{ ...btn('#fee2e2', '#991b1b'), padding: '5px 11px', fontSize: 12 }}>Eliminar</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <input style={{ ...inp, width: 70 }} maxLength={2} value={nuevaCat.icon}
            onChange={(e) => setNuevaCat({ ...nuevaCat, icon: e.target.value })} placeholder="☕" />
          <input style={{ ...inp, flex: 1, minWidth: 160 }} value={nuevaCat.name}
            onChange={(e) => setNuevaCat({ ...nuevaCat, name: e.target.value })} placeholder="Cafés y restaurantes" />
          <button onClick={crearCat} style={btn()}>Agregar</button>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 3 }}>Planes de membresía</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
          Un plan de precio <b>0</b> es una cuponera gratuita: la persona se registra y entra.
        </div>
        {plans.map((p) => (
          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '9px 0', borderBottom: '1px solid #f3f4f6' }}>
            <div>
              <b style={{ fontSize: 13.5 }}>{p.name}</b>
              <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 8 }}>
                {p.priceCents > 0 ? money(p.priceCents, p.currency) : 'Gratis'}
                {p.interval === 'ANNUAL' ? ' / año' : p.priceCents > 0 ? ' / mes' : ''}
                {p.isActive === false ? ' · inactivo' : ''}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 7 }}>
              <button onClick={() => togglePlan(p)} style={{ ...btn('#eef2f7', '#111827'), padding: '5px 11px', fontSize: 12 }}>
                {p.isActive === false ? 'Activar' : 'Desactivar'}
              </button>
              <button onClick={() => borrarPlan(p)} style={{ ...btn('#fee2e2', '#991b1b'), padding: '5px 11px', fontSize: 12 }}>Eliminar</button>
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <input style={{ ...inp, flex: 1, minWidth: 150 }} value={nuevoPlan.name}
            onChange={(e) => setNuevoPlan({ ...nuevoPlan, name: e.target.value })} placeholder="Living Card Mensual" />
          <input type="number" style={{ ...inp, width: 130 }} value={nuevoPlan.priceCents}
            onChange={(e) => setNuevoPlan({ ...nuevoPlan, priceCents: Number(e.target.value) })} placeholder="50000" />
          <select style={{ ...inp, width: 120 }} value={nuevoPlan.interval}
            onChange={(e) => setNuevoPlan({ ...nuevoPlan, interval: e.target.value as any })}>
            <option value="MONTHLY">Mensual</option>
            <option value="ANNUAL">Anual</option>
          </select>
          <button onClick={crearPlan} style={btn()}>Agregar</button>
        </div>
      </div>

      {cfg && (
        <div style={card}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 12 }}>Ajustes</div>

          <Campo label="Texto de bienvenida">
            <input style={inp} defaultValue={cfg.welcomeText}
              onBlur={(e) => e.target.value !== cfg.welcomeText && guardarCfg({ welcomeText: e.target.value })} />
          </Campo>

          <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 16, cursor: 'pointer' }}>
            <input type="checkbox" checked={cfg.requireBenefitApproval} disabled={busy}
              onChange={(e) => guardarCfg({ requireBenefitApproval: e.target.checked })} style={{ marginTop: 3 }} />
            <span style={{ fontSize: 13 }}>
              <b>Revisar los beneficios antes de publicarlos</b>
              <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>
                Con esto encendido, lo que carga un aliado queda <b>por revisar</b> y aparece en
                la pestaña Beneficios hasta que lo apruebes. Apagado, se publica solo.
              </div>
            </span>
          </label>

          <div style={{ marginTop: 16, maxWidth: 260 }}>
            <Campo label="Avisos que puede enviar cada aliado por semana">
              <input type="number" min={0} max={20} style={inp} defaultValue={cfg.allyPushPerWeek}
                onBlur={(e) => Number(e.target.value) !== cfg.allyPushPerWeek && guardarCfg({ allyPushPerWeek: Number(e.target.value) })} />
            </Campo>
            <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 5 }}>
              0 los apaga. Sin tope, un aliado puede hacer que la gente desinstale la tarjeta.
            </div>
          </div>

          <div style={{ marginTop: 18, fontSize: 11.5, color: '#94a3b8' }}>
            Publicar o pausar la cuponera se hace desde la administración de Fidelity, no acá.
          </div>
        </div>
      )}
    </>
  );
}

type Geopunto = { id: string; name: string; latitude: number | string | null; longitude: number | string | null; radiusMeters: number | null; address: string | null };
type Sellos = { id: string; name: string; stampsRequired: number; rewardText: string; maxPerDay: number; status: string; category: { name: string } | null; _count?: { cards: number } };

/**
 * Comunidad: las tres formas de alcanzar al beneficiario.
 *  · Aviso — llega a la tarjeta en el bolsillo (Apple/Google Wallet).
 *  · Geopush — aparece al pasar cerca de un punto.
 *  · Sellos — la razón para volver.
 */
function TabComunidad({
  qs, plans, allies, cats, flash,
}: {
  qs: string; plans: Plan[]; allies: Ally[]; cats: Category[]; flash: (m: string) => void;
}) {
  const [msg, setMsg] = useState({ title: '', body: '', target: 'all' as string });
  const [alcance, setAlcance] = useState<number | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [puntos, setPuntos] = useState<Geopunto[]>([]);
  const [nuevoPunto, setNuevoPunto] = useState({ name: '', latitude: '', longitude: '', radiusMeters: 300, address: '' });
  const [progs, setProgs] = useState<Sellos[]>([]);
  const [nuevoProg, setNuevoProg] = useState({ name: '', stampsRequired: 5, rewardText: '', maxPerDay: 1, categoryId: '' });

  const seg = () => {
    if (msg.target.startsWith('plan:')) return { planId: msg.target.slice(5) };
    if (msg.target.startsWith('ally:')) return { allyId: msg.target.slice(5) };
    return {};
  };

  const cargar = async () => {
    const [g, p] = await Promise.all([
      api(`/cuponera/panel/geopush${qs}`).catch(() => null),
      api(`/cuponera/panel/stamp-programs${qs}`).catch(() => null),
    ]);
    setPuntos((g as Geopunto[]) ?? []);
    setProgs((p as Sellos[]) ?? []);
  };
  useEffect(() => { cargar(); }, [qs]);

  // El alcance se consulta ANTES de mandar: sin ese número el aviso sale a
  // ciegas y no hay forma de notar que el segmento quedó vacío.
  useEffect(() => {
    const s = seg();
    const q = new URLSearchParams(qs.replace('?', ''));
    if (s.planId) q.set('planId', s.planId);
    if (s.allyId) q.set('allyId', s.allyId);
    api<{ alcance: number }>(`/cuponera/panel/push/reach?${q}`)
      .then((r) => setAlcance(r?.alcance ?? 0))
      .catch(() => setAlcance(null));
  }, [msg.target, qs]);

  async function enviar() {
    if (!msg.title.trim() || !msg.body.trim()) { flash('Falta el título o el mensaje.'); return; }
    if (alcance === 0) { flash('Ese segmento no tiene a nadie con la tarjeta instalada.'); return; }
    const aQuien = msg.target === 'all' ? 'toda la comunidad' : 'ese segmento';
    if (!confirm(`Vas a enviar este aviso a ${aQuien} (${alcance ?? '?'} tarjetas). No se puede deshacer.`)) return;
    setEnviando(true);
    try {
      const r: any = await api(`/cuponera/panel/push${qs}`, {
        method: 'POST', body: JSON.stringify({ title: msg.title, body: msg.body, ...seg() }),
      });
      setMsg({ ...msg, title: '', body: '' });
      flash(`Aviso enviado${typeof r?.sent === 'number' ? ` a ${r.sent} tarjetas` : ''}.`);
    } catch (e: any) {
      flash(e?.message || 'No se pudo enviar.');
    } finally { setEnviando(false); }
  }

  async function crearPunto() {
    const lat = Number(nuevoPunto.latitude), lng = Number(nuevoPunto.longitude);
    if (!nuevoPunto.name.trim()) { flash('Poné un nombre al punto.'); return; }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { flash('Las coordenadas tienen que ser números.'); return; }
    await api(`/cuponera/panel/geopush${qs}`, {
      method: 'POST',
      body: JSON.stringify({ ...nuevoPunto, latitude: lat, longitude: lng, radiusMeters: Number(nuevoPunto.radiusMeters) || 300 }),
    });
    setNuevoPunto({ name: '', latitude: '', longitude: '', radiusMeters: 300, address: '' });
    await cargar();
    flash('Punto creado');
  }

  async function borrarPunto(g: Geopunto) {
    if (!confirm(`¿Eliminar el punto "${g.name}"?`)) return;
    await api(`/cuponera/panel/geopush/${g.id}${qs}`, { method: 'DELETE' });
    await cargar();
  }

  async function crearProg() {
    if (!nuevoProg.name.trim()) { flash('Poné un nombre al programa.'); return; }
    await api(`/cuponera/panel/stamp-programs${qs}`, {
      method: 'POST',
      body: JSON.stringify({
        ...nuevoProg,
        stampsRequired: Number(nuevoProg.stampsRequired) || 5,
        maxPerDay: Number(nuevoProg.maxPerDay) || 1,
        categoryId: nuevoProg.categoryId || null,
      }),
    });
    setNuevoProg({ name: '', stampsRequired: 5, rewardText: '', maxPerDay: 1, categoryId: '' });
    await cargar();
    flash('Programa de sellos creado');
  }

  async function borrarProg(p: Sellos) {
    if (!confirm(`¿Eliminar "${p.name}"? Los sellos que la gente ya juntó se pierden.`)) return;
    await api(`/cuponera/panel/stamp-programs/${p.id}${qs}`, { method: 'DELETE' });
    await cargar();
  }

  return (
    <>
      <div style={card}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 3 }}>Enviar un aviso</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
          Llega a la tarjeta guardada en Apple o Google Wallet. Solo lo reciben quienes la tienen instalada.
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <Campo label="A quién">
            <select style={inp} value={msg.target} onChange={(e) => setMsg({ ...msg, target: e.target.value })}>
              <option value="all">Toda la comunidad</option>
              {plans.length > 0 && <optgroup label="Por plan">
                {plans.map((p) => <option key={p.id} value={`plan:${p.id}`}>{p.name}</option>)}
              </optgroup>}
              {allies.length > 0 && <optgroup label="Quienes usaron un beneficio de…">
                {allies.map((a) => <option key={a.id} value={`ally:${a.id}`}>{a.name}</option>)}
              </optgroup>}
            </select>
          </Campo>
          <Campo label="Título">
            <input style={inp} maxLength={60} value={msg.title} onChange={(e) => setMsg({ ...msg, title: e.target.value })} placeholder="Nuevo aliado en el centro" />
          </Campo>
          <Campo label="Mensaje">
            <textarea style={{ ...inp, minHeight: 70 }} maxLength={300} value={msg.body} onChange={(e) => setMsg({ ...msg, body: e.target.value })} placeholder="Café Aurora se suma con 20% para vos." />
          </Campo>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
          <button onClick={enviar} disabled={enviando || alcance === 0} style={{ ...btn(), opacity: alcance === 0 ? 0.5 : 1 }}>
            {enviando ? 'Enviando…' : 'Enviar aviso'}
          </button>
          <span style={{ fontSize: 12.5, color: alcance === 0 ? '#b45309' : '#64748b' }}>
            {alcance === null ? '' : alcance === 0
              ? 'Nadie en este segmento tiene la tarjeta instalada.'
              : `Llega a ${alcance} ${alcance === 1 ? 'tarjeta' : 'tarjetas'}.`}
          </span>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 3 }}>Geopush</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
          El aviso aparece solo al pasar cerca del punto. Ideal para la zona donde están los aliados.
        </div>
        {puntos.map((g) => (
          <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '9px 0', borderBottom: '1px solid #f3f4f6' }}>
            <div>
              <b style={{ fontSize: 13.5 }}>{g.name}</b>
              <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2 }}>
                {Number(g.latitude ?? 0).toFixed(5)}, {Number(g.longitude ?? 0).toFixed(5)} · radio {g.radiusMeters ?? 300} m
                {g.address ? ` · ${g.address}` : ''}
              </div>
            </div>
            <button onClick={() => borrarPunto(g)} style={{ ...btn('#fee2e2', '#991b1b'), padding: '5px 11px', fontSize: 12 }}>Eliminar</button>
          </div>
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, marginTop: 12 }}>
          <Campo label="Nombre"><input style={inp} value={nuevoPunto.name} onChange={(e) => setNuevoPunto({ ...nuevoPunto, name: e.target.value })} placeholder="Zona Rosa" /></Campo>
          <Campo label="Latitud"><input style={inp} value={nuevoPunto.latitude} onChange={(e) => setNuevoPunto({ ...nuevoPunto, latitude: e.target.value })} placeholder="4.6534" /></Campo>
          <Campo label="Longitud"><input style={inp} value={nuevoPunto.longitude} onChange={(e) => setNuevoPunto({ ...nuevoPunto, longitude: e.target.value })} placeholder="-74.0836" /></Campo>
          <Campo label="Radio (m)"><input type="number" style={inp} value={nuevoPunto.radiusMeters} onChange={(e) => setNuevoPunto({ ...nuevoPunto, radiusMeters: Number(e.target.value) })} /></Campo>
          <div style={{ display: 'flex', alignItems: 'end' }}><button onClick={crearPunto} style={btn()}>Agregar</button></div>
        </div>
        <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 8 }}>
          Las coordenadas salen de Google Maps: clic derecho sobre el lugar → el primer número es la latitud.
        </div>
      </div>

      <div style={card}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 3 }}>Sellos comunitarios</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
          Ej.: 5 cafés en cualquier aliado = 1 gratis. El negocio da el sello al escanear la tarjeta.
        </div>
        {progs.map((p) => (
          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '9px 0', borderBottom: '1px solid #f3f4f6' }}>
            <div>
              <b style={{ fontSize: 13.5 }}>{p.name}</b>
              <span style={{ fontSize: 12, color: PC, marginLeft: 8 }}>· {p.stampsRequired} sellos</span>
              <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2 }}>
                {p.rewardText || 'Sin premio definido'} · {p.category?.name || 'cualquier aliado'} · máx {p.maxPerDay}/día · {p._count?.cards ?? 0} participando
              </div>
            </div>
            <button onClick={() => borrarProg(p)} style={{ ...btn('#fee2e2', '#991b1b'), padding: '5px 11px', fontSize: 12 }}>Eliminar</button>
          </div>
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, marginTop: 12 }}>
          <Campo label="Nombre"><input style={inp} value={nuevoProg.name} onChange={(e) => setNuevoProg({ ...nuevoProg, name: e.target.value })} placeholder="Café tour" /></Campo>
          <Campo label="Sellos"><input type="number" style={inp} value={nuevoProg.stampsRequired} onChange={(e) => setNuevoProg({ ...nuevoProg, stampsRequired: Number(e.target.value) })} /></Campo>
          <Campo label="Máx/día"><input type="number" style={inp} value={nuevoProg.maxPerDay} onChange={(e) => setNuevoProg({ ...nuevoProg, maxPerDay: Number(e.target.value) })} /></Campo>
          <Campo label="Categoría">
            <select style={inp} value={nuevoProg.categoryId} onChange={(e) => setNuevoProg({ ...nuevoProg, categoryId: e.target.value })}>
              <option value="">Cualquier aliado</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Campo>
          <div style={{ gridColumn: '1 / -1' }}>
            <Campo label="Premio"><input style={inp} value={nuevoProg.rewardText} onChange={(e) => setNuevoProg({ ...nuevoProg, rewardText: e.target.value })} placeholder="Un café gratis" /></Campo>
          </div>
          <div><button onClick={crearProg} style={btn()}>Agregar</button></div>
        </div>
      </div>
    </>
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
  const [cats, setCats] = useState<Category[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [bens, setBens] = useState<PanelBenefit[]>([]);
  const [tenants, setTenants] = useState<TenantOpt[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [nuevoAliado, setNuevoAliado] = useState(false);
  const [nuevoMiembro, setNuevoMiembro] = useState(false);

  const flash = (m: string) => { setAviso(m); setTimeout(() => setAviso(null), 6000); };

  const recargarConfig = async () => {
    const [ct, pl] = await Promise.all([
      api(`/cuponera/panel/categories${qs}`).catch(() => null),
      api(`/cuponera/panel/plans${qs}`).catch(() => null),
    ]);
    setCats((ct as Category[]) ?? []);
    setPlans((pl as Plan[]) ?? []);
  };

  // Recarga puntual: tras crear o aprobar algo hay que refrescar solo lo que
  // cambió, no la pantalla entera.
  const recargar = async () => {
    const [o, a, m, b] = await Promise.all([
      api(`/cuponera/panel/overview${qs}`).catch(() => null),
      api(`/cuponera/panel/allies${qs}`).catch(() => null),
      api(`/cuponera/panel/members${qs}`).catch(() => null),
      api(`/cuponera/panel/benefits${qs}`).catch(() => null),
    ]);
    if (o) setOv(o as Overview);
    setAllies((a as Ally[]) ?? []);
    setMembers((m as Member[]) ?? []);
    setBens((b as PanelBenefit[]) ?? []);
  };

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
        const [o, a, m, r, ct, pl, bn, tn] = await Promise.all([
          api(`/cuponera/panel/overview${qs}`),
          api(`/cuponera/panel/allies${qs}`),
          api(`/cuponera/panel/members${qs}`),
          api(`/cuponera/panel/redemptions${qs}`),
          api(`/cuponera/panel/categories${qs}`).catch(() => null),
          api(`/cuponera/panel/plans${qs}`).catch(() => null),
          api(`/cuponera/panel/benefits${qs}`).catch(() => null),
          api(`/cuponera/panel/tenant-options${qs}`).catch(() => null),
        ]);
        setOv(o as Overview);
        // api() devuelve null en respuesta vacía.
        setAllies(((a as Ally[]) ?? []));
        setMembers(((m as Member[]) ?? []));
        setReds(((r as Redemption[]) ?? []));
        setCats(((ct as Category[]) ?? []));
        setPlans(((pl as Plan[]) ?? []));
        setBens(((bn as PanelBenefit[]) ?? []));
        setTenants(((tn as TenantOpt[]) ?? []));
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

      {aviso && (
        <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', borderRadius: 10, padding: '10px 13px', fontSize: 12.5, marginBottom: 12, whiteSpace: 'pre-wrap' }}>
          {aviso}
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
        <>
          {!nuevoAliado && (
            <button onClick={() => setNuevoAliado(true)} style={{ ...btn(), marginBottom: 14 }}>+ Nuevo aliado</button>
          )}
          {nuevoAliado && (
            <FormAliado
              cats={cats}
              tenants={tenants}
              onCancelar={() => setNuevoAliado(false)}
              onCreado={async (r) => {
                setNuevoAliado(false);
                await recargar();
                // La contraseña se muestra UNA sola vez: no se guarda en claro.
                // createAlly devuelve { ally, benefit, loginEmail, tempPassword }.
                flash(
                  r?.tempPassword
                    ? `Aliado creado. Entra en /cuponera/panel con ${r.loginEmail} y la contraseña ${r.tempPassword} — anotala, no se vuelve a mostrar.\nQueda PENDIENTE: aprobalo abajo para que salga en la cartelera.`
                    : 'Aliado creado. Queda PENDIENTE: aprobalo abajo para que salga en la cartelera.',
                );
              }}
            />
          )}

          <div style={card}>
            {allies.length === 0
              ? <div style={{ fontSize: 13, color: '#9ca3af' }}>Todavía no hay aliados en esta cuponera.</div>
              : allies.map((a) => {
                const st = ALLY_STATUS[a.status];
                const cambiar = async (status: Ally['status']) => {
                  await api(`/cuponera/panel/allies/${a.id}/status${qs}`, { method: 'PATCH', body: JSON.stringify({ status }) });
                  await recargar();
                };
                return (
                  <div key={a.id} style={{ padding: '11px 0', borderBottom: '1px solid #f3f4f6' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <div>
                        <b style={{ fontSize: 14 }}>{a.name}</b>
                        <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 8 }}>
                          {a.city || '—'}{a.category ? ` · ${a.category.name}` : ''}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ background: st.bg, color: st.c, padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{st.t}</span>
                        {a.status !== 'APPROVED' && (
                          <button onClick={() => cambiar('APPROVED')} style={{ ...btn('#dcfce7', '#166534'), padding: '6px 12px', fontSize: 12 }}>Aprobar</button>
                        )}
                        {a.status === 'APPROVED' && (
                          <button onClick={() => cambiar('SUSPENDED')} style={{ ...btn('#f3f4f6', '#4b5563'), padding: '6px 12px', fontSize: 12 }}>Suspender</button>
                        )}
                        {a.status === 'PENDING' && (
                          <button onClick={() => cambiar('REJECTED')} style={{ ...btn('#fee2e2', '#991b1b'), padding: '6px 12px', fontSize: 12 }}>Rechazar</button>
                        )}
                      </div>
                    </div>
                    <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 3 }}>
                      {a._count.benefits} beneficios · {a._count.locations} sedes · {a._count.redemptions} canjes
                      {a._count.benefits === 0 && <span style={{ color: '#b45309' }}> · sin beneficios, no aparece en la cartelera</span>}
                    </div>
                  </div>
                );
              })}
          </div>
        </>
      )}

      {tab === 'Beneficiarios' && (
        <>
          {!nuevoMiembro && (
            <button onClick={() => setNuevoMiembro(true)} style={{ ...btn(), marginBottom: 14 }}>+ Dar de alta</button>
          )}
          {nuevoMiembro && (
            <FormMiembro
              plans={plans}
              onCancelar={() => setNuevoMiembro(false)}
              onCreado={async () => {
                setNuevoMiembro(false);
                await recargar();
                flash('Beneficiario dado de alta y tarjeta emitida.');
              }}
            />
          )}
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
        </>
      )}

      {tab === 'Beneficios' && (
        <div style={card}>
          <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 12 }}>
            Lo que publican los aliados. Si la cuponera exige revisión, un beneficio
            queda <b>por revisar</b> y <b>no se ve en la cartelera</b> hasta que lo apruebes.
          </div>
          {bens.length === 0
            ? <div style={{ fontSize: 13, color: '#9ca3af' }}>Todavía no hay beneficios cargados.</div>
            : bens.map((b) => {
              const ap = APPROVAL[b.approval];
              const decidir = async (approval: PanelBenefit['approval']) => {
                await api(`/cuponera/panel/benefits/${b.id}/approval${qs}`, { method: 'PATCH', body: JSON.stringify({ approval }) });
                await recargar();
              };
              return (
                <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}>
                  <div>
                    <b style={{ fontSize: 13.5 }}>{b.title}</b>
                    <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2 }}>
                      {b.ally?.name ?? '—'}
                      {b.percentOff ? ` · ${b.percentOff}% OFF` : ''}
                      {b.amountOffCents ? ` · ${money(b.amountOffCents)} OFF` : ''}
                      {b.status !== 'ACTIVE' ? ` · ${b.status.toLowerCase()}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ background: ap.bg, color: ap.c, padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{ap.t}</span>
                    {b.approval !== 'APPROVED' && (
                      <button onClick={() => decidir('APPROVED')} style={{ ...btn('#dcfce7', '#166534'), padding: '6px 12px', fontSize: 12 }}>Publicar</button>
                    )}
                    {b.approval !== 'REJECTED' && (
                      <button onClick={() => decidir('REJECTED')} style={{ ...btn('#fee2e2', '#991b1b'), padding: '6px 12px', fontSize: 12 }}>Rechazar</button>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {tab === 'Comunidad' && (
        <TabComunidad qs={qs} plans={plans} allies={allies} cats={cats} flash={flash} />
      )}

      {tab === 'Configuración' && (
        <TabConfig qs={qs} cats={cats} plans={plans} flash={flash} onCambio={recargarConfig} />
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
