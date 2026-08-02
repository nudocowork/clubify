'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { api, downloadFile } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { AcademyButton } from '@/components/AcademyButton';
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
  // Cumpleaños (año 2000 = centinela; solo día+mes importan). Puede venir null.
  birthday: string | null;
  _count?: { passes: number; stamps: number };
  // M6: last stamp con operator + location, devuelto por el backend
  // como array de hasta 1 entrada. Vacío si el cliente nunca fue
  // escaneado.
  stamps?: Array<{
    id: string;
    createdAt: string;
    action: string;
    operator: { id: string; fullName: string; email: string } | null;
    location: { id: string; name: string } | null;
  }>;
};

type StaffOption = { id: string; fullName: string; email: string };

type Segment =
  | 'all'
  | 'new7'
  | 'vip'
  | 'recurring'
  | 'no-pass'
  | 'inactive'
  | 'birthday';

const SEGMENTS: { key: Segment; label: string; emoji: string; help: string }[] = [
  { key: 'all', label: 'Todos', emoji: '👥', help: 'Toda tu base' },
  { key: 'new7', label: 'Nuevos 7d', emoji: '✨', help: 'Crearon cuenta esta semana' },
  { key: 'vip', label: 'VIP', emoji: '👑', help: '3+ pedidos en total' },
  { key: 'recurring', label: 'Recurrentes', emoji: '🔁', help: '2+ pedidos' },
  { key: 'no-pass', label: 'Sin tarjeta', emoji: '🎴', help: 'Aún no tienen tarjeta de fidelización' },
  { key: 'inactive', label: 'Inactivos 30d+', emoji: '💤', help: 'Sin pedido en los últimos 30 días' },
  { key: 'birthday', label: 'Cumple este mes', emoji: '🎂', help: 'Cumplen años este mes' },
];

/** Mes (0-11) del cumpleaños, o null. La fecha se guarda con año centinela
 *  2000 y @db.Date → usamos getUTCMonth para no derivar por zona horaria. */
