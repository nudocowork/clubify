'use client';
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, getUser, clearSession } from '@/lib/api';
import { PhoneInput } from '@/components/PhoneInput';
import { ImageUploader } from '@/components/ImageUploader';
import { SedesAliado } from '@/components/cuponera/SedesAliado';
import type { MapPickResult } from '@/components/MapPicker';

const MapPicker = dynamic(
  () => import('@/components/MapPicker').then((m) => m.MapPicker),
  { ssr: false, loading: () => <div style={{ height: 320, borderRadius: 10, background: '#f1f5f9' }} /> },
);

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
  zone?: string; neighborhood?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  category: { id: string; name: string } | null;
  _count: { benefits: number; redemptions: number; locations: number };
};
type Member = {
  id: string; status: string; expiresAt: string | null; passId: string | null;
  customer: { id: string; fullName: string; phone: string | null; email: string | null };
  plan: { id: string; name: string; maxLinkedMembers?: number } | null;
  /** Con valor: esta tarjeta es un ENLACE del plan familiar de otro. */
  primaryMembershipId?: string | null;
  _count?: { linked: number };
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
  /** Plan familiar: tarjetas ADICIONALES enlazables. 0 = individual. */
  maxLinkedMembers?: number;
};
type Settings = {
  name: string; status: string; welcomeText: string;
  requireBenefitApproval: boolean; allyPushPerWeek: number;
  slug?: string; officialPageHtml?: string; directoryPageHtml?: string;
};

type PaginaCampo = 'officialPageHtml' | 'directoryPageHtml';
const PAGINAS: Record<PaginaCampo, { titulo: string; ruta: string; desc: string }> = {
  officialPageHtml: { titulo: 'Página principal (HTML)', ruta: '', desc: 'La portada de la cuponera' },
  directoryPageHtml: { titulo: 'Página de directorio (HTML)', ruta: '/directorio', desc: 'El directorio de negocios aliados' },
};

/**
 * Página oficial de la cuponera en HTML. La vista previa usa el mismo iframe
 * aislado que la página pública: lo que se ve acá es lo que ve la gente, y sus
 * scripts no alcanzan la sesión de quien la está editando.
 */
function PaginaOficialHtml({
  cfg, busy, guardar, campo,
}: { cfg: Settings; busy: boolean; guardar: (p: Partial<Settings>) => Promise<void>; campo: PaginaCampo }) {
  const meta = PAGINAS[campo];
  const guardado = cfg[campo] ?? '';
  const [html, setHtml] = useState(guardado);
  const [ver, setVer] = useState(false);
  const cambiado = html !== guardado;
  const url = cfg.slug && typeof window !== 'undefined' ? `${window.location.origin}/cuponera/p/${cfg.slug}${meta.ruta}` : '';
  const kb = Math.round(new Blob([html]).size / 1024);

  return (
    <div style={card}>
      <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 3 }}>{meta.titulo}</div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
        {meta.desc}, en código HTML. Se publica en{' '}
        {url ? <a href={url} target="_blank" rel="noreferrer" style={{ color: PC, fontWeight: 700 }}>{url}</a> : 'su enlace'}
        {cfg.status !== 'ACTIVE' && <> — <b>se verá cuando la cuponera esté publicada</b></>}.
      </div>
      <textarea
        style={{ ...inp, minHeight: 260, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'pre' }}
        spellCheck={false}
        value={html}
        onChange={(e) => setHtml(e.target.value)}
        placeholder={'<!doctype html>\n<html>\n  <head><title>Mi cuponera</title></head>\n  <body>…</body>\n</html>'}
      />
      <div style={{ fontSize: 11.5, color: kb > 300 ? '#b91c1c' : '#64748b', marginTop: 5 }}>
        {kb} KB de 300. Las imágenes van enlazadas (https://…), no pegadas dentro del código.
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button style={btn()} disabled={busy || !cambiado || kb > 300} onClick={() => guardar({ [campo]: html })}>
          {busy ? 'Guardando…' : 'Guardar página'}
        </button>
        <button style={btn('#eef2f7', '#111827')} onClick={() => setVer((v) => !v)} disabled={!html.trim()}>
          {ver ? 'Ocultar vista previa' : 'Vista previa'}
        </button>
        {guardado && (
          <button style={btn('#fee2e2', '#991b1b')} disabled={busy}
            onClick={() => { if (confirm(`¿Quitar la ${meta.titulo.replace(' (HTML)', '').toLowerCase()}? El enlace dejará de mostrarla.`)) { setHtml(''); void guardar({ [campo]: '' }); } }}>
            Quitar página
          </button>
        )}
      </div>
      {ver && html.trim() && (
        <iframe
          title="Vista previa"
          srcDoc={html}
          sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
          style={{ width: '100%', height: 520, border: '1px solid #e2e8f0', borderRadius: 10, marginTop: 12, background: '#fff' }}
        />
      )}
    </div>
  );
}
type TenantOpt = { id: string; name: string; brandName: string | null };
type PanelBenefit = {
  id: string; title: string; type: string; status: string;
  approval: 'PENDING' | 'APPROVED' | 'REJECTED';
  percentOff: number | null; amountOffCents: number | null;
  ally: { id: string; name: string } | null;
};

const TABS = ['Dashboard', 'Aliados', 'Beneficiarios', 'Beneficios', 'Comunidad', 'Redenciones', 'Tarjeta', 'Integraciones', 'Configuración'] as const;
type Tab = (typeof TABS)[number];

// ── Carga por pestañas ────────────────────────────────────────────────────────
// El panel abría con 9 peticiones a la vez aunque solo se mirara el Dashboard.
// Cada recurso se pide la primera vez que una pestaña lo necesita; esta tabla
// dice cuáles usa cada una (los formularios incluidos: el alta de aliado
// necesita categorías, negocios de la marca y correos de acceso).
type Recurso = 'allies' | 'members' | 'reds' | 'cats' | 'plans' | 'bens' | 'tenants' | 'logins';
const RECURSOS_POR_TAB: Record<Tab, Recurso[]> = {
  Dashboard: [],
  Aliados: ['allies', 'cats', 'tenants', 'logins'],
  Beneficiarios: ['members', 'plans'],
  Beneficios: ['bens'],
  Comunidad: ['plans', 'allies', 'cats'],
  Redenciones: ['reds'],
  Tarjeta: [],
  // BloqueCobro trae lo suyo (gateways + MercadoPago) con sus propias llamadas.
  Integraciones: [],
  Configuración: ['cats', 'plans'],
};

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
 * Elegir el negocio de la marca que ya es cliente. Era un desplegable con
 * cientos de nombres en orden alfabético: encontrar uno obligaba a recorrerlo
 * entero. Filtra por nombre y por nombre de marca, sin tildes ni mayúsculas.
 */
function BuscadorNegocio({
  tenants, value, onChange,
}: { tenants: TenantOpt[]; value: string; onChange: (id: string) => void }) {
  const [q, setQ] = useState('');
  const elegido = tenants.find((t) => t.id === value) ?? null;
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const nq = norm(q.trim());
  const lista = nq
    ? tenants.filter((t) => norm(`${t.name} ${t.brandName ?? ''}`).includes(nq)).slice(0, 30)
    : [];

  if (elegido) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', border: '1px solid #bae6fd', background: '#f0f9ff', borderRadius: 9 }}>
        <span style={{ flex: 1, fontSize: 13.5 }}>
          <b>{elegido.name}</b>
          {elegido.brandName && elegido.brandName !== elegido.name ? <span style={{ color: '#64748b' }}> · {elegido.brandName}</span> : null}
        </span>
        <button type="button" onClick={() => { onChange(''); setQ(''); }} style={{ ...btn('#fff', '#0f172a'), padding: '5px 10px', fontSize: 12, border: '1px solid #cbd5e1' }}>
          Quitar
        </button>
      </div>
    );
  }

  return (
    <div>
      <input style={inp} value={q} onChange={(e) => setQ(e.target.value)}
        placeholder={`Buscá entre ${tenants.length} negocios por nombre…`} />
      {nq && (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 9, marginTop: 6, maxHeight: 240, overflowY: 'auto', background: '#fff' }}>
          {lista.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: 12.5, color: '#94a3b8' }}>Ningún negocio coincide con «{q.trim()}».</div>
          ) : lista.map((t) => (
            <button key={t.id} type="button" onClick={() => onChange(t.id)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', borderBottom: '1px solid #f1f5f9', background: 'none', cursor: 'pointer', fontSize: 13.5 }}>
              {t.name}
              {t.brandName && t.brandName !== t.name ? <span style={{ color: '#64748b' }}> · {t.brandName}</span> : null}
            </button>
          ))}
        </div>
      )}
      <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 5 }}>
        Vacío = es un negocio externo y usará el portal web.
      </div>
    </div>
  );
}

