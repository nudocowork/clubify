'use client';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { DisparadoresEditor, DisparadoresModal, FiltroFila, TarjetasDeDisparadores } from '@/components/flujos/DisparadoresEditor';
import {
  disparadoresDelFlujo,
  disparadorNuevo,
  type Disparador as DisparadorDelFlujo,
  type FiltrosCat,
  type OperadorCat,
} from '@/components/flujos/disparadores';
import { aplicarPlantilla, campoObligatorio, campoVisible } from '@/components/flujos/resumen';
import { PruebaDeEnvio } from '@/components/flujos/PruebaDeEnvio';

/** Raíz de las rutas de este constructor. La usan el catálogo y las pruebas. */
const BASE = '/admin/marketing/workflows';

// Builder visual de workflows de EMAIL MARKETING (contact-based). Backend:
// /admin/marketing/workflows/*. Árbol de nodos con ramas (sin pan/zoom, robusto).
// El proveedor de envío NUNCA se nombra en la UI.


type Stats = { active: number; completed: number };
type WF = {
  id: string; name: string; folderId: string | null; status: string;
  /** `trigger` es el primero de `triggers`; vacío = flujo de antes (se lee `[trigger]`). */
  trigger: any; triggers?: any[]; rootId: string | null; nodes: Record<string, WFNode>;
  drip: any; sendWindow: any; reentry: boolean; createdAt?: string; _stats: Stats;
};
type Folder = { id: string; name: string; createdAt?: string };
type WFNode = {
  id: string; type: string; config: any;
  next?: string | null; yes?: string | null; no?: string | null;
  /** Una salida por caso, para los pasos que abren N ramas (`branch_reply`). */
  branches?: Record<string, string | null>;
};

// ── CATÁLOGO: lo sirve el backend ──────────────────────────────────────────
// Hasta el 2026-09-21 el catálogo estaba COPIADO A MANO acá y se desincronizó
// del motor: esta pantalla ofrecía el disparador «Etiqueta agregada» —con su
// campo y todo— y en el backend no existía un solo `fireTrigger('tag_added')`,
// así que quien lo configuraba esperaba un flujo que no arrancaba nunca. Ahora
// hay una sola fuente —`GET /admin/marketing/workflows/catalogo`— y esta
// pantalla se dibuja con lo que venga: añadir un paso en el backend no obliga
// a tocar este archivo.
type Opcion = { value: string; label: string };
type CampoDeConfig = {
  key: string;
  label: string;
  tipo: 'texto' | 'textarea' | 'numero' | 'select' | 'fechaHora' | 'condiciones' | 'casos' | 'cabeceras' | 'flujo' | 'paso';
  /** Las de los embudos, etapas y miembros ya vienen completadas por el servidor. */
  opciones?: (Opcion & { singular?: string })[];
  def?: string | number;
  ayuda?: string;
  requerido?: boolean;
  /** No se pinta cuando ESE otro campo del paso tiene valor (la plantilla tapa el cuerpo). */
  ocultoSi?: string;
  /** Obligatorio SALVO que ese otro campo tenga valor. */
  requeridoSalvo?: string;
};
type Disparador = { key: string; label: string; grupo: string; latencia: 'minutos' | 'hora'; hint?: string; campos?: CampoDeConfig[]; filtros?: FiltrosCat };
/** `prueba` dice que el paso MANDA algo y por qué canal: con eso se dibuja «Enviar prueba». */
type Paso = { key: string; label: string; grupo: string; icono: string; ramas?: 'siNo' | 'casos'; ramaSi?: string; ramaNo?: string; hint?: string; campos: CampoDeConfig[]; resumen?: string; prueba?: 'sms' | 'email' };
type Catalogo = {
  disparadores: Disparador[];
  pasos: Paso[];
  campos: { key: string; label: string }[];
  merge: { key: string; label: string }[];
  operadores: OperadorCat[];
};

// Red de seguridad para cuando la petición del catálogo falla (servidor caído,
// sesión vencida): la pantalla sigue usable con lo que el motor lleva
// ejecutando desde siempre, y avisa arriba de que va en modo reducido.
// A PROPÓSITO no trae los pasos nuevos: si los trajera volveríamos a tener dos
// catálogos que se desincronizan, que es justo el bug que esto vino a cerrar.
const CATALOGO_MINIMO: Catalogo = {
  disparadores: [
    { key: 'manual', label: 'Inscripción manual / lista', grupo: 'General', latencia: 'minutos', hint: 'Los inscribes tú desde la pestaña «Inscribir».' },
  ],
  pasos: [
    { key: 'send_email', label: 'Enviar correo', grupo: 'Mensaje', icono: '✉️', campos: [{ key: 'subject', label: 'Asunto', tipo: 'texto', requerido: true }, { key: 'body', label: 'Contenido', tipo: 'textarea', requerido: true }] },
    { key: 'send_sms', label: 'Enviar SMS', grupo: 'Mensaje', icono: '💬', campos: [{ key: 'message', label: 'Mensaje', tipo: 'textarea', requerido: true }] },
    { key: 'wait_delay', label: 'Espera (tiempo)', grupo: 'Espera', icono: '⏱', campos: [{ key: 'amount', label: 'Cuánto', tipo: 'numero', def: 1 }, { key: 'unit', label: 'Unidad', tipo: 'select', def: 'days', opciones: [{ value: 'minutes', label: 'minutos' }, { value: 'hours', label: 'horas' }, { value: 'days', label: 'días' }, { value: 'weeks', label: 'semanas' }] }] },
    { key: 'condition', label: 'Si / No (condición)', grupo: 'Lógica', icono: '🔀', ramas: 'siNo', campos: [{ key: 'conditions', label: 'Condiciones', tipo: 'condiciones' }, { key: 'match', label: 'Se cumple si', tipo: 'select', def: 'all', opciones: [{ value: 'all', label: 'se cumplen todas' }, { value: 'any', label: 'se cumple alguna' }] }] },
    { key: 'add_tag', label: 'Agregar etiqueta', grupo: 'Contacto', icono: '🏷', campos: [{ key: 'tag', label: 'Etiqueta a agregar', tipo: 'texto', requerido: true }] },
  ],
  campos: [{ key: 'nombre', label: 'Nombre' }, { key: 'email', label: 'Correo' }, { key: 'tags', label: 'Etiquetas' }],
  merge: [{ key: 'nombre', label: 'Nombre' }, { key: 'email', label: 'Correo' }, { key: 'marca', label: 'Marca' }],
  operadores: [{ value: 'eq', label: 'es igual a' }, { value: 'neq', label: 'no es' }, { value: 'contains', label: 'contiene' }, { value: 'filled', label: 'tiene algo' }],
};

