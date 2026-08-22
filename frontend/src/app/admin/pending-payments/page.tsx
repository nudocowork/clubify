'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

// PDF Soft 10: panel de "pagó pero no activó". Lista unificada de los 3
// Pending*Payment sin consumir + datos del comprador + link de activación.
//
// «Asignar a negocio»: muchos de estos NO son clientes nuevos, son negocios
// que YA existen cuyo pago no se reconoció (caso MOTILART: el correo del pago
// era del contador, no el de la cuenta, y sus 3 meses recurrentes cayeron
// acá). El modal asigna el pago al negocio real y deja el ciclo como si el
// webhook lo hubiera reconocido bien.
type PendingRow = {
  id: string;
  gateway: 'HOTMART' | 'STRIPE' | 'CROSS';
  email: string;
  name: string | null;
  phone: string | null;
  amountUsd: number | null;
  purchaseDate: string | null;
  activationLink: string;
  createdAt: string;
  ageHours: number;
};

type TenantHit = {
  id: string;
  brandName: string;
  name: string;
  slug: string;
  status: string;
  planPeriodicity: string;
  currentPeriodEnd: string | null;
  lastChargeAt: string | null;
  whiteLabelName: string | null;
  /** Correo de la CUENTA (el del dueño) — el contraste clave del modal. */
  email: string;
};

type AssignPreview = {
  gateway: string;
  paymentEmail: string;
  paymentsToApply: number;
  paidAt: string;
  nextChargeAt: string;
  tenant: {
    id: string;
    brandName: string;
    name: string;
    email: string;
    status: string;
    planPeriodicity: string;
    currentPeriodEnd: string | null;
  };
  emailsDiffer: boolean;
  brandMismatch: boolean;
};

