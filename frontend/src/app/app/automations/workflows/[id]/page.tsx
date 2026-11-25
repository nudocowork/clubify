'use client';
/**
 * Editor de un flujo: lienzo + panel lateral + historial.
 *
 * Guardar NO activa (el negocio activa a propósito, viendo antes qué falta y
 * con qué choca). Activar pasa por `validar`: los errores salen en una lista
 * y cada uno abre el paso que lo tiene.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { PanelHeader } from '@/components/PanelHeader';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { useTextos } from '@/components/flujos-visuales/textos';
import { Lienzo } from '@/components/flujos-visuales/Lienzo';
import { PanelNodo, type Catalogo } from '@/components/flujos-visuales/PanelNodo';
import { Historial } from '@/components/flujos-visuales/Historial';
import { IconoFlujo, PildoraEstado } from '@/components/flujos-visuales/IconoFlujo';
import {
  Flujo,
  Hueco,
  Problema,
  TipoNodo,
  actualizar,
  borrar,
  duplicar,
  insertar,
  mover,
  nodoVacio,
  pasosDeRama,
} from '@/components/flujos-visuales/grafo';

type EstadoGuardado = 'limpio' | 'sucio' | 'guardando' | 'error';
type Revision = { errores: Problema[]; avisos: Problema[] };

export default function EditorFlujoPage() {
  const t = useTextos();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [flujo, setFlujo] = useState<Flujo | null>(null);
  const [cat, setCat] = useState<(Catalogo & { negocio?: string }) | null>(null);
  const [guardado, setGuardado] = useState<EstadoGuardado>('limpio');
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [vista, setVista] = useState<'editor' | 'historial'>('editor');
  const [revision, setRevision] = useState<Revision | null>(null);
  const [revisando, setRevisando] = useState(false);
  const [pausando, setPausando] = useState(false);
  const [problemas, setProblemas] = useState<Problema[]>([]);

  useEffect(() => {
    Promise.all([api<Flujo>(`/automations/flujos/${id}`), api<Catalogo>('/automations/flujos/catalogo')])
      .then(([f, c]) => {
        setFlujo(f);
        setCat(c);
        if (!f.triggerType) setSeleccion('trigger');
      })
      .catch((e) => toast(e.message, 'error'));
  }, [id]);

  // Aviso al salir con cambios sin guardar (cerrar pestaña o recargar).
  useEffect(() => {
    if (guardado !== 'sucio') return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [guardado]);

  const cambiar = useCallback((patch: Partial<Flujo>) => {
    setFlujo((f) => (f ? { ...f, ...patch } : f));
    setGuardado('sucio');
  }, []);

  const guardar = useCallback(async (): Promise<boolean> => {
    if (!flujo) return false;
    setGuardado('guardando');
    try {
      const r = await api<Flujo & { huerfanos?: number }>(`/automations/flujos/${flujo.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: flujo.name,
          description: flujo.description,
          triggerType: flujo.triggerType,
          triggerDays: flujo.triggerType === 'INACTIVITY' ? flujo.triggerDays : null,
          triggerConfig: flujo.triggerConfig ?? {},
          reentry: flujo.reentry,
          graph: flujo.graph,
        }),
      });
      setFlujo((f) => (f ? { ...f, status: r.status, schemaVersion: r.schemaVersion } : f));
      setGuardado('limpio');
      if (r.huerfanos) toast(t.huerfanos(r.huerfanos), 'info');
      return true;
    } catch (e: any) {
      setGuardado('error');
      // Un flujo activo con pasos a medias no se guarda: se enseña qué falta.
      if (e.code === 'activo_invalido') await revisar(false);
      else toast(e.message || t.errorGuardar, 'error');
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flujo, t]);

  // Ctrl/⌘+S guarda.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        guardar();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [guardar]);

  async function revisar(abrirDialogo = true) {
    if (!flujo) return;
    setRevisando(true);
    try {
      const r = await api<Revision>(`/automations/flujos/${flujo.id}/validar`, { method: 'POST' });
      setProblemas(r.errores);
      setRevision(abrirDialogo || r.errores.length ? r : null);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setRevisando(false);
    }
  }

  async function pedirActivar() {
    if (guardado === 'sucio' || guardado === 'error') {
      if (!(await guardar())) return;
    }
    await revisar(true);
  }

  // Desde la lista, «Activar» trae aquí con ?activar=1.
  useEffect(() => {
    // Se lee de `location` y no con useSearchParams: este último obliga a un
    // Suspense alrededor de toda la página solo por un parámetro opcional.
    if (flujo && new URLSearchParams(window.location.search).get('activar') === '1') {
      revisar(true);
      router.replace(`/app/automations/workflows/${flujo.id}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flujo?.id]);

  async function activar() {
    if (!flujo) return;
    try {
      const r = await api<Flujo>(`/automations/flujos/${flujo.id}/activar`, { method: 'POST' });
      setFlujo((f) => (f ? { ...f, status: r.status } : f));
      setRevision(null);
      setProblemas([]);
      toast(t.activado, 'success');
    } catch (e: any) {
      toast(e.message, 'error');
      await revisar(true);
    }
  }

  async function pausar() {
    if (!flujo) return;
    try {
      const r = await api<Flujo>(`/automations/flujos/${flujo.id}/pausar`, { method: 'POST' });
      setFlujo((f) => (f ? { ...f, status: r.status } : f));
      setPausando(false);
      toast(t.pausado, 'success');
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  const conProblemas = useMemo(() => new Set(problemas.map((p) => p.nodeId).filter(Boolean) as string[]), [problemas]);

  if (!flujo || !cat) {
    return <div className="h-[70vh] rounded-input bg-surface border border-line animate-pulse" />;
  }

  const onInsertar = (h: Hueco, tipo: TipoNodo) => {
    const n = nodoVacio(tipo);
    cambiar({ graph: insertar(flujo.graph, h, n) });
    setSeleccion(n.id);
  };
  const onBorrar = (nid: string) => {
    const n = flujo.graph.nodes[nid];
    if (n?.type === 'condition' && !window.confirm(t.borrarCondicion(pasosDeRama(flujo.graph, n.no)))) return;
    cambiar({ graph: borrar(flujo.graph, nid) });
    setSeleccion(null);
  };

  const textoGuardado =
    guardado === 'guardando' ? t.guardando : guardado === 'sucio' ? t.sinGuardar : guardado === 'error' ? t.errorGuardar : t.guardado;

  return (
    <div className="flex flex-col" style={{ minHeight: 'calc(100vh - 140px)' }}>
      <PanelHeader title={flujo.name || t.titulo} crumb={t.estado[flujo.status]} />

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Link
          href="/app/automations/workflows"
          onClick={(e) => {
            if (guardado === 'sucio' && !window.confirm(t.salirSinGuardar)) e.preventDefault();
          }}
          className="text-sm text-mute hover:text-ink"
        >
          ← {t.volver}
        </Link>
        <input
          aria-label={t.nombre}
          className="input !py-1.5 max-w-xs font-semibold"
          value={flujo.name}
          onChange={(e) => cambiar({ name: e.target.value })}
        />
        <PildoraEstado estado={flujo.status} t={t} />
        <span
          className={`text-xs ${guardado === 'error' ? 'text-bad' : guardado === 'sucio' ? 'text-warn-ink' : 'text-mute2'}`}
          aria-live="polite"
        >
          {textoGuardado}
        </span>
        <div className="flex gap-2 ml-auto">
          <button className="btn-ghost" onClick={guardar} disabled={guardado === 'guardando' || guardado === 'limpio'}>
            {t.guardar}
          </button>
          {flujo.status === 'active' ? (
            <button className="btn-ghost" onClick={() => setPausando(true)}>
              {t.pausar}
            </button>
          ) : (
            <button className="btn-primary" onClick={pedirActivar} disabled={revisando}>
              {revisando ? t.revisando : t.activar}
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-1 mb-3" role="tablist">
        {(['editor', 'historial'] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={vista === v}
            onClick={() => setVista(v)}
            className={`px-3.5 py-1.5 rounded-pill text-sm ${vista === v ? 'bg-ink text-white' : 'text-mute hover:bg-bg2'}`}
          >
            {v === 'editor' ? t.editor : t.historial}
          </button>
        ))}
      </div>

      {vista === 'historial' ? (
        <Historial flujoId={flujo.id} t={t} />
      ) : (
        <>
          <p className="md:hidden text-xs text-mute mb-2">{t.soloEscritorio}</p>
          <div className="relative flex-1 flex gap-3 min-h-[560px]">
            <div className="flex-1 min-w-0">
              <Lienzo
                grafo={flujo.graph}
                t={t}
                disparador={flujo.triggerType}
                seleccion={seleccion}
                conProblemas={conProblemas}
                disparadorConProblema={problemas.some((p) => !p.nodeId && p.campo)}
                canales={cat.canales}
                onSeleccionar={setSeleccion}
                onInsertar={onInsertar}
              />
            </div>
            {seleccion && (
              <div className="fixed inset-x-0 bottom-0 z-40 max-h-[80vh] rounded-t-2xl overflow-hidden shadow-2xl border border-line md:static md:z-auto md:max-h-none md:w-[380px] md:rounded-input md:shadow-none">
                <PanelNodo
                  t={t}
                  cat={cat}
                  flujo={flujo}
                  seleccion={seleccion}
                  problemas={problemas}
                  negocio={cat.negocio ?? ''}
                  onFlujo={cambiar}
                  onConfig={(nid, config) => cambiar({ graph: actualizar(flujo.graph, nid, config) })}
                  onBorrar={onBorrar}
                  onDuplicar={(nid) => cambiar({ graph: duplicar(flujo.graph, nid) })}
                  onMover={(nid, dir) => cambiar({ graph: mover(flujo.graph, nid, dir) })}
                  onCerrar={() => setSeleccion(null)}
                />
              </div>
            )}
          </div>
        </>
      )}

      {revision && (
        <Dialogo onCerrar={() => setRevision(null)}>
          {revision.errores.length ? (
            <>
              <div className="flex items-center gap-2 text-lg font-semibold text-ink">
                <IconoFlujo nombre="alert" className="text-bad" /> {t.noSePuedeActivar}
              </div>
              <ul className="mt-3 divide-y divide-line">
                {revision.errores.map((p, i) => {
                  const destino = p.nodeId ?? (p.campo && p.campo !== 'name' ? 'trigger' : null);
                  return (
                    <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="text-ink">
                        {destino && destino !== 'trigger' && flujo.graph.nodes[destino] && (
                          <b className="font-medium text-mute">{t.tiposNodo[flujo.graph.nodes[destino].type]}: </b>
                        )}
                        {t.problemas[p.codigo] ?? p.codigo}
                      </span>
                      {destino && (
                        <button
                          className="text-brand-700 font-semibold whitespace-nowrap hover:underline"
                          onClick={() => {
                            setVista('editor');
                            setSeleccion(destino);
                            setRevision(null);
                          }}
                        >
                          {t.irAlPaso} →
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="flex justify-end mt-4">
                <button className="btn-ghost" onClick={() => setRevision(null)}>
                  {t.cerrar}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="text-lg font-semibold text-ink">{t.listoParaActivar}</div>
              <p className="text-sm text-mute mt-2">{t.activarTexto}</p>
              {revision.avisos.map((a, i) => (
                <p key={i} className="mt-3 rounded-input bg-warn-soft text-warn-ink text-sm px-3 py-2">
                  {t.avisos[a.codigo]?.(a.extra?.nombres ?? []) ?? a.codigo}
                </p>
              ))}
              <div className="flex justify-end gap-2 mt-5">
                <button className="btn-ghost" onClick={() => setRevision(null)}>
                  {t.cancelar}
                </button>
                <button className="btn-primary" onClick={activar}>
                  {t.confirmarActivar}
                </button>
              </div>
            </>
          )}
        </Dialogo>
      )}

      {pausando && (
        <Dialogo onCerrar={() => setPausando(false)}>
          <div className="text-lg font-semibold text-ink">{t.pausarTitulo}</div>
          <p className="text-sm text-mute mt-2">{t.pausarTexto}</p>
          <div className="flex justify-end gap-2 mt-5">
            <button className="btn-ghost" onClick={() => setPausando(false)}>
              {t.cancelar}
            </button>
            <button className="btn-primary" onClick={pausar}>
              {t.confirmarPausar}
            </button>
          </div>
        </Dialogo>
      )}
    </div>
  );
}

function Dialogo({ children, onCerrar }: { children: React.ReactNode; onCerrar: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onCerrar]);
  return (
    <div className="fixed inset-0 z-50 bg-ink/40 flex items-end sm:items-center justify-center p-4" onClick={onCerrar}>
      <div role="dialog" aria-modal className="bg-surface rounded-input w-full max-w-lg p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