// El catálogo viaja por contexto: lo pide la pantalla una vez y lo leen el
// lienzo, el menú «+» y el panel del paso sin pasarlo de props en props.
const CatalogoCtx = createContext<{ cat: Catalogo; degradado: boolean }>({ cat: CATALOGO_MINIMO, degradado: false });
const useCatalogo = () => useContext(CatalogoCtx);

// El color va por FAMILIA de paso, no por paso suelto: así el lienzo se lee de
// un vistazo y un paso nuevo del backend nace ya con su color.
const COLOR_GRUPO: Record<string, { chip: string; color: string }> = {
  Mensaje: { chip: '#dbeafe', color: '#2563eb' },
  Espera: { chip: '#ede9fe', color: '#7c3aed' },
  'Lógica': { chip: '#e0e7ff', color: '#4f46e5' },
  Contacto: { chip: '#fae8ff', color: '#a21caf' },
  Ventas: { chip: '#dcfce7', color: '#15803d' },
  'Integración': { chip: '#f1f5f9', color: '#475569' },
  Salida: { chip: '#fee2e2', color: '#b91c1c' },
};
const colorDeGrupo = (g?: string) => COLOR_GRUPO[g ?? ''] ?? { chip: '#f1f5f9', color: '#64748b' };

const pasoDef = (cat: Catalogo, type: string): Paso | null => cat.pasos.find((p) => p.key === type) ?? null;
/** Lo que necesita una tarjeta para pintarse, aunque el paso ya no esté en el catálogo. */
function metaPaso(cat: Catalogo, type: string) {
  const def = pasoDef(cat, type);
  return { def, label: def?.label ?? type, icon: def?.icono ?? '•', hint: def?.hint ?? '', grupo: def?.grupo ?? '—', ...colorDeGrupo(def?.grupo) };
}
/** Agrupa conservando el orden en que el backend mandó los grupos. */
function porGrupo<T extends { grupo: string }>(items: T[]): { grupo: string; items: T[] }[] {
  const out: { grupo: string; items: T[] }[] = [];
  for (const it of items) {
    const found = out.find((g) => g.grupo === it.grupo);
    if (found) found.items.push(it); else out.push({ grupo: it.grupo, items: [it] });
  }
  return out;
}
/**
 * Las acciones de un workflow, en un menú.
 *
 * En la fila solo había «Duplicar». Publicar, volver a borrador, exportar o
 * borrar obligaban a entrar al flujo — o no se podían hacer desde aquí. El
 * backend ya las soportaba todas; lo que faltaba era el menú.
 */
