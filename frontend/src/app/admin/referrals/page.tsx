'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  SIGNED_UP: { text: 'Inscrito', cls: 'bg-bg2 text-mute' },
  ACTIVE: { text: 'En trial', cls: 'bg-amber-100 text-amber-800' },
  PAYING: { text: 'Pagando', cls: 'bg-ok-soft text-ok' },
  CHURNED: { text: 'Canceló', cls: 'bg-red-100 text-red-800' },
};

export default function AdminReferrals() {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [commissionFor, setCommissionFor] = useState<{
    useId: string;
    tenantBrand: string;
  } | null>(null);
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [showLinkGen, setShowLinkGen] = useState(false);
  const [linkSource, setLinkSource] = useState('');

  const baseOrigin =
    typeof window !== 'undefined' ? window.location.origin : 'https://soyclubify.com';
  const captureLink = linkSource.trim()
    ? `${baseOrigin}/refer?source=${encodeURIComponent(linkSource.trim())}`
    : `${baseOrigin}/refer`;

  async function copyCaptureLink() {
    try {
      await navigator.clipboard.writeText(captureLink);
      toast('Link copiado al portapapeles', 'success');
    } catch {
      toast('No se pudo copiar — selecciona y copia manualmente', 'error');
    }
  }

  async function load() {
    try {
      setLoading(true);
      setList(await api('/referrals'));
    } catch (e: any) {
      toast(e.message || 'Error cargando referidos', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function submitCommission() {
    if (!commissionFor) return;
    const n = Number(amount);
    if (!n || n <= 0) {
      toast('Monto inválido', 'error');
      return;
    }
    setSaving(true);
    try {
      await api(`/referrals/uses/${commissionFor.useId}/commission`, {
        method: 'POST',
        body: JSON.stringify({ amount: n }),
      });
      toast(`Comisión de USD ${n} agregada`, 'success');
      setCommissionFor(null);
      setAmount('');
      load();
    } catch (e: any) {
      toast(e.message || 'No se pudo agregar la comisión', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(commId: string, status: string) {
    try {
      await api(`/referrals/commissions/${commId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      toast(`Comisión marcada como ${status === 'PAID' ? 'pagada' : status}`, 'success');
      load();
    } catch (e: any) {
      toast(e.message || 'No se pudo actualizar', 'error');
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Referidos <span className="page-crumb">/ {list.length} códigos</span>
        </h1>
        <button
          type="button"
          className="btn-primary"
          onClick={() => setShowLinkGen(true)}
        >
          <Icon name="plus" /> Generar link de captación
        </button>
      </div>

      <div className="space-y-3.5">
        {loading && (
          <>
            <div className="card card-pad">
              <div className="h-5 bg-bg2 rounded w-1/3 animate-shimmer" />
              <div className="mt-3 h-4 bg-bg2 rounded w-2/3 animate-shimmer" />
            </div>
            <div className="card card-pad">
              <div className="h-5 bg-bg2 rounded w-1/4 animate-shimmer" />
            </div>
          </>
        )}
        {!loading && list.length === 0 && (
          <div className="card card-pad text-center py-12">
            <div className="text-4xl mb-2">🔗</div>
            <div className="font-semibold">Aún no hay códigos de referido</div>
            <p className="text-sm text-mute mt-1.5 max-w-md mx-auto">
              Cuando un usuario genere su código en /refer aparecerá aquí con
              sus inscritos y comisiones acumuladas.
            </p>
          </div>
        )}
        {!loading &&
          list.map((r) => (
            <div key={r.id} className="card card-pad">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="font-semibold flex items-center gap-2 flex-wrap">
                    <span>{r.ownerName}</span>
                    <span className="font-mono text-mute font-normal text-sm">
                      · {r.code}
                    </span>
                  </div>
                  <div className="text-xs text-mute mt-0.5 break-all">
                    {r.ownerEmail} · {r.ownerWhatsapp}
                  </div>
                </div>
                <div className="text-sm flex items-center gap-2 flex-wrap">
                  <span className="badge badge-info">
                    {Number(r.commissionPercent)}% comisión
                  </span>
                  {r.source && (
                    <span
                      className="badge badge-mute text-[11px]"
                      title="Origen del afiliado (?source en el link de captación)"
                    >
                      📣 {r.source}
                    </span>
                  )}
                  <span className="text-xs text-mute">
                    {r.uses.length} inscritos
                  </span>
                </div>
              </div>
              <div className="mt-3 divide-y divide-line2">
                {r.uses.length === 0 && (
                  <div className="py-3 text-sm text-mute italic">
                    Sin conversiones aún.
                  </div>
                )}
                {r.uses.map((u: any) => {
                  const st = STATUS_LABEL[u.status] ?? {
                    text: u.status,
                    cls: 'bg-bg2 text-mute',
                  };
                  return (
                    <div
                      key={u.id}
                      className="py-3 text-sm flex flex-wrap items-center gap-3"
                    >
                      <div className="font-medium min-w-[140px] flex-1">
                        {u.tenant?.brandName ?? '—'}
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${st.cls}`}
                      >
                        {st.text}
                      </span>
                      <div className="flex flex-wrap gap-1.5 flex-1">
                        {u.commissions.length === 0 && (
                          <span className="text-mute text-xs">
                            Sin comisiones
                          </span>
                        )}
                        {u.commissions.map((c: any) => (
                          <span
                            key={c.id}
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] ${
                              c.status === 'PAID'
                                ? 'bg-ok-soft text-ok'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            USD {Number(c.amount).toFixed(2)} · {c.status}
                            {c.status !== 'PAID' && (
                              <button
                                className="underline hover:no-underline"
                                onClick={() => setStatus(c.id, 'PAID')}
                              >
                                marcar pagada
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                      <button
                        className="text-xs text-brand hover:underline whitespace-nowrap"
                        onClick={() =>
                          setCommissionFor({
                            useId: u.id,
                            tenantBrand: u.tenant?.brandName ?? 'Tenant',
                          })
                        }
                      >
                        + comisión
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
      </div>

      {/* Modal: agregar comisión */}
      {commissionFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-ink/60"
            onClick={() => !saving && setCommissionFor(null)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6">
            <h2 className="font-bold text-lg">Agregar comisión</h2>
            <p className="text-sm text-mute mt-1">
              Para inscrito en{' '}
              <b className="text-ink">{commissionFor.tenantBrand}</b>.
            </p>
            <div className="mt-4">
              <label className="label">Monto (USD)</label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="input"
                placeholder="15.00"
                onKeyDown={(e) => e.key === 'Enter' && submitCommission()}
              />
              <p className="text-xs text-mute mt-1.5">
                La comisión queda en estado PENDING. Marca como pagada cuando
                hagas la transferencia.
              </p>
            </div>
            <div className="mt-5 flex gap-2 justify-end">
              <button
                onClick={() => setCommissionFor(null)}
                disabled={saving}
                className="btn-ghost text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={submitCommission}
                disabled={saving || !amount}
                className="btn-primary text-sm disabled:opacity-50"
              >
                {saving ? 'Guardando…' : 'Agregar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: generar link de captación de afiliados */}
      {showLinkGen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-ink/60"
            onClick={() => setShowLinkGen(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <h2 className="font-bold text-lg">Link de captación de afiliados</h2>
            <p className="text-sm text-mute mt-1.5 leading-relaxed">
              Comparte este link con quien quieras invitar al programa. Cuando
              se registre obtiene <b className="text-ink">su propio código y
              link personalizado</b> para promocionar Clubify.
            </p>

            <div className="mt-4">
              <label className="label">Etiqueta de origen (opcional)</label>
              <input
                type="text"
                value={linkSource}
                onChange={(e) => setLinkSource(e.target.value)}
                className="input"
                placeholder="instagram, podcast-mayo, evento-X…"
              />
              <p className="text-xs text-mute mt-1.5">
                Útil para saber por qué canal llegó cada afiliado. Solo letras,
                números y guiones.
              </p>
            </div>

            <div className="mt-4">
              <label className="label">Tu link</label>
              <div className="flex items-stretch gap-2">
                <input
                  readOnly
                  value={captureLink}
                  className="input flex-1 font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  type="button"
                  onClick={copyCaptureLink}
                  className="btn-primary text-sm whitespace-nowrap"
                >
                  Copiar
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(
                    `Te invito a unirte al programa de afiliados de Clubify y ganar comisiones por cada negocio que registres. Regístrate aquí: ${captureLink}`,
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs btn-ghost"
                >
                  💬 Compartir por WhatsApp
                </a>
                <a
                  href={captureLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs btn-ghost"
                >
                  ↗ Abrir página
                </a>
              </div>
            </div>

            <div className="mt-5 flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowLinkGen(false);
                  setLinkSource('');
                }}
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
