'use client';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
const BASE = '/admin/workflows';

// Constructor visual de Workflows de la MARCA (audiencia: sus negocios/tenants).
// SMS al dueño por la subcuenta de Grow Business de la marca. Backend:
// /admin/workflows/* (motor durable por @Cron). Lista estilo TeamClubify:
// carpetas ANIDADAS (parentId) + migas de pan + selección múltiple con acciones
// en lote + menú «⋮» por fila. El árbol se arma acá en código a partir de
// parentId — el backend rechaza los ciclos, la UI ni los ofrece como destino.

type Stats = { active: number; completed: number };
type WF = {
  id: string; name: string; folderId: string | null; status: string;
  /** `trigger` es el primero de `triggers`; vacío = flujo de antes (se lee `[trigger]`). */
  trigger: any; triggers?: any[]; rootId: string | null; nodes: any; drip: any; sendWindow: any; reentry: boolean;
  createdAt?: string; _stats: Stats;
};
type Folder = { id: string; name: string; parentId?: string | null; createdAt?: string };
type WFNode = {
  id: string; type: string; config: any;
  next?: string | null; yes?: string | null; no?: string | null;
  /** Una salida por ruta, para los pasos que abren N ramas (`split`). */
  branches?: Record<string, string | null>;
};

// Color del riel que une los pasos. Un solo tono para TODO el cableado: el
// color informa la familia del paso, no la línea que los conecta.
const RAIL = '#CBD5E1';
// Separación entre las columnas de una rama. Es una constante porque la barra
// en T se calcula a partir de ella (ver el conector de rama en Slot).
const RAMA_GAP = 32;

// ── CATÁLOGO: lo sirve el backend ──────────────────────────────────────────
// Hasta el 2026-09-21 el catálogo estaba COPIADO A MANO acá y se desincronizó
// del motor: faltaban disparadores de este lado y pasos del otro. Ahora hay una
// sola fuente —`GET /admin/workflows/catalogo`— y esta pantalla se dibuja con
// lo que venga: añadir un paso en el backend no obliga a tocar este archivo.
type Opcion = { value: string; label: string };
type CampoDeConfig = {
  key: string;
  label: string;
  tipo: 'texto' | 'textarea' | 'numero' | 'select' | 'fechaHora' | 'condiciones' | 'rutas' | 'cabeceras' | 'flujo';
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
type Paso = { key: string; label: string; grupo: string; icono: string; ramas?: 'siNo' | 'rutas'; hint?: string; campos: CampoDeConfig[]; resumen?: string; prueba?: 'sms' | 'email' };
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
    { key: 'manual', label: 'Inscripción manual / lista', grupo: 'General', latencia: 'minutos', hint: 'Los metes tú desde la pestaña «Inscribir».' },
  ],
  pasos: [
    { key: 'send_sms', label: 'Enviar mensaje', grupo: 'Mensaje', icono: '💬', hint: 'SMS al dueño del negocio, por la subcuenta de la marca.', campos: [{ key: 'message', label: 'Mensaje', tipo: 'textarea', requerido: true }] },
    { key: 'send_email', label: 'Enviar correo', grupo: 'Mensaje', icono: '✉️', hint: 'Al correo del dueño, con el logo y el color de la marca.', campos: [{ key: 'subject', label: 'Asunto', tipo: 'texto', requerido: true }, { key: 'body', label: 'Cuerpo', tipo: 'textarea', requerido: true }] },
    { key: 'wait_delay', label: 'Esperar un tiempo', grupo: 'Espera', icono: '⏱', campos: [{ key: 'amount', label: 'Cuánto', tipo: 'numero', def: 1 }, { key: 'unit', label: 'Unidad', tipo: 'select', def: 'days', opciones: [{ value: 'minutes', label: 'minutos' }, { value: 'hours', label: 'horas' }, { value: 'days', label: 'días' }, { value: 'weeks', label: 'semanas' }] }] },
    { key: 'if_else', label: 'Si / No', grupo: 'Lógica', icono: '🔀', ramas: 'siNo', campos: [{ key: 'conditions', label: 'Condiciones', tipo: 'condiciones' }, { key: 'match', label: 'Se cumple si', tipo: 'select', def: 'all', opciones: [{ value: 'all', label: 'se cumplen todas' }, { value: 'any', label: 'se cumple alguna' }] }] },
    { key: 'end', label: 'Terminar el flujo', grupo: 'Salida', icono: '🚪', campos: [] },
  ],
  campos: [{ key: 'plan', label: 'Plan' }, { key: 'status', label: 'Estado de la cuenta' }, { key: 'negocio', label: 'Nombre del negocio' }],
  merge: [{ key: 'negocio', label: 'Negocio' }, { key: 'owner', label: 'Dueño' }, { key: 'plan', label: 'Plan' }, { key: 'platform', label: 'Marca' }],
  operadores: [{ value: 'eq', label: 'es igual a' }, { value: 'neq', label: 'no es' }, { value: 'contains', label: 'contiene' }, { value: 'filled', label: 'tiene algo' }],
};

// El catálogo viaja por contexto: lo pide la pantalla una vez y lo leen el
// lienzo, el menú «+» y el panel del paso sin pasarlo de props en props.
const CatalogoCtx = createContext<{ cat: Catalogo; degradado: boolean }>({ cat: CATALOGO_MINIMO, degradado: false });
const useCatalogo = () => useContext(CatalogoCtx);

// El color va por FAMILIA de paso, no por paso suelto: así el lienzo se lee de
// un vistazo y un paso nuevo del backend nace ya con su color. Son colores
// SEMÁNTICOS —qué hace el paso—, no el acento de la interfaz: ese sale de los
// tokens `brand`, que `.brand-panel` tiñe con el color de cada marca.
const COLOR_GRUPO: Record<string, { chip: string; color: string }> = {
  Mensaje: { chip: '#E0F2FE', color: '#0369A1' },
  Espera: { chip: '#EDE9FE', color: '#6D28D9' },
  'Lógica': { chip: '#E0E7FF', color: '#4338CA' },
  'Integración': { chip: '#FEF3C7', color: '#B45309' },
  Salida: { chip: '#FEE2E2', color: '#B91C1C' },
};
const colorDeGrupo = (g?: string) => COLOR_GRUPO[g ?? ''] ?? { chip: '#F1F5F9', color: '#64748B' };

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

function uid() { try { return 'n' + crypto.randomUUID().slice(0, 8); } catch { return 'n' + Math.random().toString(36).slice(2, 10); } }
// Los ids de ruta son la CLAVE de `node.branches`: tienen que ser estables y no
// repetirse aunque se quite una ruta y se añada otra (reusar «b» heredaría la
// rama de la ruta borrada).
function nuevaRutaId() { try { return 'r' + crypto.randomUUID().slice(0, 6); } catch { return 'r' + Math.random().toString(36).slice(2, 8); } }
function rutasPorDefecto() { return [{ id: nuevaRutaId(), label: 'A', percent: 50 }, { id: nuevaRutaId(), label: 'B', percent: 50 }]; }
/** Config inicial de un paso: los `def` del catálogo + los editores que nacen con estructura. */
function configInicial(def: Paso | null) {
  const cfg: Record<string, any> = {};
  for (const campo of def?.campos ?? []) {
    if (campo.tipo === 'condiciones' || campo.tipo === 'cabeceras') cfg[campo.key] = [];
    else if (campo.tipo === 'rutas') cfg[campo.key] = rutasPorDefecto();
    else if (campo.def !== undefined) cfg[campo.key] = campo.def;
  }
  return cfg;
}
/** TODAS las salidas de un paso, ramas por ruta incluidas. Sin `branches` acá,
 *  el podado del guardado se come media rama de cualquier A/B. */
function salidasDe(node: WFNode): string[] {
  const porRuta = node.branches ? Object.keys(node.branches).map((k) => node.branches![k]) : [];
  return [node.next, node.yes, node.no, ...porRuta].filter((x): x is string => !!x);
}
/** Las rutas válidas de un `split` (las que tienen id: el motor ignora el resto). */
function rutasDe(node: WFNode | null | undefined): { id: string; label?: string; percent?: number }[] {
  const rs = node?.config?.routes;
  return Array.isArray(rs) ? rs.filter((r: any) => r && r.id) : [];
}
function fmtDate(s?: string) { return s ? new Date(s).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; }
// `.input` global en vez de un estilo propio: bajo `.brand-panel` el foco lo
// tiñe la marca (panel-brand-theme.ts) sin escribir un solo color acá.
const inp = 'input';

// ── Helpers del árbol de carpetas ───────────────────────────────────────────
type TreeOption = { id: string; name: string; depth: number };

// La carpeta y TODAS sus descendientes. Sirve para excluir destinos que
// crearían un ciclo (mover una carpeta dentro de su propio subárbol la haría
// desaparecer de la vista junto con todo lo que contiene).
function descendantsOf(folders: Folder[], rootId: string): Set<string> {
  const out = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) { out.add(f.id); grew = true; }
    }
  }
  return out;
}

