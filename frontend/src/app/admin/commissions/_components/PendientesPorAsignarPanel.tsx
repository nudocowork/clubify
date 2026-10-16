'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { AffiliatePickerSearch } from '@/components/AffiliatePickerSearch';
import { avisarCambioPendientesPorAsignar } from '@/lib/pendientes-por-asignar';

type Cobro = { fecha: string; montoUsd: number; pasarela: string };

type Pendiente = {
  tenantId: string;
  brandName: string;
  status: string;
  planPeriodicity: string | null;
  primerCobro: Cobro | null;
  cobros: number;
  totalUsd: number;
  // Si viene, el negocio es de un grupo empresarial SIN afiliado: la comisión
  // de un grupo se genera una sola vez sobre su bruto, así que se decide en el
  // grupo y aquí no se ofrece ninguna acción (crearía dos recipientes).
  businessGroup: { id: string; name: string } | null;
};

type VentaDirecta = Omit<Pendiente, 'businessGroup'> & { marcadoEl: string };

const PASARELA: Record<string, string> = {
  HOTMART: 'Hotmart',
  STRIPE: 'Stripe',
  CROSS: 'Cross',
  MANUAL: 'Pago manual',
  MERCADOPAGO: 'Mercado Pago',
};

function fmtUsd(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Igual que el resto del panel de comisiones: el día en hora de Bogotá.
function fmtFecha(d: string) {
  return new Date(d).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Bogota',
  });
}

function ResumenCobro({ fila }: { fila: Pendiente | VentaDirecta }) {
  if (!fila.primerCobro) {
    return (
      <div className="text-[11px] text-mute">
        Suscripción activa sin cobros en Contabilidad
      </div>
    );
  }
  const c = fila.primerCobro;
  return (
    <div className="text-[11px] text-mute">
      Primer cobro: {fmtFecha(c.fecha)} · <strong className="text-ink">{fmtUsd(c.montoUsd)}</strong> ·{' '}
      {PASARELA[c.pasarela] ?? c.pasarela}
      {fila.cobros > 1 && (
        <>
          {' '}· {fila.cobros} cobros, {fmtUsd(fila.totalUsd)} en total
        </>
      )}
    </div>
  );
}

