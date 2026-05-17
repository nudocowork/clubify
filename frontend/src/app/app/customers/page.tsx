'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, downloadFile } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

type Customer = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
  lastOrderAt: string | null;
  totalOrdersCount: number;
  totalOrdersAmount: number;
  _count?: { passes: number; stamps: number };
};

type Segment = 'all' | 'new7' | 'vip' | 'recurring' | 'no-pass' | 'inactive';

const SEGMENTS: { key: Segment; label: string; emoji: string; help: string }[] = [
  { key: 'all', label: 'Todos', emoji: '👥', help: 'Toda tu base' },
  { key: 'new7', label: 'Nuevos 7d', emoji: '✨', help: 'Crearon cuenta esta semana' },
  { key: 'vip', label: 'VIP', emoji: '👑', help: '3+ pedidos en total' },
  { key: 'recurring', label: 'Recurrentes', emoji: '🔁', help: '2+ pedidos' },
  { key: 'no-pass', label: 'Sin tarjeta', emoji: '🎴', help: 'Aún no tienen tarjeta de fidelización' },
  { key: 'inactive', label: 'Inactivos 30d+', emoji: '💤', help: 'Sin pedido en los últimos 30 días' },
];

function avatarClass(seed: string) {
  const sum = seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return `avatar-${(sum % 7) + 1}`;
}
function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}
function fmtDate(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
  });
}
function COP(n: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n);
}

