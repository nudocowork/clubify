'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { getCategoryBySlug } from '@/lib/business-categories';

/**
 * «Pendientes de aprobación» (Sara, 2026-10-03): los pagos por fuera que
 * registran los closers desde su enlace. Aquí se comprueba que el dinero llegó
 * y se aprueba: eso crea el negocio, lo activa, genera la comisión del closer y
 * apunta el ingreso en Contabilidad, todo de una vez.
 */

type Solicitud = {
  id: string;
  status: 'PENDIENTE' | 'APROBANDO' | 'APROBADO' | 'RECHAZADO';
  closerName: string;
  brandName: string;
  ownerEmail: string;
  ownerPhone: string | null;
  ownerFullName: string;
  planPeriodicity: string;
  businessType: string;
  businessCategorySlug: string | null;
  method: string;
  amount: number;
  currency: string;
  paidAt: string;
  reference: string | null;
  proofUrl: string;
  note: string | null;
  amountUsd: number | null;
  usdSugerido: number;
  precioDelPlanUsd: number;
  createdTenantId: string | null;
  reviewedAt: string | null;
  revisadoPor: string | null;
  rejectReason: string | null;
  lastError: string | null;
  createdAt: string;
};

type Aprobado = {
  tenantId: string;
  ownerEmail: string;
  ownerTempPassword: string | null;
  amountUsd: number;
  comisiones: Array<{ afiliado: string | null; monto: number; estado: string }>;
};

type EnlaceCloser = { id: string; code: string; ownerName: string; role: string; token: string };

const ESTADOS = [
  { v: '', label: 'Pendientes' },
  { v: 'APROBADO', label: 'Aprobadas' },
  { v: 'RECHAZADO', label: 'Rechazadas' },
  { v: 'TODOS', label: 'Todas' },
] as const;

const METODO: Record<string, string> = { NEQUI: 'Nequi', TRANSFERENCIA: 'Transferencia', EFECTIVO: 'Efectivo', OTRO: 'Otro' };
const PERIODO: Record<string, string> = { MENSUAL: 'Mensual', TRIMESTRAL: 'Trimestral', SEMESTRAL: 'Semestral', ANUAL: 'Anual' };
const ROL: Record<string, string> = { VENDOR: 'Vendedor', AMBASSADOR: 'Embajador', INFLUENCER: 'Influencer' };

const fecha = (d: string) =>
  new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Bogota' });
const dinero = (n: number, moneda: string) =>
  `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(n)} ${moneda}`;

function Estado({ s }: { s: Solicitud }) {
  if (s.status === 'APROBADO') return <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-ok-soft text-ok-ink">Aprobada</span>;
  if (s.status === 'RECHAZADO') return <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-bad-soft text-bad-ink">Rechazada</span>;
  if (s.lastError) return <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-bad-soft text-bad-ink">Falló al aprobar</span>;
  if (s.status === 'APROBANDO') return <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-warn-soft text-warn-ink">Aprobando…</span>;
  return <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-warn-soft text-warn-ink">Por aprobar</span>;
}