function FilaMenu({
  publicado,
  busy,
  onEditar,
  onEstado,
  onDuplicar,
  onExportar,
  onBorrar,
}: {
  publicado: boolean;
  busy: boolean;
  onEditar: () => void;
  onEstado: () => void;
  onDuplicar: () => void;
  onExportar: () => void;
  onBorrar: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const item =
    'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100';
  const cerrarY = (fn: () => void) => () => {
    setAbierto(false);
    fn();
  };
  return (
    <div className="relative inline-block text-left">
      <button
        onClick={() => setAbierto((v) => !v)}
        aria-label="Acciones"
        className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        ⋮
      </button>
      {abierto && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAbierto(false)} />
          <div className="absolute right-0 z-50 mt-1 w-56 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
            <button onClick={cerrarY(onEditar)} className={item}>
              <span className="w-4 text-center">✏️</span> Editar flujo
            </button>
            <button onClick={cerrarY(onEstado)} disabled={busy} className={item}>
              <span className="w-4 text-center">{publicado ? '⏸' : '▶'}</span>{' '}
              {publicado ? 'Desactivar (borrador)' : 'Activar (publicar)'}
            </button>
            <button onClick={cerrarY(onDuplicar)} disabled={busy} className={item}>
              <span className="w-4 text-center">⧉</span> Duplicar
            </button>
            <button onClick={cerrarY(onExportar)} className={item}>
              <span className="w-4 text-center">↓</span> Exportar JSON
            </button>
            <div className="my-1 border-t border-slate-100" />
            <button
              onClick={cerrarY(onBorrar)}
              disabled={busy}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-rose-600 hover:bg-rose-50"
            >
              <span className="w-4 text-center">✕</span> Eliminar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function uid() { try { return 'n' + crypto.randomUUID().slice(0, 8); } catch { return 'n' + Math.random().toString(36).slice(2, 10); } }
function casoId() { try { return 'c' + crypto.randomUUID().slice(0, 6); } catch { return 'c' + Math.random().toString(36).slice(2, 8); } }
function casosPorDefecto() {
  return [
    { id: casoId(), label: 'Dice que sí', palabras: 'sí, claro, dale, me interesa' },
    { id: casoId(), label: 'Dice que no', palabras: 'no, no me interesa, ahora no' },
  ];
}
/** Los valores con los que nace un paso, según lo que pida su catálogo. */
function configInicial(def: Paso | null): any {
  const cfg: any = {};
  for (const campo of def?.campos ?? []) {
    if (campo.tipo === 'condiciones' || campo.tipo === 'cabeceras') cfg[campo.key] = [];
    else if (campo.tipo === 'casos') cfg[campo.key] = casosPorDefecto();
    else if (campo.def !== undefined) cfg[campo.key] = campo.def;
  }
  return cfg;
}
function casosDe(node: WFNode | null | undefined): { id: string; label?: string; palabras?: string }[] {
  const v = node?.config?.casos;
  return Array.isArray(v) ? v.filter((r: any) => r && r.id) : [];
}
function fmtDate(s?: string) { return s ? new Date(s).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; }
// `.input` global: bajo `.brand-panel` el foco lo tiñe la marca (coral en
// Sellea) sin escribir un color aquí, igual que en BrandWorkflowsPanel.
const inp = 'input';

export default function EmailMarketingWorkflows() {
  const [loading, setLoading] = useState(true);
  const [wfs, setWfs] = useState<WF[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cat, setCat] = useState<Catalogo>(CATALOGO_MINIMO);
  const [degradado, setDegradado] = useState(false);

  async function load() {
    setLoading(true);
    try { const d: any = await api('/admin/marketing/workflows'); setWfs(d?.workflows ?? []); setFolders(d?.folders ?? []); }
    catch { /* noop */ } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    api(`${BASE}/catalogo`)
      .then((d: any) => {
        if (d?.pasos?.length && d?.disparadores?.length) { setCat(d); setDegradado(false); }
        else setDegradado(true);
      })
      .catch(() => setDegradado(true));
  }, []);

  async function addWf() {
    setBusy(true);
    try { const w: any = await api('/admin/marketing/workflows', { method: 'POST', body: JSON.stringify({ name: 'Nuevo workflow' }) }); setWfs((p) => [{ ...w, folderId: null, nodes: {}, drip: {}, sendWindow: {}, _stats: { active: 0, completed: 0 } }, ...p]); setOpenId(w.id); }
    catch (e: any) { toast(e.message ?? 'Error', 'error'); } finally { setBusy(false); }
  }
  async function duplicate(id: string) {
    setBusy(true);
    try { const w: any = await api(`/admin/marketing/workflows/${id}/duplicate`, { method: 'POST' }); setWfs((p) => [{ ...w, _stats: { active: 0, completed: 0 } }, ...p]); }
    catch { await load(); } finally { setBusy(false); }
  }

  /** Publicar o volver a borrador desde la lista, sin entrar al flujo. */
  async function cambiarEstado(id: string, publicar: boolean) {
    setBusy(true);
    try {
      await api(`/admin/marketing/workflows/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: publicar ? 'published' : 'draft' }),
      });
      await load();
      toast(publicar ? 'Workflow publicado' : 'Workflow en borrador', 'success');
    } catch (e: any) {
      toast(e.message ?? 'Error', 'error');
    } finally {
      setBusy(false);
    }
  }

  /** Borra, preguntando antes: un flujo publicado se lleva sus inscritos. */
  async function borrar(id: string, nombre: string) {
    if (!window.confirm(`¿Eliminar el workflow «${nombre}»? No se puede deshacer.`)) return;
    setBusy(true);
    try {
      await api(`/admin/marketing/workflows/${id}`, { method: 'DELETE' });
      await load();
      toast('Workflow eliminado', 'success');
    } catch (e: any) {
      toast(e.message ?? 'Error', 'error');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Se descarga el flujo tal cual, para guardarlo o llevarlo a otra marca.
   * Sale del que ya está en la lista: no hace falta volver a pedirlo.
   */
  function exportar(w: any) {
    const blob = new Blob([JSON.stringify(w, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workflow-${(w.name || 'sin-nombre').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const open = wfs.find((w) => w.id === openId) ?? null;
  const contenido = open ? (
    <Editor
      key={open.id}
      wf={open}
      otros={wfs.filter((w) => w.id !== open.id)}
      onBack={() => { setOpenId(null); load(); }}
      onDeleted={() => { setWfs((p) => p.filter((w) => w.id !== open.id)); setOpenId(null); }}
    />
  ) : loading ? (
    <div className="py-10 text-center text-sm text-slate-400">Cargando…</div>
  ) : (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-slate-500">Flujos por correo/SMS a tus contactos, con esperas, ramas, ventana horaria y reintentos.</p>
        <div className="ml-auto">
          <button onClick={addWf} disabled={busy} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white">+ Nuevo workflow</button>
        </div>
      </div>
      {degradado && <AvisoCatalogo />}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
            <tr className="[&>th]:px-3 [&>th]:py-2.5"><th>Nombre</th><th>Estado</th><th>Inscritos</th><th>Activos</th><th>Creado</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {wfs.map((w) => (
              <tr key={w.id} className="[&>td]:px-3 [&>td]:py-3 hover:bg-slate-50/70">
                <td><button onClick={() => setOpenId(w.id)} className="flex items-center gap-2 font-medium text-slate-800 hover:underline">{w.name} <span className="text-slate-400">↗</span></button></td>
                <td><span className="rounded-full px-2 py-0.5 text-[11px]" style={w.status === 'published' ? { background: '#dcfce7', color: '#15803d' } : { background: '#f1f5f9', color: '#64748b' }}>{w.status === 'published' ? 'Publicado' : 'Borrador'}</span></td>
                <td className="text-slate-800">{w._stats.active + w._stats.completed}</td>
                <td className="text-slate-800">{w._stats.active}</td>
                <td className="whitespace-nowrap text-slate-400">{fmtDate(w.createdAt)}</td>
                <td className="text-right">
                  <FilaMenu
                    publicado={w.status === 'published'}
                    busy={busy}
                    onEditar={() => setOpenId(w.id)}
                    onEstado={() => cambiarEstado(w.id, w.status !== 'published')}
                    onDuplicar={() => duplicate(w.id)}
                    onExportar={() => exportar(w)}
                    onBorrar={() => borrar(w.id, w.name)}
                  />
                </td>
              </tr>
            ))}
            {wfs.length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-400">Aún no hay workflows. Crea el primero.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );

  return <CatalogoCtx.Provider value={{ cat, degradado }}>{contenido}</CatalogoCtx.Provider>;
}

function AvisoCatalogo() {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      No se pudo leer la lista de pasos del servidor: se está mostrando la reducida. Vuelve a cargar la página
      antes de crear un flujo nuevo — desde aquí no verás los pasos que sí existen.
    </div>
  );
}

type Tab = 'creador' | 'config' | 'inscribir' | 'registros';
function Editor({ wf, otros, onBack, onDeleted }: { wf: WF; otros: WF[]; onBack: () => void; onDeleted: () => void }) {
  const { cat, degradado } = useCatalogo();
  const [tab, setTab] = useState<Tab>('creador');
  const [name, setName] = useState(wf.name);
  const [status, setStatus] = useState(wf.status);
  // Varios disparadores: entra si casa cualquiera. Un flujo de antes trae la
  // lista vacía y se lee su `trigger`, igual que en el motor.
  const [disparadores, setDisparadores] = useState<DisparadorDelFlujo[]>(() => disparadoresDelFlujo(wf));
  // El modal «Disparadores» y a cuál llevar la vista al abrirlo.
  const [modalDisparadores, setModalDisparadores] = useState<{ enfocar: number | null } | null>(null);
  const [drip, setDrip] = useState<any>(wf.drip || {});
  const [win, setWin] = useState<any>(wf.sendWindow || {});
  const [reentry, setReentry] = useState(wf.reentry);
  const [nodes, setNodes] = useState<Record<string, WFNode>>(wf.nodes || {});
  const [root, setRoot] = useState<string | null>(wf.rootId);
  const [editNode, setEditNode] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const touch = () => setDirty(true);

  function insert(type: string, oldChild: string | null, setSlot: (v: string | null) => void) {
    const id = uid();
    const def = pasoDef(cat, type);
    const config = configInicial(def);
    // Lo que colgaba del hueco se reengancha en la PRIMERA salida del paso
    // nuevo: nunca se pierde media rama por meter un paso en medio.
    let node: WFNode;
    if (def?.ramas === 'siNo') node = { id, type, config, yes: oldChild, no: null };
    // En un paso por casos, lo que ya colgaba pasa a «Cualquier otra»: así el
    // flujo que había sigue valiendo para todos y los casos se van llenando.
    else if (def?.ramas === 'casos') node = { id, type, config, branches: {}, next: oldChild };
    else node = { id, type, config, next: oldChild };
    setNodes((n) => ({ ...n, [id]: node })); setSlot(id); touch(); setEditNode(id);
  }
  function setField(nodeId: string, field: 'next' | 'yes' | 'no', v: string | null) { setNodes((n) => ({ ...n, [nodeId]: { ...n[nodeId], [field]: v } })); touch(); }
  function setBranch(nodeId: string, casoId2: string, v: string | null) {
    setNodes((n) => ({ ...n, [nodeId]: { ...n[nodeId], branches: { ...(n[nodeId].branches || {}), [casoId2]: v } } }));
    touch();
  }
  function del(node: WFNode, setSlot: (v: string | null) => void) {
    // Se conserva la primera rama con algo colgado: quitar un «Si/No» no puede
    // llevarse por delante toda la secuencia que venía debajo.
    const primeraRama = Object.values(node.branches || {}).find((v) => !!v) ?? null;
    setSlot(node.next ?? node.yes ?? primeraRama ?? null); touch();
  }
  function patchNode(id: string, cfg: any) { setNodes((n) => ({ ...n, [id]: { ...n[id], config: { ...n[id].config, ...cfg } } })); touch(); }
  function patchNodeRaw(id: string, patch: Partial<WFNode>) { setNodes((n) => ({ ...n, [id]: { ...n[id], ...patch } })); touch(); }

  async function save(publish?: boolean) {
    setBusy(true);
    const reach = new Set<string>();
    const walk = (id?: string | null) => {
      if (!id || reach.has(id) || !nodes[id]) return;
      reach.add(id);
      walk(nodes[id].next); walk(nodes[id].yes); walk(nodes[id].no);
      for (const v of Object.values(nodes[id].branches || {})) walk(v);
    };
    walk(root);
    const pruned: Record<string, WFNode> = {}; reach.forEach((id) => { pruned[id] = nodes[id]; });
    const st = publish != null ? (publish ? 'published' : 'draft') : status;
    try {
      // Solo `triggers`: el servidor escribe `trigger` con el primero, para que
      // lo que todavía lee el campo de antes vea el de siempre.
      await api(`/admin/marketing/workflows/${wf.id}`, { method: 'PATCH', body: JSON.stringify({ name, status: st, triggers: disparadores, rootId: root, nodes: pruned, drip, sendWindow: win, reentry }) });
      setNodes(pruned); setStatus(st); setDirty(false); toast('Guardado', 'success');
    } catch (e: any) { toast(e.message ?? 'Error al guardar', 'error'); } finally { setBusy(false); }
  }
  async function remove() { if (!window.confirm('¿Eliminar este workflow?')) return; setBusy(true); try { await api(`/admin/marketing/workflows/${wf.id}`, { method: 'DELETE' }); onDeleted(); } catch (e: any) { toast(e.message ?? 'Error', 'error'); setBusy(false); } }

  function cambiarDisparadores(d: DisparadorDelFlujo[]) { setDisparadores(d); touch(); }
  // Abrir el modal cierra el panel del paso: dos capas encima del lienzo y la
  // tecla Escape no sabría cuál cerrar.
  function abrirDisparadores(enfocar: number | null) { setEditNode(null); setModalDisparadores({ enfocar }); }
  function anadirDisparador() {
    cambiarDisparadores([...disparadores, disparadorNuevo(cat)]);
    abrirDisparadores(disparadores.length);
  }
  const editorDeDisparadores = {
    disparadores,
    onChange: cambiarDisparadores,
    catalogo: cat,
    sujeto: 'contacto' as const,
    // Los campos propios del disparador (la etiqueta) con el mismo control que los pasos.
    renderCampo: (campo: CampoDeConfig, valor: unknown, onChange: (v: unknown) => void) => (
      <CampoControl campo={campo} valor={valor} onChange={onChange} />
    ),
  };
  const algunoAutomatico = disparadores.some((d) => d.type !== 'manual');

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-50">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
        <button onClick={onBack} className="rounded-lg px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-100">← Lista</button>
        <input value={name} onChange={(e) => { setName(e.target.value); touch(); }} className="min-w-0 max-w-[220px] flex-1 rounded-lg px-2 py-1 text-sm font-semibold text-slate-800 outline-none hover:bg-slate-50" />
        <nav className="mx-auto flex items-center gap-1">
          {([['creador', 'Creador'], ['config', 'Configuración'], ['inscribir', 'Inscribir'], ['registros', 'Registro']] as [Tab, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 text-sm ${tab === k ? 'font-semibold text-brand' : 'text-slate-500'}`}>{l}</button>
          ))}
        </nav>
        <button onClick={() => save()} disabled={busy || !dirty} className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50">Guardar</button>
        <div className="flex items-center gap-2 text-sm">
          <span className={status === 'published' ? 'text-slate-400' : 'font-medium text-slate-700'}>Borrador</span>
          <button onClick={() => save(status !== 'published')} disabled={busy || !root} title={!root ? 'Agrega al menos un paso' : ''} className={`relative h-5 w-9 rounded-full ${status === 'published' ? 'bg-brand' : 'bg-slate-300'}`}><span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: status === 'published' ? 18 : 2 }} /></button>
          <span className={status === 'published' ? 'font-medium text-brand' : 'text-slate-400'}>Publicar</span>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-auto">
        {tab === 'creador' && (
          <div className="min-h-full bg-slate-50 [background-image:radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:22px_22px] p-6">
            <div className="flex flex-col items-center pb-40">
              {degradado && <div className="mb-3 w-[320px]"><AvisoCatalogo /></div>}
              {/* Una tarjeta por disparador + «Añadir». Antes era una tarjeta
                  suelta que no se podía ni pulsar: para cambiar el disparador
                  había que saber que vivía en la pestaña Configuración. */}
              <TarjetasDeDisparadores disparadores={disparadores} catalogo={cat} sujeto="contacto" onAbrir={abrirDisparadores} onAnadir={anadirDisparador} />
              <Slot value={root} setSlot={(v: string | null) => { setRoot(v); touch(); }} nodes={nodes} onInsert={insert} onEdit={setEditNode} onDelete={del} setField={setField} setBranch={setBranch} depth={0} />
            </div>
          </div>
        )}
        {tab === 'config' && (
          <div className="p-5"><div className="mx-auto max-w-2xl space-y-4">
            <Card title="Disparadores">
              {/* El mismo editor que el modal del lienzo: los campos, los filtros y
                  los operadores salen del catálogo del servidor. */}
              <DisparadoresEditor {...editorDeDisparadores} />
              {algunoAutomatico && <p className="mt-3 rounded-md bg-brand-soft px-3 py-2 text-xs text-slate-700">⚡ Publica el workflow para activarlo: hasta entonces ningún disparador inscribe a nadie.</p>}
            </Card>
            <Card title="Goteo (Drip)"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!drip.enabled} onChange={(e) => { setDrip({ ...drip, enabled: e.target.checked }); touch(); }} /> No enviar todos de golpe</label>{drip.enabled && <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-slate-500">Enviar a <input type="number" value={drip.batchSize ?? 50} onChange={(e) => { setDrip({ ...drip, batchSize: +e.target.value }); touch(); }} className="w-20 rounded border border-slate-300 px-2 py-1" /> contactos cada <input type="number" value={drip.intervalMinutes ?? 10} onChange={(e) => { setDrip({ ...drip, intervalMinutes: +e.target.value }); touch(); }} className="w-20 rounded border border-slate-300 px-2 py-1" /> min</div>}</Card>
            <Card title="Ventana de envío"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!win.enabled} onChange={(e) => { setWin({ ...win, enabled: e.target.checked }); touch(); }} /> Enviar solo en cierto horario</label>{win.enabled && <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-slate-500">De <input type="number" value={win.startHour ?? 8} onChange={(e) => { setWin({ ...win, startHour: +e.target.value }); touch(); }} className="w-16 rounded border border-slate-300 px-2 py-1" />h a <input type="number" value={win.endHour ?? 20} onChange={(e) => { setWin({ ...win, endHour: +e.target.value }); touch(); }} className="w-16 rounded border border-slate-300 px-2 py-1" />h <label className="ml-2 flex items-center gap-1"><input type="checkbox" checked={!!win.skipWeekends} onChange={(e) => { setWin({ ...win, skipWeekends: e.target.checked }); touch(); }} /> saltar findes</label></div>}</Card>
            <Card title="Re-entrada"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={reentry} onChange={(e) => { setReentry(e.target.checked); touch(); }} /> Permitir que un mismo contacto vuelva a entrar</label></Card>
            <button onClick={remove} className="text-sm text-rose-500">Eliminar workflow</button>
          </div></div>
        )}
        {tab === 'inscribir' && <EnrollTab workflowId={wf.id} published={status === 'published'} />}
        {tab === 'registros' && <LogsTab workflowId={wf.id} />}
      </div>

      {editNode && nodes[editNode] && (
        <NodeConfig
          node={nodes[editNode]}
          flujos={otros}
          nodos={nodes}
          onClose={() => setEditNode(null)}
          onPatch={(cfg) => patchNode(editNode, cfg)}
          onNode={(patch) => patchNodeRaw(editNode, patch)}
        />
      )}
      {modalDisparadores && (
        <DisparadoresModal {...editorDeDisparadores} enfocar={modalDisparadores.enfocar} onClose={() => setModalDisparadores(null)} />
      )}
    </div>
  );
}

