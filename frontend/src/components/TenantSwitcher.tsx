'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, startImpersonation } from '@/lib/api';
import { toast } from './Toast';

const RECENTS_KEY = 'clubify:tenant_switcher:recents';
const PINS_KEY = 'clubify:tenant_switcher:pins';
const RECENT_LIMIT = 5;

type Tenant = {
  id: string;
  brandName: string;
  email: string;
  status: string;
  plan?: { name: string } | null;
};

function loadIds(key: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveIds(key: string, ids: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {}
}

function initial(name: string) {
  return (name?.[0] ?? '?').toUpperCase();
}

function statusEmoji(s: string) {
  if (s === 'ACTIVE') return '🟢';
  if (s === 'TRIAL') return '🟡';
  if (s === 'SUSPENDED') return '🔴';
  return '⚪';
}

/**
 * Switcher de subcuentas inspirado en el pattern de GHL: trigger en
 * el sidebar, abre popup con buscador (nombre/marca/email), sección
 * de anclados, recientes y todas las cuentas. Click → impersonate.
 *
 * Recientes y pins viven en localStorage del super admin (per-device).
 */
export function TenantSwitcher() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [pins, setPins] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Carga inicial al abrir
  useEffect(() => {
    if (!open) return;
    setPins(loadIds(PINS_KEY));
    setRecents(loadIds(RECENTS_KEY));
    if (tenants.length === 0) {
      setLoading(true);
      api<Tenant[]>('/tenants')
        .then(setTenants)
        .catch(() => null)
        .finally(() => setLoading(false));
    }
    // Foco al search al abrir
    setTimeout(() => inputRef.current?.focus(), 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Click fuera + Esc para cerrar
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function togglePin(id: string) {
    const next = pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id];
    setPins(next);
    saveIds(PINS_KEY, next);
  }

  async function enter(t: Tenant) {
    if (enteringId || t.status === 'SUSPENDED') return;
    setEnteringId(t.id);
    try {
      const res = await api<any>(`/tenants/${t.id}/impersonate`, {
        method: 'POST',
      });
      const newRecents = [t.id, ...recents.filter((r) => r !== t.id)].slice(
        0,
        RECENT_LIMIT,
      );
      saveIds(RECENTS_KEY, newRecents);
      startImpersonation({
        accessToken: res.accessToken,
        user: res.user,
        tenant: { id: res.tenant.id, brandName: res.tenant.brandName },
      });
      toast(`Entrando a ${res.tenant.brandName}…`, 'success');
      setOpen(false);
      router.push('/app');
    } catch (e: any) {
      toast(e.message || 'No se pudo entrar', 'error');
      setEnteringId(null);
    }
  }

  const term = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!term) return tenants;
    return tenants.filter((t) => {
      const hay = `${t.brandName ?? ''} ${t.email ?? ''}`.toLowerCase();
      return hay.includes(term);
    });
  }, [term, tenants]);

  const tenantById = useMemo(
    () => new Map(tenants.map((t) => [t.id, t])),
    [tenants],
  );
  const pinnedTenants = useMemo(
    () => pins.map((id) => tenantById.get(id)).filter(Boolean) as Tenant[],
    [pins, tenantById],
  );
  const recentTenants = useMemo(
    () =>
      recents
        .filter((id) => !pins.includes(id))
        .map((id) => tenantById.get(id))
        .filter(Boolean) as Tenant[],
    [recents, pins, tenantById],
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-[10px] text-sm transition ${
          open
            ? 'bg-[#172534] text-white'
            : 'bg-sidebar-hover text-white hover:bg-[#172534]'
        }`}
      >
        <span className="w-7 h-7 rounded-full bg-brand text-white text-[11px] font-bold flex items-center justify-center flex-none">
          🔁
        </span>
        <span className="truncate flex-1 text-left text-[12.5px] leading-tight">
          Cambiar de subcuenta
          <span className="block text-[10px] text-sidebar-mute font-normal">
            Click para escoger un negocio
          </span>
        </span>
        <span className="text-sidebar-mute text-xs">▾</span>
      </button>

      {open && (
        <div className="fixed sm:absolute inset-x-2 sm:inset-x-auto sm:left-full sm:top-0 sm:ml-3 sm:w-[420px] mt-12 sm:mt-0 bg-white text-ink rounded-2xl shadow-2xl border border-line z-50 max-h-[80vh] overflow-hidden flex flex-col">
          <div className="p-3 border-b border-line2">
            <input
              ref={inputRef}
              type="text"
              placeholder="🔍 Buscar por nombre o email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input"
            />
          </div>
          <div className="overflow-y-auto flex-1 px-2 py-2">
            {loading && tenants.length === 0 && (
              <div className="text-center py-8 text-mute text-sm">
                Cargando…
              </div>
            )}

            {!term && pinnedTenants.length > 0 && (
              <Section
                label="ANCLADOS"
                tenants={pinnedTenants}
                onEnter={enter}
                onTogglePin={togglePin}
                pins={pins}
                enteringId={enteringId}
              />
            )}

            {!term && recentTenants.length > 0 && (
              <Section
                label="RECIENTES"
                tenants={recentTenants}
                onEnter={enter}
                onTogglePin={togglePin}
                pins={pins}
                enteringId={enteringId}
              />
            )}

            <Section
              label={term ? 'RESULTADOS' : 'TODAS LAS CUENTAS'}
              tenants={filtered}
              onEnter={enter}
              onTogglePin={togglePin}
              pins={pins}
              enteringId={enteringId}
            />

            {!loading && filtered.length === 0 && (
              <div className="text-center py-8 text-mute text-sm">
                <div className="text-3xl mb-1">🔎</div>
                Sin resultados para “{search}”
              </div>
            )}
          </div>

          <div className="border-t border-line2 px-3 py-2 text-[11px] text-mute flex items-center justify-between">
            <span>{tenants.length} subcuentas en total</span>
            <kbd className="bg-bg2 px-1.5 py-0.5 rounded text-[10px] font-mono">
              Esc
            </kbd>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================
//                          Section
// =============================================================

function Section({
  label,
  tenants,
  onEnter,
  onTogglePin,
  pins,
  enteringId,
}: {
  label: string;
  tenants: Tenant[];
  onEnter: (t: Tenant) => void;
  onTogglePin: (id: string) => void;
  pins: string[];
  enteringId: string | null;
}) {
  if (tenants.length === 0) return null;
  return (
    <div className="mb-2">
      <div className="text-[10px] uppercase tracking-[0.16em] text-mute font-semibold px-2.5 pt-2 pb-1.5">
        {label}
      </div>
      <div className="space-y-0.5">
        {tenants.map((t) => {
          const pinned = pins.includes(t.id);
          const disabled = t.status === 'SUSPENDED' || enteringId === t.id;
          return (
            <div
              key={t.id}
              className={`group flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition ${
                disabled
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:bg-bg2 cursor-pointer'
              }`}
              onClick={() => !disabled && onEnter(t)}
              title={t.status === 'SUSPENDED' ? 'Negocio suspendido' : ''}
            >
              <div className="w-9 h-9 rounded-full bg-bg2 flex items-center justify-center text-sm font-bold text-ink flex-none">
                {initial(t.brandName)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate flex items-center gap-1.5">
                  {t.brandName}
                  <span className="text-[10px]">{statusEmoji(t.status)}</span>
                </div>
                <div className="text-[11px] text-mute truncate">
                  {t.email}
                  {t.plan?.name && (
                    <span className="ml-1.5">· {t.plan.name}</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePin(t.id);
                }}
                className={`flex-none w-7 h-7 rounded flex items-center justify-center text-sm transition ${
                  pinned
                    ? 'text-brand opacity-100'
                    : 'text-mute opacity-0 group-hover:opacity-100 hover:text-brand'
                }`}
                title={pinned ? 'Quitar del anclado' : 'Anclar arriba'}
              >
                📌
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