export default function PendientesDeAprobacion() {
  const [estado, setEstado] = useState<string>('');
  const [filas, setFilas] = useState<Solicitud[] | null>(null);
  const [abierta, setAbierta] = useState<Solicitud | null>(null);
  const [verEnlaces, setVerEnlaces] = useState(false);

  const cargar = useCallback(async () => {
    setFilas(null);
    const q = estado ? `?estado=${estado}` : '';
    setFilas(await api<Solicitud[]>(`/admin/pagos-por-aprobar${q}`).catch(() => []));
  }, [estado]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-ink">
            Pendientes de aprobación{' '}
            <Link href="/admin/tenants" className="text-sm font-normal text-mute hover:text-ink">/ Negocios</Link>
          </h1>
          <p className="text-sm text-mute mt-1 max-w-2xl">
            Pagos por fuera que registraron los closers. Aprobar crea y activa el negocio, genera la comisión del closer y
            registra el ingreso en Contabilidad.
          </p>
        </div>
        <button type="button" className="btn-ghost" onClick={() => setVerEnlaces((v) => !v)}>
          {verEnlaces ? 'Ocultar enlaces' : 'Enlaces de los closers'}
        </button>
      </div>

      {verEnlaces && <EnlacesDeLosClosers />}

      <div className="flex gap-1 bg-bg2 p-1 rounded-xl w-fit">
        {ESTADOS.map((e) => (
          <button
            key={e.v}
            type="button"
            onClick={() => setEstado(e.v)}
            className={`px-3 h-8 rounded-lg text-sm font-semibold transition ${estado === e.v ? 'bg-surface text-ink shadow-sm' : 'text-mute hover:text-ink'}`}
          >
            {e.label}
          </button>
        ))}
      </div>

      {filas === null ? (
        <div className="card card-pad text-mute text-sm">Cargando…</div>
      ) : filas.length === 0 ? (
        <div className="card card-pad text-center text-mute text-sm">
          {estado ? 'No hay registros en esta lista.' : 'No hay pagos esperando aprobación.'}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wider text-mute bg-bg2/60">
              <tr>
                {['Registrado', 'Negocio', 'Closer', 'Plan', 'Pago', 'Estado'].map((h) => (
                  <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((s) => (
                <tr key={s.id} onClick={() => setAbierta(s)} className="border-t border-line2 hover:bg-bg2/40 cursor-pointer">
                  <td className="px-4 py-3 whitespace-nowrap text-mute">{fecha(s.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-ink">{s.brandName}</div>
                    <div className="text-xs text-mute">{s.ownerEmail}</div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{s.closerName}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-mute">{PERIODO[s.planPeriodicity] ?? s.planPeriodicity}</td>
                  <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                    <div className="font-semibold">{dinero(s.amount, s.currency)}</div>
                    <div className="text-xs text-mute">{METODO[s.method] ?? s.method} · {fecha(s.paidAt)}</div>
                  </td>
                  <td className="px-4 py-3"><Estado s={s} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {abierta && (
        <Detalle
          solicitud={abierta}
          onClose={() => setAbierta(null)}
          onCambio={() => void cargar()}
        />
      )}
    </div>
  );
}

function Detalle({ solicitud: s, onClose, onCambio }: { solicitud: Solicitud; onClose: () => void; onCambio: () => void }) {
  const [usd, setUsd] = useState(String(s.usdSugerido));
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(s.lastError);
  const [aprobado, setAprobado] = useState<Aprobado | null>(null);
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const pendiente = s.status === 'PENDIENTE';
  const esPdf = /\.pdf($|\?)/i.test(s.proofUrl);
  const categoria = s.businessCategorySlug ? getCategoryBySlug(s.businessCategorySlug) : null;

  async function aprobar() {
    const monto = Number(usd.replace(',', '.'));
    if (!(monto > 0)) {
      setError('Escribe el monto en dólares que entra a Contabilidad.');
      return;
    }
    setTrabajando(true);
    setError(null);
    try {
      const r = await api<Aprobado>(`/admin/pagos-por-aprobar/${s.id}/aprobar`, {
        method: 'POST',
        body: JSON.stringify({ amountUsd: monto }),
      });
      setAprobado(r);
      toast('Pago aprobado: el negocio quedó activo', 'success');
      onCambio();
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo aprobar.');
      onCambio();
    } finally {
      setTrabajando(false);
    }
  }

  async function rechazar() {
    setTrabajando(true);
    setError(null);
    try {
      await api(`/admin/pagos-por-aprobar/${s.id}/rechazar`, { method: 'POST', body: JSON.stringify({ motivo }) });
      toast('Registro rechazado', 'success');
      onCambio();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo rechazar.');
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Pago de ${s.brandName}`}
        className="bg-surface w-full sm:max-w-3xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-surface border-b border-line px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-bold text-ink">{s.brandName}</div>
            <div className="text-sm text-mute">
              Registrado por <b className="text-ink">{s.closerName}</b> el {fecha(s.createdAt)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Estado s={s} />
            <button type="button" onClick={onClose} className="btn-ghost h-8 px-2" aria-label="Cerrar">✕</button>
          </div>
        </div>

        {aprobado ? (
          <div className="p-5 space-y-4">
            <div className="rounded-xl bg-ok-soft text-ok-ink px-4 py-3 text-sm">
              Negocio creado y activo. Ingreso de <b>US$ {aprobado.amountUsd}</b> registrado en Contabilidad.
            </div>
            <div className="card card-pad space-y-2 text-sm">
              <div className="font-semibold text-ink">Acceso del dueño</div>
              <Dato k="Correo" v={aprobado.ownerEmail} />
              {aprobado.ownerTempPassword ? (
                <Dato k="Contraseña temporal" v={aprobado.ownerTempPassword} copiable />
              ) : (
                <div className="text-mute text-xs">La contraseña se generó en un intento anterior; puedes cambiarla desde la ficha del negocio.</div>
              )}
            </div>
            <div className="card card-pad space-y-1 text-sm">
              <div className="font-semibold text-ink">Comisión</div>
              {aprobado.comisiones.length ? (
                aprobado.comisiones.map((c, i) => (
                  <div key={i} className="flex justify-between"><span>{c.afiliado ?? '—'}</span><b className="tabular-nums">US$ {c.monto}</b></div>
                ))
              ) : (
                <div className="text-bad text-xs">No se generó comisión. Revisa la ficha del negocio y pulsa «Generar comisión ahora».</div>
              )}
            </div>
            <Link href={`/admin/tenants/${aprobado.tenantId}`} className="btn-primary w-full justify-center">Ir al negocio</Link>
          </div>
        ) : (
          <div className="p-5 grid md:grid-cols-[1fr_280px] gap-5">
            <div className="space-y-4 text-sm">
              <Bloque titulo="El negocio">
                <Dato k="Nombre comercial" v={s.brandName} />
                <Dato k="Dueño" v={s.ownerFullName} />
                <Dato k="Correo" v={s.ownerEmail} />
                <Dato k="Teléfono" v={s.ownerPhone ?? '—'} />
                <Dato k="Periodicidad" v={PERIODO[s.planPeriodicity] ?? s.planPeriodicity} />
                <Dato k="Categoría" v={categoria ? `${categoria.emoji} ${categoria.name}` : '—'} />
                <Dato k="Producto" v={s.businessType === 'INFOLINK' ? 'Solo InfoLink' : 'Completo'} />
              </Bloque>
              <Bloque titulo="El pago">
                <Dato k="Monto" v={dinero(s.amount, s.currency)} />
                <Dato k="Método" v={METODO[s.method] ?? s.method} />
                <Dato k="Fecha del pago" v={fecha(s.paidAt)} />
                <Dato k="Referencia" v={s.reference ?? '—'} />
                {s.note && <Dato k="Nota del closer" v={s.note} />}
              </Bloque>
              {s.status === 'RECHAZADO' && (
                <div className="rounded-xl bg-bad-soft text-bad-ink px-4 py-3">
                  Rechazada{s.revisadoPor ? ` por ${s.revisadoPor}` : ''}: {s.rejectReason}
                </div>
              )}
              {s.status === 'APROBADO' && (
                <div className="rounded-xl bg-ok-soft text-ok-ink px-4 py-3 flex items-center justify-between gap-3">
                  <span>Aprobada{s.revisadoPor ? ` por ${s.revisadoPor}` : ''}{s.amountUsd != null ? ` · US$ ${s.amountUsd} a Contabilidad` : ''}</span>
                  {s.createdTenantId && <Link href={`/admin/tenants/${s.createdTenantId}`} className="font-semibold underline">Ver negocio</Link>}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">Comprobante</div>
              <a href={s.proofUrl} target="_blank" rel="noreferrer" className="block rounded-xl border border-line overflow-hidden bg-bg2 hover:border-brand transition">
                {esPdf ? (
                  <div className="p-6 text-center text-sm">📄 Abrir el PDF del comprobante</div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.proofUrl} alt="Comprobante de pago" className="w-full max-h-[420px] object-contain" />
                )}
              </a>
              <div className="text-xs text-mute">Toca para verlo en grande.</div>
            </div>

            {pendiente && (
              <div className="md:col-span-2 border-t border-line pt-4 space-y-3">
                {error && <div role="alert" className="rounded-xl bg-bad-soft text-bad-ink px-4 py-3 text-sm">{error}</div>}
                {!rechazando ? (
                  <>
                    <label className="block max-w-xs">
                      <span className="label">Monto que entra a Contabilidad (USD)</span>
                      <input className="input w-full tabular-nums" inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} />
                    </label>
                    <p className="text-xs text-mute max-w-xl">
                      {s.currency === 'USD'
                        ? 'Es lo que el closer dice que pagó.'
                        : `Pagó en ${s.currency}: se propone el precio del plan ${(PERIODO[s.planPeriodicity] ?? '').toLowerCase()} (US$ ${s.precioDelPlanUsd}).`}{' '}
                      Será también el precio pactado del negocio, la base de su comisión y de sus renovaciones.
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      <button type="button" className="btn-primary" disabled={trabajando} onClick={aprobar}>
                        {trabajando ? 'Aprobando…' : 'Aprobar pago manual'}
                      </button>
                      <button type="button" className="btn-ghost" disabled={trabajando} onClick={() => setRechazando(true)}>
                        Rechazar
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <label className="block">
                      <span className="label">¿Por qué se rechaza?</span>
                      <textarea className="input w-full min-h-[72px]" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: la transferencia no llegó, el comprobante no se lee…" />
                    </label>
                    <div className="flex gap-2">
                      <button type="button" className="btn-primary bg-bad hover:bg-bad-ink border-bad" disabled={trabajando || !motivo.trim()} onClick={rechazar}>
                        {trabajando ? 'Rechazando…' : 'Rechazar registro'}
                      </button>
                      <button type="button" className="btn-ghost" disabled={trabajando} onClick={() => setRechazando(false)}>Volver</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-1.5">{titulo}</div>
      <div className="divide-y divide-line2 border-y border-line2">{children}</div>
    </div>
  );
}

function Dato({ k, v, copiable }: { k: string; v: string; copiable?: boolean }) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <span className="text-mute shrink-0">{k}</span>
      <span className="text-ink text-right break-all flex items-center gap-2">
        <span className={copiable ? 'font-mono' : ''}>{v}</span>
        {copiable && (
          <button
            type="button"
            className="text-xs text-brand-700 font-semibold"
            onClick={() => navigator.clipboard.writeText(v).then(() => toast('Copiado', 'success'))}
          >
            Copiar
          </button>
        )}
      </span>
    </div>
  );
}

function EnlacesDeLosClosers() {
  const [enlaces, setEnlaces] = useState<EnlaceCloser[] | null>(null);
  const [busca, setBusca] = useState('');
  useEffect(() => {
    api<EnlaceCloser[]>('/admin/pagos-por-aprobar/enlaces').then(setEnlaces).catch(() => setEnlaces([]));
  }, []);
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (enlaces ?? []).filter((e) => !q || e.ownerName.toLowerCase().includes(q) || e.code.toLowerCase().includes(q));
  }, [enlaces, busca]);

  return (
    <div className="card card-pad space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="font-semibold text-ink">Enlace de cada closer</div>
          <div className="text-xs text-mute">Cada closer registra sus pagos desde el suyo: el afiliado queda puesto solo.</div>
        </div>
        <input className="input h-9 text-sm w-60" placeholder="Buscar closer o código…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>
      {enlaces === null ? (
        <div className="text-mute text-sm">Cargando…</div>
      ) : (
        <div className="max-h-72 overflow-y-auto divide-y divide-line2">
          {visibles.map((e) => {
            const url = `${base}/registro-pago/${e.token}`;
            return (
              <div key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-semibold text-ink truncate">{e.ownerName}</div>
                  <div className="text-xs text-mute">{ROL[e.role] ?? e.role} · {e.code}</div>
                </div>
                <button
                  type="button"
                  className="btn-ghost h-8 text-xs shrink-0"
                  onClick={() => navigator.clipboard.writeText(url).then(() => toast(`Enlace de ${e.ownerName} copiado`, 'success'))}
                >
                  Copiar enlace
                </button>
              </div>
            );
          })}
          {!visibles.length && <div className="text-mute text-sm py-2">Ningún closer coincide.</div>}
        </div>
      )}
    </div>
  );
}