// Aplana el árbol en orden de recorrido (padre antes que hijas) con la
// profundidad de cada carpeta, para pintar menús "Mover a…" con sangría.
// Las carpetas con padre roto (dato corrupto) se anexan al final: que nunca
// desaparezcan de los menús.
function flattenTree(folders: Folder[], exclude?: Set<string>): TreeOption[] {
  const out: TreeOption[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    if (depth > 20) return;
    for (const f of folders) {
      if ((f.parentId ?? null) !== parent || seen.has(f.id) || exclude?.has(f.id)) continue;
      seen.add(f.id);
      out.push({ id: f.id, name: f.name, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const f of folders) {
    if (!seen.has(f.id) && !exclude?.has(f.id)) out.push({ id: f.id, name: f.name, depth: 0 });
  }
  return out;
}

type NameModalState = { title: string; initial: string; placeholder?: string; submitLabel: string; onSubmit: (name: string) => Promise<void> };
type ConfirmModalState = { title: string; body: React.ReactNode; confirmLabel: string; onConfirm: () => Promise<void> };

export default function BrandWorkflowsPanel() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wfs, setWfs] = useState<WF[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null); // null = raíz
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [nameModal, setNameModal] = useState<NameModalState | null>(null);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);
  const [cat, setCat] = useState<Catalogo>(CATALOGO_MINIMO);
  const [catDegradado, setCatDegradado] = useState(false);

  // El catálogo se pide APARTE de la lista: si falla, la lista sigue viéndose y
  // el constructor cae al mínimo en vez de quedarse sin pasos que ofrecer.
  useEffect(() => {
    let vivo = true;
    api(`${BASE}/catalogo`)
      .then((d: any) => {
        if (!vivo) return;
        if (d?.pasos?.length && d?.disparadores?.length) { setCat({ ...CATALOGO_MINIMO, ...d }); setCatDegradado(false); }
        else setCatDegradado(true);
      })
      .catch(() => { if (vivo) setCatDegradado(true); });
    return () => { vivo = false; };
  }, []);
  const ctxCatalogo = useMemo(() => ({ cat, degradado: catDegradado }), [cat, catDegradado]);

  async function load() {
    setLoading(true); setLoadError(null);
    try {
      const d: any = await api('/admin/workflows');
      const fs: Folder[] = d?.folders ?? [];
      setWfs(d?.workflows ?? []); setFolders(fs);
      // Si la carpeta en la que estabas ya no existe (la borró otra sesión),
      // vuelve a la raíz en vez de quedarte mirando una vista vacía fantasma.
      setCurrentFolder((cur) => (cur && !fs.some((f) => f.id === cur) ? null : cur));
    } catch (e: any) {
      setLoadError(e?.message || 'No se pudo conectar con el servidor.');
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  // Navegar entre carpetas limpia la selección (evita actuar sobre filas que ya no ves).
  function goFolder(id: string | null) { setCurrentFolder(id); setSelected(new Set()); }
  function toggleSel(id: string) { setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }

  async function addWf() {
    setBusy(true);
    try {
      const w: any = await api('/admin/workflows', { method: 'POST', body: JSON.stringify({ name: 'Nuevo workflow', folderId: currentFolder }) });
      setWfs((p) => [{ ...w, folderId: w.folderId ?? currentFolder ?? null, nodes: w.nodes ?? {}, drip: w.drip ?? {}, sendWindow: w.sendWindow ?? {}, _stats: { active: 0, completed: 0 } }, ...p]);
      setOpenId(w.id);
    } catch (e: any) { toast(e?.message || 'No se pudo crear el workflow', 'error'); } finally { setBusy(false); }
  }

  function askNewFolder() {
    const here = inFolder ? ` dentro de "${inFolder.name}"` : '';
    setNameModal({
      title: `Nueva carpeta${here}`,
      initial: '',
      placeholder: 'Nombre de la carpeta',
      submitLabel: 'Crear carpeta',
      onSubmit: async (name) => {
        const f: any = await api('/admin/workflows/folders', { method: 'POST', body: JSON.stringify({ name, parentId: currentFolder }) });
        setFolders((p) => [...p, f]);
      },
    });
  }

  function askRenameFolder(f: Folder) {
    setNameModal({
      title: `Renombrar la carpeta "${f.name}"`,
      initial: f.name,
      submitLabel: 'Guardar',
      onSubmit: async (name) => {
        if (name === f.name) return;
        // Primero el servidor, luego la lista: si falla, el usuario lo ve en el
        // modal y la carpeta conserva su nombre real (nada de "se deshizo solo").
        await api(`/admin/workflows/folders/${f.id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
        setFolders((p) => p.map((x) => (x.id === f.id ? { ...x, name } : x)));
      },
    });
  }

  // Optimista CON reversa: se pinta al instante y, si el servidor rechaza,
  // se restaura el estado anterior y se avisa — nunca se descarta el error.
  function moveWf(id: string, folderId: string | null) {
    const prev = wfs;
    setWfs((p) => p.map((w) => (w.id === id ? { ...w, folderId } : w)));
    api(`/admin/workflows/${id}`, { method: 'PATCH', body: JSON.stringify({ folderId }) })
      .catch((e: any) => { setWfs(prev); toast(e?.message || 'No se pudo mover el workflow', 'error'); });
  }

  function moveFolderTo(id: string, parentId: string | null) {
    const prev = folders;
    setFolders((p) => p.map((f) => (f.id === id ? { ...f, parentId } : f)));
    api(`/admin/workflows/folders/${id}/move`, { method: 'PATCH', body: JSON.stringify({ parentId }) })
      .catch((e: any) => { setFolders(prev); toast(e?.message || 'No se pudo mover la carpeta', 'error'); });
  }

  function setStatusWf(id: string, published: boolean) {
    const prev = wfs;
    setWfs((p) => p.map((w) => (w.id === id ? { ...w, status: published ? 'published' : 'draft' } : w)));
    api(`/admin/workflows/${id}`, { method: 'PATCH', body: JSON.stringify({ status: published ? 'published' : 'draft' }) })
      .catch((e: any) => { setWfs(prev); toast(e?.message || 'No se pudo cambiar el estado', 'error'); });
  }

  async function duplicate(id: string) {
    setBusy(true);
    try {
      const w: any = await api(`/admin/workflows/${id}/duplicate`, { method: 'POST' });
      setWfs((p) => [{ ...w, folderId: w.folderId ?? null, nodes: w.nodes ?? {}, drip: w.drip ?? {}, sendWindow: w.sendWindow ?? {}, _stats: { active: 0, completed: 0 } }, ...p]);
      toast('Workflow duplicado (en borrador)', 'success');
    } catch (e: any) { toast(e?.message || 'No se pudo duplicar', 'error'); } finally { setBusy(false); }
  }

  // Exportar el flujo como JSON (para clonarlo entre marcas). La lista ya trae
  // el workflow completo, así que no hace falta otra llamada.
  function exportWf(w: WF) {
    // Con `triggers`: sin la lista, el JSON de un flujo con varios disparadores
    // se llevaría solo el primero.
    const data = { name: w.name, trigger: w.trigger, triggers: w.triggers ?? [], rootId: w.rootId, nodes: w.nodes, drip: w.drip, sendWindow: w.sendWindow, reentry: w.reentry };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${(w.name || 'workflow').replace(/[^\w\- ]+/g, '').trim() || 'workflow'}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function askDeleteWf(w: WF) {
    setConfirmModal({
      title: `Eliminar el workflow "${w.name}"`,
      body: 'Se eliminan también todas sus inscripciones (los negocios que van por el flujo). Esta acción no se puede deshacer.',
      confirmLabel: 'Eliminar workflow',
      onConfirm: async () => {
        await api(`/admin/workflows/${w.id}`, { method: 'DELETE' });
        setWfs((p) => p.filter((x) => x.id !== w.id));
        setSelected((s) => { const n = new Set(s); n.delete(w.id); return n; });
        toast('Workflow eliminado', 'success');
      },
    });
  }

  function askDeleteFolder(f: Folder) {
    const directWfs = wfs.filter((w) => (w.folderId ?? null) === f.id).length;
    const directSubs = folders.filter((x) => (x.parentId ?? null) === f.id).length;
    const parent = folders.find((x) => x.id === (f.parentId ?? '')) ?? null;
    const dest = parent ? `la carpeta "${parent.name}"` : 'el inicio';
    const hasContent = directWfs > 0 || directSubs > 0;
    setConfirmModal({
      title: `Eliminar la carpeta "${f.name}"`,
      body: hasContent
        ? `Contiene ${directWfs} workflow(s) y ${directSubs} subcarpeta(s). Todo su contenido se moverá a ${dest} — no se elimina ningún workflow.`
        : 'La carpeta está vacía. Esta acción no se puede deshacer.',
      confirmLabel: 'Eliminar carpeta',
      onConfirm: async () => {
        await api(`/admin/workflows/folders/${f.id}`, { method: 'DELETE' });
        // Espejo local de lo que hizo el servidor: el contenido sube al padre.
        const newParent = f.parentId ?? null;
        setFolders((p) => p.filter((x) => x.id !== f.id).map((x) => ((x.parentId ?? null) === f.id ? { ...x, parentId: newParent } : x)));
        setWfs((p) => p.map((w) => ((w.folderId ?? null) === f.id ? { ...w, folderId: newParent } : w)));
        setCurrentFolder((cur) => (cur === f.id ? newParent : cur));
        toast(hasContent ? 'Carpeta eliminada; su contenido subió un nivel' : 'Carpeta eliminada', 'success');
      },
    });
  }

  // ── Acciones en lote (una sola llamada al servidor) ──
  function bulkMove(folderId: string | null) {
    const ids = [...selected]; if (!ids.length) return;
    const prev = wfs;
    setWfs((p) => p.map((w) => (selected.has(w.id) ? { ...w, folderId } : w)));
    setSelected(new Set());
    api('/admin/workflows/bulk/move', { method: 'POST', body: JSON.stringify({ ids, folderId }) })
      .then((r: any) => toast(`${r?.count ?? ids.length} workflow(s) movidos`, 'success'))
      .catch((e: any) => { setWfs(prev); setSelected(new Set(ids)); toast(e?.message || 'No se pudieron mover los workflows', 'error'); });
  }

  function askBulkDelete() {
    const ids = [...selected]; if (!ids.length) return;
    setConfirmModal({
      title: `Eliminar ${ids.length} workflow(s)`,
      body: 'Se eliminan también todas sus inscripciones. Esta acción no se puede deshacer.',
      confirmLabel: `Eliminar ${ids.length} workflow(s)`,
      onConfirm: async () => {
        await api('/admin/workflows/bulk/delete', { method: 'POST', body: JSON.stringify({ ids }) });
        setWfs((p) => p.filter((w) => !ids.includes(w.id)));
        setSelected(new Set());
        toast('Workflows eliminados', 'success');
      },
    });
  }

  const open = wfs.find((w) => w.id === openId) ?? null;
  if (open) return (
    <CatalogoCtx.Provider value={ctxCatalogo}>
      <Editor
        key={open.id}
        wf={open}
        otros={wfs.filter((w) => w.id !== open.id)}
        onBack={() => { setOpenId(null); load(); }}
        onDeleted={() => { setWfs((p) => p.filter((w) => w.id !== open.id)); setOpenId(null); }}
      />
    </CatalogoCtx.Provider>
  );

  const inFolder = folders.find((f) => f.id === currentFolder) ?? null;
  // Miga de pan: ruta completa desde la raíz hasta la carpeta actual (con tope
  // por si los datos trajeran un ciclo — la UI no debe colgarse por eso).
  const trail: Folder[] = [];
  { let cur = inFolder; for (let i = 0; i < 20 && cur; i++) { trail.unshift(cur); cur = folders.find((f) => f.id === (cur!.parentId ?? '')) ?? null; } }
  // Carpetas hijas del nivel actual (en la raíz: las que no tienen padre).
  const showFolders = folders.filter((f) => (f.parentId ?? null) === currentFolder);
  // Orden por nombre: primero signos, luego números, luego letras (como TeamClubify).
  const rank = (s: string) => { const c = (s || '').trim().charAt(0); if (/[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(c)) return 2; if (/[0-9]/.test(c)) return 1; return 0; };
  const rows = wfs.filter((w) => (w.folderId ?? null) === currentFolder).sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, 'es', { numeric: true }));
  const empty = showFolders.length === 0 && rows.length === 0;
  const allSelected = rows.length > 0 && rows.every((w) => selected.has(w.id));
  function toggleAll() { setSelected(allSelected ? new Set() : new Set(rows.map((w) => w.id))); }
  const moveOptions = flattenTree(folders);

  return (
    <CatalogoCtx.Provider value={ctxCatalogo}>
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-slate-500">Flujos con esperas, ramas y ventana horaria para tus negocios. Organízalos en carpetas (y subcarpetas).</p>
        <div className="ml-auto flex gap-2">
          <button onClick={askNewFolder} disabled={busy || loading} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">📁 Nueva carpeta</button>
          <button onClick={addWf} disabled={busy || loading} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">+ Nuevo workflow</button>
        </div>
      </div>

      {catDegradado && <AvisoCatalogo />}

      {/* Miga de pan al entrar a una carpeta: ← Atrás | Inicio / A / B */}
      {!loading && !loadError && currentFolder !== null && (
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <button onClick={() => goFolder(trail.length > 1 ? trail[trail.length - 2].id : null)} className="text-slate-500 hover:text-slate-800">← Atrás</button>
          <span className="text-slate-300">|</span>
          <button onClick={() => goFolder(null)} className="text-slate-500 hover:text-slate-800">Inicio</button>
          {trail.map((f, i) => (
            <span key={f.id} className="flex items-center gap-1.5">
              <span className="text-slate-400">/</span>
              {i === trail.length - 1
                ? <span className="font-semibold text-slate-800">📁 {f.name}</span>
                : <button onClick={() => goFolder(f.id)} className="text-slate-500 hover:text-slate-800">📁 {f.name}</button>}
            </span>
          ))}
        </div>
      )}

      {/* Barra de acciones en lote (aparece al seleccionar) */}
      {!loading && !loadError && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand bg-brand-soft px-3 py-2 text-sm">
          <span className="font-medium text-brand">{selected.size} seleccionado(s)</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              value=""
              onChange={(e) => { const v = e.target.value; if (v === '') return; bulkMove(v === '__root__' ? null : v);}}
              className={`${inp} w-auto px-2 py-1 text-xs`}
            >
              <option value="">📁 Mover a…</option>
              {currentFolder !== null && <option value="__root__">Inicio (sin carpeta)</option>}
              {moveOptions.filter((o) => o.id !== currentFolder).map((o) => (
                <option key={o.id} value={o.id}>{' '.repeat(o.depth * 2) + '📁 ' + o.name}</option>
              ))}
            </select>
            <button onClick={askBulkDelete} className="rounded-lg border border-rose-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50">🗑 Eliminar</button>
            <button onClick={() => setSelected(new Set())} className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:text-slate-800">Deseleccionar</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center text-sm text-slate-400">Cargando workflows…</div>
      ) : loadError ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-8 text-center">
          <p className="text-sm font-semibold text-amber-900">No se pudo cargar la lista</p>
          <p className="mt-1 text-xs text-amber-800">{loadError}</p>
          <button onClick={load} className="mt-3 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700">Reintentar</button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
              <tr className="[&>th]:px-3 [&>th]:py-2.5">
                <th className="w-8"><input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={rows.length === 0} title="Seleccionar todos" /></th>
                <th>Nombre</th><th>Estado</th><th>Total de inscritos</th><th>Inscripción activa</th><th>Fecha de creación</th><th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {showFolders.map((f) => (
                <FolderRowItem key={f.id} f={f} folders={folders} onOpen={() => goFolder(f.id)} onRename={() => askRenameFolder(f)} onDelete={() => askDeleteFolder(f)} onMove={(pid) => moveFolderTo(f.id, pid)} />
              ))}
              {rows.map((w) => (
                <WorkflowRowItem key={w.id} w={w} moveOptions={moveOptions} selected={selected.has(w.id)} busy={busy} onToggle={() => toggleSel(w.id)} onOpen={() => setOpenId(w.id)} onMove={(fid) => moveWf(w.id, fid)} onDelete={() => askDeleteWf(w)} onDuplicate={() => duplicate(w.id)} onExport={() => exportWf(w)} onSetStatus={(pub) => setStatusWf(w.id, pub)} />
              ))}
              {empty && (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400">
                  {currentFolder ? 'Carpeta vacía. Mueve workflows aquí con «Mover a carpeta».' : 'Aún no hay workflows ni carpetas. Crea el primero con «+ Nuevo workflow».'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {nameModal && <NameModal {...nameModal} onClose={() => setNameModal(null)} />}
      {confirmModal && <ConfirmModal {...confirmModal} onClose={() => setConfirmModal(null)} />}
    </div>
    </CatalogoCtx.Provider>
  );
}

// El catálogo no llegó: se puede seguir trabajando, pero con los pasos de
// siempre. Decirlo evita la pregunta «¿y dónde está el paso del webhook?».
function AvisoCatalogo() {
  return (
    <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      No se pudo cargar el catálogo de disparadores y pasos: se muestran solo los básicos. Recarga la página para reintentar.
    </p>
  );
}

// ── Modales (reemplazan window.prompt / window.confirm) ─────────────────────
// El guardado ocurre DENTRO del modal: si el servidor rechaza, el error se ve
// (toast) y el modal sigue abierto — la lista solo cambia tras el OK real.
function NameModal({ title, initial, placeholder, submitLabel, onSubmit, onClose }: NameModalState & { onClose: () => void }) {
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  async function go() {
    const v = name.trim();
    if (!v || saving) return;
    setSaving(true);
    try { await onSubmit(v); onClose(); }
    catch (e: any) { toast(e?.message || 'No se pudo guardar', 'error'); setSaving(false); }
  }
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold text-slate-800">{title}</h3>
        <input
          autoFocus value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') go(); if (e.key === 'Escape') onClose(); }}
          className={inp} placeholder={placeholder || 'Nombre'} maxLength={60}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">Cancelar</button>
          <button onClick={go} disabled={saving || !name.trim()} className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Guardando…' : submitLabel}</button>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({ title, body, confirmLabel, onConfirm, onClose }: ConfirmModalState & { onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  async function go() {
    if (saving) return;
    setSaving(true);
    try { await onConfirm(); onClose(); }
    catch (e: any) { toast(e?.message || 'No se pudo completar la acción', 'error'); setSaving(false); }
  }
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <p className="mt-2 text-sm text-slate-500">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">Cancelar</button>
          <button onClick={go} disabled={saving} className="rounded-lg bg-rose-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">{saving ? 'Eliminando…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// Lista de destinos para "Mover a…" con sangría por profundidad.
function MoveTargets({ options, activeId, rootLabel, onPick }: { options: TreeOption[]; activeId: string | null; rootLabel: string; onPick: (id: string | null) => void }) {
  const item = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-slate-50';
  return (
    <div className="mt-0.5 max-h-48 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/70 p-1">
      <button onClick={() => onPick(null)} className={`${item} ${activeId == null ? 'font-semibold text-brand' : 'text-slate-700'}`}><span className="w-4" /> {rootLabel}</button>
      {options.map((t) => (
        <button key={t.id} onClick={() => onPick(t.id)} className={`${item} ${activeId === t.id ? 'font-semibold text-brand' : 'text-slate-700'}`}>
          <span className="w-4 text-center">📁</span><span className="truncate" style={{ paddingLeft: t.depth * 12 }}>{t.name}</span>
        </button>
      ))}
      {options.length === 0 && <p className="px-2.5 py-1.5 text-xs text-slate-400">No hay otra carpeta.</p>}
    </div>
  );
}

function FolderRowItem({ f, folders, onOpen, onRename, onDelete, onMove }: { f: Folder; folders: Folder[]; onOpen: () => void; onRename: () => void; onDelete: () => void; onMove: (parentId: string | null) => void }) {
  // Menú con position:fixed — un dropdown absoluto dentro de la tabla quedaría
  // recortado por el contenedor overflow-x-auto.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const menu = pos != null;
  function openMenu(e: React.MouseEvent) { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) }); }
  const close = () => { setPos(null); setMoveOpen(false); };
  const item = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50';
  // Destinos válidos: ni ella misma ni sus descendientes (sería un ciclo; el
  // backend también lo rechaza — acá ni se ofrece).
  const targets = flattenTree(folders, descendantsOf(folders, f.id));
  return (
    <tr className="group [&>td]:px-3 [&>td]:py-3 hover:bg-slate-50/70">
      <td />
      <td>
        {/* Hover sin color de marca a propósito: `hover:text-brand` lo pinta el
            override de `.brand-panel` SIEMPRE (el selector mira el atributo
            class, no el estado), y el nombre saldría coral sin pasar el ratón. */}
        <button onClick={onOpen} className="flex items-center gap-2 text-left font-medium text-slate-800 hover:underline">
          <span className="text-lg">📁</span> {f.name}
        </button>
      </td>
      <td /><td /><td />
      <td className="whitespace-nowrap text-slate-400">{fmtDate(f.createdAt)}</td>
      <td className="text-right">
        <div className="inline-block">
          <button onClick={(e) => (menu ? close() : openMenu(e))} title="Opciones de la carpeta" className="rounded-lg px-2 py-1 text-lg leading-none text-slate-400 hover:bg-slate-100">⋮</button>
          {menu && pos && (
            <>
              <div className="fixed inset-0 z-40" onClick={close} />
              <div style={{ top: pos.top, right: pos.right }} className="fixed z-50 w-56 rounded-xl border border-slate-200 bg-white p-1 text-left shadow-lg">
                <button onClick={() => { close(); onOpen(); }} className={item}><span className="w-4 text-center">📂</span> Abrir</button>
                <button onClick={() => { close(); onRename(); }} className={item}><span className="w-4 text-center">✎</span> Renombrar</button>
                <div className="relative">
                  <button onClick={() => setMoveOpen((v) => !v)} className={`${item} justify-between`}><span className="flex items-center gap-2"><span className="w-4 text-center">📁</span> Mover a carpeta</span><span className="text-slate-400">›</span></button>
                  {moveOpen && <MoveTargets options={targets} activeId={f.parentId ?? null} rootLabel="Inicio (raíz)" onPick={(pid) => { close(); onMove(pid); }} />}
                </div>
                <div className="my-1 border-t border-slate-100" />
                <button onClick={() => { close(); onDelete(); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-rose-600 hover:bg-rose-50"><span className="w-4 text-center">🗑</span> Eliminar</button>
              </div>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function WorkflowRowItem({ w, moveOptions, selected, busy, onToggle, onOpen, onMove, onDelete, onDuplicate, onExport, onSetStatus }: { w: WF; moveOptions: TreeOption[]; selected: boolean; busy: boolean; onToggle: () => void; onOpen: () => void; onMove: (folderId: string | null) => void; onDelete: () => void; onDuplicate: () => void; onExport: () => void; onSetStatus: (published: boolean) => void }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const menu = pos != null;
  const published = w.status === 'published';
  function openMenu(e: React.MouseEvent) { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) }); }
  const close = () => { setPos(null); setMoveOpen(false); };
  const item = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50';
  return (
    <tr className={`group [&>td]:px-3 [&>td]:py-3 hover:bg-slate-50/70 ${selected ? 'bg-brand-soft' : ''}`}>
      <td><input type="checkbox" checked={selected} onChange={onToggle} onClick={(e) => e.stopPropagation()} /></td>
      <td><button onClick={onOpen} className="flex items-center gap-2 text-left font-medium text-slate-800 hover:underline">{w.name} <span className="text-slate-400">↗</span></button></td>
      <td><span className={`rounded-full px-2 py-0.5 text-[11px] ${published ? 'bg-brand-soft text-brand' : 'bg-slate-100 text-slate-500'}`}>{published ? 'Publicado' : 'Borrador'}</span></td>
      <td className="text-slate-800">{w._stats.active + w._stats.completed}</td>
      <td className="text-slate-800">{w._stats.active}</td>
      <td className="whitespace-nowrap text-slate-400">{fmtDate(w.createdAt)}</td>
      <td className="text-right">
        <div className="inline-block">
          <button onClick={(e) => (menu ? close() : openMenu(e))} title="Opciones" className="rounded-lg px-2 py-1 text-lg leading-none text-slate-400 hover:bg-slate-100">⋮</button>
          {menu && pos && (
            <>
              <div className="fixed inset-0 z-40" onClick={close} />
              <div style={{ top: pos.top, right: pos.right }} className="fixed z-50 w-56 rounded-xl border border-slate-200 bg-white p-1 text-left shadow-lg">
                <button onClick={() => { close(); onOpen(); }} className={item}><span className="w-4 text-center">✏️</span> Editar flujo</button>
                <button onClick={() => { close(); onSetStatus(!published); }} className={item}><span className="w-4 text-center">{published ? '⏸' : '▶'}</span> {published ? 'Desactivar (borrador)' : 'Activar (publicar)'}</button>
                <button onClick={() => { close(); onDuplicate(); }} disabled={busy} className={item}><span className="w-4 text-center">📄</span> Duplicar</button>
                <button onClick={() => { close(); onExport(); }} className={item}><span className="w-4 text-center">⬇</span> Exportar JSON</button>
                <div className="relative">
                  <button onClick={() => setMoveOpen((v) => !v)} className={`${item} justify-between`}><span className="flex items-center gap-2"><span className="w-4 text-center">📁</span> Mover a carpeta</span><span className="text-slate-400">›</span></button>
                  {moveOpen && <MoveTargets options={moveOptions} activeId={w.folderId ?? null} rootLabel="Sin carpeta" onPick={(fid) => { close(); onMove(fid); }} />}
                </div>
                <div className="my-1 border-t border-slate-100" />
                <button onClick={() => { close(); onDelete(); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-rose-600 hover:bg-rose-50"><span className="w-4 text-center">🗑</span> Eliminar</button>
              </div>
            </>
          )}
        </div>
      </td>
    </tr>
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
  const [savedFlag, setSavedFlag] = useState(false);
  const [busy, setBusy] = useState(false);
  const touch = () => { setDirty(true); setSavedFlag(false); };

  function insert(type: string, oldChild: string | null, setSlot: (v: string | null) => void) {
    const id = uid();
    const def = pasoDef(cat, type);
    const config = configInicial(def);
    let node: WFNode;
    if (def?.ramas === 'siNo') node = { id, type, config, yes: oldChild, no: null };
    else if (def?.ramas === 'rutas') {
      // La PRIMERA ruta se queda con lo que ya colgaba: insertar un A/B encima
      // de un flujo no puede dejar huérfano lo que venía debajo.
      const rutas = (config.routes as { id: string }[]) ?? [];
      node = { id, type, config, branches: Object.fromEntries(rutas.map((r, i) => [r.id, i === 0 ? oldChild : null])) };
    } else node = { id, type, config, next: oldChild };
    setNodes((n) => ({ ...n, [id]: node })); setSlot(id); touch(); setEditNode(id);
  }
  function setField(nodeId: string, field: 'next' | 'yes' | 'no', v: string | null) { setNodes((n) => ({ ...n, [nodeId]: { ...n[nodeId], [field]: v } })); touch(); }
  /** La salida de UNA ruta (paso `split`). Vive en `branches`, no en `next`. */
  function setBranch(nodeId: string, routeId: string, v: string | null) {
    setNodes((n) => ({ ...n, [nodeId]: { ...n[nodeId], branches: { ...(n[nodeId].branches || {}), [routeId]: v } } }));
    touch();
  }
  // Al borrar un paso, el hueco lo ocupa su continuación. Si el paso abría
  // ramas solo puede sobrevivir UNA: las demás se pierden enteras, y eso hay
  // que decirlo antes (hasta 2026-09 se perdía en silencio). Se conserva la
  // primera rama CON contenido, no la primera a secas.
  function del(node: WFNode, setSlot: (v: string | null) => void) {
    const hijos = salidasDe(node);
    const sucesor = hijos[0] ?? null;
    const subarbol = (id?: string | null, vistos = new Set<string>()): Set<string> => {
      if (!id || vistos.has(id) || !nodes[id]) return vistos;
      vistos.add(id);
      for (const h of salidasDe(nodes[id])) subarbol(h, vistos);
      return vistos;
    };
    const conservado = subarbol(sucesor);
    const perdida = new Set<string>();
    for (const h of hijos.slice(1)) subarbol(h, perdida);
    conservado.forEach((id) => perdida.delete(id));
    if (perdida.size) {
      const etiqueta = metaPaso(cat, node.type).label;
      if (!window.confirm(`Al quitar «${etiqueta}» se conserva una sola rama: las demás se eliminan con sus ${perdida.size} paso(s). ¿Seguir?`)) return;
    }
    // Si el paso abierto en el panel es el que se borra —o iba dentro de la
    // rama que se pierde— hay que cerrarlo. Si no, el panel se queda editando
    // un nodo ya desenganchado: lo que escribas se ve, y al guardar se poda sin
    // avisar. (Antes no pasaba porque el modal tapaba el lienzo entero y no se
    // podía llegar al ✕ de la tarjeta.)
    if (editNode && (editNode === node.id || perdida.has(editNode))) setEditNode(null);
    setSlot(sucesor);
    touch();
  }
  function patchNode(id: string, cfg: any) { setNodes((n) => ({ ...n, [id]: { ...n[id], config: { ...n[id].config, ...cfg } } })); touch(); }
  /** Parcheo del NODO (no de su config): lo usa el editor de rutas para tirar la
   *  rama de una ruta que se quita — si se quedara en `branches`, su subárbol
   *  seguiría «alcanzable» y se guardaría para siempre sin verse en el lienzo. */
  function patchNodeRaw(id: string, patch: Partial<WFNode>) { setNodes((n) => ({ ...n, [id]: { ...n[id], ...patch } })); touch(); }

  async function save(publish?: boolean) {
    setBusy(true);
    // El podado tiene que recorrer TAMBIÉN `branches`: sin eso, el primer flujo
    // con un A/B pierde media rama en cuanto se guarda.
    const reach = new Set<string>();
    const walk = (id?: string | null) => { if (!id || reach.has(id) || !nodes[id]) return; reach.add(id); for (const h of salidasDe(nodes[id])) walk(h); };
    walk(root);
    const pruned: Record<string, WFNode> = {}; reach.forEach((id) => { pruned[id] = nodes[id]; });
    const st = publish != null ? (publish ? 'published' : 'draft') : status;
    try {
      // Solo `triggers`: el servidor escribe `trigger` con el primero, para que
      // lo que todavía lee el campo de antes vea el de siempre.
      await api(`/admin/workflows/${wf.id}`, { method: 'PATCH', body: JSON.stringify({ name, status: st, triggers: disparadores, rootId: root, nodes: pruned, drip, sendWindow: win, reentry }) });
      setNodes(pruned); setStatus(st); setDirty(false); setSavedFlag(true); setTimeout(() => setSavedFlag(false), 2000);
      toast('Guardado', 'success');
    } catch (e: any) { toast(e.message ?? 'Error al guardar', 'error'); } finally { setBusy(false); }
  }
  async function remove() { if (!window.confirm('¿Eliminar este workflow?')) return; setBusy(true); try { await api(`/admin/workflows/${wf.id}`, { method: 'DELETE' }); onDeleted(); } catch (e: any) { toast(e.message ?? 'Error', 'error'); setBusy(false); } }

  function cambiarDisparadores(d: DisparadorDelFlujo[]) { setDisparadores(d); touch(); }
  // Abrir el modal cierra el panel del paso: dos capas encima del lienzo y la
  // tecla Escape cerraría las dos a la vez.
  function abrirDisparadores(enfocar: number | null) { setEditNode(null); setModalDisparadores({ enfocar }); }
  function anadirDisparador() {
    cambiarDisparadores([...disparadores, disparadorNuevo(cat)]);
    abrirDisparadores(disparadores.length);
  }
  const editorDeDisparadores = {
    disparadores,
    onChange: cambiarDisparadores,
    catalogo: cat,
    sujeto: 'negocio' as const,
    // Los campos propios del disparador (días antes, días sin pedidos…) con el mismo control que los pasos.
    renderCampo: (campo: CampoDeConfig, valor: unknown, onChange: (v: unknown) => void) => (
      <CampoControl campo={campo} valor={valor} onChange={onChange} />
    ),
  };
  const algunoAutomatico = disparadores.some((d) => d.type !== 'manual');
  const flujosDestino = otros.map((w) => ({ id: w.id, name: w.name, status: w.status }));

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-50">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
        <button onClick={onBack} className="rounded-lg px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-100">← Lista</button>
        <input value={name} onChange={(e) => { setName(e.target.value); touch(); }} className="min-w-0 max-w-[220px] flex-1 rounded-lg px-2 py-1 text-sm font-semibold text-slate-800 outline-none hover:bg-slate-50" />
        <nav className="mx-auto hidden items-center gap-1 md:flex">
          {([['creador', 'Creador'], ['config', 'Configuración'], ['inscribir', 'Inscribir'], ['registros', 'Registros']] as [Tab, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 text-sm ${tab === k ? 'font-semibold text-brand' : 'text-slate-500'}`}>{l}</button>
          ))}
        </nav>
        <button onClick={() => save()} disabled={busy || (!dirty && !savedFlag)} className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50">{savedFlag ? '✓ Guardado' : 'Guardar'}</button>
        <div className="flex items-center gap-2 text-sm">
          <span className={status === 'published' ? 'text-slate-400' : 'font-medium text-slate-700'}>Borrador</span>
          <button onClick={() => save(status !== 'published')} disabled={busy || !root} className={`relative h-5 w-9 rounded-full ${status === 'published' ? 'bg-brand' : 'bg-slate-300'}`}><span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: status === 'published' ? 18 : 2 }} /></button>
          <span className={status === 'published' ? 'font-medium text-brand' : 'text-slate-400'}>Publicar</span>
        </div>
      </header>
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-1.5 md:hidden">
        {([['creador', 'Creador'], ['config', 'Config'], ['inscribir', 'Inscribir'], ['registros', 'Registros']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`whitespace-nowrap rounded-md px-3 py-1 text-sm ${tab === k ? 'bg-brand-soft font-semibold text-brand' : 'text-slate-500'}`}>{l}</button>
        ))}
      </div>
      {degradado && <div className="shrink-0 px-3 pt-2"><AvisoCatalogo /></div>}

      <div className="relative min-h-0 flex-1">
        {tab === 'creador' && <Canvas disparadores={disparadores} onAbrirDisparadores={abrirDisparadores} onAnadirDisparador={anadirDisparador} root={root} setRoot={(v: string | null) => { setRoot(v); touch(); }} nodes={nodes} onInsert={insert} onEdit={setEditNode} onDelete={del} setField={setField} setBranch={setBranch} selectedId={editNode} panelAbierto={!!(editNode && nodes[editNode])} />}
        {/* El panel del paso vive DENTRO del lienzo: se edita viendo el flujo.
            Solo en «Creador» — en las otras pestañas taparía el contenido. */}
        {tab === 'creador' && editNode && nodes[editNode] && (
          <NodeConfig
            node={nodes[editNode]}
            flujos={flujosDestino}
            onClose={() => setEditNode(null)}
            onPatch={(cfg) => patchNode(editNode, cfg)}
            onNode={(patch) => patchNodeRaw(editNode, patch)}
          />
        )}
        {tab === 'config' && (
          <div className="absolute inset-0 overflow-auto p-5"><div className="mx-auto max-w-2xl space-y-4">
            <Card title="Disparadores">
              {/* El mismo editor que el modal del lienzo. Los campos de cada
                  disparador (días antes, días sin pedidos…), los filtros y los
                  operadores salen del catálogo: uno nuevo en el backend aparece
                  acá solo. */}
              <DisparadoresEditor {...editorDeDisparadores} />
              {algunoAutomatico && <p className="mt-3 rounded-md bg-brand-soft px-3 py-2 text-xs text-brand">⚡ El sistema inscribe solo los negocios que cumplen. Publica el workflow para activarlo.</p>}
            </Card>
            <Card title="Goteo (Drip)"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!drip.enabled} onChange={(e) => { setDrip({ ...drip, enabled: e.target.checked }); touch(); }} /> No enviar todos de golpe</label>{drip.enabled && <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-slate-500">Enviar a <input type="number" value={drip.batchSize ?? 50} onChange={(e) => { setDrip({ ...drip, batchSize: +e.target.value }); touch(); }} className="w-20 rounded border border-slate-300 px-2 py-1" /> negocios cada <input type="number" value={drip.intervalMinutes ?? 10} onChange={(e) => { setDrip({ ...drip, intervalMinutes: +e.target.value }); touch(); }} className="w-20 rounded border border-slate-300 px-2 py-1" /> min</div>}</Card>
            <Card title="Ventana de envío"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!win.enabled} onChange={(e) => { setWin({ ...win, enabled: e.target.checked }); touch(); }} /> Enviar solo en cierto horario</label>{win.enabled && <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-slate-500">De <input type="number" value={win.startHour ?? 8} onChange={(e) => { setWin({ ...win, startHour: +e.target.value }); touch(); }} className="w-16 rounded border border-slate-300 px-2 py-1" />h a <input type="number" value={win.endHour ?? 20} onChange={(e) => { setWin({ ...win, endHour: +e.target.value }); touch(); }} className="w-16 rounded border border-slate-300 px-2 py-1" />h <label className="ml-2 flex items-center gap-1"><input type="checkbox" checked={!!win.skipWeekends} onChange={(e) => { setWin({ ...win, skipWeekends: e.target.checked }); touch(); }} /> saltar findes</label></div>}</Card>
            <Card title="Re-entrada"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={reentry} onChange={(e) => { setReentry(e.target.checked); touch(); }} /> Permitir que un mismo negocio vuelva a entrar</label></Card>
            <button onClick={remove} className="text-sm text-rose-500">Eliminar workflow</button>
          </div></div>
        )}
        {tab === 'inscribir' && <EnrollTab workflowId={wf.id} published={status === 'published'} />}
        {tab === 'registros' && <LogsTab workflowId={wf.id} />}
      </div>

      {modalDisparadores && (
        <DisparadoresModal {...editorDeDisparadores} enfocar={modalDisparadores.enfocar} onClose={() => setModalDisparadores(null)} />
      )}
    </div>
  );
}