/**
 * Alta de aliado. Incluye el PRIMER BENEFICIO en el mismo formulario a
 * propósito: un aliado sin beneficio no aparece en la cartelera, así que
 * crearlo sin eso deja el trabajo a medias y a alguien volviendo después.
 */
function FormAliado({
  cats, tenants, zonas, onCreado, onCancelar,
}: {
  cats: Category[]; tenants: TenantOpt[];
  /** Zonas que ya usan otros aliados, para sugerirlas. */
  zonas: string[];
  onCreado: (r: any) => void; onCancelar: () => void;
}) {
  const vacio = {
    name: '', email: '', ownerFullName: '', categoryId: '', city: '', zone: '', neighborhood: '', whatsapp: '',
    description: '', tenantId: '', password: '', password2: '', coverUrl: '', logoUrl: '',
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
    // Sin foto la ficha sale en la cartelera como un recuadro vacío, y es lo
    // primero que mira quien decide si ir o no.
    if (!f.coverUrl) return setErr('Adjuntá una foto del negocio.');
    if (f.password && f.password.length < 8) return setErr('La contraseña debe tener al menos 8 caracteres.');
    if (f.password && f.password !== f.password2) return setErr('Las dos contraseñas no coinciden.');
    setBusy(true);
    try {
      const body: any = {
        name: f.name.trim(), email: f.email.trim(), ownerFullName: f.ownerFullName.trim(),
        categoryId: f.categoryId || null, city: f.city.trim(), zone: f.zone.trim(), neighborhood: f.neighborhood.trim(),
        whatsapp: f.whatsapp,
        description: f.description, tenantId: f.tenantId || null,
        ...(f.password ? { password: f.password } : {}),
        coverUrl: f.coverUrl, logoUrl: f.logoUrl || null,
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
          <input style={inp} value={f.city} onChange={(e) => set('city', e.target.value)} placeholder="Bucaramanga" />
        </Campo>
        <Campo label="Zona">
          <input style={inp} list="zonas-cuponera" value={f.zone} onChange={(e) => set('zone', e.target.value)} placeholder="Norte, Centro…" />
          <datalist id="zonas-cuponera">
            {zonas.map((z) => <option key={z} value={z} />)}
          </datalist>
        </Campo>
        <Campo label="Barrio">
          <input style={inp} value={f.neighborhood} onChange={(e) => set('neighborhood', e.target.value)} placeholder="Cabecera" />
        </Campo>
        <Campo label="WhatsApp">
          {/* Con selector de país: escrito a mano salían números sin prefijo
              o con el +57 duplicado, que después no se pueden llamar. */}
          <PhoneInput value={f.whatsapp} onChange={(v) => set('whatsapp', v)} />
        </Campo>
        <div style={{ gridColumn: '1 / -1' }}>
          <Campo label="Descripción">
            <input style={inp} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Café de origen en el centro" />
          </Campo>
        </div>
        <Campo label="Foto del negocio *">
          <ImageUploader value={f.coverUrl || null} onChange={(url) => set('coverUrl', url || '')}
            folder="covers" crop={false} minDimensionWarn={false} />
          <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 4 }}>La que se ve grande en la cartelera. Horizontal.</div>
        </Campo>
        <Campo label="Logo">
          <ImageUploader value={f.logoUrl || null} onChange={(url) => set('logoUrl', url || '')}
            folder="logos" crop={false} minDimensionWarn={false} />
          <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 4 }}>Opcional. Cuadrado y con fondo claro.</div>
        </Campo>
        <Campo label="Contraseña de acceso">
          <input type="password" autoComplete="new-password" style={inp} value={f.password}
            onChange={(e) => set('password', e.target.value)} placeholder="Mínimo 8 caracteres" />
        </Campo>
        <Campo label="Repetir contraseña">
          <input type="password" autoComplete="new-password" style={inp} value={f.password2}
            onChange={(e) => set('password2', e.target.value)} />
        </Campo>
        <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: '#64748b', marginTop: -4 }}>
          Si la dejás vacía se genera una y se muestra una sola vez al crear el aliado.
        </div>
      </div>

      {tenants.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <Campo label="¿Ya es cliente de la plataforma?">
            <BuscadorNegocio tenants={tenants} value={f.tenantId} onChange={(id) => set('tenantId', id)} />
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

/**
 * Clave nueva para un aliado. Es el camino cuando el negocio olvidó la suya:
 * la recuperación por correo todavía no sale con la marca de la cuponera.
 */
function ClaveAliado({
  ally, qs, flash, onListo,
}: { ally: Ally; qs: string; flash: (m: string) => void; onListo: () => void }) {
  const [f, setF] = useState({ a: '', b: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function guardar() {
    setErr(null);
    if (f.a.length < 8) return setErr('Mínimo 8 caracteres.');
    if (f.a !== f.b) return setErr('Las dos contraseñas no coinciden.');
    setBusy(true);
    try {
      const r = await api<{ loginEmails: string[] }>(`/cuponera/panel/allies/${ally.id}/password${qs}`, {
        method: 'PATCH', body: JSON.stringify({ password: f.a }),
      });
      flash(`Contraseña de ${ally.name} cambiada. Entra con ${r?.loginEmails?.join(' o ') || 'su correo'} y la clave nueva.`);
      onListo();
    } catch (e: any) { setErr(e?.message || 'No se pudo cambiar la contraseña.'); }
    finally { setBusy(false); }
  }
  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, marginTop: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>Nueva contraseña para {ally.name}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10 }}>
        <input type="password" autoComplete="new-password" style={inp} placeholder="Contraseña nueva" value={f.a} onChange={(e) => setF({ ...f, a: e.target.value })} />
        <input type="password" autoComplete="new-password" style={inp} placeholder="Repetirla" value={f.b} onChange={(e) => setF({ ...f, b: e.target.value })} />
      </div>
      <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 6 }}>
        La anterior deja de servir y las sesiones abiertas se cierran. Pasásela al negocio por un canal privado.
      </div>
      {err && <div style={{ color: '#b91c1c', fontSize: 12.5, marginTop: 6 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button onClick={guardar} disabled={busy} style={{ ...btn(), padding: '7px 13px' }}>{busy ? 'Guardando…' : 'Guardar contraseña'}</button>
        <button onClick={onListo} style={{ ...btn('#eef2f7', '#111827'), padding: '7px 13px' }}>Cancelar</button>
      </div>
    </div>
  );
}

type VistaFamilia = {
  max: number; usados: number;
  titular: { fullName: string; usable: boolean };
  links: { id: string; fullName: string; phone: string | null; email: string | null; status: string }[];
};

/**
 * Plan familiar de un beneficiario: sus tarjetas enlazadas. Cada familiar
 * recibe SU tarjeta con su propio QR; todas viven y mueren con la suscripción
 * del titular. Quitar un enlace libera el cupo en el acto.
 */
function FamiliaDe({ membershipId, qs, flash }: { membershipId: string; qs: string; flash: (m: string) => void }) {
  const [v, setV] = useState<VistaFamilia | null>(null);
  const [f, setF] = useState({ fullName: '', phone: '', email: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<VistaFamilia>(`/cuponera/panel/members/${membershipId}/links${qs}`).then(setV).catch(() => setV(null));
  }, [membershipId, qs]);

  async function agregar() {
    if (!f.fullName.trim()) return flash('El familiar necesita un nombre.');
    if (!f.phone.trim() && !f.email.trim()) return flash('Dejá un teléfono o un correo: sin eso no hay cómo entregarle la tarjeta.');
    setBusy(true);
    try {
      setV(await api<VistaFamilia>(`/cuponera/panel/members/${membershipId}/links${qs}`, {
        method: 'POST',
        body: JSON.stringify({ fullName: f.fullName.trim(), phone: f.phone, email: f.email || undefined }),
      }));
      setF({ fullName: '', phone: '', email: '' });
      flash('Familiar enlazado: su tarjeta ya está emitida.');
    } catch (e: any) { flash(e?.message || 'No se pudo enlazar.'); }
    finally { setBusy(false); }
  }

  async function quitar(l: VistaFamilia['links'][number]) {
    if (!confirm(`¿Quitar a ${l.fullName} del plan familiar? Su tarjeta deja de canjear y el cupo queda libre.`)) return;
    try {
      setV(await api<VistaFamilia>(`/cuponera/panel/members/${membershipId}/links/${l.id}${qs}`, { method: 'DELETE' }));
      flash('Enlace quitado.');
    } catch (e: any) { flash(e?.message || 'No se pudo quitar.'); }
  }

  if (!v) return <div style={{ fontSize: 12.5, color: '#94a3b8', padding: '8px 0' }}>Cargando familia…</div>;

  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, marginTop: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>
        Plan familiar · {v.usados} de {v.max} {v.max === 1 ? 'tarjeta enlazada' : 'tarjetas enlazadas'}
      </div>
      {v.links.map((l) => (
        <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #eef2f7', fontSize: 13 }}>
          <span><b>{l.fullName}</b> <span style={{ color: '#6b7280' }}>· {l.phone || l.email || '—'}</span></span>
          <button onClick={() => quitar(l)} style={{ ...btn('#fee2e2', '#991b1b'), padding: '5px 11px', fontSize: 12 }}>Quitar</button>
        </div>
      ))}
      {!v.titular.usable ? (
        <div style={{ fontSize: 11.5, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '7px 10px', marginTop: 8 }}>
          La membresía del titular no está al día: hasta que renueve no se pueden agregar familiares.
        </div>
      ) : v.usados < v.max ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10 }}>
            <input style={inp} placeholder="Nombre del familiar *" value={f.fullName}
              onChange={(e) => setF({ ...f, fullName: e.target.value })} />
            <PhoneInput value={f.phone} onChange={(v2) => setF({ ...f, phone: v2 })} />
            <input style={inp} placeholder="Email (opcional)" value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })} />
          </div>
          <button onClick={agregar} disabled={busy} style={{ ...btn(), marginTop: 10, padding: '7px 13px' }}>
            {busy ? 'Enlazando…' : 'Enlazar y emitir su tarjeta'}
          </button>
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 8 }}>
          Cupo completo. Para cambiar a alguien, quitá un enlace y agregá al nuevo.
        </div>
      )}
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
      setErr(e?.message || 'No se pudo agregar el beneficiario.');
    } finally { setBusy(false); }
  }

  return (
    <div style={{ ...card, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
      <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 12 }}>Agregar un beneficiario</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
        <Campo label="Nombre *"><input style={inp} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Campo>
        <Campo label="Teléfono"><PhoneInput value={f.phone} onChange={(v) => setF({ ...f, phone: v })} /></Campo>
        <Campo label="Email"><input style={inp} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Campo>
        <Campo label="Plan">
          <select style={inp} value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })}>
            <option value="">Sin plan</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {money(p.priceCents, p.currency)}{(p.maxLinkedMembers ?? 0) > 0 ? ` · familiar +${p.maxLinkedMembers}` : ''}
              </option>
            ))}
          </select>
        </Campo>
      </div>
      <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 8 }}>
        Se le emite la tarjeta al instante. Puede recuperarla en <b>Mi tarjeta</b> con el mismo teléfono o correo.
      </div>
      {err && <div style={{ marginTop: 12, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 9, padding: '9px 12px', fontSize: 12.5 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={crear} disabled={busy} style={btn()}>{busy ? 'Agregando…' : 'Agregar beneficiario'}</button>
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
  const [nuevoPlan, setNuevoPlan] = useState({ name: '', priceCents: 0, interval: 'MONTHLY' as const, maxLinkedMembers: 0 });
  const [busy, setBusy] = useState(false);
  // Edición en línea: una categoría o un plan a la vez.
  const [catEdit, setCatEdit] = useState<{ id: string; name: string; icon: string } | null>(null);
  const [planEdit, setPlanEdit] = useState<{
    id: string; name: string; priceCents: number; interval: 'MONTHLY' | 'ANNUAL'; description: string;
    maxLinkedMembers: number;
  } | null>(null);
  const [nombre, setNombre] = useState('');
  useEffect(() => { if (cfg) setNombre(cfg.name); }, [cfg?.name]);

  useEffect(() => {
    api<Settings>(`/cuponera/panel/settings${qs}`).then(setCfg).catch(() => setCfg(null));
  }, [qs]);

  async function guardarCfg(patch: Partial<Settings>) {
    setBusy(true);
    try {
      setCfg(await api<Settings>(`/cuponera/panel/settings${qs}`, { method: 'PATCH', body: JSON.stringify(patch) }));
      flash('Ajustes guardados');
    } catch (e: any) {
      flash(e?.message || 'No se pudieron guardar los ajustes');
    } finally { setBusy(false); }
  }

  async function crearCat() {
    if (!nuevaCat.name.trim()) return;
    await api(`/cuponera/panel/categories${qs}`, { method: 'POST', body: JSON.stringify(nuevaCat) });
    setNuevaCat({ name: '', icon: '' });
    await onCambio();
    flash('Categoría creada');
  }

  async function guardarCat() {
    if (!catEdit || !catEdit.name.trim()) return flash('La categoría necesita un nombre');
    try {
      await api(`/cuponera/panel/categories/${catEdit.id}${qs}`, {
        method: 'PATCH', body: JSON.stringify({ name: catEdit.name.trim(), icon: catEdit.icon }),
      });
      setCatEdit(null);
      await onCambio();
      flash('Categoría actualizada');
    } catch (e: any) { flash(e?.message || 'No se pudo guardar la categoría'); }
  }

  async function guardarPlan() {
    if (!planEdit || !planEdit.name.trim()) return flash('El plan necesita un nombre');
    try {
      await api(`/cuponera/panel/plans/${planEdit.id}${qs}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: planEdit.name.trim(),
          priceCents: Math.round(Math.max(0, Number(planEdit.priceCents) || 0)),
          interval: planEdit.interval,
          description: planEdit.description,
          maxLinkedMembers: Math.min(20, Math.max(0, Math.round(Number(planEdit.maxLinkedMembers) || 0))),
        }),
      });
      setPlanEdit(null);
      await onCambio();
      flash('Plan actualizado. El precio nuevo rige para las compras que vienen.');
    } catch (e: any) { flash(e?.message || 'No se pudo guardar el plan'); }
  }

  async function guardarNombre() {
    if (!cfg || !nombre.trim() || nombre.trim() === cfg.name) return;
    await guardarCfg({ name: nombre.trim() });
    // El nombre sale en la cabecera del panel, que vive en el padre.
    await onCambio();
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
    setNuevoPlan({ name: '', priceCents: 0, interval: 'MONTHLY', maxLinkedMembers: 0 });
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
        {cats.map((c) => catEdit?.id === c.id ? (
          <div key={c.id} style={{ display: 'flex', gap: 8, padding: '8px 0', borderBottom: '1px solid #f3f4f6', flexWrap: 'wrap' }}>
            <input style={{ ...inp, width: 70 }} maxLength={2} value={catEdit.icon}
              onChange={(e) => setCatEdit({ ...catEdit, icon: e.target.value })} />
            <input style={{ ...inp, flex: 1, minWidth: 160 }} value={catEdit.name} autoFocus
              onChange={(e) => setCatEdit({ ...catEdit, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') void guardarCat(); }} />
            <button onClick={guardarCat} style={{ ...btn(), padding: '5px 11px', fontSize: 12 }}>Guardar</button>
            <button onClick={() => setCatEdit(null)} style={{ ...btn('#eef2f7', '#111827'), padding: '5px 11px', fontSize: 12 }}>Cancelar</button>
          </div>
        ) : (
          <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
            <span style={{ fontSize: 13.5 }}>{c.icon ? `${c.icon} ` : ''}{c.name}</span>
            <div style={{ display: 'flex', gap: 7 }}>
              <button onClick={() => setCatEdit({ id: c.id, name: c.name, icon: c.icon || '' })} style={{ ...btn('#eef2f7', '#111827'), padding: '5px 11px', fontSize: 12 }}>Editar</button>
              <button onClick={() => borrarCat(c)} style={{ ...btn('#fee2e2', '#991b1b'), padding: '5px 11px', fontSize: 12 }}>Eliminar</button>
            </div>
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
          El último campo son los <b>enlaces familiares</b>: cuántas tarjetas más puede
          enlazar el titular a su suscripción (0 = plan individual).
        </div>
        {plans.map((p) => planEdit?.id === p.id ? (
          <div key={p.id} style={{ padding: '10px 0', borderBottom: '1px solid #f3f4f6' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8 }}>
              <Campo label="Nombre">
                <input style={inp} value={planEdit.name} onChange={(e) => setPlanEdit({ ...planEdit, name: e.target.value })} />
              </Campo>
              <Campo label={`Precio (${p.currency})`}>
                <input type="number" min={0} style={inp} value={planEdit.priceCents}
                  onChange={(e) => setPlanEdit({ ...planEdit, priceCents: Number(e.target.value) })} />
              </Campo>
              <Campo label="Cobro">
                <select style={inp} value={planEdit.interval}
                  onChange={(e) => setPlanEdit({ ...planEdit, interval: e.target.value as 'MONTHLY' | 'ANNUAL' })}>
                  <option value="MONTHLY">Mensual</option>
                  <option value="ANNUAL">Anual</option>
                </select>
              </Campo>
              <Campo label="Enlaces familiares (0 = individual)">
                <input type="number" min={0} max={20} style={inp} value={planEdit.maxLinkedMembers}
                  onChange={(e) => setPlanEdit({ ...planEdit, maxLinkedMembers: Number(e.target.value) })} />
              </Campo>
              <div style={{ gridColumn: '1 / -1' }}>
                <Campo label="Descripción">
                  <input style={inp} maxLength={280} value={planEdit.description}
                    onChange={(e) => setPlanEdit({ ...planEdit, description: e.target.value })} />
                </Campo>
              </div>
            </div>
            <div style={{ fontSize: 11.5, color: '#92400e', marginTop: 6 }}>
              Si cobrás por Hotmart o Stripe, cambiá el precio también allá: esto no modifica el producto de la pasarela.
            </div>
            <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>
              <button onClick={guardarPlan} style={{ ...btn(), padding: '6px 12px', fontSize: 12 }}>Guardar</button>
              <button onClick={() => setPlanEdit(null)} style={{ ...btn('#eef2f7', '#111827'), padding: '6px 12px', fontSize: 12 }}>Cancelar</button>
            </div>
          </div>
        ) : (
          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '9px 0', borderBottom: '1px solid #f3f4f6' }}>
            <div>
              <b style={{ fontSize: 13.5 }}>{p.name}</b>
              <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 8 }}>
                {p.priceCents > 0 ? money(p.priceCents, p.currency) : 'Gratis'}
                {p.interval === 'ANNUAL' ? ' / año' : p.priceCents > 0 ? ' / mes' : ''}
                {(p.maxLinkedMembers ?? 0) > 0 ? ` · familiar: +${p.maxLinkedMembers}` : ''}
                {p.isActive === false ? ' · inactivo' : ''}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 7 }}>
              <button
                onClick={() => setPlanEdit({
                  id: p.id, name: p.name, priceCents: p.priceCents,
                  interval: p.interval === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY', description: p.description || '',
                  maxLinkedMembers: p.maxLinkedMembers ?? 0,
                })}
                style={{ ...btn('#eef2f7', '#111827'), padding: '5px 11px', fontSize: 12 }}
              >
                Editar
              </button>
              <button onClick={() => togglePlan(p)} style={{ ...btn('#eef2f7', '#111827'), padding: '5px 11px', fontSize: 12 }}>
                {p.isActive === false ? 'Activar' : 'Desactivar'}
              </button>
              <button onClick={() => borrarPlan(p)} style={{ ...btn('#fee2e2', '#991b1b'), padding: '5px 11px', fontSize: 12 }}>Eliminar</button>
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <input style={{ ...inp, flex: 1, minWidth: 150 }} value={nuevoPlan.name}
            onChange={(e) => setNuevoPlan({ ...nuevoPlan, name: e.target.value })} placeholder="Cuponera Card Mensual" />
          <input type="number" style={{ ...inp, width: 130 }} value={nuevoPlan.priceCents}
            onChange={(e) => setNuevoPlan({ ...nuevoPlan, priceCents: Number(e.target.value) })} placeholder="50000" />
          <select style={{ ...inp, width: 120 }} value={nuevoPlan.interval}
            onChange={(e) => setNuevoPlan({ ...nuevoPlan, interval: e.target.value as any })}>
            <option value="MONTHLY">Mensual</option>
            <option value="ANNUAL">Anual</option>
          </select>
          <input type="number" min={0} max={20} title="Enlaces familiares (0 = plan individual)"
            style={{ ...inp, width: 90 }} value={nuevoPlan.maxLinkedMembers}
            onChange={(e) => setNuevoPlan({ ...nuevoPlan, maxLinkedMembers: Number(e.target.value) })} />
          <button onClick={crearPlan} style={btn()}>Agregar</button>
        </div>
      </div>

      {cfg && (
        <div style={card}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 12 }}>Ajustes</div>

          <div style={{ marginBottom: 14 }}>
            <Campo label="Nombre de la cuponera">
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={inp} maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void guardarNombre(); }} />
                {nombre.trim() && nombre.trim() !== cfg.name && (
                  <button onClick={guardarNombre} disabled={busy} style={btn()}>Guardar</button>
                )}
              </div>
            </Campo>
            <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 5 }}>
              Es el nombre que se ve en el panel y en la cartelera. El enlace de la cuponera no cambia.
            </div>
          </div>

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

      {cfg && <PaginaOficialHtml cfg={cfg} busy={busy} guardar={guardarCfg} campo="officialPageHtml" />}
      {cfg && <PaginaOficialHtml cfg={cfg} busy={busy} guardar={guardarCfg} campo="directoryPageHtml" />}
    </>
  );
}

type Geopunto = {
  id: string; name: string; latitude: number | string | null; longitude: number | string | null;
  radiusMeters: number | null; address: string | null;
  /** 'aliado:<sede>' = el punto lo maneja la sede de ese aliado, no esta pantalla. */
  externalId?: string | null; walletRelevantText?: string | null;
};
const esDeAliado = (g: Geopunto) => !!g.externalId?.startsWith('aliado:');
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
  const [nuevoPunto, setNuevoPunto] = useState({ name: '', radiusMeters: 300, walletRelevantText: '' });
  const [lugar, setLugar] = useState<MapPickResult | null>(null);
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
    if (!lugar) { flash('Marcá el lugar en el mapa.'); return; }
    const name = nuevoPunto.name.trim() || lugar.name;
    try {
      await api(`/cuponera/panel/geopush${qs}`, {
        method: 'POST',
        body: JSON.stringify({
          name: name.slice(0, 80),
          address: lugar.address.slice(0, 200),
          latitude: lugar.lat, longitude: lugar.lng,
          radiusMeters: Number(nuevoPunto.radiusMeters) || 300,
          ...(nuevoPunto.walletRelevantText.trim() ? { walletRelevantText: nuevoPunto.walletRelevantText.trim() } : {}),
        }),
      });
      setNuevoPunto({ name: '', radiusMeters: 300, walletRelevantText: '' });
      setLugar(null);
      await cargar();
      flash('Punto creado');
    } catch (e: any) { flash(e?.message || 'No se pudo crear el punto.'); }
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
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 3 }}>GeoPush</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
          El aviso aparece al pasar cerca del punto. Cada aliado tiene el suyo en <b>Aliados → Sedes y GeoPush</b>;
          acá podés sumar puntos de la cuponera, como una zona comercial.
        </div>
        {puntos.length > 10 && (
          <div style={{ fontSize: 11.5, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
            Hay {puntos.length} puntos y Apple Wallet usa como máximo 10 por tarjeta: en iPhone algunos no van a avisar.
          </div>
        )}
        {puntos.map((g) => (
          <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '9px 0', borderBottom: '1px solid #f3f4f6' }}>
            <div>
              <b style={{ fontSize: 13.5 }}>{g.name}</b>
              {esDeAliado(g) && (
                <span style={{ marginLeft: 8, background: '#e0f2fe', color: '#075985', padding: '1px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 700 }}>Sede de aliado</span>
              )}
              <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2 }}>
                {g.address || `${Number(g.latitude ?? 0).toFixed(5)}, ${Number(g.longitude ?? 0).toFixed(5)}`} · radio {g.radiusMeters ?? 300} m
              </div>
              {g.walletRelevantText && (
                <div style={{ fontSize: 11.5, color: '#334155', marginTop: 2, fontStyle: 'italic' }}>“{g.walletRelevantText}”</div>
              )}
            </div>
            {esDeAliado(g)
              ? <span style={{ fontSize: 11.5, color: '#94a3b8' }}>Se cambia desde su aliado</span>
              : <button onClick={() => borrarPunto(g)} style={{ ...btn('#fee2e2', '#991b1b'), padding: '5px 11px', fontSize: 12 }}>Eliminar</button>}
          </div>
        ))}
        <div style={{ marginTop: 14 }}>
          <label style={lbl}>Nuevo punto</label>
          <MapPicker height={300} picked={lugar} onPick={setLugar} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginTop: 12 }}>
          <Campo label="Nombre"><input style={inp} value={nuevoPunto.name} onChange={(e) => setNuevoPunto({ ...nuevoPunto, name: e.target.value })} placeholder={lugar?.name || 'Zona Rosa'} /></Campo>
          <Campo label="Radio (m)"><input type="number" style={inp} value={nuevoPunto.radiusMeters} onChange={(e) => setNuevoPunto({ ...nuevoPunto, radiusMeters: Number(e.target.value) })} /></Campo>
          <div style={{ gridColumn: '1 / -1' }}>
            <Campo label="Mensaje del aviso"><input style={inp} maxLength={120} value={nuevoPunto.walletRelevantText} onChange={(e) => setNuevoPunto({ ...nuevoPunto, walletRelevantText: e.target.value })} placeholder="Estás en la zona de los aliados: mirá tus beneficios" /></Campo>
          </div>
          <div><button onClick={crearPunto} disabled={!lugar} style={{ ...btn(), opacity: lugar ? 1 : 0.5 }}>Agregar punto</button></div>
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


// ───────────────────────────────────────────────────────────────────────────
// Tarjeta y cobro.
//
// Vivían solo en /superadmin/living-card, que editaba SIEMPRE la primera
// cuponera. Acá van con `qs` (?campaignId=), así que cada cuponera diseña su
// tarjeta y conecta su cobro. Al unificar las dos pantallas del Master Admin,
// esto es lo que había que traer para no perder capacidad.
// ───────────────────────────────────────────────────────────────────────────

type CardWallet = {
  id: string; name: string;
  primaryColor?: string | null; secondaryColor?: string | null;
  logoUrl?: string | null; heroImageUrl?: string | null;
  rewardText?: string | null; howToEarnText?: string | null; terms?: string | null;
};

function TabTarjeta({ qs, flash }: { qs: string; flash: (m: string) => void }) {
  const [tarjeta, setTarjeta] = useState<CardWallet | null>(null);
  const [cargando, setCargando] = useState(true);
  const [f, setF] = useState({
    name: '', primaryColor: '#0a90bd', secondaryColor: '#075e7d',
    logoUrl: '', heroImageUrl: '', rewardText: '', howToEarnText: '', terms: '',
  });
  const [guardando, setGuardando] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    setCargando(true);
    api<CardWallet>(`/cuponera/panel/card${qs}`)
      .then((c) => {
        setTarjeta(c);
        setF({
          name: c?.name || '', primaryColor: c?.primaryColor || '#0a90bd',
          secondaryColor: c?.secondaryColor || '#075e7d', logoUrl: c?.logoUrl || '',
          heroImageUrl: c?.heroImageUrl || '', rewardText: c?.rewardText || '',
          howToEarnText: c?.howToEarnText || '', terms: c?.terms || '',
        });
      })
      .catch(() => setTarjeta(null))
      .finally(() => setCargando(false));
  }, [qs]);

  async function guardar() {
    setGuardando(true);
    try {
      const c = await api<CardWallet>(`/cuponera/panel/card${qs}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: f.name, primaryColor: f.primaryColor, secondaryColor: f.secondaryColor,
          logoUrl: f.logoUrl || undefined, heroImageUrl: f.heroImageUrl || undefined,
          rewardText: f.rewardText, howToEarnText: f.howToEarnText, terms: f.terms,
        }),
      });
      setTarjeta(c);
      flash('Tarjeta actualizada — el cambio llega a los pases ya emitidos');
    } finally { setGuardando(false); }
  }

  if (cargando) return <div style={card}>Cargando la tarjeta…</div>;

  return (
    <div style={card}>
      <div style={{ fontWeight: 800, fontSize: 15 }}>Diseño de la tarjeta (Wallet)</div>
      <div style={{ fontSize: 12.5, color: '#64748b', margin: '2px 0 16px' }}>
        Es la tarjeta que el beneficiario guarda en Apple o Google Wallet. Guardar
        cambia también las que ya están en el bolsillo de la gente.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(220px,1fr)', gap: 20 }}>
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Campo label="Nombre en la tarjeta">
              <input style={inp} value={f.name} onChange={(e) => set('name', e.target.value)} />
            </Campo>
            <Campo label="Beneficio principal">
              <input style={inp} value={f.rewardText} onChange={(e) => set('rewardText', e.target.value)}
                placeholder="Beneficios exclusivos para miembros" />
            </Campo>
            <Campo label="Color de fondo">
              <input type="color" style={{ ...inp, height: 40, padding: 4 }} value={f.primaryColor}
                onChange={(e) => set('primaryColor', e.target.value)} />
            </Campo>
            <Campo label="Color secundario">
              <input type="color" style={{ ...inp, height: 40, padding: 4 }} value={f.secondaryColor}
                onChange={(e) => set('secondaryColor', e.target.value)} />
            </Campo>
            {/* Solo adjuntar: pedir una URL obligaba a subir la imagen a otro
                sitio primero, y un enlace que después se cae deja la tarjeta
                sin logo en el celular de todos. */}
            <Campo label="Logo">
              <ImageUploader value={f.logoUrl || null} onChange={(url) => set('logoUrl', url || '')}
                folder="logos" crop={false} minDimensionWarn={false} />
            </Campo>
            <Campo label="Imagen principal">
              <ImageUploader value={f.heroImageUrl || null} onChange={(url) => set('heroImageUrl', url || '')}
                folder="covers" crop={false} minDimensionWarn={false} />
            </Campo>
          </div>
          <div style={{ marginTop: 14 }}>
            <Campo label="Cómo funciona">
              <input style={inp} value={f.howToEarnText} onChange={(e) => set('howToEarnText', e.target.value)} />
            </Campo>
          </div>
          <div style={{ marginTop: 14 }}>
            <Campo label="Términos y condiciones">
              <textarea style={{ ...inp, minHeight: 60 }} value={f.terms}
                onChange={(e) => set('terms', e.target.value)} />
            </Campo>
          </div>
          <button style={{ ...btn(), marginTop: 16 }} disabled={guardando} onClick={guardar}>
            {guardando ? 'Guardando…' : tarjeta ? 'Actualizar tarjeta' : 'Crear tarjeta'}
          </button>
        </div>

        <div>
          <label style={lbl}>Vista previa</label>
          <div style={{
            borderRadius: 16, padding: 18, minHeight: 180, color: '#fff',
            background: `linear-gradient(135deg, ${f.primaryColor}, ${f.secondaryColor})`,
            boxShadow: '0 10px 24px rgba(0,0,0,.18)', display: 'flex',
            flexDirection: 'column', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {f.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.logoUrl} alt="logo" style={{ width: 38, height: 38, borderRadius: 8, objectFit: 'contain', background: '#fff' }} />
              ) : (
                <div style={{ width: 38, height: 38, borderRadius: 8, background: 'rgba(255,255,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>
                  {f.name[0]?.toUpperCase() || '·'}
                </div>
              )}
              <div style={{ fontWeight: 800, fontSize: 15 }}>{f.name || 'Sin nombre'}</div>
            </div>
            <div>
              <div style={{ fontSize: 12.5, opacity: 0.9 }}>{f.rewardText}</div>
              <div style={{ marginTop: 10, background: '#fff', width: 90, height: 90, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#111', fontSize: 10 }}>QR</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type GwPlan = {
  id: string; name: string; priceCents: number; currency: string; interval: string; isActive: boolean;
  hotmartProductId: string | null; hotmartOfferCode: string | null; stripePriceId: string | null;
  hotmartCheckoutUrl: string | null; stripeCheckoutUrl: string | null;
};
type GwStatus = {
  hotmart: { webhookUrl: string; planesMapeados: number; listo: boolean };
  stripe: { webhookUrl: string; planesMapeados: number; listo: boolean };
  mercadopago: { webhookUrl: string; configurado: boolean };
  planes: GwPlan[];
};
type MpStatus = {
  configured: boolean; webhookUrl: string;
  /** 'oauth' = conectado con el botón; 'manual' = credenciales pegadas. */
  via?: 'oauth' | 'manual' | null;
  userId?: string | null; expiresAt?: string | null;
  /** La plataforma tiene su aplicación de MP: el botón se puede ofrecer. */
  oauthAvailable?: boolean;
};

/** Mensajes con los que vuelve el callback de «Conectar con MercadoPago». */
const AVISOS_MP: Record<string, string> = {
  conectado: 'MercadoPago quedó conectado: esta cuponera ya puede cobrar suscripciones.',
  rechazado: 'La conexión con MercadoPago se canceló antes de autorizar. Podés intentarlo de nuevo.',
  estado_invalido: 'El enlace de conexión venció. Tocá «Conectar con MercadoPago» otra vez.',
  error_token: 'MercadoPago no entregó las credenciales. Intentalo de nuevo en un momento.',
  sin_configurar: 'La conexión con un clic no está configurada en la plataforma todavía.',
};

/** Cobro: MercadoPago (propio de la cuponera) + el mapeo a Hotmart y Stripe. */
function BloqueCobro({ qs, flash }: { qs: string; flash: (m: string) => void }) {
  const [gw, setGw] = useState<GwStatus | null>(null);
  const [mp, setMp] = useState<MpStatus | null>(null);
  const [cred, setCred] = useState({ accessToken: '', publicKey: '', webhookSecret: '' });
  const [edit, setEdit] = useState<Record<string, Partial<GwPlan>>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const cargar = () => {
    api<GwStatus>(`/cuponera/panel/gateways${qs}`).then(setGw).catch(() => setGw(null));
    api<MpStatus>(`/cuponera/panel/mercadopago${qs}`).then(setMp).catch(() => setMp(null));
  };
  useEffect(cargar, [qs]);

  const campo = (p: GwPlan, k: keyof GwPlan) =>
    (edit[p.id]?.[k] as string | undefined) ?? ((p[k] as string | null) ?? '');
  const set = (id: string, k: keyof GwPlan, v: string) =>
    setEdit((e) => ({ ...e, [id]: { ...e[id], [k]: v } }));

  async function guardarPlan(p: GwPlan) {
    const cambios = edit[p.id];
    if (!cambios) return;
    setBusy(p.id);
    try {
      // null (no '') para DESmapear: con '' el webhook buscaría por cadena
      // vacía y no matchearía nunca.
      const body = Object.fromEntries(
        Object.entries(cambios).map(([k, v]) => [k, (v as string)?.trim() ? (v as string).trim() : null]),
      );
      await api(`/cuponera/panel/plans/${p.id}${qs}`, { method: 'PATCH', body: JSON.stringify(body) });
      setEdit((e) => { const n = { ...e }; delete n[p.id]; return n; });
      cargar();
      flash(`Pasarelas de "${p.name}" guardadas`);
    } finally { setBusy(null); }
  }

  async function conectarMp() {
    try {
      const r = await api<{ url: string }>(`/cuponera/panel/mercadopago/oauth-url${qs}`);
      if (r?.url) window.location.href = r.url;
      else flash('No se pudo iniciar la conexión con MercadoPago.');
    } catch (e: any) { flash(e?.message || 'No se pudo iniciar la conexión con MercadoPago.'); }
  }

  async function desconectarMp() {
    if (!confirm('¿Desconectar MercadoPago? Las suscripciones nuevas no se podrán cobrar hasta volver a conectar. Las ya activas siguen cobrándose en MercadoPago, pero los avisos dejarán de procesarse.')) return;
    setBusy('mp');
    try {
      await api(`/cuponera/panel/mercadopago${qs}`, { method: 'DELETE' });
      cargar();
      flash('MercadoPago desconectado.');
    } finally { setBusy(null); }
  }

  async function guardarMp() {
    setBusy('mp');
    try {
      const body: Record<string, string> = {};
      if (cred.accessToken) body.accessToken = cred.accessToken;
      if (cred.publicKey) body.publicKey = cred.publicKey;
      if (cred.webhookSecret) body.webhookSecret = cred.webhookSecret;
      await api(`/cuponera/panel/mercadopago${qs}`, { method: 'PATCH', body: JSON.stringify(body) });
      setCred({ accessToken: '', publicKey: '', webhookSecret: '' });
      cargar();
      flash('Credenciales de MercadoPago guardadas');
    } finally { setBusy(null); }
  }

  const chip = (ok: boolean, texto: string) => (
    <span style={{ fontSize: 12, fontWeight: 700, color: ok ? '#16a34a' : '#9ca3af' }}>
      {ok ? '✓' : '○'} {texto}
    </span>
  );

  return (
    <div style={card}>
      <div style={{ fontWeight: 800, fontSize: 15 }}>Integraciones con pasarelas</div>
      <div style={{ fontSize: 12.5, color: '#64748b', margin: '2px 0 14px' }}>
        Por dónde cobra esta cuponera. <b>MercadoPago</b> es la pasarela nativa:
        con sus credenciales, quien compra un plan queda suscrito y se le cobra
        solo cada período — si el cobro no llega, la tarjeta deja de canjear hasta
        que pague. Hotmart y Stripe funcionan mapeando cada plan a su producto.
        Sin ninguna configurada, los planes pagos no se pueden vender.
      </div>

      {gw && (
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 14 }}>
          {chip(gw.hotmart.listo, `Hotmart · ${gw.hotmart.planesMapeados} ${gw.hotmart.planesMapeados === 1 ? 'plan' : 'planes'}`)}
          {chip(gw.stripe.listo, `Stripe · ${gw.stripe.planesMapeados} ${gw.stripe.planesMapeados === 1 ? 'plan' : 'planes'}`)}
          {chip(!!mp?.configured, 'MercadoPago')}
        </div>
      )}

      {gw && (
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 18, lineHeight: 1.7 }}>
          <b>Webhooks.</b> Hotmart y Stripe cobran en la cuenta de la marca dueña de
          la cuponera, así que usan la ruta de esa marca — no hay que crear una nueva:
          <div style={{ marginTop: 6, wordBreak: 'break-all' }}>
            <code>{gw.hotmart.webhookUrl}</code><br />
            <code>{gw.stripe.webhookUrl}</code>
          </div>
          <div style={{ marginTop: 6, wordBreak: 'break-all' }}>
            MercadoPago sí es propio de esta cuponera: <code>{gw.mercadopago.webhookUrl}</code>
          </div>
        </div>
      )}

      {/* Mapeo plan ↔ producto de la pasarela */}
      {gw && gw.planes.length === 0 && (
        <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 18 }}>
          Todavía no hay planes que mapear. Creá uno arriba.
        </div>
      )}
      {gw?.planes.map((p) => (
        <div key={p.id} style={{ borderTop: '1px solid #f1f5f9', padding: '13px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 9 }}>
            <b style={{ fontSize: 13.5 }}>{p.name}</b>
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              {p.currency === 'COP' ? `$ ${p.priceCents.toLocaleString('es-CO')}` : `${p.currency} ${(p.priceCents / 100).toFixed(2)}`}
              {' · '}{p.interval === 'ANNUAL' ? 'anual' : 'mensual'}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>
            <Campo label="Hotmart — producto">
              <input style={inp} value={campo(p, 'hotmartProductId')} onChange={(e) => set(p.id, 'hotmartProductId', e.target.value)} />
            </Campo>
            <Campo label="Hotmart — oferta">
              <input style={inp} value={campo(p, 'hotmartOfferCode')} onChange={(e) => set(p.id, 'hotmartOfferCode', e.target.value)} />
            </Campo>
            <Campo label="Hotmart — link de compra">
              <input style={inp} value={campo(p, 'hotmartCheckoutUrl')} onChange={(e) => set(p.id, 'hotmartCheckoutUrl', e.target.value)} />
            </Campo>
            <Campo label="Stripe — price ID">
              <input style={inp} value={campo(p, 'stripePriceId')} onChange={(e) => set(p.id, 'stripePriceId', e.target.value)} />
            </Campo>
            <Campo label="Stripe — link de compra">
              <input style={inp} value={campo(p, 'stripeCheckoutUrl')} onChange={(e) => set(p.id, 'stripeCheckoutUrl', e.target.value)} />
            </Campo>
          </div>
          {edit[p.id] && (
            <button style={{ ...btn(), marginTop: 11 }} disabled={busy === p.id} onClick={() => guardarPlan(p)}>
              {busy === p.id ? 'Guardando…' : 'Guardar'}
            </button>
          )}
        </div>
      ))}

      {/* MercadoPago */}
      <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 18, paddingTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 3 }}>MercadoPago (suscripción recurrente)</div>

        {mp?.via === 'oauth' ? (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 14px', marginTop: 8, display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ fontSize: 13, color: '#166534' }}>
              <b>✓ Cuenta de MercadoPago conectada</b>{mp.userId ? ` · nº ${mp.userId}` : ''}
              <div style={{ fontSize: 11.5, color: '#15803d', marginTop: 2 }}>
                La conexión se renueva sola{mp.expiresAt ? ` (próximo vencimiento: ${new Date(mp.expiresAt).toLocaleDateString('es-CO')})` : ''}. El precio y la frecuencia de cada cobro los pone el plan que el cliente compra (Configuración → Planes).
              </div>
            </div>
            <button style={{ ...btn('#fee2e2', '#991b1b'), padding: '6px 12px', fontSize: 12 }} disabled={busy === 'mp'} onClick={desconectarMp}>
              Desconectar
            </button>
          </div>
        ) : mp?.oauthAvailable ? (
          <div style={{ marginTop: 8 }}>
            <button onClick={conectarMp}
              style={{ background: '#009ee3', color: '#fff', border: 'none', padding: '11px 20px', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
              Conectar con MercadoPago
            </button>
            <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 6 }}>
              Te lleva a iniciar sesión en MercadoPago y autorizar. No hay que copiar ninguna clave
              ni crear ningún producto en MercadoPago: el plan de la cuponera ES el producto — el
              precio y la frecuencia salen de Configuración → Planes de membresía.
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 11.5, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px', marginTop: 8 }}>
            El botón «Conectar con MercadoPago» estará disponible cuando la plataforma registre su
            aplicación de MP. Mientras tanto se puede conectar a mano, abajo.
          </div>
        )}

        <details style={{ marginTop: 12 }}>
          <summary style={{ fontSize: 12.5, color: '#64748b', cursor: 'pointer' }}>
            Conectar a mano (avanzado)
          </summary>
          <div style={{ fontSize: 12, color: '#64748b', margin: '10px 0 12px' }}>
            Para quien prefiere pegar sus credenciales de MercadoPago. Se guardan cifradas; dejar un
            campo vacío lo deja como estaba.
          </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12 }}>
          <Campo label="Access Token">
            <input style={inp} type="password" placeholder="APP_USR-…" value={cred.accessToken}
              onChange={(e) => setCred({ ...cred, accessToken: e.target.value })} />
          </Campo>
          <Campo label="Public Key">
            <input style={inp} placeholder="APP_USR-…" value={cred.publicKey}
              onChange={(e) => setCred({ ...cred, publicKey: e.target.value })} />
          </Campo>
          <Campo label="Webhook Secret">
            <input style={inp} type="password" placeholder="clave de firma" value={cred.webhookSecret}
              onChange={(e) => setCred({ ...cred, webhookSecret: e.target.value })} />
          </Campo>
        </div>
        <button style={{ ...btn(), marginTop: 14 }} disabled={busy === 'mp'} onClick={guardarMp}>
          {busy === 'mp' ? 'Guardando…' : 'Guardar credenciales'}
        </button>
        </details>
      </div>
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
  const [cats, setCats] = useState<Category[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [bens, setBens] = useState<PanelBenefit[]>([]);
  const [tenants, setTenants] = useState<TenantOpt[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [nuevoAliado, setNuevoAliado] = useState(false);
  const [nuevoMiembro, setNuevoMiembro] = useState(false);
  // Beneficiario con el plan familiar abierto (uno a la vez).
  const [familiaDe, setFamiliaDe] = useState<string | null>(null);
  // Un aliado abierto a la vez, en sus sedes o en el cambio de contraseña.
  const [abierto, setAbierto] = useState<{ id: string; que: 'sedes' | 'clave' } | null>(null);
  const [logins, setLogins] = useState<Record<string, string[]>>({});
  const toggleAbierto = (id: string, que: 'sedes' | 'clave') =>
    setAbierto((a) => (a?.id === id && a.que === que ? null : { id, que }));

  const flash = (m: string) => { setAviso(m); setTimeout(() => setAviso(null), 6000); };

  // Qué recursos ya se pidieron. Si una carga falla, la clave se libera para
  // que volver a entrar a la pestaña reintente en vez de mostrar listas vacías
  // para siempre.
  const cargados = useRef<Set<Recurso>>(new Set());
  const fetchers: Record<Recurso, () => Promise<void>> = {
    allies: () => api(`/cuponera/panel/allies${qs}`).then((a) => setAllies((a as Ally[]) ?? [])),
    members: () => api(`/cuponera/panel/members${qs}`).then((m) => setMembers((m as Member[]) ?? [])),
    reds: () => api(`/cuponera/panel/redemptions${qs}`).then((r) => setReds((r as Redemption[]) ?? [])),
    cats: () => api(`/cuponera/panel/categories${qs}`).then((c) => setCats((c as Category[]) ?? [])),
    plans: () => api(`/cuponera/panel/plans${qs}`).then((p) => setPlans((p as Plan[]) ?? [])),
    bens: () => api(`/cuponera/panel/benefits${qs}`).then((b) => setBens((b as PanelBenefit[]) ?? [])),
    tenants: () => api(`/cuponera/panel/tenant-options${qs}`).then((t) => setTenants((t as TenantOpt[]) ?? [])),
    logins: () => api(`/cuponera/panel/ally-logins${qs}`).then((lg) => setLogins((lg as Record<string, string[]>) ?? {})),
  };
  const asegurar = (claves: Recurso[]) => {
    for (const k of claves) {
      if (cargados.current.has(k)) continue;
      cargados.current.add(k);
      void fetchers[k]().catch((e: any) => {
        cargados.current.delete(k);
        flash(e?.message || 'No se pudo cargar una parte del panel.');
      });
    }
  };
  const abrirTab = (t: Tab) => { setTab(t); asegurar(RECURSOS_POR_TAB[t]); };

  const recargarConfig = async () => {
    (['cats', 'plans'] as Recurso[]).forEach((k) => cargados.current.add(k));
    const [ct, pl, o] = await Promise.all([
      api(`/cuponera/panel/categories${qs}`).catch(() => null),
      api(`/cuponera/panel/plans${qs}`).catch(() => null),
      // La cabecera muestra el nombre de la cuponera, que se edita en Ajustes.
      api(`/cuponera/panel/overview${qs}`).catch(() => null),
    ]);
    setCats((ct as Category[]) ?? []);
    setPlans((pl as Plan[]) ?? []);
    if (o) setOv(o as Overview);
  };

  // Recarga puntual: tras crear o aprobar algo hay que refrescar solo lo que
  // cambió, no la pantalla entera.
  const recargar = async () => {
    (['allies', 'members', 'bens', 'logins'] as Recurso[]).forEach((k) => cargados.current.add(k));
    const [o, a, m, b, lg] = await Promise.all([
      api(`/cuponera/panel/overview${qs}`).catch(() => null),
      api(`/cuponera/panel/allies${qs}`).catch(() => null),
      api(`/cuponera/panel/members${qs}`).catch(() => null),
      api(`/cuponera/panel/benefits${qs}`).catch(() => null),
      api(`/cuponera/panel/ally-logins${qs}`).catch(() => null),
    ]);
    setLogins((lg as Record<string, string[]>) ?? {});
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
    // Al volver del OAuth de MercadoPago, el callback redirige con ?mp=…: se
    // abre Integraciones y se cuenta cómo terminó.
    const mpAviso = params.get('mp');
    if (mpAviso) {
      setTab('Integraciones');
      flash(AVISOS_MP[mpAviso] ?? AVISOS_MP.error_token);
    }
    // Solo el overview bloquea la primera pintura: trae el nombre, el estado y
    // los números del Dashboard. El resto llega cuando se abre su pestaña.
    cargados.current = new Set();
    api(`/cuponera/panel/overview${qs}`)
      .then((o) => setOv(o as Overview))
      .catch((e: any) => setErr(e?.message || 'No se pudo cargar el panel'))
      .finally(() => setLoading(false));
    asegurar(RECURSOS_POR_TAB[tab]);
    setVerComo(!!campaignId && u.role !== 'CUPONERA_ADMIN');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- asegurar/tab: solo al montar o cambiar de cuponera
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
          <button key={t} onClick={() => abrirTab(t)}
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
              zonas={Array.from(new Set(allies.map((x) => (x.zone || '').trim()).filter(Boolean))).sort()}
              onCancelar={() => setNuevoAliado(false)}
              onCreado={async (r) => {
                setNuevoAliado(false);
                await recargar();
                // La contraseña se muestra UNA sola vez: no se guarda en claro.
                // createAlly devuelve { ally, benefit, loginEmail, tempPassword }.
                flash(
                  r?.tempPassword
                    ? `Aliado creado. Entra en /cuponera/panel con ${r.loginEmail} y la contraseña ${r.tempPassword} — anotala, no se vuelve a mostrar.\nQueda PENDIENTE: aprobalo abajo para que salga en la cartelera.`
                    : `Aliado creado. Entra en /cuponera/panel con ${r?.loginEmail ?? 'su correo'} y la contraseña que elegiste.\nQueda PENDIENTE: aprobalo abajo para que salga en la cartelera.`,
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
                          {[a.neighborhood, a.zone, a.city].filter(Boolean).join(' · ') || '—'}{a.category ? ` · ${a.category.name}` : ''}
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
                        <button onClick={() => toggleAbierto(a.id, 'sedes')} style={{ ...btn(abierto?.id === a.id && abierto.que === 'sedes' ? PC : '#e0f2fe', abierto?.id === a.id && abierto.que === 'sedes' ? '#fff' : '#075985'), padding: '6px 12px', fontSize: 12 }}>
                          Sedes y GeoPush
                        </button>
                        <button onClick={() => toggleAbierto(a.id, 'clave')} style={{ ...btn('#eef2f7', '#111827'), padding: '6px 12px', fontSize: 12 }}>
                          Cambiar contraseña
                        </button>
                      </div>
                    </div>
                    <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 3 }}>
                      {a._count.benefits} beneficios · {a._count.locations} sedes · {a._count.redemptions} canjes
                      {logins[a.id]?.length ? ` · entra con ${logins[a.id].join(', ')}` : ''}
                      {a._count.benefits === 0 && <span style={{ color: '#b45309' }}> · sin beneficios, no aparece en la cartelera</span>}
                    </div>
                    {abierto?.id === a.id && abierto.que === 'clave' && (
                      <ClaveAliado ally={a} qs={qs} flash={flash} onListo={() => setAbierto(null)} />
                    )}
                    {abierto?.id === a.id && abierto.que === 'sedes' && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed #cbd5e1' }}>
                        <SedesAliado
                          base={`/cuponera/panel/allies/${a.id}/locations`}
                          qs={qs}
                          flash={flash}
                          sinAviso={a.status !== 'APPROVED'
                            ? 'Mientras el aliado no esté aprobado, sus sedes no avisan a nadie aunque tengan el GeoPush encendido.'
                            : null}
                          intro={<>Locales de <b>{a.name}</b>. Cada uno avisa por su cuenta a quien pase cerca con la tarjeta.</>}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </>
      )}

      {tab === 'Beneficiarios' && (
        <>
          {!nuevoMiembro && (
            <button onClick={() => setNuevoMiembro(true)} style={{ ...btn(), marginBottom: 14 }}>+ Agregar un beneficiario</button>
          )}
          {nuevoMiembro && (
            <FormMiembro
              plans={plans}
              onCancelar={() => setNuevoMiembro(false)}
              onCreado={async () => {
                setNuevoMiembro(false);
                await recargar();
                flash('Beneficiario agregado y tarjeta emitida.');
              }}
            />
          )}
        <div style={card}>
          {members.length === 0
            ? <div style={{ fontSize: 13, color: '#9ca3af' }}>Todavía no hay beneficiarios registrados.</div>
            : members.map((m) => {
              const maxFam = m.primaryMembershipId ? 0 : (m.plan?.maxLinkedMembers ?? 0);
              return (
              <div key={m.id} style={{ padding: '9px 0', borderBottom: '1px solid #f3f4f6' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div>
                    <b style={{ fontSize: 13.5 }}>{m.customer.fullName || 'Sin nombre'}</b>
                    <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 8 }}>
                      {m.customer.phone || m.customer.email || '—'}
                    </span>
                    {m.primaryMembershipId && (
                      <span style={{ marginLeft: 8, background: '#e0f2fe', color: '#075985', padding: '1px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 700 }}>
                        Enlace familiar
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: '#374151' }}>
                    <span>
                      {m.plan?.name ?? 'Sin plan'} · <b>{m.status}</b>
                      {m.passId ? ' · tarjeta emitida' : ' · sin tarjeta'}
                    </span>
                    {maxFam > 0 && (
                      <button onClick={() => setFamiliaDe(familiaDe === m.id ? null : m.id)}
                        style={{ ...btn(familiaDe === m.id ? PC : '#e0f2fe', familiaDe === m.id ? '#fff' : '#075985'), padding: '5px 11px', fontSize: 12 }}>
                        Familia {m._count?.linked ?? 0}/{maxFam}
                      </button>
                    )}
                  </div>
                </div>
                {familiaDe === m.id && maxFam > 0 && (
                  <FamiliaDe membershipId={m.id} qs={qs} flash={flash} />
                )}
              </div>
              );
            })}
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

      {tab === 'Tarjeta' && <TabTarjeta qs={qs} flash={flash} />}

      {tab === 'Integraciones' && <BloqueCobro qs={qs} flash={flash} />}

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
