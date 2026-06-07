'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, getUser, startImpersonation } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
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

  async function deleteTenant(t: any) {
    try {
      await api(`/tenants/${t.id}`, { method: 'DELETE' });
      toast(`${t.brandName} eliminado`, 'success');
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
          {!isMarketing && (
            <Link className="btn-primary" href="/admin/tenants/new">
              <Icon name="plus" /> Nuevo negocio
            </Link>
          )}
        </div>
      </div>

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
              {['Negocio', 'Plan', 'Estado', 'Trial', 'Pedidos 30d', 'Revenue 30d', 'Clientes', ''].map(
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
                  <td colSpan={8} className="px-4 py-3.5">
                    <div className="h-6 bg-bg2 rounded animate-shimmer" />
                  </td>
                </tr>
              ))}
            {!loading && visible.length === 0 && (
              <tr>
                <td className="px-4 py-12 text-center" colSpan={8}>
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
        <ConfirmDeleteModal
          title="Eliminar negocio"
          confirmLabel="Eliminar definitivamente"
          requireText="123"
          description={
            <>
              <p>
                ¿Estás seguro de que deseas eliminar este negocio?
              </p>
              <p className="mt-2">Esta acción eliminará:</p>
              <ul className="mt-1 list-disc list-inside text-mute space-y-0.5">
                <li>Información del negocio</li>
                <li>Configuraciones</li>
                <li>Menús</li>
                <li>Tarjetas</li>
                <li>CRM asociado</li>
                <li>Estadísticas</li>
              </ul>
              <p className="mt-3 text-bad font-medium">
                Esta acción no se puede deshacer.
              </p>
            </>
          }
          onConfirm={() => deleteTenant(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
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
      const top = rect.bottom + 6;
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
      className="fixed bg-white border border-line2 rounded-lg shadow-xl py-1 text-left text-sm"
      style={{
        top: pos.top,
        left: pos.left,
        width: pos.width,
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