function Slot({ value, setSlot, nodes, onInsert, onEdit, onDelete, setField, setBranch, depth }: any) {
  const { cat } = useCatalogo();
  const node: WFNode | null = value ? nodes[value] : null;
  const def = node ? pasoDef(cat, node.type) : null;
  const hijo = (props: any) => (
    <Slot nodes={nodes} onInsert={onInsert} onEdit={onEdit} onDelete={onDelete} setField={setField} setBranch={setBranch} {...props} />
  );
  return (
    <div className="flex flex-col items-center">
      <Insert terminal={!node} onPick={(t: string) => onInsert(t, value, setSlot)} />
      {node && (<>
        <NodeCard node={node} onEdit={() => onEdit(node.id)} onDelete={() => onDelete(node, setSlot)} />
        {def?.ramas === 'siNo' ? (
          <div className="flex items-start gap-6 pt-1 sm:gap-10">
            <Branch label={def.ramaSi ?? 'Sí'} bg="#ecfdf5" color="#059669">
              {hijo({ value: node.yes ?? null, setSlot: (v: string | null) => setField(node.id, 'yes', v), depth: depth + 1 })}
            </Branch>
            <Branch label={def.ramaNo ?? 'No'} bg="#fef2f2" color="#dc2626">
              {hijo({ value: node.no ?? null, setSlot: (v: string | null) => setField(node.id, 'no', v), depth: depth + 1 })}
            </Branch>
          </div>
        ) : def?.ramas === 'casos' ? (
          <div className="flex items-start gap-6 pt-1 sm:gap-8">
            {casosDe(node).map((caso) => (
              <Branch key={caso.id} label={caso.label || caso.id} bg="#eef2ff" color="#4f46e5">
                {hijo({ value: node.branches?.[caso.id] ?? null, setSlot: (v: string | null) => setBranch(node.id, caso.id, v), depth: depth + 1 })}
              </Branch>
            ))}
            {/* La salida normal del nodo es «cualquier otra respuesta»: lo que no
                casa con ningún caso sigue por aquí y no se queda colgado. */}
            <Branch label="Cualquier otra" bg="#f1f5f9" color="#64748b">
              {hijo({ value: node.next ?? null, setSlot: (v: string | null) => setField(node.id, 'next', v), depth: depth + 1 })}
            </Branch>
          </div>
        ) : (
          hijo({ value: node.next ?? null, setSlot: (v: string | null) => setField(node.id, 'next', v), depth })
        )}
      </>)}
      {!node && depth > 0 && <span className="mt-1 rounded-full bg-slate-200 px-2 py-0.5 text-[9px] font-medium uppercase text-slate-500">Fin</span>}
    </div>
  );
}
function Insert({ terminal, onPick }: { terminal: boolean; onPick: (t: string) => void }) {
  const { cat } = useCatalogo();
  const [op, setOp] = useState(false);
  return (
    <div className="relative flex flex-col items-center">
      <div className="h-4 w-px bg-slate-300" />
      <button onClick={() => setOp((o) => !o)} className={`grid h-6 w-6 place-items-center rounded-full border text-sm ${op ? 'bg-brand border-brand text-white' : 'bg-white border-slate-300 text-slate-400'}`}>+</button>
      {!terminal && <div className="h-4 w-px bg-slate-300" />}
      {op && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOp(false)} />
          <div className="absolute top-11 z-30 max-h-[60vh] w-60 overflow-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
            {porGrupo(cat.pasos).map((g) => (
              <div key={g.grupo}>
                <p className="px-2 py-1 text-[10px] font-semibold uppercase text-slate-400">{g.grupo}</p>
                {g.items.map((p) => {
                  const c = colorDeGrupo(p.grupo);
                  return (
                    <button key={p.key} onClick={() => { onPick(p.key); setOp(false); }} title={p.hint} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-xs" style={{ background: c.chip, color: c.color }}>{p.icono}</span>
                      <span className="truncate">{p.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Una línea con lo configurado, sacada de los campos del propio catálogo. */
function resumen(def: Paso | null, node: WFNode): string {
  const c = node.config || {};
  if (!def) return 'Paso desconocido';
  // El catálogo puede traer su propia frase («Espera respuesta · 3 días»).
  if (def.resumen) return aplicarPlantilla(def.resumen, def.campos, c);
  const partes: string[] = [];
  for (const campo of def.campos) {
    const v = c[campo.key];
    // Un campo que la pantalla no enseña tampoco cuenta en la tarjeta: con una
    // plantilla elegida, el cuerpo escrito antes ya no es lo que se manda.
    if (!campoVisible(campo, c)) continue;
    if (campo.tipo === 'condiciones') {
      const n = Array.isArray(v) ? v.length : 0;
      partes.push(n ? `${n} condición${n === 1 ? '' : 'es'}` : 'Sin condiciones');
    } else if (campo.tipo === 'casos') {
      const rs = Array.isArray(v) ? v : [];
      partes.push(rs.length ? rs.map((r: any) => r.label || r.id).join(' / ') : 'Sin casos');
    } else if (campo.tipo === 'cabeceras') {
      continue;
    } else if (campo.tipo === 'paso') {
      // El id del paso («n3f9a1») no le dice nada a nadie y aquí no está el
      // grafo para traducirlo: basta con decir si tiene destino o no.
      partes.push(String(v ?? '').trim() ? 'a otro paso' : 'sin destino');
    } else if (campo.tipo === 'select') {
      const elegido = String(v ?? campo.def ?? '');
      // Un desplegable SIN elegir no dice nada de lo que hace el paso, igual
      // que un texto vacío: «Sin plantilla (escribo el cuerpo aquí)» ocuparía
      // la tarjeta entera sin aportar.
      const op = elegido ? campo.opciones?.find((o) => o.value === elegido) : null;
      if (op) partes.push(op.label);
    } else {
      const s = String(v ?? '').trim();
      if (s) partes.push(campo.tipo === 'textarea' ? s.slice(0, 44) : s.slice(0, 44));
    }
  }
  if (!partes.length) return def.campos.length ? 'Sin configurar' : def.hint || '';
  return partes.slice(0, 3).join(' · ');
}

/** ¿Le falta algún campo obligatorio? Es la causa nº1 de «publiqué el flujo y no llegó nada». */
function faltaAlgo(def: Paso | null, node: WFNode): boolean {
  if (!def) return false;
  return def.campos.some((campo) => {
    if (!campoObligatorio(campo, node.config)) return false;
    const v = node.config?.[campo.key];
    if (campo.tipo === 'condiciones' || campo.tipo === 'cabeceras' || campo.tipo === 'casos') return !Array.isArray(v) || v.length === 0;
    return String(v ?? '').trim() === '';
  });
}

function NodeCard({ node, onEdit, onDelete }: { node: WFNode; onEdit: () => void; onDelete: () => void }) {
  const { cat } = useCatalogo();
  const d = metaPaso(cat, node.type);
  const incompleto = faltaAlgo(d.def, node);
  return (
    <div className="group relative w-[280px] rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
      <button onClick={onEdit} className="flex w-full items-center gap-2 text-left">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm" style={{ background: d.chip, color: d.color }}>{d.icon}</span>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: d.color }}>
            <span className="truncate">{d.label}</span>
            {incompleto && <span className="shrink-0 rounded bg-amber-100 px-1 py-px text-[9px] font-semibold text-amber-700">Vacío</span>}
          </p>
          <p className="truncate text-sm text-slate-600">{resumen(d.def, node)}</p>
        </div>
      </button>
      <button onClick={onDelete} className="absolute -right-2 -top-2 hidden h-5 w-5 place-items-center rounded-full bg-white text-xs text-rose-500 shadow group-hover:grid" title="Quitar paso">✕</button>
    </div>
  );
}
function Branch({ label, bg, color, children }: any) {
  return (
    <div className="flex flex-col items-center">
      <span className="mb-1 max-w-[150px] truncate rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: bg, color }}>{label}</span>
      {children}
    </div>
  );
}

function NodeConfig({ node, flujos, nodos, onClose, onPatch, onNode }: {
  node: WFNode;
  flujos: WF[];
  /** Todos los pasos del flujo: los necesita «Ir a un paso». */
  nodos: Record<string, WFNode>;
  onClose: () => void;
  onPatch: (cfg: any) => void;
  onNode: (patch: Partial<WFNode>) => void;
}) {
  const { cat } = useCatalogo();
  const c = node.config || {};
  const d = metaPaso(cat, node.type);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-auto bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="font-semibold text-slate-800">{d.icon} {d.label}</h3><button onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button></div>
        {/* El formulario ENTERO sale de `campos`: no hay un `if` por tipo de paso.
            Un paso nuevo en el backend se configura acá sin tocar esta pantalla. */}
        <div className="mt-4 space-y-3">
          {d.hint && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">{d.hint}</p>}
          {!d.def && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
              Este paso no está en la lista que respondió el servidor. Puede ser de una versión más nueva: no lo edites desde aquí o perderás su configuración.
            </p>
          )}
          {(d.def?.campos ?? []).filter((campo) => campoVisible(campo, c)).map((campo) => (
            <CampoControl
              key={campo.key}
              campo={campo}
              valor={c[campo.key]}
              node={node}
              flujos={flujos}
              nodos={nodos}
              onChange={(v) => onPatch({ [campo.key]: v })}
              onNode={onNode}
            />
          ))}
          {/* Probar el paso ANTES de publicarlo: manda lo que hay escrito ahora
              al destino de prueba de la marca. Qué pasos lo enseñan lo dice el
              catálogo (`prueba`), no una lista de tipos escrita aquí. */}
          {d.def?.prueba && <PruebaDeEnvio canal={d.def.prueba} base={BASE} config={c} />}
          {d.def && d.def.campos.length === 0 && <p className="text-sm text-slate-500">Este paso no necesita configuración.</p>}
        </div>
        <button onClick={onClose} className="mt-5 w-full rounded-lg bg-brand py-2 text-sm font-semibold text-white">Listo</button>
      </div>
    </div>
  );
}

// ── Un campo del catálogo → su control ─────────────────────────────────────
// `condiciones`, `casos`, `cabeceras`, `flujo` y `paso` tienen editor propio;
// el resto son controles normales.
function CampoControl({ campo, valor, node, flujos, nodos, onChange, onNode }: {
  campo: CampoDeConfig;
  valor: any;
  node?: WFNode;
  flujos?: WF[];
  nodos?: Record<string, WFNode>;
  onChange: (v: any) => void;
  onNode?: (patch: Partial<WFNode>) => void;
}) {
  const ref = useRef<any>(null);
  const texto = String(valor ?? campo.def ?? '');
  let control: React.ReactNode;
  switch (campo.tipo) {
    case 'textarea':
      control = (
        <>
          <textarea ref={ref} rows={6} value={texto} onChange={(e) => onChange(e.target.value)} className={inp} />
          <MergeHelp />
        </>
      );
      break;
    case 'numero':
      control = <input type="number" min={0} value={Number(valor ?? campo.def ?? 0)} onChange={(e) => onChange(+e.target.value)} className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm" />;
      break;
    case 'select':
      control = (
        <select value={texto} onChange={(e) => onChange(e.target.value)} className={inp}>
          {(campo.opciones ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
      break;
    case 'fechaHora':
      // `datetime-local` da «2026-09-21T14:30», que es justo lo que el motor
      // interpreta en hora de Bogotá.
      control = <input type="datetime-local" value={texto} onChange={(e) => onChange(e.target.value)} className={inp} />;
      break;
    case 'condiciones':
      control = <CondicionesEditor valor={Array.isArray(valor) ? valor : []} onChange={onChange} />;
      break;
    case 'casos':
      control = <CasosEditor valor={Array.isArray(valor) ? valor : []} node={node} onChange={onChange} onNode={onNode} />;
      break;
    case 'cabeceras':
      control = <CabecerasEditor valor={Array.isArray(valor) ? valor : []} onChange={onChange} />;
      break;
    case 'flujo':
      control = <FlujoSelect flujos={flujos ?? []} valor={texto} onChange={onChange} />;
      break;
    case 'paso':
      control = <PasoSelect nodos={nodos ?? {}} actual={node?.id} valor={texto} onChange={onChange} />;
      break;
    default:
      control = <input ref={ref} value={texto} onChange={(e) => onChange(e.target.value)} className={inp} />;
  }
  return (
    <div>
      {/* El asterisco mira si el campo es obligatorio AHORA: con una plantilla
          elegida, el asunto deja de serlo (cae al de la plantilla). */}
      <Label>{campo.label}{campoObligatorio(campo, node?.config) && <span className="ml-1 text-rose-500" title="Obligatorio">*</span>}</Label>
      {control}
      {campo.ayuda && <p className="mt-1 text-[11px] text-slate-400">{campo.ayuda}</p>}
    </div>
  );
}

// Campos y operadores salen del catálogo: si el backend añade un campo del
// contacto, aparece acá sin tocar nada.
// La fila es la misma que la de los filtros del disparador: con los 12
// operadores, «contiene» admite varios valores en chips y «está vacío» no pide
// valor. Dos editores distintos para la misma condición acabarían guardando
// cosas distintas.
function CondicionesEditor({ valor, onChange }: { valor: any[]; onChange: (v: any[]) => void }) {
  const { cat } = useCatalogo();
  const campoPorDefecto = cat.campos[0]?.key ?? 'nombre';
  const opPorDefecto = cat.operadores[0]?.value ?? 'eq';
  return (
    <div className="space-y-2">
      {valor.map((cond: any, i: number) => (
        <FiltroFila
          key={i}
          filtro={cond}
          campos={cat.campos}
          permitidos={null}
          operadores={cat.operadores}
          onChange={(nc) => onChange(valor.map((x, j) => (j === i ? nc : x)))}
          onQuitar={() => onChange(valor.filter((_, j) => j !== i))}
        />
      ))}
      <button type="button" onClick={() => onChange([...valor, { field: campoPorDefecto, op: opPorDefecto, value: '' }])} className="btn-link text-sm">+ Añadir condición</button>
    </div>
  );
}

/**
 * Los casos de «Ramas por respuesta»: una salida por caso.
 *
 * Al borrar un caso se borra TAMBIÉN su salida del nodo: si se quedara, el
 * flujo guardaría una rama que la pantalla ya no dibuja y esos pasos no los
 * volvería a ver nadie —pero seguirían ejecutándose—.
 */
function CasosEditor({ valor, node, onChange, onNode }: {
  valor: any[];
  node?: WFNode;
  onChange: (v: any[]) => void;
  onNode?: (patch: Partial<WFNode>) => void;
}) {
  const set = (i: number, patch: any) => onChange(valor.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  function quitar(i: number) {
    const fuera = valor[i];
    onChange(valor.filter((_, j) => j !== i));
    if (fuera?.id && node?.branches && onNode) {
      const branches = { ...node.branches };
      delete branches[fuera.id];
      onNode({ branches });
    }
  }
  return (
    <div className="space-y-2">
      {valor.map((caso: any, i: number) => (
        <div key={caso.id ?? i} className="rounded-lg border border-slate-200 p-2">
          <div className="flex items-center gap-1.5">
            <input value={caso.label ?? ''} onChange={(e) => set(i, { label: e.target.value })} placeholder="Nombre de la rama" className="flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm" />
            <button onClick={() => quitar(i)} className="text-rose-500" title="Quitar caso">✕</button>
          </div>
          <input value={caso.palabras ?? ''} onChange={(e) => set(i, { palabras: e.target.value })} placeholder="sí, claro, me interesa" className="mt-1.5 w-full rounded-lg border border-slate-300 px-2 py-1 text-sm" />
        </div>
      ))}
      <button onClick={() => onChange([...valor, { id: casoId(), label: `Caso ${valor.length + 1}`, palabras: '' }])} className="text-sm font-medium text-brand">+ Añadir caso</button>
    </div>
  );
}

function CabecerasEditor({ valor, onChange }: { valor: any[]; onChange: (v: any[]) => void }) {
  const set = (i: number, patch: any) => onChange(valor.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-1.5">
      {valor.map((h: any, i: number) => (
        <div key={i} className="flex items-center gap-1.5">
          <input value={h.key ?? ''} onChange={(e) => set(i, { key: e.target.value })} placeholder="Authorization" className="w-1/2 rounded-lg border border-slate-300 px-2 py-1 text-sm" />
          <input value={h.value ?? ''} onChange={(e) => set(i, { value: e.target.value })} placeholder="Bearer …" className="w-1/2 rounded-lg border border-slate-300 px-2 py-1 text-sm" />
          <button onClick={() => onChange(valor.filter((_, j) => j !== i))} className="text-rose-500">✕</button>
        </div>
      ))}
      <button onClick={() => onChange([...valor, { key: '', value: '' }])} className="text-sm font-medium text-brand">+ Añadir cabecera</button>
    </div>
  );
}

/**
 * El flujo destino. Solo se ofrecen los PUBLICADOS: el motor se niega a mandar
 * un contacto a un borrador, así que ofrecerlo sería prometer algo que no pasa.
 */
function FlujoSelect({ flujos, valor, onChange }: { flujos: WF[]; valor: string; onChange: (v: string) => void }) {
  const publicados = flujos.filter((f) => f.status === 'published');
  return (
    <>
      <select value={valor} onChange={(e) => onChange(e.target.value)} className={inp}>
        <option value="">— Elige un flujo —</option>
        {publicados.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
      {publicados.length === 0 && <p className="mt-1 text-[11px] text-amber-700">No hay ningún otro flujo publicado de esta marca al que mandar el contacto.</p>}
    </>
  );
}

/**
 * El paso destino de «Ir a un paso de este flujo».
 *
 * Se ofrecen los pasos del flujo MENOS el propio «Ir a»: apuntarse a sí mismo
 * es un bucle cerrado que el motor corta a las 50 vueltas, pero mejor no
 * ofrecerlo siquiera. Cada opción lleva el icono y el tipo del paso porque los
 * ids («n3f9a1») no le dicen nada a nadie.
 */
function PasoSelect({ nodos, actual, valor, onChange }: {
  nodos: Record<string, WFNode>;
  actual?: string;
  valor: string;
  onChange: (v: string) => void;
}) {
  const { cat } = useCatalogo();
  const destinos = Object.values(nodos).filter((n) => n.id !== actual);
  return (
    <>
      <select value={valor} onChange={(e) => onChange(e.target.value)} className={inp}>
        <option value="">— Elige un paso —</option>
        {destinos.map((n) => {
          const d = metaPaso(cat, n.type);
          return <option key={n.id} value={n.id}>{d.icon} {d.label} · {resumen(d.def, n).slice(0, 40)}</option>;
        })}
      </select>
      {destinos.length === 0 && <p className="mt-1 text-[11px] text-amber-700">Este flujo todavía no tiene otro paso al que ir.</p>}
    </>
  );
}

function MergeHelp() {
  const { cat } = useCatalogo();
  return <p className="mt-1 text-xs text-slate-500">Variables: {cat.merge.map((m) => <code key={m.key} className="mx-0.5 rounded bg-slate-100 px-1">{`{{${m.key}}}`}</code>)}</p>;
}
function Card({ title, children }: any) { return <div className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="mb-2 font-semibold text-slate-800">{title}</h3>{children}</div>; }
function Label({ children }: any) { return <label className="mb-1 block text-xs font-medium text-slate-600">{children}</label>; }

function EnrollTab({ workflowId, published }: { workflowId: string; published: boolean }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(async () => {
      try { const d: any = await api(`/admin/marketing/workflows/meta/contacts?q=${encodeURIComponent(q)}`); setRows(d ?? []); } catch { /* noop */ }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  async function enroll() {
    if (!sel.size) return;
    setBusy(true);
    try { const r: any = await api(`/admin/marketing/workflows/${workflowId}/enroll`, { method: 'POST', body: JSON.stringify({ contactIds: [...sel] }) }); toast(`Inscritos ${r?.count ?? sel.size}`, 'success'); setSel(new Set()); }
    catch (e: any) { toast(e.message ?? 'Error', 'error'); } finally { setBusy(false); }
  }
  return (
    <div className="p-5"><div className="mx-auto max-w-2xl space-y-3">
      {!published && <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">Publica el workflow antes de inscribir contactos.</div>}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar contacto…" className={inp} />
      <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-50">
        {rows.map((c) => (
          <label key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50">
            <input type="checkbox" checked={sel.has(c.id)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n; })} />
            <span className="font-medium text-slate-800">{c.name || '—'}</span>
            <span className="text-slate-400">{c.email || c.phone || ''}</span>
          </label>
        ))}
        {rows.length === 0 && <div className="px-3 py-6 text-center text-sm text-slate-400">Sin contactos.</div>}
      </div>
      <button onClick={enroll} disabled={busy || !sel.size || !published} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Inscribir {sel.size ? `(${sel.size})` : ''}</button>
    </div></div>
  );
}

function LogsTab({ workflowId }: { workflowId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  async function load() { setLoading(true); try { const d: any = await api(`/admin/marketing/workflows/${workflowId}/logs`); setRows(d ?? []); } catch { /* noop */ } finally { setLoading(false); } }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const STATUS: Record<string, { label: string; bg: string; color: string }> = {
    sent: { label: 'Enviado', bg: '#dcfce7', color: '#15803d' },
    skipped: { label: 'Omitido', bg: '#fef9c3', color: '#a16207' },
    retrying: { label: 'Reintentando', bg: '#ffedd5', color: '#c2410c' },
    failed: { label: 'Falló', bg: '#fee2e2', color: '#b91c1c' },
    processing: { label: 'Enviando', bg: '#e0f2fe', color: '#0369a1' },
    pending: { label: 'Pendiente', bg: '#f1f5f9', color: '#64748b' },
  };
  const fmt = (s?: string) => (s ? new Date(s).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  return (
    <div className="p-5">
      <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold text-slate-800">Registro de ejecución</h3><button onClick={load} className="text-xs text-slate-500 hover:text-slate-800">↻ Actualizar</button></div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-slate-100 text-left text-xs font-medium text-slate-500"><tr className="[&>th]:px-3 [&>th]:py-2"><th>Contacto</th><th>Canal</th><th>Estado</th><th>Intento</th><th>Detalle</th><th>Eventos</th><th>Próximo</th></tr></thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Cargando…</td></tr>
              : rows.length === 0 ? <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Sin envíos todavía.</td></tr>
              : rows.map((r) => {
                const st = STATUS[r.status] ?? STATUS.pending;
                return (
                  <tr key={r.id} className="[&>td]:px-3 [&>td]:py-2 align-top">
                    <td className="text-slate-800">{r.contact?.name || r.contact?.email || r.contact?.phone || '—'}</td>
                    <td>{r.channel === 'email' ? '✉️' : '💬'}</td>
                    <td><span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: st.bg, color: st.color }}>{st.label}</span></td>
                    <td className="whitespace-nowrap text-slate-500">{r.attempts}/4</td>
                    <td className="max-w-[220px] text-slate-500">{r.error ? <span className="text-rose-600">{r.error}</span> : (r.subject || '—')}</td>
                    <td className="whitespace-nowrap text-xs">
                      {r.deliveredAt && <span title={`Entregado ${fmt(r.deliveredAt)}`}>✓ </span>}
                      {r.openedAt && <span title={`Abrió ${fmt(r.openedAt)}`}>👁 </span>}
                      {r.clickedAt && <span title={`Clic ${fmt(r.clickedAt)}`}>🖱 </span>}
                      {r.bouncedAt && <span title={`Rebote ${fmt(r.bouncedAt)}`} className="text-rose-600">↩ </span>}
                      {!r.deliveredAt && !r.openedAt && !r.clickedAt && !r.bouncedAt && <span className="text-slate-300">—</span>}
                    </td>
                    <td className="whitespace-nowrap text-xs text-slate-400">{r.status === 'retrying' && r.nextAttemptAt ? `🕐 ${fmt(r.nextAttemptAt)}` : ''}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