function Canvas({ disparadores, onAbrirDisparadores, onAnadirDisparador, root, setRoot, nodes, onInsert, onEdit, onDelete, setField, setBranch, selectedId, panelAbierto }: any) {
  const { cat } = useCatalogo();
  const [view, setView] = useState({ x: 0, y: 30, z: 0.9 });
  const pan = useRef<any>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const zRef = useRef(view.z); zRef.current = view.z;
  const [mini, setMini] = useState<{ boxes: { x: number; y: number; w: number; h: number }[]; W: number; H: number } | null>(null);
  function down(e: React.PointerEvent) { if ((e.target as HTMLElement).closest('.wf-node, button, .wf-nopan')) return; pan.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }
  function moveP(e: React.PointerEvent) { if (!pan.current) return; setView((v) => ({ ...v, x: pan.current.vx + (e.clientX - pan.current.x), y: pan.current.vy + (e.clientY - pan.current.y) })); }
  const zoom = (d: number) => setView((v) => ({ ...v, z: Math.min(1.4, Math.max(0.35, Math.round((v.z + d) * 100) / 100)) }));
  // Ajustar al contenido REAL: mide el ancho natural del flujo y calcula el zoom.
  function fitToContent() {
    const cont = contentRef.current, wrap = wrapRef.current;
    if (!cont || !wrap) { setView({ x: 0, y: 30, z: 0.9 }); return; }
    const natW = cont.getBoundingClientRect().width / (zRef.current || 1);
    if (!natW) { setView({ x: 0, y: 30, z: 0.9 }); return; }
    const targetZ = Math.min(1, Math.max(0.35, Math.round(((wrap.clientWidth - 40) / natW) * 100) / 100));
    setView({ x: 0, y: 30, z: targetZ });
  }
  // Medición para el MINIMAPA: silueta de los nodos + tamaño del contenido.
  // Los disparadores cuentan: añadir uno ensancha la banda de arriba y el
  // minimapa tiene que volver a medir.
  const structSig = JSON.stringify(Object.keys(nodes || {}).map((k) => [k, nodes[k]?.next, nodes[k]?.yes, nodes[k]?.no, nodes[k]?.branches])) + ':' + (disparadores as DisparadorDelFlujo[]).map((d) => d.type).join(',');
  useEffect(() => {
    const measure = () => {
      try {
        const cont = contentRef.current; if (!cont) return;
        const z = zRef.current || 1;
        const cRect = cont.getBoundingClientRect();
        const boxes: { x: number; y: number; w: number; h: number }[] = [];
        cont.querySelectorAll<HTMLElement>('.wf-node').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width / z < 60) return; // omite los botones "+" pequeños
          boxes.push({ x: (r.left - cRect.left) / z, y: (r.top - cRect.top) / z, w: r.width / z, h: r.height / z });
        });
        setMini({ boxes, W: cRect.width / z, H: cRect.height / z });
      } catch { /* decorativo: nunca romper el lienzo */ }
    };
    const raf = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', measure); };
  }, [structSig]);
  const vacio = !root;
  return (
    // Con el panel abierto el lienzo se ENCOGE en vez de quedar tapado. Así el
    // centrado, el minimapa y «ajustar al contenido» (que mide wrap.clientWidth)
    // siguen contando sobre lo que de verdad se ve. Antes el panel se comía la
    // rama derecha y el minimapa entero, y un paso recién insertado en la rama
    // «No» nacía escondido debajo.
    <div ref={wrapRef} className={`absolute inset-0 overflow-hidden bg-slate-50 [background-image:radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:22px_22px] ${panelAbierto ? 'sm:right-[380px]' : ''}`} onPointerDown={down} onPointerMove={moveP} onPointerUp={() => (pan.current = null)} onPointerLeave={() => (pan.current = null)} onWheel={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(-e.deltaY * 0.002); } }} style={{ cursor: pan.current ? 'grabbing' : 'grab' }}>
      <div ref={contentRef} className="absolute left-1/2 top-0 origin-top" style={{ transform: `translate(-50%,0) translate(${view.x}px,${view.y}px) scale(${view.z})` }}>
        <div className="flex flex-col items-center pb-40">
          {/* Banda de disparadores: un bloque claro que dice CUÁNDO entra el
              negocio, con una tarjeta por disparador. Pulsar cualquiera abre el
              modal «Disparadores» encima del lienzo (antes llevaba a la pestaña
              Configuración y se perdía de vista el flujo). */}
          <TarjetasDeDisparadores disparadores={disparadores} catalogo={cat} sujeto="negocio" onAbrir={onAbrirDisparadores} onAnadir={onAnadirDisparador} />
          <Slot value={root} setSlot={setRoot} nodes={nodes} onInsert={onInsert} onEdit={onEdit} onDelete={onDelete} setField={setField} setBranch={setBranch} depth={0} selectedId={selectedId} />
          {/* Flujo vacío: guiar los dos pasos en vez de dejar un lienzo mudo. */}
          {vacio && (
            <div className="wf-nopan mt-3 w-[300px] rounded-2xl border border-dashed border-slate-300 bg-white/80 p-4 text-center">
              <p className="text-sm font-semibold text-slate-700">Este flujo aún no hace nada</p>
              <ol className="mt-2 space-y-1 text-left text-[12px] text-slate-500">
                <li><span className="font-semibold text-slate-600">1.</span> Elige cuándo se dispara en <button onClick={() => onAbrirDisparadores(0)} className="font-medium text-brand underline underline-offset-2">Disparadores</button>.</li>
                <li><span className="font-semibold text-slate-600">2.</span> Pulsa el <span className="font-semibold text-slate-600">+</span> de arriba y añade el primer paso.</li>
              </ol>
            </div>
          )}
        </div>
      </div>
      {/* En móvil el panel es una hoja que sube desde abajo y se comía estos
          botones; con el panel abierto se suben arriba. En sm+ el lienzo ya se
          encogió, así que se quedan donde estaban. */}
      <div className={`wf-nopan absolute left-4 flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${panelAbierto ? 'top-4 sm:bottom-4 sm:top-auto' : 'bottom-4'}`}>
        <button onClick={() => zoom(0.1)} className="px-3 py-2 text-slate-500 hover:bg-slate-50">+</button>
        <span className="border-y border-slate-100 px-2 py-1 text-center text-[11px] text-slate-400">{Math.round(view.z * 100)}%</span>
        <button onClick={() => zoom(-0.1)} className="px-3 py-2 text-slate-500 hover:bg-slate-50">−</button>
        <button onClick={fitToContent} title="Ajustar al contenido" className="border-t border-slate-100 px-3 py-2 text-slate-500 hover:bg-slate-50">⤢</button>
      </div>
      {mini && mini.H > 40 && (
        <BrandMinimap mini={mini} view={view} getWrapH={() => wrapRef.current?.clientHeight ?? 400} onJump={(cy) => setView((v) => ({ ...v, x: 0, y: (wrapRef.current?.clientHeight ?? 400) / 2 - cy * v.z }))} />
      )}
    </div>
  );
}