function birthdayMonth(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.getUTCMonth();
}

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** "15 may" a partir del cumpleaños (día + mes corto). */
function fmtBday(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS_ES[d.getUTCMonth()]}`;
}

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
  const t = useTranslations('app_customers');
  const [list, setList] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [locationId, setLocationId] = useState<string>('');
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
  // M6: filtros por scanner (operator) y fecha desde (en días).
  const [operatorId, setOperatorId] = useState<string>('');
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [sinceDays, setSinceDays] = useState<string>(''); // '' | '7' | '30' | '90'
  const [segment, setSegment] = useState<Segment>('all');
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ fullName: '', email: '', phone: '' });
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [waOpen, setWaOpen] = useState(false);
  const [waMessage, setWaMessage] = useState(
    t('waMessageDefault'),
  );
  const [duplicateGroups, setDuplicateGroups] = useState(0);

  // Búsqueda live debounced (300ms) — re-fetch si cambia search/sede/
  // scanner/fecha. M6: 4 filtros combinables.
  //
  // HOTFIX 2026-06-05 (bug I): requestIdRef monotónico para descartar
  // respuestas de filtros viejos. Sin esto, si el cliente tipea "Juan"
  // → borra → "Maria" rápido, la respuesta de "Juan" podía llegar
  // después y pisar la lista de "Maria" → lista incorrecta intermitente.
  // El api() helper no expone AbortController, así que usamos id que
  // se invalida en cada nueva request.
  const requestIdRef = useRef(0);
  useEffect(() => {
    const t = setTimeout(() => load(search), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, locationId, operatorId, sinceDays]);

  useEffect(() => {
    api('/customers/duplicates')
      .then((r) => setDuplicateGroups(r?.total ?? 0))
      .catch(() => {});
    api<any[]>('/locations')
      .then((rows) =>
        setLocations((rows ?? []).map((r) => ({ id: r.id, name: r.name }))),
      )
      .catch(() => {});
    // M6: lista de staff (scanner users) para poblar el dropdown del filtro.
    // Endpoint TENANT_OWNER-only; si el user es TENANT_STAFF no carga.
    api<any[]>('/tenants/me/staff')
      .then((rows) =>
        setStaff(
          (rows ?? []).map((r) => ({
            id: r.id,
            fullName: r.fullName,
            email: r.email,
          })),
        ),
      )
      .catch(() => {});
  }, []);

  async function load(term: string = search) {
    setLoading(true);
    const myId = ++requestIdRef.current;
    try {
      const qs = new URLSearchParams();
      if (term) qs.set('search', term);
      if (locationId) qs.set('locationId', locationId);
      if (operatorId) qs.set('operatorId', operatorId);
      if (sinceDays) {
        const days = Number(sinceDays);
        if (Number.isFinite(days) && days > 0) {
          qs.set(
            'since',
            new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
          );
        }
      }
      const params = qs.toString() ? `?${qs}` : '';
      const res = await api<Customer[]>(`/customers${params}`);
      // Solo aplicar si seguimos siendo la última request — sino una
      // respuesta lenta de filtros viejos pisaría la nueva.
      if (myId === requestIdRef.current) {
        setList(res);
      }
    } catch (e: any) {
      if (myId === requestIdRef.current) {
        toast(e.message || t('errLoading'), 'error');
      }
    } finally {
      if (myId === requestIdRef.current) {
        setLoading(false);
      }
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
      toast(t('customerCreated'), 'success');
    } catch (e: any) {
      toast(e.message || t('errCreate'), 'error');
    } finally {
      setSaving(false);
    }
  }

  // Segmentación client-side para no recargar
  const visible = useMemo(() => {
    const now = Date.now();
    const ms7 = 7 * 24 * 60 * 60 * 1000;
    const ms30 = 30 * 24 * 60 * 60 * 1000;
    const thisMonth = new Date().getMonth();
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
        case 'birthday':
          return birthdayMonth(c.birthday) === thisMonth;
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
      birthday: list.filter((c) => birthdayMonth(c.birthday) === new Date().getMonth())
        .length,
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
          {t('title')}{' '}
          <span className="page-crumb">
            / {visible.length}
            {segment !== 'all' && ` ${t('ofTotal', { total: list.length })}`}
          </span>
        </h1>
        <div className="flex gap-2 flex-wrap">
          <div className="flex items-center gap-2 bg-white border border-line rounded-pill px-3 py-1.5">
            <Icon name="search" size={14} className="text-mute" />
            <input
              className="border-0 outline-none text-sm w-52 bg-transparent"
              placeholder={t('searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="text-mute hover:text-ink text-sm"
                title={t('clear')}
              >
                ✕
              </button>
            )}
          </div>
          <AcademyButton moduleKey="clientes" />
          {locations.length > 0 && (
            <select
              className="bg-white border border-line rounded-pill px-3 py-1.5 text-sm"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              title={t('filterByLocation')}
            >
              <option value="">{t('allLocations')}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  📍 {l.name}
                </option>
              ))}
            </select>
          )}
          {staff.length > 0 && (
            <select
              className="bg-white border border-line rounded-pill px-3 py-1.5 text-sm"
              value={operatorId}
              onChange={(e) => setOperatorId(e.target.value)}
              title={t('filterByScanner')}
            >
              <option value="">{t('allScanners')}</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  👤 {s.fullName}
                </option>
              ))}
            </select>
          )}
          <select
            className="bg-white border border-line rounded-pill px-3 py-1.5 text-sm"
            value={sinceDays}
            onChange={(e) => setSinceDays(e.target.value)}
            title={t('filterByActivity')}
          >
            <option value="">{t('anyDate')}</option>
            <option value="7">📅 {t('last7Days')}</option>
            <option value="30">📅 {t('last30Days')}</option>
            <option value="90">📅 {t('last90Days')}</option>
          </select>
          {duplicateGroups > 0 && (
            <Link
              href="/app/customers/duplicates"
              className="text-xs font-medium px-3 py-1.5 rounded-pill border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 transition flex items-center gap-1.5"
              title={t('duplicatesDetected')}
            >
              ⚠ {t('possibleDuplicates')}
              <span className="bg-amber-600 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                {duplicateGroups}
              </span>
            </Link>
          )}
          <button
            className="btn-ghost text-xs"
            title={t('downloadCsvTitle')}
            onClick={() =>
              downloadFile(
                `/customers/export.csv${search ? `?search=${encodeURIComponent(search)}` : ''}`,
                `clientes-${new Date().toISOString().slice(0, 10)}.csv`,
              )
            }
          >
            ⤓ {t('exportCsv')}
          </button>
          <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
            <Icon name="plus" /> {showForm ? t('cancel') : t('newCustomer')}
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
            <label className="label">{t('name')}</label>
            <input
              className="input"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label">{t('email')}</label>
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div>
            <label className="label">{t('phone')}</label>
            <input
              className="input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div className="md:col-span-3">
            <button className="btn-primary" disabled={saving}>
              {saving ? t('saving') : t('save')}
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
                  title={t('selectAllWithPhone')}
                />
              </th>
              {[
                { key: 'colCustomer', label: t('colCustomer') },
                { key: 'colContact', label: t('colContact') },
                { key: 'colPasses', label: t('colPasses') },
                { key: 'colOrders', label: t('colOrders') },
                { key: 'colLtv', label: t('colLtv') },
                { key: 'colLastScan', label: t('colLastScan') },
                { key: 'colLast', label: t('colLast') },
              ].map((h) => (
                <th
                  key={h.key}
                  className="text-left px-4 py-3.5 text-[11px] uppercase tracking-[0.1em] text-mute font-semibold"
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-t border-line2">
                  <td colSpan={8} className="px-4 py-3.5">
                    <div className="h-6 bg-bg2 rounded animate-shimmer" />
                  </td>
                </tr>
              ))}
            {!loading && visible.length === 0 && (
              <tr>
                <td className="px-4 py-12 text-center" colSpan={8}>
                  <div className="text-4xl mb-2">
                    {segment === 'all' ? '👥' : SEGMENTS.find((s) => s.key === segment)?.emoji}
                  </div>
                  <div className="font-semibold">
                    {search
                      ? t('noResultsFor', { term: search })
                      : segment === 'all'
                      ? t('noCustomersYet')
                      : t('noCustomersInSegment')}
                  </div>
                  <div className="text-xs text-mute mt-1 max-w-sm mx-auto">
                    {segment === 'all'
                      ? t('emptyHelp')
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
                          ? t('selectForCampaign')
                          : t('noPhoneCannotContact')
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
                        <div className="flex items-center gap-1 flex-wrap">
                          {c.totalOrdersCount >= 3 && (
                            <span className="badge text-[9px] bg-amber-100 text-amber-800 mt-0.5">
                              👑 VIP
                            </span>
                          )}
                          {c.birthday && (
                            <span
                              className={`badge text-[9px] mt-0.5 ${
                                birthdayMonth(c.birthday) === new Date().getMonth()
                                  ? 'bg-pink-100 text-pink-700'
                                  : 'bg-bg2 text-mute'
                              }`}
                            >
                              🎂 {fmtBday(c.birthday)}
                            </span>
                          )}
                        </div>
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
                  <td className="px-4 py-3.5 text-xs">
                    {(() => {
                      const last = c.stamps?.[0];
                      if (!last) return <span className="text-mute">—</span>;
                      const who =
                        last.operator?.fullName ?? last.operator?.email ?? '—';
                      return (
                        <div>
                          <div
                            className="font-medium text-ink truncate max-w-[160px]"
                            title={last.operator?.email ?? ''}
                          >
                            👤 {who}
                          </div>
                          <div className="text-mute2 truncate max-w-[160px]">
                            {last.location
                              ? `📍 ${last.location.name}`
                              : t('noLocation')}
                            {' · '}
                            {fmtDate(last.createdAt)}
                          </div>
                        </div>
                      );
                    })()}
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
            {t('selectedCount', { count: selected.size })}
          </span>
          <button
            onClick={() => setSelected(new Set())}
            className="text-white/70 hover:text-white text-xs"
          >
            {t('clear')}
          </button>
          <button
            onClick={() => setWaOpen(true)}
            className="bg-ok text-white text-sm font-semibold px-4 py-2 rounded-full inline-flex items-center gap-1.5 hover:bg-ok/90"
          >
            <Icon name="send" size={14} /> {t('sendWhatsApp')}
          </button>
          <button
            onClick={async () => {
              const n = selected.size;
              const msg = t('deleteConfirm', { count: n });
              const confirmText = window.prompt(msg);
              if ((confirmText ?? '').trim().toUpperCase() !== t('deleteConfirmKeyword')) return;
              let ok = 0;
              let fail = 0;
              for (const id of Array.from(selected)) {
                try {
                  await api(`/customers/${id}`, { method: 'DELETE' });
                  ok++;
                } catch {
                  fail++;
                }
              }
              setSelected(new Set());
              toast(
                fail > 0
                  ? t('deleteResultPartial', { ok, fail })
                  : t('deleteResultAll', { count: ok }),
                fail > 0 ? 'error' : 'success',
              );
              load();
            }}
            className="bg-bad text-white text-sm font-semibold px-4 py-2 rounded-full inline-flex items-center gap-1.5 hover:bg-bad/90"
          >
            <Icon name="trash" size={14} /> {t('delete')}
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
                <h2 className="font-bold text-lg">{t('waCampaign')}</h2>
                <p className="text-xs text-mute mt-0.5">
                  {t('recipientsWithPhone', { count: selectedCustomers.length })}
                </p>
              </div>
              <button
                onClick={() => setWaOpen(false)}
                className="text-mute hover:text-ink text-lg"
                aria-label={t('close')}
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-4 border-b border-line2">
              <label className="label">
                {t('messageLabelBefore')} <code>{'{{nombre}}'}</code> {t('messageLabelAfter')}
              </label>
              <textarea
                className="input min-h-[100px]"
                value={waMessage}
                onChange={(e) => setWaMessage(e.target.value)}
                placeholder={t('waMessagePlaceholder')}
                maxLength={1000}
              />
              <div className="text-xs text-mute mt-1.5 flex items-center justify-between">
                <span>
                  {t('waWebHint')}
                </span>
                <span>{waMessage.length}/1000</span>
              </div>
            </div>

            <div className="flex-1 overflow-auto px-6 py-4">
              <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
                {t('sendList')}
              </div>
              {selectedCustomers.length === 0 ? (
                <div className="text-sm text-mute text-center py-6">
                  {t('noneHasPhone')}
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
                        {t('openChat')} →
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-3 border-t border-line2 bg-bg2/40 flex items-center justify-between">
              <div className="text-xs text-mute">
                💡 {t('massCampaignHintBefore')}{' '}
                <Link
                  href="/app/automations"
                  className="text-brand hover:underline"
                >
                  {t('whatsappAutomations')}
                </Link>
                {t('massCampaignHintAfter')}
              </div>
              <button
                onClick={() => setWaOpen(false)}
                className="btn-ghost text-sm"
              >
                {t('close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
