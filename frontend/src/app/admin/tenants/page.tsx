'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, getUser, startImpersonation } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { DuplicateBusinessModal } from '@/components/DuplicateBusinessModal';
import { ManageTrialModal } from '@/components/ManageTrialModal';
import { periodLabel, type PlanPeriodicity } from '@/lib/plan-format';

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

type StatusFilter = 'ALL' | 'ACTIVE' | 'TRIAL' | 'SUSPENDED';
type PlanFilter = 'ALL' | 'ELITE';
type PeriodFilter = 'ALL' | 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';

// Aplana un tenant a una bolsa de tokens lowercase para búsqueda
// multi-keyword AND. Tomamos solo los campos que SÍ devuelve /tenants
// (brandName/email/phone/whatsappPhone/status/plan/periodicidad).
// Los campos de atribución (influencer/embajador/vendor/campaña) no
// vienen en el response actual — si en el futuro se agregan acá los
// recogemos automático sin tocar la UI.
function searchHaystack(t: any): string {
  const parts = [
    t.brandName,
    t.name,
    t.email,
    t.phone,
    t.whatsappPhone,
    t.slug,
    t.city,
    t.country,
    t.status,
    t.plan?.name,
    t.planPeriodicity,
    t.attributionInfluencer?.ownerName,
    t.attributionAmbassador?.ownerName,
    t.attributionVendor?.ownerName,
    t.attributionCampaign?.name,
    // Concatenado plan+periodicidad para que "elite trimestral" matchee
    // como una sola frase aunque vengan de campos distintos.
    t.plan?.name && t.planPeriodicity
      ? `${t.plan.name} ${t.planPeriodicity}`
      : null,
  ];
  return parts.filter(Boolean).join(' ').toLowerCase();
}