// Minimapa del lienzo de Sellea: silueta escalada de los nodos + viewport vertical +
// clic para saltar. Decorativo y robusto (si algo falla, no rompe el lienzo).
function BrandMinimap({ mini, view, getWrapH, onJump }: { mini: { boxes: { x: number; y: number; w: number; h: number }[]; W: number; H: number }; view: { x: number; y: number; z: number }; getWrapH: () => number; onJump: (cy: number) => void }) {
  const MW = 92, MH = 128;
  const scale = Math.min(MW / Math.max(1, mini.W), MH / Math.max(1, mini.H));
  const z = view.z || 1;
  const vpTop = Math.max(0, (-view.y) / z) * scale;
  const vpH = Math.min(MH, (getWrapH() / z) * scale);
  return (
    <div className="wf-nopan absolute right-4 top-4 cursor-pointer overflow-hidden rounded-lg border border-slate-200 bg-white/90 shadow-sm" style={{ width: MW, height: MH }} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onJump((e.clientY - r.top) / (scale || 1)); }} title="Minimapa — clic para saltar">
      {mini.boxes.map((b, i) => (
        <div key={i} className="absolute rounded-[1px] bg-slate-300" style={{ left: b.x * scale, top: b.y * scale, width: Math.max(2, b.w * scale), height: Math.max(1.5, b.h * scale) }} />
      ))}
      <div className="pointer-events-none absolute inset-x-0 rounded-sm border border-brand bg-brand-soft" style={{ top: vpTop, height: Math.max(4, vpH) }} />
    </div>
  );
}