function fmtDate(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
function fmtDateLong(s: string) {
  return new Date(s).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
function fmtAge(h: number) {
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}
function gwBadge(g: string) {
  const map: Record<string, string> = {
    HOTMART: 'bg-orange-100 text-orange-700',
    STRIPE: 'bg-indigo-100 text-indigo-700',
    CROSS: 'bg-emerald-100 text-emerald-700',
  };
  return map[g] ?? 'bg-bg2 text-mute';
}
const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: 'Activo', cls: 'bg-emerald-100 text-emerald-700' },
  SUSPENDED: { label: 'Suspendido', cls: 'bg-red-100 text-red-700' },
  TRIAL: { label: 'Prueba', cls: 'bg-amber-100 text-amber-700' },
};
function statusBadge(status: string) {
  const s = STATUS_LABEL[status] ?? { label: status, cls: 'bg-bg2 text-mute' };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${s.cls}`}>
      {s.label}
    </span>
  );
}

export default function PendingPaymentsPage() {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<PendingRow | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api<PendingRow[]>('/admin/pending-payments');
      setRows(data ?? []);
    } catch (e) {
      // Distinguir "error" de "vacío": sin esto un fallo de red se ve como
      // "no hay pagos pendientes" y nadie persigue los casos.
      setLoadError(
        e instanceof Error ? e.message : 'No se pudieron cargar los pagos pendientes',
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast('Link de activación copiado', 'success');
    } catch {
      toast('No se pudo copiar', 'error');
    }
  }

  async function resend(r: PendingRow) {
    // Stripe/Cross: no hay reenvío automático aún → copiar el link.
    if (r.gateway !== 'HOTMART') {
      copyLink(r.activationLink);
      return;
    }
    setResending(r.email);
    try {
      const res = await api<{ ok: boolean; found: boolean }>(
        '/admin/pending-payments/resend',
        { method: 'POST', body: JSON.stringify({ email: r.email, gateway: r.gateway }) },
      );
      if (res?.ok)
        toast('Enlace reenviado al comprador (email + WhatsApp/SMS)', 'success');
      else toast('No se encontró el pago pendiente para reenviar', 'info');
    } catch {
      toast('Error al reenviar', 'error');
    } finally {
      setResending(null);
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold">Pagos sin activar</h1>
        <button className="btn-ghost text-sm" onClick={load}>
          Actualizar
        </button>
      </div>
      <p className="text-sm text-mute mb-4">
        Compradores que pagaron (Hotmart o la pasarela de la marca) pero aún no
        terminaron de crear su cuenta. Reenvíales el enlace de activación, o si
        el negocio ya existe (paga otra persona: el contador, el socio),
        asígnale el pago directamente.
      </p>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 font-semibold">Pasarela</th>
                <th className="px-4 py-3 font-semibold">Comprador</th>
                <th className="px-4 py-3 font-semibold">Contacto</th>
                <th className="px-4 py-3 font-semibold text-right">Monto</th>
                <th className="px-4 py-3 font-semibold">Fecha de compra</th>
                <th className="px-4 py-3 font-semibold text-center">Espera</th>
                <th className="px-4 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-mute">
                    Cargando…
                  </td>
                </tr>
              )}
              {!loading && loadError && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center">
                    <div className="text-sm text-red-600 mb-2">{loadError}</div>
                    <button className="btn-ghost text-sm" onClick={load}>
                      Reintentar
                    </button>
                  </td>
                </tr>
              )}
              {!loading && !loadError && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-mute">
                    <div className="text-3xl mb-2">✅</div>
                    No hay pagos pendientes de activación.
                  </td>
                </tr>
              )}
              {!loading &&
                !loadError &&
                rows.map((r, i) => (
                  <tr
                    key={`${r.gateway}-${r.email}-${i}`}
                    className="border-t border-line2 hover:bg-bg2/40"
                  >
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${gwBadge(r.gateway)}`}
                      >
                        {r.gateway}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.name ?? '—'}</div>
                      <div className="text-[11px] text-mute">{r.email}</div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {r.phone ? (
                        <a
                          className="text-brand hover:underline"
                          href={`https://wa.me/${r.phone.replace(/[^0-9]/g, '')}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {r.phone}
                        </a>
                      ) : (
                        <span className="text-mute">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {r.amountUsd != null ? `$${r.amountUsd.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      {fmtDate(r.purchaseDate)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                          r.ageHours >= 24
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-bg2 text-mute'
                        }`}
                      >
                        {fmtAge(r.ageHours)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        className="btn-ghost text-xs mr-1"
                        onClick={() => copyLink(r.activationLink)}
                        title={r.activationLink}
                      >
                        Copiar link
                      </button>
                      <button
                        className="btn-ghost text-xs mr-1"
                        onClick={() => setAssigning(r)}
                        title="El pago es de un negocio que ya existe (renovación no reconocida)"
                      >
                        Asignar a negocio
                      </button>
                      <button
                        className="btn-primary text-xs"
                        disabled={resending === r.email}
                        onClick={() => resend(r)}
                      >
                        {resending === r.email
                          ? 'Enviando…'
                          : r.gateway === 'HOTMART'
                            ? 'Reenviar'
                            : 'Copiar'}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {assigning && (
        <AssignToTenantModal
          row={assigning}
          onClose={() => setAssigning(null)}
          onAssigned={() => {
            setAssigning(null);
            load();
          }}
        />
      )}
    </div>
  );
}

/**
 * Modal de «Asignar a negocio»: buscador de negocios activos + confirmación
 * a conciencia. Muestra el correo del PAGO frente al correo del NEGOCIO
 * elegido — que sean distintos es justamente el caso que motiva la función,
 * y quien asigna tiene que verlo antes de confirmar.
 */
function AssignToTenantModal({
  row,
  onClose,
  onAssigned,
}: {
  row: PendingRow;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TenantHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  // «Reintentar» no cambia el texto — sin este contador el efecto de búsqueda
  // no se re-dispararía (React ignora setState con el mismo valor).
  const [searchTick, setSearchTick] = useState(0);

  const [selected, setSelected] = useState<TenantHit | null>(null);
  const [preview, setPreview] = useState<AssignPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Búsqueda con debounce. El guard `alive` evita que una respuesta vieja
  // pise los resultados de lo último que escribió el admin.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearched(false);
      setSearchError(null);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const data = await api<TenantHit[]>(
          `/admin/pending-payments/tenants?q=${encodeURIComponent(q)}`,
        );
        if (!alive) return;
        setResults(data ?? []);
        setSearched(true);
      } catch (e) {
        if (!alive) return;
        setSearchError(
          e instanceof Error ? e.message : 'No se pudo buscar negocios',
        );
      } finally {
        if (alive) setSearching(false);
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, searchTick]);

  async function loadPreview(tenant: TenantHit) {
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    try {
      const p = await api<AssignPreview>('/admin/pending-payments/assign/preview', {
        method: 'POST',
        body: JSON.stringify({
          pendingId: row.id,
          gateway: row.gateway,
          tenantId: tenant.id,
        }),
      });
      setPreview(p);
    } catch (e) {
      setPreviewError(
        e instanceof Error ? e.message : 'No se pudo preparar la asignación',
      );
    } finally {
      setPreviewLoading(false);
    }
  }

  function pick(t: TenantHit) {
    setSelected(t);
    loadPreview(t);
  }

  async function confirm() {
    if (!selected || !preview) return;
    setBusy(true);
    try {
      const r = await api<{
        ok: boolean;
        brandName: string;
        currentPeriodEnd: string;
      }>('/admin/pending-payments/assign', {
        method: 'POST',
        body: JSON.stringify({
          pendingId: row.id,
          gateway: row.gateway,
          tenantId: selected.id,
        }),
      });
      toast(
        `Pago asignado a ${r.brandName}. Próximo cobro: ${fmtDateLong(r.currentPeriodEnd)}.`,
        'success',
      );
      onAssigned();
    } catch (e) {
      toast(
        e instanceof Error ? e.message : 'No se pudo asignar el pago',
        'error',
      );
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
        <div className="px-5 py-4 border-b border-line2">
          <div className="font-semibold">Asignar pago a un negocio existente</div>
          <div className="text-xs text-mute mt-0.5">
            Pago de <span className="font-medium text-ink">{row.email}</span>
            {' · '}
            {row.gateway}
            {row.purchaseDate ? ` · ${fmtDate(row.purchaseDate)}` : ''}
          </div>
        </div>

        {!selected && (
          <div className="px-5 py-4">
            <label className="text-xs font-semibold text-mute uppercase tracking-wider">
              ¿De qué negocio es este pago?
            </label>
            <input
              autoFocus
              className="input w-full mt-1"
              placeholder="Buscar por nombre del negocio o correo de la cuenta…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="mt-3 max-h-72 overflow-y-auto">
              {searching && (
                <div className="py-6 text-center text-sm text-mute">Buscando…</div>
              )}
              {!searching && searchError && (
                <div className="py-6 text-center">
                  <div className="text-sm text-red-600 mb-2">{searchError}</div>
                  <button
                    className="btn-ghost text-sm"
                    onClick={() => setSearchTick((n) => n + 1)}
                  >
                    Reintentar
                  </button>
                </div>
              )}
              {!searching && !searchError && searched && results.length === 0 && (
                <div className="py-6 text-center text-sm text-mute">
                  Ningún negocio coincide con «{query.trim()}».
                </div>
              )}
              {!searching && !searchError && query.trim().length < 2 && (
                <div className="py-6 text-center text-sm text-mute">
                  Escribe al menos 2 caracteres. Puedes buscar por el correo de
                  la cuenta aunque sea distinto al del pago.
                </div>
              )}
              {!searching &&
                !searchError &&
                results.map((t) => (
                  <button
                    key={t.id}
                    className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-bg2 flex items-center justify-between gap-3"
                    onClick={() => pick(t)}
                  >
                    <span className="min-w-0">
                      <span className="block font-medium truncate">
                        {t.brandName}
                        {t.whiteLabelName ? (
                          <span className="text-[11px] text-mute font-normal">
                            {' '}
                            · {t.whiteLabelName}
                          </span>
                        ) : null}
                      </span>
                      <span className="block text-[11px] text-mute truncate">
                        {t.email} · {t.planPeriodicity.toLowerCase()} · vence{' '}
                        {fmtDate(t.currentPeriodEnd)}
                      </span>
                    </span>
                    {statusBadge(t.status)}
                  </button>
                ))}
            </div>
            <div className="mt-3 pt-3 border-t border-line2 flex justify-end">
              <button className="btn-ghost text-sm" onClick={onClose}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {selected && (
          <div className="px-5 py-4">
            {previewLoading && (
              <div className="py-8 text-center text-sm text-mute">
                Preparando la asignación…
              </div>
            )}
            {!previewLoading && previewError && (
              <div className="py-8 text-center">
                <div className="text-sm text-red-600 mb-2">{previewError}</div>
                <button
                  className="btn-ghost text-sm mr-2"
                  onClick={() => loadPreview(selected)}
                >
                  Reintentar
                </button>
                <button
                  className="btn-ghost text-sm"
                  onClick={() => setSelected(null)}
                >
                  Volver
                </button>
              </div>
            )}
            {!previewLoading && preview && (
              <>
                {/* El contraste que hace evidente el porqué de esta función */}
                <div className="rounded-xl border border-line2 divide-y divide-line2 text-sm">
                  <div className="px-3 py-2.5 flex items-center justify-between gap-3">
                    <span className="text-xs text-mute shrink-0">
                      Correo del pago
                    </span>
                    <span className="font-medium truncate">
                      {preview.paymentEmail}
                    </span>
                  </div>
                  <div className="px-3 py-2.5 flex items-center justify-between gap-3">
                    <span className="text-xs text-mute shrink-0">
                      Correo del negocio
                    </span>
                    <span className="font-medium truncate">
                      {preview.tenant.email}
                    </span>
                  </div>
                </div>
                {preview.emailsDiffer && (
                  <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2">
                    Los correos son distintos (paga otra persona: el contador,
                    el socio, la empresa). Confirma que este pago corresponde a{' '}
                    <span className="font-semibold">
                      {preview.tenant.brandName}
                    </span>{' '}
                    antes de asignarlo.
                  </div>
                )}
                {preview.brandMismatch && (
                  <div className="mt-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2">
                    El pago entró por la pasarela de OTRA marca. Verifica que
                    de verdad sea de este negocio.
                  </div>
                )}

                <div className="mt-3 rounded-xl bg-bg2 text-sm px-4 py-3 space-y-1">
                  <div className="font-medium">Al asignar:</div>
                  <ul className="text-[13px] space-y-1 list-disc pl-4">
                    <li>
                      <span className="font-semibold">
                        {preview.tenant.brandName}
                      </span>{' '}
                      quedará <span className="font-semibold">activo</span> y su
                      próximo cobro pasará al{' '}
                      <span className="font-semibold">
                        {fmtDateLong(preview.nextChargeAt)}
                      </span>{' '}
                      (plan {preview.tenant.planPeriodicity.toLowerCase()},
                      pago del {fmtDateLong(preview.paidAt)}).
                    </li>
                    {preview.paymentsToApply > 1 && (
                      <li>
                        Se aplicarán{' '}
                        <span className="font-semibold">
                          {preview.paymentsToApply} pagos
                        </span>{' '}
                        sin reconocer de este comprador (el ciclo sale del más
                        reciente).
                      </li>
                    )}
                    <li>
                      Los próximos cobros de esta suscripción se reconocerán
                      como renovación.
                    </li>
                    <li>
                      No se enviará ningún correo ni mensaje al cliente.
                    </li>
                  </ul>
                </div>

                <div className="mt-4 pt-3 border-t border-line2 flex items-center justify-between">
                  <button
                    className="btn-ghost text-sm"
                    disabled={busy}
                    onClick={() => {
                      setSelected(null);
                      setPreview(null);
                    }}
                  >
                    ← Elegir otro
                  </button>
                  <div className="flex gap-2">
                    <button
                      className="btn-ghost text-sm"
                      disabled={busy}
                      onClick={onClose}
                    >
                      Cancelar
                    </button>
                    <button
                      className="btn-primary text-sm"
                      disabled={busy}
                      onClick={confirm}
                    >
                      {busy ? 'Asignando…' : 'Asignar y activar'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