export default function CustomersPage() {
  const [list, setList] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [locationId, setLocationId] = useState<string>('');
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [segment, setSegment] = useState<Segment>('all');
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ fullName: '', email: '', phone: '' });
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [waOpen, setWaOpen] = useState(false);
  const [waMessage, setWaMessage] = useState(
    '¡Hola {{nombre}}! Te queríamos contar que…',
  );
  const [duplicateGroups, setDuplicateGroups] = useState(0);

  // Búsqueda live debounced (300ms) — re-fetch también si cambia la sede.
  useEffect(() => {
    const t = setTimeout(() => load(search), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, locationId]);

  useEffect(() => {
    api('/customers/duplicates')
      .then((r) => setDuplicateGroups(r?.total ?? 0))
      .catch(() => {});
    api<any[]>('/locations')
      .then((rows) =>
        setLocations((rows ?? []).map((r) => ({ id: r.id, name: r.name }))),
      )
      .catch(() => {});
  }, []);

  async function load(term: string = search) {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (term) qs.set('search', term);
      if (locationId) qs.set('locationId', locationId);
      const params = qs.toString() ? `?${qs}` : '';
      setList(await api(`/customers${params}`));
    } catch (e: any) {
      toast(e.message || 'Error cargando clientes', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api('/customers', { method: 'POST', body: JSON.stringify(form) });
      setForm({ fullName: '', email: '', phone: '' });
      setShowForm(false);
      load();
      toast('Cliente creado', 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo crear', 'error');
    } finally {
      setSaving(false);
    }
  }

  // Segmentación client-side para no recargar
  const visible = useMemo(() => {
    const now = Date.now();
    const ms7 = 7 * 24 * 60 * 60 * 1000;
    const ms30 = 30 * 24 * 60 * 60 * 1000;
    return list.filter((c) => {
      switch (segment) {
        case 'new7':
          return now - new Date(c.createdAt).getTime() < ms7;
        case 'vip':
          return (c.totalOrdersCount ?? 0) >= 3;
        case 'recurring':
          return (c.totalOrdersCount ?? 0) >= 2;
        case 'no-pass':
          return (c._count?.passes ?? 0) === 0;
        case 'inactive':
          return (
            !!c.lastOrderAt &&
            now - new Date(c.lastOrderAt).getTime() > ms30
          );
        default:
          return true;
      }
    });
  }, [list, segment]);

  const segmentCounts = useMemo(() => {
    const now = Date.now();
    const ms7 = 7 * 24 * 60 * 60 * 1000;
    const ms30 = 30 * 24 * 60 * 60 * 1000;
    return {
      all: list.length,
      new7: list.filter((c) => now - new Date(c.createdAt).getTime() < ms7).length,
      vip: list.filter((c) => (c.totalOrdersCount ?? 0) >= 3).length,
      recurring: list.filter((c) => (c.totalOrdersCount ?? 0) >= 2).length,
      'no-pass': list.filter((c) => (c._count?.passes ?? 0) === 0).length,
      inactive: list.filter(
        (c) =>
          !!c.lastOrderAt && now - new Date(c.lastOrderAt).getTime() > ms30,
      ).length,
    } as Record<Segment, number>;
  }, [list]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelected((prev) => {
      const allVisibleIds = visible
        .filter((c) => !!c.phone)
        .map((c) => c.id);
      const allSelected = allVisibleIds.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        for (const id of allVisibleIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of allVisibleIds) next.add(id);
      return next;
    });
  }

  const selectedCustomers = useMemo(
    () => list.filter((c) => selected.has(c.id) && !!c.phone),
    [list, selected],
  );

  function buildWaLink(c: Customer) {
    const phone = (c.phone ?? '').replace(/\D/g, '');
    const msg = waMessage.replace(/\{\{nombre\}\}/g, c.fullName);
    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Clientes{' '}
          <span className="page-crumb">
            / {visible.length}
            {segment !== 'all' && ` de ${list.length}`}
          </span>
        </h1>
        <div className="flex gap-2 flex-wrap">
          <div className="flex items-center gap-2 bg-white border border-line rounded-pill px-3 py-1.5">
            <Icon name="search" size={14} className="text-mute" />
            <input
              className="border-0 outline-none text-sm w-52 bg-transparent"
              placeholder="Buscar por nombre, email, teléfono…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="text-mute hover:text-ink text-sm"
                title="Limpiar"
              >
                ✕
              </button>
            )}
          </div>
          {locations.length > 0 && (
            <select
              className="bg-white border border-line rounded-pill px-3 py-1.5 text-sm"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              title="Filtrar por sede"
            >
              <option value="">Todas las sedes</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  📍 {l.name}
                </option>
              ))}
            </select>
          )}
          {duplicateGroups > 0 && (
            <Link
              href="/app/customers/duplicates"
              className="text-xs font-medium px-3 py-1.5 rounded-pill border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 transition flex items-center gap-1.5"
              title="Detectamos posibles clientes duplicados"
            >
              ⚠ Posibles duplicados
              <span className="bg-amber-600 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                {duplicateGroups}
              </span>
            </Link>
          )}
          <button
            className="btn-ghost text-xs"
            title="Descargar CSV de la búsqueda actual"
            onClick={() =>
              downloadFile(
                `/customers/export.csv${search ? `?search=${encodeURIComponent(search)}` : ''}`,
                `clientes-${new Date().toISOString().slice(0, 10)}.csv`,
              )
            }
          >
            ⤓ Exportar CSV
          </button>
          <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
            <Icon name="plus" /> {showForm ? 'Cancelar' : 'Nuevo cliente'}
          </button>
        </div>
      </div>

      {/* Segment chips */}
      <div className="flex gap-1.5 flex-wrap mb-4">
        {SEGMENTS.map((s) => {
          const active = segment === s.key;
          const count = segmentCounts[s.key] ?? 0;
          return (
            <button
              key={s.key}
              onClick={() => setSegment(s.key)}
              title={s.help}
              className={`text-xs font-medium px-3 py-1.5 rounded-pill border transition ${
                active
                  ? 'bg-brand text-white border-brand'
                  : 'bg-white text-mute border-line hover:border-brand/50 hover:text-ink'
              }`}
            >
              <span className="mr-1">{s.emoji}</span>
              {s.label}
              <span
                className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${
                  active ? 'bg-white/20' : 'bg-bg2'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {showForm && (
        <form
          onSubmit={create}
          className="card card-pad mb-4 grid grid-cols-1 md:grid-cols-3 gap-3"
        >
          <div>
            <label className="label">Nombre</label>
            <input
              className="input"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Teléfono</label>
            <input
              className="input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div className="md:col-span-3">
            <button className="btn-primary" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      )}

      <div className="card overflow-hidden p-0">
       <div className="overflow-x-auto">
        <table className="w-full text-[13.5px] min-w-[760px]">
          <thead className="bg-bg2">
            <tr>
              <th className="px-3 py-3.5 w-10">
                <input
                  type="checkbox"
                  className="cursor-pointer"
                  checked={
                    visible.length > 0 &&
                    visible
                      .filter((c) => !!c.phone)
                      .every((c) => selected.has(c.id))
                  }
                  onChange={toggleSelectAllVisible}
                  title="Seleccionar todos los visibles con teléfono"
                />
              </th>
              {['Cliente', 'Contacto', 'Pases', 'Pedidos', 'LTV', 'Último'].map(
                (h) => (
                  <th
                    key={h}
                    className="text-left px-4 py-3.5 text-[11px] uppercase tracking-[0.1em] text-mute font-semibold"
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-t border-line2">
                  <td colSpan={7} className="px-4 py-3.5">
                    <div className="h-6 bg-bg2 rounded animate-shimmer" />
                  </td>
                </tr>
              ))}
            {!loading && visible.length === 0 && (
              <tr>
                <td className="px-4 py-12 text-center" colSpan={7}>
                  <div className="text-4xl mb-2">
                    {segment === 'all' ? '👥' : SEGMENTS.find((s) => s.key === segment)?.emoji}
                  </div>
                  <div className="font-semibold">
                    {search
                      ? `Sin resultados para "${search}"`
                      : segment === 'all'
                      ? 'Aún no hay clientes'
                      : `Sin clientes en este segmento`}
                  </div>
                  <div className="text-xs text-mute mt-1 max-w-sm mx-auto">
                    {segment === 'all'
                      ? 'Cuando alguien haga su primer pedido o reciba una tarjeta, aparece aquí.'
                      : SEGMENTS.find((s) => s.key === segment)?.help}
                  </div>
                </td>
              </tr>
            )}
            {!loading &&
              visible.map((c) => (
                <tr
                  key={c.id}
                  className={`border-t border-line2 hover:bg-[#FAFAFB] ${
                    selected.has(c.id) ? 'bg-brand-soft/30' : ''
                  }`}
                >
                  <td className="px-3 py-3.5">
                    <input
                      type="checkbox"
                      className="cursor-pointer disabled:opacity-30"
                      checked={selected.has(c.id)}
                      disabled={!c.phone}
                      onChange={() => toggleSelect(c.id)}
                      title={
                        c.phone
                          ? 'Seleccionar para campaña'
                          : 'Sin teléfono — no se puede contactar'
                      }
                    />
                  </td>
                  <td className="px-4 py-3.5">
                    <Link
                      href={`/app/customers/${c.id}`}
                      className="flex items-center gap-2.5 hover:text-brand"
                    >
                      <span
                        className={`avatar w-8 h-8 text-xs ${avatarClass(c.fullName)}`}
                      >
                        {initials(c.fullName)}
                      </span>
                      <div>
                        <div className="font-medium">{c.fullName}</div>
                        {c.totalOrdersCount >= 3 && (
                          <span className="badge text-[9px] bg-amber-100 text-amber-800 mt-0.5">
                            👑 VIP
                          </span>
                        )}
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-3.5 text-mute text-xs">
                    <div>{c.phone || '—'}</div>
                    {c.email && (
                      <div className="text-mute2 truncate max-w-[180px]">
                        {c.email}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <span
                      className={`badge ${
                        (c._count?.passes ?? 0) > 0 ? 'badge-info' : 'badge-mute'
                      }`}
                    >
                      {c._count?.passes ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 font-medium">
                    {c.totalOrdersCount ?? 0}
                  </td>
                  <td className="px-4 py-3.5 text-xs">
                    {Number(c.totalOrdersAmount) > 0
                      ? COP(Number(c.totalOrdersAmount))
                      : '—'}
                  </td>
                  <td className="px-4 py-3.5 text-xs text-mute">
                    {fmtDate(c.lastOrderAt)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
       </div>
      </div>

      {/* Barra flotante de selección */}
      {selected.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-ink text-white rounded-full shadow-2xl pl-5 pr-2 py-2 flex items-center gap-3">
          <span className="text-sm font-semibold">
            {selected.size} cliente{selected.size === 1 ? '' : 's'} seleccionado
            {selected.size === 1 ? '' : 's'}
          </span>
          <button
            onClick={() => setSelected(new Set())}
            className="text-white/70 hover:text-white text-xs"
          >
            Limpiar
          </button>
          <button
            onClick={() => setWaOpen(true)}
            className="bg-ok text-white text-sm font-semibold px-4 py-2 rounded-full inline-flex items-center gap-1.5 hover:bg-ok/90"
          >
            <Icon name="send" size={14} /> Enviar WhatsApp
          </button>
        </div>
      )}

      {/* Modal: campaña WhatsApp */}
      {waOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-ink/60"
            onClick={() => setWaOpen(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-line2 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-lg">Campaña WhatsApp</h2>
                <p className="text-xs text-mute mt-0.5">
                  {selectedCustomers.length} destinatario
                  {selectedCustomers.length === 1 ? '' : 's'} con teléfono
                </p>
              </div>
              <button
                onClick={() => setWaOpen(false)}
                className="text-mute hover:text-ink text-lg"
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-4 border-b border-line2">
              <label className="label">
                Mensaje (usa <code>{'{{nombre}}'}</code> para personalizar)
              </label>
              <textarea
                className="input min-h-[100px]"
                value={waMessage}
                onChange={(e) => setWaMessage(e.target.value)}
                placeholder="¡Hola {{nombre}}! Tenemos una promo nueva esta semana…"
                maxLength={1000}
              />
              <div className="text-xs text-mute mt-1.5 flex items-center justify-between">
                <span>
                  WhatsApp Web abrirá un chat por cliente. Tú decides cuáles
                  enviar.
                </span>
                <span>{waMessage.length}/1000</span>
              </div>
            </div>

            <div className="flex-1 overflow-auto px-6 py-4">
              <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
                Lista de envío
              </div>
              {selectedCustomers.length === 0 ? (
                <div className="text-sm text-mute text-center py-6">
                  Ningún seleccionado tiene teléfono.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {selectedCustomers.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-bg2/50 hover:bg-bg2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">
                          {c.fullName}
                        </div>
                        <div className="text-xs text-mute">{c.phone}</div>
                      </div>
                      <a
                        href={buildWaLink(c)}
                        target="_blank"
                        rel="noreferrer"
                        className="bg-ok text-white text-xs font-semibold px-3 py-1.5 rounded-full inline-flex items-center gap-1 hover:bg-ok/90 whitespace-nowrap"
                      >
                        Abrir chat →
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-3 border-t border-line2 bg-bg2/40 flex items-center justify-between">
              <div className="text-xs text-mute">
                💡 Para campañas masivas reales (sin abrir uno por uno), usa
                las{' '}
                <Link
                  href="/app/automations"
                  className="text-brand hover:underline"
                >
                  automatizaciones de WhatsApp
                </Link>
                .
              </div>
              <button
                onClick={() => setWaOpen(false)}
                className="btn-ghost text-sm"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