/** Una salida del paso: Sí/No, o una por ruta del `split`. */
type Rama = { key: string; label: string; chip: string; color: string; valor: string | null; setSlot: (v: string | null) => void };

function Slot({ value, setSlot, nodes, onInsert, onEdit, onDelete, setField, setBranch, depth, selectedId }: any) {
  const { cat } = useCatalogo();
  const node: WFNode | null = value ? nodes[value] : null;
  const def = node ? pasoDef(cat, node.type) : null;
  // Tras «Terminar» no se ofrece continuación: el motor da por acabado el flujo
  // ahí y un «+» prometería un paso que nunca se ejecuta. Si un flujo viejo ya
  // trae algo colgando de un `end`, se sigue pintando — esconderlo lo dejaría
  // invisible pero guardado, que es peor.
  const cierra = node?.type === 'end' && !node?.next;
  const sub = { nodes, onInsert, onEdit, onDelete, setField, setBranch, selectedId };
  // Las ramas salen del catálogo, no del tipo de paso. Un `split` sin rutas
  // configuradas no pinta ninguna: el motor también sigue por `next` en ese caso.
  const ramas: Rama[] = !node
    ? []
    : def?.ramas === 'siNo'
      ? [
          { key: 'yes', label: 'Sí', chip: '#DCFCE7', color: '#15803D', valor: node.yes ?? null, setSlot: (v) => setField(node.id, 'yes', v) },
          { key: 'no', label: 'No', chip: '#FEE2E2', color: '#B91C1C', valor: node.no ?? null, setSlot: (v) => setField(node.id, 'no', v) },
        ]
      : def?.ramas === 'rutas'
        ? rutasDe(node).map((r) => ({
            key: r.id,
            label: `${r.label || r.id} · ${Number(r.percent) || 0}%`,
            chip: '#E0E7FF',
            color: '#4338CA',
            valor: node.branches?.[r.id] ?? null,
            setSlot: (v: string | null) => setBranch(node.id, r.id, v),
          }))
        : [];
  // Con N columnas iguales y una separación g, el centro de la primera NO cae
  // en el (100/2N)% exacto: el ancho de columna es (100% − (N−1)g)/N, así que
  // el centro está a la mitad de eso. Sin ese ajuste la barra en T se queda
  // corta y deja un hueco justo donde engancha con cada rama.
  const barra = ramas.length > 1 ? `calc((100% - ${(ramas.length - 1) * RAMA_GAP}px) / ${2 * ramas.length})` : '50%';
  return (
    <div className="flex flex-col items-center">
      <Connector terminal={!node} onPick={(t: string) => onInsert(t, value, setSlot)} />
      {node && (<>
        <NodeCard node={node} selected={selectedId === node.id} onEdit={() => onEdit(node.id)} onDelete={() => onDelete(node, setSlot)} />
        {ramas.length ? (
          // Conector en T: un tramo que baja del nodo y una barra horizontal que
          // va del centro de la primera columna al de la última.
          <>
            <span aria-hidden className="h-5 w-[2px]" style={{ background: RAIL }} />
            <div className="relative grid justify-items-center" style={{ gridTemplateColumns: `repeat(${ramas.length}, minmax(0, 1fr))`, columnGap: RAMA_GAP }}>
              <span aria-hidden className="absolute top-0 h-[2px]" style={{ background: RAIL, left: barra, right: barra }} />
              {ramas.map((r) => (
                <BranchCol key={r.key} label={r.label} chip={r.chip} color={r.color}>
                  <Slot value={r.valor} setSlot={r.setSlot} depth={depth + 1} {...sub} />
                </BranchCol>
              ))}
            </div>
          </>
        ) : cierra ? null : node.type === 'end' ? (
          // Un flujo viejo puede traer pasos colgando de «Terminar» (se dan si
          // se inserta el Terminar ENCIMA de un paso que ya existía). No se
          // esconden —quedarían invisibles pero guardados— pero se marcan: el
          // motor devuelve `removed` en `end` y nunca los ejecuta.
          <div className="flex flex-col items-center opacity-50">
            <span className="mt-1.5 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700">
              Nunca se ejecuta
            </span>
            <Slot value={node.next ?? null} setSlot={(v: string | null) => setField(node.id, 'next', v)} depth={depth} {...sub} />
          </div>
        ) : (
          <Slot value={node.next ?? null} setSlot={(v: string | null) => setField(node.id, 'next', v)} depth={depth} {...sub} />
        )}
      </>)}
      {!node && depth > 0 && <span className="mt-1.5 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-400">Fin</span>}
    </div>
  );
}