export default function TenantsPage() {
  const router = useRouter();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [planFilter, setPlanFilter] = useState<PlanFilter>('ALL');
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('ALL');
  const [searchRaw, setSearchRaw] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [duplicateTarget, setDuplicateTarget] = useState<any | null>(null);
  const [showRanking, setShowRanking] = useState(false); // #11
  const [trialTarget, setTrialTarget] = useState<any | null>(null);
  const me = getUser();
  const isMarketing = me?.role === 'MARKETING';

  // Debounce 150ms para evitar re-renders por keystroke en listas grandes.
  useEffect(() => {
    const id = setTimeout(() => setSearchDebounced(searchRaw.trim()), 150);
    return () => clearTimeout(id);
  }, [searchRaw]);

  async function enterTenant(t: any) {
    if (enteringId) return;
    setEnteringId(t.id);
    try {
      const res = await api(`/tenants/${t.id}/impersonate`, { method: 'POST' });
      startImpersonation({
        accessToken: res.accessToken,
        user: res.user,
        tenant: { id: res.tenant.id, brandName: res.tenant.brandName },
      });
      toast(`Entrando a ${res.tenant.brandName}…`, 'success');
      router.push('/app');
    } catch (e: any) {
      toast(e.message || 'No se pudo entrar al negocio', 'error');
      setEnteringId(null);
    }
  }

  async function load() {
    setLoading(true);
    try {
      setList(await api('/tenants'));
    } catch (e: any) {
      toast(e.message || 'Error cargando negocios', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function setStatus(id: string, status: string) {
    try {
      await api(`/tenants/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      toast(
        status === 'ACTIVE' ? 'Negocio reactivado' : 'Negocio suspendido',
        'success',
      );
      load();
    } catch (e: any) {
      toast(e.message || 'No se pudo cambiar el estado', 'error');
    }
  }

  // Genera y dispara la descarga de un JSON con los datos del tenant que
  // tenemos en memoria (sin pegarle al backend de nuevo). Útil para
  // auditorías rápidas, soporte y handover.
  function downloadTenant(t: any) {
    try {
      const safeName = (t.brandName || t.slug || 'negocio')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      const date = new Date().toISOString().slice(0, 10);
      const blob = new Blob([JSON.stringify(t, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tenant-${safeName}-${date}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('Descarga lista', 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo descargar', 'error');
    }
  }

  /**
   * Bloque 5 (2026-06-12): eliminar con opción "conservar historial".
   * keepHistory=true (default seguro) → soft delete. Las relaciones se
   * preservan (Order/Commission/ReferralUse) y el tenant desaparece de
   * los listados. keepHistory=false → hard delete con cascade.
   */
  async function deleteTenant(t: any, opts: { keepHistory: boolean }) {
    try {
      await api(`/tenants/${t.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ keepHistory: opts.keepHistory }),
      });
      toast(
        `${t.brandName} eliminado${opts.keepHistory ? ' (historial conservado)' : ''}`,
        'success',
      );
      setDeleteTarget(null);
      load();
    } catch (e: any) {
      toast(e.message || 'No se pudo eliminar el negocio', 'error');
    }
  }

  const visible = useMemo(() => {
    const keywords = searchDebounced
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return list.filter((t) => {
      if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
      if (planFilter !== 'ALL') {
        const name = (t.plan?.name ?? '').toString().toUpperCase();
        if (name !== planFilter) return false;
      }
      if (periodFilter !== 'ALL') {
        // Sin periodicidad explícita el backend la trata como MENSUAL
        // (ver periodLabel) — replicamos esa convención al filtrar.
        const p = (t.planPeriodicity ?? 'MENSUAL').toString().toUpperCase();
        if (p !== periodFilter) return false;
      }
      if (keywords.length === 0) return true;
      const hay = searchHaystack(t);
      return keywords.every((k) => hay.includes(k));
    });
  }, [list, statusFilter, planFilter, periodFilter, searchDebounced]);

  const hasActiveFilters =
    statusFilter !== 'ALL' ||
    planFilter !== 'ALL' ||
    periodFilter !== 'ALL' ||
    searchDebounced.length > 0;

  function clearFilters() {
    setStatusFilter('ALL');
    setPlanFilter('ALL');
    setPeriodFilter('ALL');
    setSearchRaw('');
    setSearchDebounced('');
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Negocios <span className="page-crumb">/ {list.length} registros</span>
        </h1>
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setShowRanking(true)}
          >
            🏆 Ranking
          </button>
          {!isMarketing && (
            <Link className="btn-primary" href="/admin/tenants/new">
              <Icon name="plus" /> Nuevo negocio
            </Link>
          )}
        </div>
      </div>

      {showRanking && <PassesRankingModal onClose={() => setShowRanking(false)} />}

      <div className="mb-3.5 flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex items-center gap-2 flex-1 bg-bg2 rounded-pill px-4 py-2.5">
          <Icon name="search" size={16} className="text-mute shrink-0" />
          <input
            type="search"
            value={searchRaw}
            onChange={(e) => setSearchRaw(e.target.value)}
            placeholder="Buscar negocio, cliente, correo, teléfono…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-mute2"
          />
          {searchRaw && (
            <button
              type="button"
              onClick={() => setSearchRaw('')}
              className="text-mute hover:text-ink text-lg leading-none shrink-0"
              aria-label="Limpiar búsqueda"
            >
              ×
            </button>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="bg-white border border-line rounded-pill px-3 py-2 text-sm cursor-pointer hover:bg-bg2"
          >
            <option value="ALL">Estado: Todos</option>
            <option value="ACTIVE">Activos</option>
            <option value="TRIAL">Trial</option>
            <option value="SUSPENDED">Suspendidos</option>
          </select>
          <select
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value as PlanFilter)}
            className="bg-white border border-line rounded-pill px-3 py-2 text-sm cursor-pointer hover:bg-bg2"
          >
            <option value="ALL">Plan: Todos</option>
            <option value="ELITE">Elite</option>
          </select>
          <select
            value={periodFilter}
            onChange={(e) => setPeriodFilter(e.target.value as PeriodFilter)}
            className="bg-white border border-line rounded-pill px-3 py-2 text-sm cursor-pointer hover:bg-bg2"
          >
            <option value="ALL">Periodicidad: Todas</option>
            <option value="MENSUAL">Mensual</option>
            <option value="TRIMESTRAL">Trimestral</option>
            <option value="SEMESTRAL">Semestral</option>
            <option value="ANUAL">Anual</option>
          </select>
        </div>
      </div>

      {hasActiveFilters && (
        <div className="mb-3 flex items-center gap-3 text-xs text-mute">
          <span>
            <strong className="text-ink">{visible.length}</strong>{' '}
            {visible.length === 1 ? 'negocio' : 'negocios'}
          </span>
          <button
            type="button"
            onClick={clearFilters}
            className="text-brand hover:underline"
          >
            Limpiar filtros
          </button>
        </div>
      )}

      <div className="card overflow-visible p-0">
       <div className="overflow-x-auto overflow-y-visible">
        <table className="w-full text-[13.5px] min-w-[760px]">
          <thead className="bg-bg2">
            <tr>
              {['Negocio', 'Plan', 'Estado', 'Trial', 'Pedidos 30d', 'Revenue 30d', 'Clientes', 'Grupo', ''].map(
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
                  <td colSpan={9} className="px-4 py-3.5">
                    <div className="h-6 bg-bg2 rounded animate-shimmer" />
                  </td>
                </tr>
              ))}
            {!loading && visible.length === 0 && (
              <tr>
                <td className="px-4 py-12 text-center" colSpan={9}>
                  <div className="text-3xl mb-1">🏢</div>
                  <div className="font-semibold">
                    {hasActiveFilters
                      ? 'Sin resultados con esos filtros'
                      : 'Sin negocios todavía'}
                  </div>
                  <div className="text-mute text-xs mt-1">
                    {hasActiveFilters
                      ? 'Prueba a limpiar la búsqueda o ajustar los filtros.'
                      : 'Cuando alguien haga signup aparecerá aquí.'}
                  </div>
                </td>
              </tr>
            )}
            {visible.map((t) => {
              const canEnter =
                !isMarketing && t.status !== 'SUSPENDED' && enteringId !== t.id;
              const stop = (e: React.MouseEvent) => e.stopPropagation();
              return (
              <tr
                key={t.id}
                onClick={() => canEnter && enterTenant(t)}
                className={`border-t border-line2 transition group ${
                  canEnter
                    ? 'hover:bg-brand-soft/40 cursor-pointer'
                    : 'opacity-70'
                }`}
                title={
                  isMarketing
                    ? 'Solo lectura · sin impersonación'
                    : t.status === 'SUSPENDED'
                      ? 'Reactiva el negocio para entrar'
                      : `Entrar como ${t.brandName}`
                }
              >
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`avatar w-8 h-8 text-xs ${avatarClass(t.brandName)}`}
                    >
                      {initials(t.brandName)}
                    </span>
                    <div>
                      <div className="font-medium group-hover:text-brand transition">
                        {t.brandName}
                      </div>
                      <div className="text-mute text-xs">{t.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  <div className="font-medium">{t.plan?.name ?? 'Elite'}</div>
                  <div className="text-[11px] text-mute">
                    {periodLabel(t.planPeriodicity as PlanPeriodicity | null)}
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  <span
                    className={`badge ${
                      t.status === 'ACTIVE'
                        ? 'badge-ok'
                        : t.status === 'TRIAL'
                        ? 'badge-warn'
                        : 'badge-bad'
                    }`}
                  >
                    {t.status === 'ACTIVE'
                      ? 'Activo'
                      : t.status === 'TRIAL'
                      ? 'Trial'
                      : 'Suspendido'}
                  </span>
                </td>
                <td className="px-4 py-3.5">
                  {t.daysLeftInTrial !== null ? (
                    <span
                      className={
                        t.daysLeftInTrial <= 2
                          ? 'text-bad font-medium'
                          : t.daysLeftInTrial <= 5
                          ? 'text-warn font-medium'
                          : 'text-mute'
                      }
                    >
                      {t.daysLeftInTrial}d
                    </span>
                  ) : (
                    <span className="text-mute2">—</span>
                  )}
                </td>
                <td className="px-4 py-3.5 font-medium">{t.orders30 ?? 0}</td>
                <td className="px-4 py-3.5 font-medium">
                  {(t.revenue30 ?? 0).toLocaleString('es-CO', {
                    style: 'currency',
                    currency: t.currency ?? 'COP',
                    maximumFractionDigits: 0,
                  })}
                </td>
                <td className="px-4 py-3.5">{t._count?.customers ?? 0}</td>
                <td className="px-4 py-3.5">
                  {t.businessGroup?.name ? (
                    <span
                      className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-pill bg-bg2 text-ink2"
                      title="Grupo Empresarial"
                    >
                      {t.businessGroup.name}
                    </span>
                  ) : (
                    <span className="text-mute2 text-xs">Sin grupo</span>
                  )}
                </td>
                <td
                  className="px-4 py-3.5 text-right whitespace-nowrap"
                  onClick={stop}
                >
                  <ActionsMenu
                    canEnter={canEnter}
                    canManage={!isMarketing}
                    isEntering={enteringId === t.id}
                    status={t.status}
                    onEnter={() => enterTenant(t)}
                    onView={() => router.push(`/admin/tenants/${t.id}`)}
                    onDownload={() => downloadTenant(t)}
                    onToggleStatus={() =>
                      setStatus(t.id, t.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE')
                    }
                    onManageTrial={() => setTrialTarget(t)}
                    onDuplicate={() => setDuplicateTarget(t)}
                    onDelete={() => setDeleteTarget(t)}
                  />
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
       </div>
      </div>

      {duplicateTarget && (
        <DuplicateBusinessModal
          source={{
            id: duplicateTarget.id,
            brandName: duplicateTarget.brandName,
            slug: duplicateTarget.slug,
          }}
          onClose={() => setDuplicateTarget(null)}
        />
      )}

      {trialTarget && (
        <ManageTrialModal
          tenant={{
            id: trialTarget.id,
            brandName: trialTarget.brandName,
            status: trialTarget.status,
            trialEndsAt: trialTarget.trialEndsAt,
          }}
          onClose={() => setTrialTarget(null)}
          onSaved={() => {
            setTrialTarget(null);
            load();
          }}
        />
      )}

      {deleteTarget && (
        <DeleteTenantModal
          tenant={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={(opts) => deleteTenant(deleteTarget, opts)}
        />
      )}
    </div>
  );
}

/**
 * #11 (2026-06-16): ranking de negocios por pases emitidos (mayor a menor,
 * con botón para invertir). Modal sobre la lista de negocios.
 */
function PassesRankingModal({ onClose }: { onClose: () => void }) {
  const [order, setOrder] = useState<'desc' | 'asc'>('desc');
  const [rows, setRows] = useState<
    { id: string; brandName: string; status: string; passCount: number }[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api<typeof rows>(`/tenants/ranking?order=${order}`)
      .then((r) => setRows(r ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [order]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-line">
          <h3 className="text-lg font-bold">🏆 Ranking por pases emitidos</h3>
          <button
            onClick={onClose}
            className="text-mute hover:text-ink text-xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="px-4 py-2 border-b border-line flex items-center justify-between">
          <span className="text-xs text-mute">
            {rows.length} negocios · orden {order === 'desc' ? 'mayor → menor' : 'menor → mayor'}
          </span>
          <button
            className="btn-ghost text-xs"
            onClick={() => setOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
          >
            ⇅ Invertir
          </button>
        </div>
        <div className="overflow-y-auto p-2">
          {loading ? (
            <div className="text-center text-mute text-sm py-8">Cargando…</div>
          ) : rows.length === 0 ? (
            <div className="text-center text-mute text-sm py-8">Sin datos.</div>
          ) : (
            <div className="divide-y divide-line">
              {rows.map((r, i) => (
                <Link
                  key={r.id}
                  href={`/admin/tenants/${r.id}`}
                  className="flex items-center gap-3 px-2 py-2.5 hover:bg-bg2 rounded-lg"
                >
                  <div className="w-7 text-center font-bold">
                    {order === 'desc' && i < 3
                      ? ['🥇', '🥈', '🥉'][i]
                      : `${i + 1}`}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{r.brandName}</div>
                    <div className="text-[11px] text-mute">{r.status}</div>
                  </div>
                  <div className="font-bold text-brand whitespace-nowrap">
                    {r.passCount.toLocaleString()} pases
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Menú de acciones por tenant. Reemplaza la columna de botones independientes
 * (Entrar/Ver/Suspender) por un solo botón "⋮ Acciones" que despliega un
 * dropdown estilo SaaS. Cierre por click fuera, click en item, o Escape.
 */
function ActionsMenu({
  canEnter,
  canManage,
  isEntering,
  status,
  onEnter,
  onView,
  onDownload,
  onToggleStatus,
  onManageTrial,
  onDuplicate,
  onDelete,
}: {
  canEnter: boolean;
  canManage: boolean;
  isEntering: boolean;
  status: string;
  onEnter: () => void;
  onView: () => void;
  onDownload: () => void;
  onToggleStatus: () => void;
  onManageTrial: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 224,
  });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Calcular posición del menú alineado al botón cada vez que abre o
  // hay scroll/resize. Fix 2026-06-07: el contenedor padre tiene
  // overflow-x-auto que clipea position:absolute. Portal + fixed lo evita.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    function update() {
      const rect = btnRef.current!.getBoundingClientRect();
      const menuW = 240;
      // Alinear a la derecha del botón; clamp dentro del viewport.
      const left = Math.max(8, rect.right - menuW);
      // #9 (2026-06-16): para el ÚLTIMO negocio el menú se abría hacia abajo
      // y se salía del viewport (se veía incompleto). Si no hay espacio
      // abajo y sí arriba, lo abrimos hacia arriba; y siempre clampeamos
      // dentro de la pantalla.
      const menuH = menuRef.current?.offsetHeight ?? 320;
      const spaceBelow = window.innerHeight - rect.bottom;
      let top =
        spaceBelow < menuH + 12 && rect.top > menuH + 12
          ? rect.top - menuH - 6
          : rect.bottom + 6;
      top = Math.max(8, Math.min(top, window.innerHeight - menuH - 8));
      setPos({ top, left, width: menuW });
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function run(fn: () => void) {
    return () => {
      setOpen(false);
      fn();
    };
  }

  const menu = open && mounted ? (
    <div
      ref={menuRef}
      role="menu"
      className="fixed bg-white border border-line2 rounded-lg shadow-xl py-1 text-left text-sm overflow-y-auto"
      style={{
        top: pos.top,
        left: pos.left,
        width: pos.width,
        maxHeight: 'calc(100vh - 16px)',
        zIndex: 9999,
      }}
    >
      <MenuItem icon="📥" label="Descargar" onClick={run(onDownload)} />
      {canEnter && (
        <MenuItem icon="🏢" label="Ir al panel" onClick={run(onEnter)} />
      )}
      <MenuItem icon="👁" label="Ver detalle" onClick={run(onView)} />
      {canManage && (
        <MenuItem
          icon={status === 'ACTIVE' ? '⏸' : '▶'}
          label={status === 'ACTIVE' ? 'Suspender negocio' : 'Activar negocio'}
          onClick={run(onToggleStatus)}
        />
      )}
      {canManage && (
        <MenuItem
          icon="⏱"
          label="Gestionar Trial"
          onClick={run(onManageTrial)}
        />
      )}
      {canManage && (
        <>
          <div className="my-1 border-t border-line2" />
          <MenuItem
            icon="📋"
            label="Duplicar negocio"
            onClick={run(onDuplicate)}
          />
          <MenuItem
            icon="🗑️"
            label="Eliminar negocio"
            danger
            onClick={run(onDelete)}
          />
        </>
      )}
    </div>
  ) : null;

  return (
    <div className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn-ghost text-xs px-3 py-1.5 min-h-0"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {isEntering ? '… Entrando' : 'Acciones ▾'}
      </button>
      {menu && createPortal(menu, document.body)}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-bg2 transition ${
        danger ? 'text-bad' : 'text-ink'
      }`}
    >
      <span className="w-5 text-center text-base leading-none">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// =====================================================
// DeleteTenantModal — Bloque 5 (2026-06-12)
// 3 opciones: Cancelar / Conservar historial / Eliminar todo
// =====================================================
function DeleteTenantModal({
  tenant,
  onClose,
  onConfirm,
}: {
  tenant: { id: string; brandName: string };
  onClose: () => void;
  onConfirm: (opts: { keepHistory: boolean }) => Promise<void> | void;
}) {
  const [mode, setMode] = useState<'choose' | 'confirmHard'>('choose');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  async function runSoft() {
    setBusy(true);
    try {
      await onConfirm({ keepHistory: true });
    } finally {
      setBusy(false);
    }
  }

  async function runHard() {
    if (confirmText.trim() !== '123') return;
    setBusy(true);
    try {
      await onConfirm({ keepHistory: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
        <div className="px-5 py-4 border-b border-line2 flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-bad-soft flex items-center justify-center text-bad shrink-0">
            🗑
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-base">Eliminar negocio</div>
            <div className="text-xs text-mute mt-0.5">{tenant.brandName}</div>
          </div>
        </div>

        {mode === 'choose' && (
          <div className="px-5 py-4 space-y-3">
            <p className="text-sm text-ink">
              Elige cómo quieres eliminar este negocio:
            </p>

            {/* Opción 1: Conservar historial (recomendada) */}
            <button
              type="button"
              onClick={runSoft}
              disabled={busy}
              className="w-full text-left rounded-lg border-2 border-brand bg-brand-soft/40 hover:bg-brand-soft/60 transition p-3 disabled:opacity-60"
            >
              <div className="flex items-start gap-2">
                <div className="text-lg">📚</div>
                <div className="flex-1">
                  <div className="font-semibold text-sm">
                    Conservar historial{' '}
                    <span className="text-[10px] uppercase tracking-wider bg-brand text-white px-1.5 py-0.5 rounded ml-1">
                      recomendado
                    </span>
                  </div>
                  <div className="text-xs text-mute mt-0.5 leading-snug">
                    El negocio queda inaccesible pero las relaciones (pedidos,
                    comisiones, referidos) se preservan para auditoría
                    contable. Las comisiones PAID al afiliado se mantienen
                    intactas.
                  </div>
                </div>
              </div>
            </button>

            {/* Opción 2: Eliminar todo (peligrosa) */}
            <button
              type="button"
              onClick={() => setMode('confirmHard')}
              disabled={busy}
              className="w-full text-left rounded-lg border border-bad/30 bg-bad-soft/30 hover:bg-bad-soft/50 transition p-3 disabled:opacity-60"
            >
              <div className="flex items-start gap-2">
                <div className="text-lg">⚠️</div>
                <div className="flex-1">
                  <div className="font-semibold text-sm text-bad">
                    Eliminar todo (irreversible)
                  </div>
                  <div className="text-xs text-mute mt-0.5 leading-snug">
                    Borra el negocio + clientes + tarjetas + pedidos +
                    comisiones + referidos. Usar solo si la cuenta no tiene
                    actividad crítica (duplicado accidental).
                  </div>
                </div>
              </div>
            </button>
          </div>
        )}

        {mode === 'confirmHard' && (
          <div className="px-5 py-4 space-y-3">
            <p className="text-sm text-ink">
              Vas a <strong>borrar todo</strong> el historial de este negocio.
              Esta acción NO se puede deshacer.
            </p>
            <p className="text-xs text-mute leading-relaxed">
              Se eliminarán: información del negocio, configuraciones, menús,
              tarjetas, clientes, CRM, estadísticas, comisiones y referrals.
            </p>
            <div>
              <label className="block text-xs text-mute mb-1.5">
                Escribe{' '}
                <span className="font-mono font-semibold text-ink bg-bg2 px-1.5 py-0.5 rounded">
                  123
                </span>{' '}
                para confirmar
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoFocus
                autoComplete="off"
                className="w-full bg-white border border-line2 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-bad"
                placeholder="123"
              />
            </div>
          </div>
        )}

        <div className="px-5 py-3 border-t border-line2 flex flex-col-reverse sm:flex-row items-stretch sm:items-center sm:justify-end gap-2">
          {mode === 'confirmHard' && (
            <button
              type="button"
              onClick={() => {
                setMode('choose');
                setConfirmText('');
              }}
              disabled={busy}
              className="btn-ghost text-sm min-h-[44px] disabled:opacity-50"
            >
              ← Volver
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn-ghost text-sm justify-center min-h-[44px] disabled:opacity-50"
          >
            Cancelar
          </button>
          {mode === 'confirmHard' && (
            <button
              type="button"
              onClick={runHard}
              disabled={busy || confirmText.trim() !== '123'}
              className="text-sm font-semibold px-4 py-2 rounded-md bg-bad text-white hover:bg-bad/90 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
            >
              {busy ? 'Eliminando…' : 'Eliminar todo definitivamente'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