function FilaPendiente({
  fila,
  onListo,
  modo,
}: {
  fila: Pendiente | VentaDirecta;
  onListo: () => void;
  /** «pendiente»: asignar vendedor o venta directa. «directa»: pasar a un vendedor. */
  modo: 'pendiente' | 'directa';
}) {
  const [codeId, setCodeId] = useState('');
  const [guardando, setGuardando] = useState<'vendedor' | 'directa' | null>(null);
  const grupo = 'businessGroup' in fila ? fila.businessGroup : null;

  async function asignar() {
    if (!codeId) {
      toast('Elige un vendedor', 'info');
      return;
    }
    setGuardando('vendedor');
    try {
      await api(`/admin/pendientes-por-asignar/${fila.tenantId}/vendedor`, {
        method: 'POST',
        body: JSON.stringify({ codeId }),
      });
      toast(`Vendedor asignado a ${fila.brandName}`, 'success');
      avisarCambioPendientesPorAsignar();
      onListo();
    } catch (e: any) {
      toast(e?.message ?? 'No se pudo asignar', 'error');
    } finally {
      setGuardando(null);
    }
  }

  async function ventaDirecta() {
    if (
      !confirm(
        `¿Marcar ${fila.brandName} como venta directa? Lo vendió la empresa y no se genera comisión a nadie. ` +
          'Podrás pasarlo a un vendedor más adelante.',
      )
    )
      return;
    setGuardando('directa');
    try {
      await api(`/admin/pendientes-por-asignar/${fila.tenantId}/venta-directa`, {
        method: 'POST',
      });
      toast(`${fila.brandName} quedó como venta directa`, 'success');
      avisarCambioPendientesPorAsignar();
      onListo();
    } catch (e: any) {
      toast(e?.message ?? 'No se pudo marcar', 'error');
    } finally {
      setGuardando(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line2 bg-white px-3 py-2">
      <div className="min-w-[180px] flex-1">
        <Link
          href={`/admin/tenants/${fila.tenantId}`}
          className="text-sm font-medium hover:underline"
        >
          {fila.brandName}
        </Link>
        {fila.status !== 'ACTIVE' && (
          <span className="ml-2 badge text-[10px]">
            {fila.status === 'SUSPENDED' ? 'Suspendido' : fila.status === 'TRIAL' ? 'En prueba' : fila.status}
          </span>
        )}
        <ResumenCobro fila={fila} />
        {modo === 'directa' && 'marcadoEl' in fila && (
          <div className="text-[11px] text-mute">Venta directa desde el {fmtFecha(fila.marcadoEl)}</div>
        )}
        {grupo && (
          <div className="text-[11px] text-amber-700">
            Pertenece al grupo «{grupo.name}»: el vendedor se asigna en el grupo, no en este negocio.
          </div>
        )}
      </div>
      {!grupo && (
        <>
          <div className="min-w-[220px] flex-1">
            <AffiliatePickerSearch value={codeId} onChange={setCodeId} placeholder="Buscar vendedor…" />
          </div>
          <button
            onClick={asignar}
            disabled={!!guardando || !codeId}
            className="text-sm px-3 py-1.5 rounded-md bg-brand text-white disabled:opacity-50"
          >
            {guardando === 'vendedor' ? '…' : 'Asignar vendedor'}
          </button>
          {modo === 'pendiente' && (
            <button
              onClick={ventaDirecta}
              disabled={!!guardando}
              className="text-sm px-3 py-1.5 rounded-md border border-line bg-white text-ink hover:bg-bg2 disabled:opacity-50"
            >
              {guardando === 'directa' ? '…' : 'Venta directa'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * «Pendientes por asignar vendedor» (Javier, 2026-10-16). Reemplaza al aviso
 * «Negocios sin afiliado»: aquel solo veía negocios activos con suscripción de
 * Hotmart, y Habibi Bar Cantina —que pagó $432 por fuera y $68 por Hotmart sin
 * ningún vendedor— no salía. Ahora sale todo negocio de la plataforma con un
 * cobro pagado y sin vendedor, y se puede cerrar como «Venta directa» (lo vendió
 * la empresa, sin comisión) para que deje de aparecer.
 *
 * Solo la plataforma: para una marca blanca el endpoint responde 403 y el
 * panel no se pinta.
 */
export default function PendientesPorAsignarPanel() {
  const [pendientes, setPendientes] = useState<Pendiente[]>([]);
  const [directas, setDirectas] = useState<VentaDirecta[]>([]);
  const [cargado, setCargado] = useState(false);
  const [visible, setVisible] = useState(false);
  const [abierto, setAbierto] = useState(true);
  const [verDirectas, setVerDirectas] = useState(false);

  const cargar = useCallback(() => {
    api<{ pendientes: Pendiente[]; ventasDirectas: VentaDirecta[] }>('/admin/pendientes-por-asignar')
      .then((r) => {
        setPendientes(r?.pendientes ?? []);
        setDirectas(r?.ventasDirectas ?? []);
        setVisible(true);
      })
      .catch(() => setVisible(false))
      .finally(() => setCargado(true));
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (!cargado || !visible) return null;
  if (pendientes.length === 0 && directas.length === 0) return null;

  const hayPendientes = pendientes.length > 0;
  return (
    <div
      className={`card card-pad mb-4 border ${
        hayPendientes ? 'border-amber-200 bg-amber-50/40' : 'border-line2'
      }`}
    >
      <button
        onClick={() => setAbierto((o) => !o)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className={`font-semibold ${hayPendientes ? 'text-amber-800' : 'text-ink'}`}>
          {hayPendientes ? '⚠️ ' : ''}Pendientes por asignar vendedor{' '}
          <span
            className={`ml-1 inline-flex min-w-[22px] justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
              hayPendientes ? 'bg-amber-400 text-amber-950' : 'bg-bg2 text-mute'
            }`}
          >
            {pendientes.length}
          </span>
        </span>
        <span className={`text-xs ${hayPendientes ? 'text-amber-700' : 'text-mute'}`}>
          {abierto ? '▲ ocultar' : '▼ ver'}
        </span>
      </button>
      {abierto && (
        <div className="mt-3 space-y-2">
          {hayPendientes ? (
            <p className="text-xs text-mute">
              Negocios que ya pagaron y no tienen vendedor. Asígnale su vendedor para que la
              comisión salga como siempre, o márcalo como venta directa si lo vendió la empresa:
              así no se genera comisión a nadie y deja de aparecer aquí.
            </p>
          ) : (
            <p className="text-xs text-mute">No hay negocios pendientes. Todo pago tiene vendedor o es venta directa.</p>
          )}
          {pendientes.map((p) => (
            <FilaPendiente key={p.tenantId} fila={p} modo="pendiente" onListo={cargar} />
          ))}

          {directas.length > 0 && (
            <div className="pt-2">
              <button
                onClick={() => setVerDirectas((v) => !v)}
                className="text-xs font-semibold text-mute hover:text-ink"
              >
                {verDirectas ? '▲' : '▼'} Ventas directas ({directas.length})
              </button>
              {verDirectas && (
                <div className="mt-2 space-y-2">
                  <p className="text-xs text-mute">
                    Vendidos por la empresa, sin comisión. Si en realidad lo trajo alguien, asígnale
                    su vendedor y la comisión del ciclo en curso se genera como en cualquier asignación.
                  </p>
                  {directas.map((d) => (
                    <FilaPendiente key={d.tenantId} fila={d} modo="directa" onListo={cargar} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
