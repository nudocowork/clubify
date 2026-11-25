'use client';
/**
 * Historial de un flujo: quién entró, en qué paso va cada uno y, por cliente,
 * la línea de tiempo de lo que pasó. Solo cifras que salen de filas reales
 * (inscripciones y registros de pasos): aperturas y clics no se muestran
 * porque ni Apple ni Google Wallet los informan.
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import type { Textos } from './textos';
import { COLOR_NODO } from './Lienzo';
import { IconoFlujo } from './IconoFlujo';

type Stats = { inscritos: number; enCurso: number; completados: number; cancelados: number; errores: number; enviados: number; fallidos: number };
type Fila = {
  id: string;
  cliente: string;
  estado: string;
  tipoNodoActual: string | null;
  proximaAccion: string | null;
  recorrido: number;
  entro: string;
};
type Paso = {
  id: string;
  recorrido: number;
  tipo: string;
  estado: string;
  motivo: string | null;
  texto: string | null;
  hasta: string | null;
  resultado: string | null;
  fecha: string;
};
type Linea = { id: string; cliente: string; estado: string; recorrido: number; proximaAccion: string | null; pasos: Paso[] };

const ESTILO_ESTADO: Record<string, string> = {
  waiting: 'bg-info-soft text-info-ink',
  running: 'bg-brand-soft text-brand-700',
  done: 'bg-ok-soft text-ok-ink',
  cancelled: 'bg-bg2 text-mute',
  error: 'bg-bad-soft text-bad-ink',
};

const cuando = (s: string | null) =>
  s ? new Date(s).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export function Historial({ flujoId, t }: { flujoId: string; t: Textos }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [estado, setEstado] = useState('');
  const [pagina, setPagina] = useState(0);
  const [datos, setDatos] = useState<{ total: number; filas: Fila[] } | null>(null);
  const [abierta, setAbierta] = useState<Linea | null>(null);

  async function cargar() {
    try {
      const [lista, ej] = await Promise.all([
        api<Array<{ id: string; stats: Stats }>>('/automations/flujos'),
        api<{ total: number; filas: Fila[] }>(`/automations/flujos/${flujoId}/ejecuciones?estado=${estado}&pagina=${pagina}`),
      ]);
      setStats(lista.find((f) => f.id === flujoId)?.stats ?? null);
      setDatos(ej);
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }
  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flujoId, estado, pagina]);

  async function abrir(id: string) {
    try {
      setAbierta(await api<Linea>(`/automations/flujos/${flujoId}/ejecuciones/${id}`));
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  async function sacar(id: string) {
    if (!window.confirm(t.confirmarCancelarRecorrido)) return;
    try {
      await api(`/automations/flujos/${flujoId}/ejecuciones/${id}/cancelar`, { method: 'POST' });
      await Promise.all([cargar(), abrir(id)]);
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  const exito =
    stats && stats.enviados + stats.fallidos > 0 ? Math.round((stats.enviados / (stats.enviados + stats.fallidos)) * 100) : null;

  const filtros: Array<[string, string]> = [
    ['', t.todas],
    ['waiting', t.esperando],
    ['running', t.estadosEjecucion.running],
    ['done', t.completados],
    ['cancelled', t.cancelados],
    ['error', t.errores],
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px rounded-input overflow-hidden border border-line bg-line">
        {[
          [t.inscritos, stats?.inscritos],
          [t.enCurso, stats?.enCurso],
          [t.completados, stats?.completados],
          [t.enviados, stats?.enviados],
          [t.fallidos, stats?.fallidos],
          [t.tasaExito, exito === null ? '—' : `${exito}%`],
        ].map(([l, v]) => (
          <div key={String(l)} className="bg-surface px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-mute2">{l}</div>
            <div className="text-xl font-semibold text-ink tabular-nums mt-0.5">{v ?? '…'}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-1 overflow-x-auto">
        {filtros.map(([k, l]) => (
          <button
            key={k}
            onClick={() => {
              setEstado(k);
              setPagina(0);
            }}
            className={`px-3 py-1.5 rounded-pill text-sm whitespace-nowrap ${estado === k ? 'bg-ink text-white' : 'text-mute hover:bg-bg2'}`}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="rounded-input border border-line bg-surface overflow-x-auto">
        {!datos ? (
          <div className="h-40 animate-pulse" />
        ) : datos.filas.length === 0 ? (
          <p className="text-center text-mute py-12">{t.sinEjecuciones}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-mute2">
              <tr className="border-b border-line">
                <th className="px-4 py-2.5 font-medium">{t.cliente}</th>
                <th className="px-4 py-2.5 font-medium">{t.estadoCol}</th>
                <th className="px-4 py-2.5 font-medium">{t.pasoActual}</th>
                <th className="px-4 py-2.5 font-medium">{t.proxima}</th>
                <th className="px-4 py-2.5 font-medium">{t.entro}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {datos.filas.map((f) => (
                <tr key={f.id} onClick={() => abrir(f.id)} className="cursor-pointer hover:bg-bg/60">
                  <td className="px-4 py-2.5 font-medium text-ink whitespace-nowrap">
                    {f.cliente}
                    {f.recorrido > 1 && <span className="ml-1.5 text-[11px] text-mute2">#{f.recorrido}</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-pill px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${ESTILO_ESTADO[f.estado] ?? ''}`}>
                      {t.estadosEjecucion[f.estado] ?? f.estado}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-mute whitespace-nowrap">{f.tipoNodoActual ? t.tiposNodo[f.tipoNodoActual] : '—'}</td>
                  <td className="px-4 py-2.5 text-mute whitespace-nowrap tabular-nums">{cuando(f.proximaAccion)}</td>
                  <td className="px-4 py-2.5 text-mute whitespace-nowrap tabular-nums">{cuando(f.entro)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {datos && datos.total > 50 && (
        <div className="flex justify-end gap-2">
          <button className="btn-ghost text-sm" disabled={pagina === 0} onClick={() => setPagina((x) => x - 1)}>
            {t.anterior}
          </button>
          <button className="btn-ghost text-sm" disabled={(pagina + 1) * 50 >= datos.total} onClick={() => setPagina((x) => x + 1)}>
            {t.siguiente}
          </button>
        </div>
      )}

      {abierta && (
        <div className="fixed inset-0 z-50 bg-ink/40 flex justify-end" onClick={() => setAbierta(null)}>
          <div className="w-full max-w-md h-full bg-surface overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between px-5 py-4 border-b border-line">
              <div>
                <div className="font-semibold text-ink">{abierta.cliente}</div>
                <span className={`inline-block mt-1 rounded-pill px-2.5 py-0.5 text-[11px] font-semibold ${ESTILO_ESTADO[abierta.estado] ?? ''}`}>
                  {t.estadosEjecucion[abierta.estado] ?? abierta.estado}
                </span>
              </div>
              <button onClick={() => setAbierta(null)} aria-label={t.cerrar} className="text-mute hover:text-ink">
                <IconoFlujo nombre="x" />
              </button>
            </div>
            <ol className="px-5 py-4">
              {abierta.pasos.map((p, i) => {
                const nuevoRecorrido = i === 0 || abierta.pasos[i - 1].recorrido !== p.recorrido;
                const malo = p.estado === 'failed' || p.estado === 'skipped';
                return (
                  <li key={p.id}>
                    {nuevoRecorrido && abierta.pasos.some((x) => x.recorrido > 1) && (
                      <div className="text-[11px] uppercase tracking-wide text-mute2 mb-2 mt-1">{t.recorrido(p.recorrido)}</div>
                    )}
                    <div className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span
                          className="grid place-items-center w-7 h-7 rounded-full shrink-0"
                          style={{ background: '#12203A', color: malo ? '#FCA5A5' : COLOR_NODO[p.tipo] ?? '#94A3B8' }}
                        >
                          <IconoFlujo nombre={p.tipo === 'unknown' ? 'alert' : p.tipo} size={14} />
                        </span>
                        {i < abierta.pasos.length - 1 && <span className="w-px flex-1 bg-line my-1 min-h-[14px]" />}
                      </div>
                      <div className="pb-4 min-w-0">
                        <div className={`text-sm font-medium ${malo ? 'text-bad-ink' : 'text-ink'}`}>
                          {t.lineaTiempo[p.estado] ?? p.estado}
                          {(p.estado === 'waited' || p.estado === 'info') && p.hasta ? ` ${cuando(p.hasta)}` : ''}
                          {p.estado === 'branch' ? ` ${p.resultado === 'yes' ? t.si : t.no}` : ''}
                        </div>
                        {p.motivo && p.estado !== 'info' && <div className="text-xs text-mute">{t.motivos[p.motivo] ?? t.motivos.error_de_envio}</div>}
                        {p.texto && <div className="text-xs text-mute mt-0.5 break-words">«{p.texto}»</div>}
                        <div className="text-[11px] text-mute2 mt-0.5 tabular-nums">{cuando(p.fecha)}</div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            {['waiting', 'running'].includes(abierta.estado) && (
              <div className="px-5 pb-5">
                <button className="btn-ghost !text-bad text-sm" onClick={() => sacar(abierta.id)}>
                  {t.cancelarRecorrido}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