// Riel continuo entre pasos, con el «+» encima. La línea es UNA sola (absoluta,
// de borde a borde) y el botón se apoya sobre ella con fondo sólido: así se ve
// un cable que atraviesa el punto de inserción, no tres trozos sueltos.
function Connector({ terminal, onPick }: { terminal: boolean; onPick: (t: string) => void }) {
  const { cat } = useCatalogo();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const fuera = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div ref={ref} className="wf-nopan relative flex flex-col items-center justify-center" style={{ height: 46 }}>
      {/* left+translate en vez de dejarlo en su posición estática: un absolute
          sin left dentro de un flex centrado lo resuelve cada navegador a su
          manera y el riel se iba a un lado. */}
      <span aria-hidden className="absolute w-[2px] -translate-x-1/2" style={{ background: RAIL, left: '50%', top: 0, bottom: terminal ? '50%' : 0 }} />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Añadir paso"
        aria-expanded={open}
        className={`relative z-10 grid h-7 w-7 place-items-center rounded-full border-2 text-sm font-medium leading-none transition-all hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 ${open ? 'border-brand bg-brand text-white' : 'bg-white text-slate-500'}`}
        style={open ? undefined : { borderColor: RAIL }}
      >
        +
      </button>
      {open && (
        <div className="absolute top-10 z-30 max-h-80 w-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
          {porGrupo(cat.pasos).map((g) => (
            <div key={g.grupo}>
              <p className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">{g.grupo}</p>
              {g.items.map((p) => {
                const col = colorDeGrupo(p.grupo);
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => { onPick(p.key); setOpen(false); }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-xs" style={{ background: col.chip, color: col.color }}>{p.icono}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-slate-800">{p.label}</span>
                      {p.hint && <span className="block truncate text-[11px] text-slate-400">{p.hint}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Resumen de la tarjeta a partir de los CAMPOS del catálogo, no del tipo de
// paso: un paso nuevo del backend ya nace con resumen sin tocar esto.
function resumen(def: Paso | null, node: WFNode): string {
  const c = node.config || {};
  if (!def) return 'Paso desconocido';
  // El catálogo puede traer su propia frase para la tarjeta.
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
    } else if (campo.tipo === 'rutas') {
      const rs = Array.isArray(v) ? v : [];
      partes.push(rs.length ? rs.map((r: any) => `${r.label || r.id} ${Number(r.percent) || 0}%`).join(' / ') : 'Sin rutas');
    } else if (campo.tipo === 'cabeceras') {
      continue;
    } else if (campo.tipo === 'select') {
      const elegido = String(v ?? campo.def ?? '');
      // Un desplegable SIN elegir no dice nada de lo que hace el paso, igual
      // que un texto vacío: «Sin plantilla (escribo el cuerpo aquí)» ocuparía
      // la tarjeta entera sin aportar.
      const op = elegido ? campo.opciones?.find((o) => o.value === elegido) : null;
      if (op) partes.push(op.label);
    } else {
      const s = String(v ?? '').trim();
      if (s) partes.push(campo.tipo === 'textarea' ? s.slice(0, 60) : s);
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
    if (campo.tipo === 'condiciones' || campo.tipo === 'cabeceras' || campo.tipo === 'rutas') return !Array.isArray(v) || v.length === 0;
    return String(v ?? '').trim() === '';
  });
}

function NodeCard({ node, selected, onEdit, onDelete }: { node: WFNode; selected: boolean; onEdit: () => void; onDelete: () => void }) {
  const { cat } = useCatalogo();
  const s = metaPaso(cat, node.type);
  const incompleto = faltaAlgo(s.def, node);
  return (
    <div
      className={`wf-node group relative flex w-[264px] items-center gap-3 rounded-2xl border bg-white px-3 py-2.5 transition-shadow ${selected ? 'border-brand shadow-md ring-2 ring-brand' : 'border-slate-200 shadow-sm hover:shadow-md'}`}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm" style={{ background: s.chip, color: s.color }}>{s.icon}</span>
      <button
        type="button"
        onClick={onEdit}
        className="min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 rounded-md"
      >
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-slate-800">{s.label}</span>
          {incompleto && <span className="shrink-0 rounded bg-amber-100 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-700">Vacío</span>}
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] text-slate-400">{resumen(s.def, node)}</span>
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Eliminar el paso ${s.label}`}
        className="shrink-0 rounded-md px-1 text-slate-300 opacity-0 transition hover:text-rose-500 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 group-hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}

function BranchCol({ label, chip, color, children }: any) {
  return (
    <div className="flex flex-col items-center">
      <span aria-hidden className="h-4 w-[2px]" style={{ background: RAIL }} />
      <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ background: chip, color }}>{label}</span>
      {children}
    </div>
  );
}

// Segmentos de SMS. GSM-7 cabe 160 (153 si va partido); en cuanto entra un
// carácter fuera del alfabeto —una emoji, casi siempre— el mensaje pasa a UCS-2
// y baja a 70/67. Es la diferencia entre pagar 1 envío y pagar 3, y no se ve
// hasta que llega la factura; por eso el contador está a la vista.
const GSM7 = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXT = '^{}\\[~]|€';
function segmentosSms(texto: string) {
  // DOS pasadas a propósito. La primera decide el alfabeto del mensaje ENTERO;
  // la segunda cuenta. Contar y decidir a la vez estaba mal: `{ } [ ] ~ ^ | €`
  // valen 2 en GSM-7 pero 1 en UCS-2, y como cada variable es `{{x}}` (cuatro
  // de esos), un mensaje con una tilde o una emoji se contaba 4 de más por
  // variable.
  let esGsm = true;
  for (const ch of texto) {
    if (GSM7_EXT.includes(ch) || GSM7.includes(ch)) continue;
    esGsm = false;
    break;
  }
  let unidades = 0;
  for (const ch of texto) {
    // En GSM-7 los de la tabla de extensión ocupan dos septetos; en UCS-2 se
    // cuenta por unidades UTF-16 (una emoji ocupa 2).
    unidades += esGsm ? (GSM7_EXT.includes(ch) ? 2 : 1) : ch.length;
  }
  const simple = esGsm ? 160 : 70;
  const multi = esGsm ? 153 : 67;
  const segmentos = unidades === 0 ? 0 : unidades <= simple ? 1 : Math.ceil(unidades / multi);
  return { unidades, segmentos, esGsm, tope: segmentos > 1 ? multi : simple };
}

// Inserta la variable DONDE está el cursor, no al final. Escribir el mensaje y
// tener que recolocar cada {{negocio}} a mano era la queja de siempre.
function pegarEnCursor(el: HTMLTextAreaElement | HTMLInputElement | null, texto: string, valor: string) {
  const ini = el?.selectionStart ?? texto.length;
  const fin = el?.selectionEnd ?? texto.length;
  const salida = texto.slice(0, ini) + valor + texto.slice(fin);
  const cursor = ini + valor.length;
  if (el) requestAnimationFrame(() => { try { el.focus(); el.setSelectionRange(cursor, cursor); } catch { /* el panel pudo cerrarse */ } });
  return salida;
}

function ChipsMerge({ onPick }: { onPick: (clave: string) => void }) {
  const { cat } = useCatalogo();
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      <span className="mr-0.5 self-center text-[11px] text-slate-400">Insertar:</span>
      {cat.merge.map((m) => (
        <button
          key={m.key}
          type="button"
          onClick={() => onPick(m.key)}
          className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

// Panel LATERAL (antes era un modal centrado que tapaba el flujo). Editar un
// paso mirando el lienzo es media faena: se ve dónde encaja lo que escribes.
function NodeConfig({ node, flujos, onClose, onPatch, onNode }: {
  node: WFNode;
  flujos: { id: string; name: string; status: string }[];
  onClose: () => void;
  onPatch: (c: any) => void;
  onNode: (patch: Partial<WFNode>) => void;
}) {
  const { cat } = useCatalogo();
  const c = node.config || {};
  const s = metaPaso(cat, node.type);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <aside
      role="dialog"
      aria-label={`Configurar el paso ${s.label}`}
      className="absolute inset-x-0 bottom-0 z-30 flex max-h-[75%] flex-col rounded-t-2xl border-t border-slate-200 bg-white shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[380px] sm:rounded-none sm:border-l sm:border-t-0"
    >
      <header className="flex shrink-0 items-center gap-2.5 border-b border-slate-100 px-4 py-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm" style={{ background: s.chip, color: s.color }}>{s.icon}</span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-slate-800">{s.label}</h3>
          <p className="truncate text-[11px] text-slate-400">{s.grupo}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">✕</button>
      </header>

      {/* El formulario ENTERO sale de `campos`: no hay un `if` por tipo de paso.
          Un paso nuevo en el backend se configura acá sin tocar esta pantalla. */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {s.hint && <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">{s.hint}</p>}
        {s.grupo === 'Mensaje' && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
            Sale por la subcuenta de Grow Business de <strong>tu marca</strong>. Si la marca no tiene subcuenta propia, el paso se salta y queda anotado en Registros.
          </p>
        )}
        {!s.def && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
            Este paso no está en el catálogo que respondió el servidor. Puede ser de una versión más nueva del panel: no lo edites desde aquí o perderás su configuración.
          </p>
        )}
        {(s.def?.campos ?? []).filter((campo) => campoVisible(campo, c)).map((campo) => (
          <CampoControl
            key={campo.key}
            campo={campo}
            valor={c[campo.key]}
            node={node}
            flujos={flujos}
            onChange={(v) => onPatch({ [campo.key]: v })}
            onNode={onNode}
          />
        ))}
        {/* Probar el paso ANTES de publicarlo: manda lo que hay escrito ahora
            al destino de prueba de la marca. Qué pasos lo enseñan lo dice el
            catálogo (`prueba`), no una lista de tipos escrita aquí. */}
        {s.def?.prueba && <PruebaDeEnvio canal={s.def.prueba} base={BASE} config={c} />}
        {s.def && s.def.campos.length === 0 && !s.hint && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-600">Este paso no necesita configuración.</p>
        )}
      </div>

      <footer className="shrink-0 border-t border-slate-100 px-4 py-3">
        <button type="button" onClick={onClose} className="w-full rounded-lg bg-brand py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2">Listo</button>
        <p className="mt-1.5 text-center text-[11px] text-slate-400">Los cambios se guardan con «Guardar» arriba.</p>
      </footer>
    </aside>
  );
}

// ── Un campo del catálogo → su control ─────────────────────────────────────
// `condiciones`, `rutas`, `cabeceras` y `flujo` tienen editor propio; el resto
// son controles normales.
function CampoControl({ campo, valor, node, flujos, onChange, onNode }: {
  campo: CampoDeConfig;
  valor: any;
  node?: WFNode;
  flujos?: { id: string; name: string; status: string }[];
  onChange: (v: any) => void;
  onNode?: (patch: Partial<WFNode>) => void;
}) {
  const ref = useRef<any>(null);
  const texto = String(valor ?? campo.def ?? '');
  // El contador de segmentos va con el campo que SALE por SMS, no con un tipo
  // de paso: `message` es el que se manda. Si el paso puede ir por correo
  // (notify_brand con canal=email) el contador no aplica y estorbaría.
  const esSms = campo.key === 'message' && String(node?.config?.canal ?? 'sms') !== 'email';

  let control: React.ReactNode;
  switch (campo.tipo) {
    case 'textarea': {
      const sms = esSms ? segmentosSms(texto) : null;
      control = (
        <>
          {/* El placeholder solo se arriesga a sugerir texto cuando el campo es
              el del mensaje: en el cuerpo de un webhook un «Hola {{owner}}»
              sería basura. */}
          <textarea ref={ref} rows={6} value={texto} onChange={(e) => onChange(e.target.value)} className={`${inp} resize-none`} placeholder={esSms ? 'Hola {{owner}}, tu plan de {{negocio}} vence pronto…' : ''} />
          {sms && (
            <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px]">
              <span className="text-slate-400">
                {sms.unidades} / {sms.tope} · <span className={sms.segmentos > 1 ? 'font-semibold text-amber-700' : ''}>{sms.segmentos} segmento{sms.segmentos === 1 ? '' : 's'}</span>
              </span>
              {!sms.esGsm && <span className="text-amber-700">Lleva algo fuera del alfabeto SMS —una emoji, o á í ó ú—: el tope cae de 160 a 70 por segmento.</span>}
            </div>
          )}
          <ChipsMerge onPick={(k) => onChange(pegarEnCursor(ref.current, texto, `{{${k}}}`))} />
          {sms && <p className="mt-1.5 text-[11px] text-slate-400">El contador es aproximado: las variables se sustituyen al enviar y cambian el largo.</p>}
        </>
      );
      break;
    }
    case 'numero':
      control = <input type="number" min={0} value={Number(valor ?? campo.def ?? 0)} onChange={(e) => onChange(+e.target.value)} className={`${inp} w-32`} />;
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
    case 'rutas':
      control = <RutasEditor valor={Array.isArray(valor) ? valor : []} node={node} onChange={onChange} onNode={onNode} />;
      break;
    case 'cabeceras':
      control = <CabecerasEditor valor={Array.isArray(valor) ? valor : []} onChange={onChange} />;
      break;
    case 'flujo':
      control = <FlujoSelect flujos={flujos ?? []} valor={texto} onChange={onChange} />;
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
// negocio, aparece acá sin tocar nada.
// La fila es la misma que la de los filtros del disparador: con todos los
// operadores, «contiene» admite varios valores en chips y «está vacío» no pide
// valor. Dos editores distintos para la misma condición acabarían guardando
// cosas distintas.
function CondicionesEditor({ valor, onChange }: { valor: any[]; onChange: (v: any[]) => void }) {
  const { cat } = useCatalogo();
  const campoPorDefecto = cat.campos[0]?.key ?? 'plan';
  const opPorDefecto = cat.operadores[0]?.value ?? 'eq';
  return (
    <div>
      <div className="space-y-2">
        {valor.map((cd: any, i: number) => (
          <FiltroFila
            key={i}
            filtro={cd}
            campos={cat.campos}
            permitidos={null}
            operadores={cat.operadores}
            onChange={(nc) => onChange(valor.map((x, j) => (j === i ? nc : x)))}
            onQuitar={() => onChange(valor.filter((_, j) => j !== i))}
          />
        ))}
      </div>
      <button type="button" onClick={() => onChange([...valor, { field: campoPorDefecto, op: opPorDefecto, value: '' }])} className="btn-link mt-1.5 text-sm">+ Condición</button>
      {valor.length === 0 && <p className="mt-1 text-[11px] text-slate-400">Sin condiciones el flujo siempre irá por «Sí».</p>}
    </div>
  );
}

// Rutas del paso «Dividir»: cada una es una salida del lienzo (`node.branches`).
function RutasEditor({ valor, node, onChange, onNode }: {
  valor: any[];
  node?: WFNode;
  onChange: (v: any[]) => void;
  onNode?: (patch: Partial<WFNode>) => void;
}) {
  const suma = valor.reduce((s, r) => s + (Number(r?.percent) || 0), 0);
  const set = (i: number, patch: any) => onChange(valor.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  function quitar(i: number) {
    const ruta = valor[i];
    // Si la ruta tiene pasos colgando, PREGUNTAR: quitarla se los lleva por
    // delante al guardar, y el usuario no los ve desaparecer. Borrar un paso ya
    // pregunta; esto no lo hacía.
    if (ruta?.id && node?.branches?.[ruta.id]) {
      const ok = window.confirm(
        `La ruta «${ruta.label || ruta.id}» tiene pasos colgando. Si la quitas, esos pasos se pierden al guardar. ¿Seguir?`,
      );
      if (!ok) return;
    }
    onChange(valor.filter((_, j) => j !== i));
    // La rama de la ruta se va CON la ruta. Si se quedara en `branches`, su
    // subárbol seguiría siendo alcanzable al guardar: quedaría guardado para
    // siempre sin que nadie lo vea en el lienzo.
    if (ruta?.id && node && onNode) {
      onNode({ branches: Object.fromEntries(Object.entries(node.branches ?? {}).filter(([k]) => k !== ruta.id)) });
    }
  }
  return (
    <div>
      <div className="space-y-2">
        {valor.map((r: any, i: number) => (
          <div key={r?.id ?? i} className="flex flex-wrap items-center gap-1.5">
            <input value={r?.label ?? ''} onChange={(e) => set(i, { label: e.target.value })} placeholder="Nombre" className={`${inp} w-28 px-2 py-1.5`} />
            <input type="number" min={0} max={100} value={Number(r?.percent) || 0} onChange={(e) => set(i, { percent: +e.target.value })} className={`${inp} w-20 px-2 py-1.5`} />
            <span className="text-xs text-slate-400">%</span>
            <button type="button" onClick={() => quitar(i)} aria-label={`Quitar la ruta ${r?.label ?? ''}`} className="text-slate-400 hover:text-rose-600">✕</button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => onChange([...valor, { id: nuevaRutaId(), label: String.fromCharCode(65 + valor.length), percent: 0 }])} className="btn-link mt-1.5 text-sm">+ Ruta</button>
      {valor.length === 0 && <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800">Sin rutas este paso no divide nada: el flujo sigue de largo.</p>}
      {valor.length > 0 && suma !== 100 && (
        <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800">Los porcentajes suman {suma}%. El motor reparte en proporción igual, pero lo esperable es 100%.</p>
      )}
    </div>
  );
}

function CabecerasEditor({ valor, onChange }: { valor: any[]; onChange: (v: any[]) => void }) {
  const set = (i: number, patch: any) => onChange(valor.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div>
      <div className="space-y-2">
        {valor.map((h: any, i: number) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5">
            <input value={h?.key ?? ''} onChange={(e) => set(i, { key: e.target.value })} placeholder="Authorization" className={`${inp} w-32 px-2 py-1.5`} />
            <input value={h?.value ?? ''} onChange={(e) => set(i, { value: e.target.value })} placeholder="Bearer …" className={`${inp} w-32 px-2 py-1.5`} />
            <button type="button" onClick={() => onChange(valor.filter((_, j) => j !== i))} aria-label="Quitar la cabecera" className="text-slate-400 hover:text-rose-600">✕</button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => onChange([...valor, { key: '', value: '' }])} className="btn-link mt-1.5 text-sm">+ Cabecera</button>
    </div>
  );
}

// Destino de «Pasar a otro flujo». Los BORRADORES no se pueden elegir: el motor
// los rechaza y el paso se saltaría sin que nadie se enterara.
function FlujoSelect({ flujos, valor, onChange }: { flujos: { id: string; name: string; status: string }[]; valor: string; onChange: (v: string) => void }) {
  const publicados = flujos.filter((f) => f.status === 'published');
  const elegido = flujos.find((f) => f.id === valor) ?? null;
  return (
    <div>
      <select value={valor} onChange={(e) => onChange(e.target.value)} className={inp}>
        <option value="">— Elige un flujo —</option>
        {flujos.map((f) => (
          <option key={f.id} value={f.id} disabled={f.status !== 'published'}>
            {f.name}{f.status === 'published' ? '' : ' · borrador'}
          </option>
        ))}
      </select>
      {flujos.length === 0 && <p className="mt-1 text-[11px] text-slate-400">No hay otro flujo en esta marca.</p>}
      {flujos.length > 0 && publicados.length === 0 && (
        <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800">Ninguno está publicado. Publica el flujo destino antes de usarlo aquí.</p>
      )}
      {valor && (!elegido || elegido.status !== 'published') && (
        <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800">El flujo elegido ya no está publicado: el paso se saltará y quedará anotado en Registros.</p>
      )}
    </div>
  );
}

function EnrollTab({ workflowId, published }: { workflowId: string; published: boolean }) {
  const [q, setQ] = useState(''); const [list, setList] = useState<any[] | null>(null); const [sel, setSel] = useState<Set<string>>(new Set()); const [busy, setBusy] = useState(false); const [done, setDone] = useState(0);
  async function search() { setBusy(true); try { setList(await api(`/admin/workflows/meta/tenants${q ? `?q=${encodeURIComponent(q)}` : ''}`)); } catch { setList([]); } finally { setBusy(false); } }
  useEffect(() => { search(); }, []);
  async function go() { setBusy(true); try { const r: any = await api(`/admin/workflows/${workflowId}/enroll`, { method: 'POST', body: JSON.stringify({ tenantIds: [...sel] }) }); setDone(r?.count ?? sel.size); setSel(new Set()); toast('Inscritos', 'success'); } catch (e: any) { toast(e.message ?? 'Error', 'error'); } finally { setBusy(false); } }
  return (
    <div className="absolute inset-0 overflow-auto p-5"><div className="mx-auto max-w-md space-y-3">
      <h3 className="text-sm font-semibold">Inscribir negocios</h3>
      {!published && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">Publica el workflow (arriba) para inscribir.</p>}
      {done > 0 && <p className="rounded-lg bg-brand-soft px-3 py-2 text-xs text-brand">✓ {done} negocio(s) inscrito(s).</p>}
      <div className="flex gap-2"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar negocio…" className={inp} /><button onClick={search} disabled={busy} className="rounded-lg border border-slate-300 px-3 text-sm">Buscar</button></div>
      <div className="space-y-1 rounded-xl border border-slate-200 bg-white p-2">
        {(list ?? []).map((t) => (<label key={t.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"><input type="checkbox" checked={sel.has(t.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })} /><span className="flex-1 truncate">{t.name}</span><span className="text-[11px] text-slate-400">{t.phone || t.whatsappPhone || 'sin tel'}</span></label>))}
        {list && list.length === 0 && <p className="py-4 text-center text-xs text-slate-400">Sin negocios.</p>}
      </div>
      <div className="flex justify-end"><button onClick={go} disabled={busy || !published || sel.size === 0} className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">Inscribir {sel.size || ''}</button></div>
    </div></div>
  );
}
function LogsTab({ workflowId }: { workflowId: string }) {
  const [logs, setLogs] = useState<any[] | null>(null);
  useEffect(() => { api(`/admin/workflows/${workflowId}/logs`).then((r: any) => setLogs(r ?? [])).catch(() => setLogs([])); }, [workflowId]);
  return (
    <div className="absolute inset-0 overflow-auto p-5"><div className="mx-auto max-w-3xl">
      <h3 className="mb-1 text-sm font-semibold">Registros de ejecución</h3>
      <p className="mb-3 text-xs text-slate-500">Cada línea: cuándo, qué negocio, qué se envió, <strong>a quién</strong> y cómo terminó.</p>
      {!logs ? <p className="py-8 text-center text-sm text-slate-400">Cargando…</p> : logs.length === 0 ? <p className="py-8 text-center text-sm text-slate-400">Sin registros aún.</p> : (
        <div className="space-y-1 text-sm">{logs.map((l) => (<div key={l.id} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-2 py-1.5"><span className="w-28 shrink-0 text-[11px] text-slate-400">{new Date(l.createdAt).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span><span className="w-28 shrink-0 truncate">{l.tenantName}</span><span className="min-w-0 flex-1 truncate text-slate-500">{l.message || l.result}</span><span className="w-52 shrink-0 truncate text-[11px] text-slate-500" title={l.recipient ?? ''}>{l.recipient || '—'}</span><span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px]" style={l.status === 'sent' ? { background: '#dcfce7', color: '#15803d' } : l.status === 'failed' ? { background: '#fee2e2', color: '#b91c1c' } : { background: '#f1f5f9', color: '#64748b' }}>{ESTADO_DEL_REGISTRO[l.status] ?? l.status}</span></div>))}</div>
      )}
    </div></div>
  );
}
// El estado lo lee el dueño de la marca: en español, no «sent»/«failed».
const ESTADO_DEL_REGISTRO: Record<string, string> = {
  sent: 'enviado',
  failed: 'falló',
  skipped: 'omitido',
  info: 'info',
};

function Card({ title, children }: any) { return <div className="rounded-2xl border border-slate-200 bg-white p-4"><h3 className="mb-2 text-sm font-semibold">{title}</h3>{children}</div>; }
function Label({ children }: any) { return <p className="mb-1 text-xs font-medium text-slate-500">{children}</p>; }
