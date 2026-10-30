'use client';
/**
 * Suscripciones de Hotmart que necesitan atención (doble suscripción,
 * huérfanas cobrando). Vive en la portada del admin porque es la pantalla que
 * el equipo abre todos los días: el caso de Café Macondo (2026-10-16) se
 * descubrió solo porque alguien revisó Hotmart a mano.
 *
 * Si no hay nada pendiente no pinta nada. Una marca blanca recibe 403
 * (SoloPlataformaGuard) y tampoco pinta nada: el error se traga a propósito.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';

type Suscripcion = {
  codigo: string;
  correos: string[];
  telefono: string | null;
  plan: string | null;
  estado: 'al_dia' | 'en_retraso';
  vinculada: boolean;
  reintentos: number;
  ultimoPago: string | null;
  ultimoEvento: string;
  ultimaFecha: string;
};

type Alerta = {
  id: string;
  tipo: 'DOBLE_SUSCRIPCION' | 'SUSCRIPCION_HUERFANA';
  gravedad: 'alta' | 'media';
  negocio: { id: string; nombre: string; vinculo: string; eliminado: boolean } | null;
  suscripciones: Suscripcion[];
  ultimoEvento: string;
  ultimaFecha: string;
  titulo: string;
  recomendacion: string;
};

type Respuesta = { ventanaDias: number; pendientes: Alerta[]; revisadas: Alerta[] };

const EVENTO: Record<string, string> = {
  PURCHASE_APPROVED: 'Pago aprobado',
  PURCHASE_COMPLETE: 'Pago completado',
  PURCHASE_DELAYED: 'Cobro en retraso',
  PURCHASE_BILLET_PRINTED: 'Boleto generado',
};

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });

export function AlertasDeSuscripcion() {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  // Cerrada: abierta empujaba todo el panel hacia abajo cada vez que se entraba.
  // La fila de arriba ya dice cuántas hay.
  const [abierta, setAbierta] = useState(false);
  const [marcando, setMarcando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    api<Respuesta>('/admin/alertas-de-suscripcion')
      .then(setDatos)
      .catch(() => setDatos(null));
  }, []);
  useEffect(cargar, [cargar]);

  async function marcar(id: string) {
    setMarcando(id);
    setError(null);
    try {
      await api('/admin/alertas-de-suscripcion/revisar', {
        method: 'POST',
        body: JSON.stringify({ id, revisada: true }),
      });
      // Se quita al momento; la recarga confirma lo que quedó guardado.
      setDatos((d) => (d ? { ...d, pendientes: d.pendientes.filter((a) => a.id !== id) } : d));
      cargar();
    } catch (e) {
      setError((e as Error).message || 'No se pudo marcar como revisada.');
    } finally {
      setMarcando(null);
    }
  }

  if (!datos || datos.pendientes.length === 0) return null;
  const n = datos.pendientes.length;

  return (
    <div className="card mb-4 border-bad-soft overflow-hidden">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        className="w-full card-pad flex items-center gap-3 bg-bad-soft/40 text-left"
      >
        <div className="w-9 h-9 rounded-lg bg-bad-soft text-bad-ink flex items-center justify-center shrink-0">
          <Icon name="card" size={16} />
        </div>
        <div className="flex-1 text-sm">
          <span className="font-semibold">
            {n} suscripci{n === 1 ? 'ón' : 'ones'} de Hotmart que revisar
          </span>
          <span className="text-mute"> · dobles o cobrando sin negocio, últimos {datos.ventanaDias} días</span>
        </div>
        <span className="badge badge-bad">{n}</span>
        <span className="text-xs text-mute">{abierta ? 'Ocultar' : 'Ver'}</span>
      </button>

      {abierta && (
        <div className="divide-y divide-line">
          {error && <div className="card-pad text-sm text-bad">{error}</div>}
          {datos.pendientes.map((a) => (
            <div key={a.id} className="card-pad">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-[240px]">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`badge ${a.gravedad === 'alta' ? 'badge-bad' : 'badge-warn'}`}>
                      {a.tipo === 'DOBLE_SUSCRIPCION' ? 'Doble suscripción' : 'Sin negocio'}
                    </span>
                    <span className="font-semibold text-sm">{a.titulo}</span>
                  </div>
                  <p className="text-sm">{a.recomendacion}</p>
                </div>
                <button
                  type="button"
                  className="btn-ghost text-sm"
                  disabled={marcando === a.id}
                  onClick={() => marcar(a.id)}
                >
                  <Icon name="check" size={14} />{' '}
                  {marcando === a.id ? 'Marcando…' : 'Marcar como revisada'}
                </button>
              </div>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-mute text-left">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Código</th>
                      <th className="py-1 pr-3 font-medium">Paga con</th>
                      <th className="py-1 pr-3 font-medium">Plan</th>
                      <th className="py-1 pr-3 font-medium">Estado</th>
                      <th className="py-1 font-medium">Último aviso</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.suscripciones.map((s) => (
                      <tr key={s.codigo} className="align-top">
                        <td className="py-1 pr-3 font-mono">
                          {s.codigo}
                          {s.vinculada && <span className="text-mute font-sans"> · vinculada</span>}
                        </td>
                        <td className="py-1 pr-3 break-all">{s.correos.join(', ') || '—'}</td>
                        <td className="py-1 pr-3">{s.plan ?? '—'}</td>
                        <td className="py-1 pr-3">
                          {s.estado === 'en_retraso' ? (
                            <span className="badge badge-bad">
                              En retraso · {s.reintentos} reintento{s.reintentos === 1 ? '' : 's'}
                            </span>
                          ) : (
                            <span className="badge badge-ok">
                              Al día{s.ultimoPago ? ` · pagó ${fecha(s.ultimoPago)}` : ''}
                            </span>
                          )}
                        </td>
                        <td className="py-1">
                          {EVENTO[s.ultimoEvento] ?? s.ultimoEvento} · {fecha(s.ultimaFecha)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
