'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

// Constructor visual de Workflows de la MARCA (audiencia: sus negocios/tenants).
// SMS al dueño por la subcuenta de Grow Business de la marca. Backend:
// /admin/workflows/* (motor durable por @Cron). Lista estilo TeamClubify:
// carpetas ANIDADAS (parentId) + migas de pan + selección múltiple con acciones
// en lote + menú «⋮» por fila. El árbol se arma acá en código a partir de
// parentId — el backend rechaza los ciclos, la UI ni los ofrece como destino.

type Stats = { active: number; completed: number };
type WF = {
  id: string; name: string; folderId: string | null; status: string;
  trigger: any; rootId: string | null; nodes: any; drip: any; sendWindow: any; reentry: boolean;
  createdAt?: string; _stats: Stats;
};
type Folder = { id: string; name: string; parentId?: string | null; createdAt?: string };
type WFNode = { id: string; type: string; config: any; next?: string | null; yes?: string | null; no?: string | null };

const ACCENT = '#16a34a';
// Color del riel que une los pasos. Un solo tono para TODO el cableado: el
// color informa la familia del paso, no la línea que los conecta.
const RAIL = '#CBD5E1';
// Separación entre las columnas «Sí» y «No». Es una constante porque la barra
// en T se calcula a partir de ella (ver el conector de rama en Slot).
const RAMA_GAP = 32;

// El color va por FAMILIA, no por nodo suelto. Así el lienzo se lee de un
// vistazo — verde sale un mensaje, violeta espera, índigo decide, rojo
// termina — en vez de ser un mosaico de colores sin sistema.
//
// Y el catálogo tiene EXACTAMENTE los 5 tipos que el motor sabe ejecutar
// (brand-workflow-engine.service.ts). Ofrecer un paso que el motor no ejecuta
// es peor que no ofrecerlo: el flujo se guarda, se publica, y el negocio pasa
// por ese nodo sin que ocurra nada y sin que nadie se entere.
const NODE = {
  send_sms: { label: 'Enviar mensaje', sub: 'SMS al dueño', icon: '💬', chip: '#D1FAE5', color: '#047857', group: 'Mensaje' },
  send_email: { label: 'Enviar correo', sub: 'Al correo del dueño', icon: '✉️', chip: '#D1FAE5', color: '#047857', group: 'Mensaje' },
  wait_delay: { label: 'Esperar un tiempo', sub: 'Pausa el flujo', icon: '⏱', chip: '#EDE9FE', color: '#6D28D9', group: 'Espera' },
  if_else: { label: 'Si / No', sub: 'Parte el flujo en dos', icon: '⑂', chip: '#E0E7FF', color: '#4338CA', group: 'Lógica', branch: true },
  end: { label: 'Terminar el flujo', sub: 'El negocio sale', icon: '🚪', chip: '#FEE2E2', color: '#B91C1C', group: 'Salida' },
} as const;
const NODE_TYPES = Object.keys(NODE) as (keyof typeof NODE)[];
// Orden de los grupos en el menú «+». Se deriva del catálogo para que añadir un
// tipo nuevo no obligue a tocar el menú en otro sitio y se quede fuera.
const NODE_GROUPS = NODE_TYPES.reduce<{ group: string; types: (keyof typeof NODE)[] }[]>((acc, t) => {
  const g = NODE[t].group;
  const found = acc.find((x) => x.group === g);
  if (found) found.types.push(t); else acc.push({ group: g, types: [t] });
  return acc;
}, []);
const nodeMeta = (type: string) =>
  (NODE as any)[type] ?? { label: type, sub: 'Paso desconocido', icon: '•', chip: '#F1F5F9', color: '#64748B', group: '—' };
const MERGE = [
  { key: 'negocio', label: 'Negocio' }, { key: 'owner', label: 'Dueño' },
  { key: 'plan', label: 'Plan' }, { key: 'platform', label: 'Marca' },
];
const COND_FIELDS = [{ key: 'plan', label: 'Plan' }, { key: 'status', label: 'Estado' }, { key: 'negocio', label: 'Nombre del negocio' }];
const TRIGGERS = [
  { key: 'manual', label: 'Inscripción manual / lista', wired: true, hint: 'Inscribe negocios a mano desde la pestaña "Inscribir".' },
  { key: 'business_created', label: 'Negocio nuevo', wired: true, hint: 'Se inscribe solo cuando se registra un negocio nuevo en la marca.' },
  { key: 'subscription_expiring', label: 'Suscripción por vencer', wired: true, hint: 'Se inscribe cuando faltan N días para el próximo cobro.' },
  { key: 'business_inactive', label: 'Negocio inactivo', wired: true, hint: 'Se inscribe si un negocio activo lleva N días sin pedidos.' },
];
function uid() { try { return 'n' + crypto.randomUUID().slice(0, 8); } catch { return 'n' + Math.random().toString(36).slice(2, 10); } }
function fmtDate(s?: string) { return s ? new Date(s).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; }
const inp = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500';

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
    const data = { name: w.name, trigger: w.trigger, rootId: w.rootId, nodes: w.nodes, drip: w.drip, sendWindow: w.sendWindow, reentry: w.reentry };
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
  if (open) return <Editor key={open.id} wf={open} onBack={() => { setOpenId(null); load(); }} onDeleted={() => { setWfs((p) => p.filter((w) => w.id !== open.id)); setOpenId(null); }} />;

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-slate-500">Flujos con esperas, ramas y ventana horaria para tus negocios. Organízalos en carpetas (y subcarpetas).</p>
        <div className="ml-auto flex gap-2">
          <button onClick={askNewFolder} disabled={busy || loading} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">📁 Nueva carpeta</button>
          <button onClick={addWf} disabled={busy || loading} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50" style={{ background: ACCENT }}>+ Nuevo workflow</button>
        </div>
      </div>

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
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
          <span className="font-medium text-emerald-800">{selected.size} seleccionado(s)</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              value=""
              onChange={(e) => { const v = e.target.value; if (v === '') return; bulkMove(v === '__root__' ? null : v);}}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-emerald-400"
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
          <button onClick={go} disabled={saving || !name.trim()} className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50" style={{ background: ACCENT }}>{saving ? 'Guardando…' : submitLabel}</button>
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
      <button onClick={() => onPick(null)} className={`${item} ${activeId == null ? 'font-semibold text-emerald-700' : 'text-slate-700'}`}><span className="w-4" /> {rootLabel}</button>
      {options.map((t) => (
        <button key={t.id} onClick={() => onPick(t.id)} className={`${item} ${activeId === t.id ? 'font-semibold text-emerald-700' : 'text-slate-700'}`}>
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
        <button onClick={onOpen} className="flex items-center gap-2 text-left font-medium text-slate-800 hover:text-emerald-700">
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
    <tr className={`group [&>td]:px-3 [&>td]:py-3 hover:bg-slate-50/70 ${selected ? 'bg-emerald-50/50' : ''}`}>
      <td><input type="checkbox" checked={selected} onChange={onToggle} onClick={(e) => e.stopPropagation()} /></td>
      <td><button onClick={onOpen} className="flex items-center gap-2 text-left font-medium text-slate-800 hover:text-emerald-700">{w.name} <span className="text-slate-400">↗</span></button></td>
      <td><span className="rounded-full px-2 py-0.5 text-[11px]" style={published ? { background: '#dcfce7', color: '#15803d' } : { background: '#f1f5f9', color: '#64748b' }}>{published ? 'Publicado' : 'Borrador'}</span></td>
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
function Editor({ wf, onBack, onDeleted }: { wf: WF; onBack: () => void; onDeleted: () => void }) {
  const [tab, setTab] = useState<Tab>('creador');
  const [name, setName] = useState(wf.name);
  const [status, setStatus] = useState(wf.status);
  const [trigger, setTrigger] = useState<any>(wf.trigger || { type: 'manual' });
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
    const id = uid(); const branch = (NODE as any)[type]?.branch;
    const node: WFNode = { id, type, config: {}, ...(branch ? { yes: oldChild, no: null } : { next: oldChild }) };
    setNodes((n) => ({ ...n, [id]: node })); setSlot(id); touch(); setEditNode(id);
  }
  function setField(nodeId: string, field: 'next' | 'yes' | 'no', v: string | null) { setNodes((n) => ({ ...n, [nodeId]: { ...n[nodeId], [field]: v } })); touch(); }
  // Al borrar un paso, el hueco lo ocupa su continuación. En un «Si / No» solo
  // puede sobrevivir UNA rama: la otra se pierde entera, y hasta ahora se
  // perdía en silencio. Se prefiere la rama que TIENE contenido (antes se
  // conservaba «Sí» aunque estuviera vacía y se tiraba «No» con todo dentro).
  function del(node: WFNode, setSlot: (v: string | null) => void) {
    const sucesor = node.next ?? node.yes ?? node.no ?? null;
    const subarbol = (id?: string | null, vistos = new Set<string>()): Set<string> => {
      if (!id || vistos.has(id) || !nodes[id]) return vistos;
      vistos.add(id);
      subarbol(nodes[id].next, vistos);
      subarbol(nodes[id].yes, vistos);
      subarbol(nodes[id].no, vistos);
      return vistos;
    };
    const perdida =
      node.type === 'if_else'
        ? subarbol(node.yes === sucesor ? node.no : node.yes)
        : new Set<string>();
    if (perdida.size) {
      const cual = node.yes === sucesor ? 'No' : 'Sí';
      if (!window.confirm(`Al quitar este «Si / No» se conserva una rama y se elimina la rama «${cual}» con sus ${perdida.size} paso(s). ¿Seguir?`)) return;
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

  async function save(publish?: boolean) {
    setBusy(true);
    const reach = new Set<string>(); const walk = (id?: string | null) => { if (!id || reach.has(id) || !nodes[id]) return; reach.add(id); walk(nodes[id].next); walk(nodes[id].yes); walk(nodes[id].no); }; walk(root);
    const pruned: Record<string, WFNode> = {}; reach.forEach((id) => { pruned[id] = nodes[id]; });
    const st = publish != null ? (publish ? 'published' : 'draft') : status;
    try {
      await api(`/admin/workflows/${wf.id}`, { method: 'PATCH', body: JSON.stringify({ name, status: st, trigger, rootId: root, nodes: pruned, drip, sendWindow: win, reentry }) });
      setNodes(pruned); setStatus(st); setDirty(false); setSavedFlag(true); setTimeout(() => setSavedFlag(false), 2000);
      toast('Guardado', 'success');
    } catch (e: any) { toast(e.message ?? 'Error al guardar', 'error'); } finally { setBusy(false); }
  }
  async function remove() { if (!window.confirm('¿Eliminar este workflow?')) return; setBusy(true); try { await api(`/admin/workflows/${wf.id}`, { method: 'DELETE' }); onDeleted(); } catch (e: any) { toast(e.message ?? 'Error', 'error'); setBusy(false); } }

  const trigDef = TRIGGERS.find((t) => t.key === trigger.type);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-50">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
        <button onClick={onBack} className="rounded-lg px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-100">← Lista</button>
        <input value={name} onChange={(e) => { setName(e.target.value); touch(); }} className="min-w-0 max-w-[220px] flex-1 rounded-lg px-2 py-1 text-sm font-semibold text-slate-800 outline-none hover:bg-slate-50" />
        <nav className="mx-auto hidden items-center gap-1 md:flex">
          {([['creador', 'Creador'], ['config', 'Configuración'], ['inscribir', 'Inscribir'], ['registros', 'Registros']] as [Tab, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 text-sm ${tab === k ? 'font-semibold text-emerald-700' : 'text-slate-500'}`}>{l}</button>
          ))}
        </nav>
        <button onClick={() => save()} disabled={busy || (!dirty && !savedFlag)} className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50">{savedFlag ? '✓ Guardado' : 'Guardar'}</button>
        <div className="flex items-center gap-2 text-sm">
          <span className={status === 'published' ? 'text-slate-400' : 'font-medium text-slate-700'}>Borrador</span>
          <button onClick={() => save(status !== 'published')} disabled={busy || !root} className="relative h-5 w-9 rounded-full" style={{ background: status === 'published' ? ACCENT : '#cbd5e1' }}><span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: status === 'published' ? 18 : 2 }} /></button>
          <span className={status === 'published' ? 'font-medium text-emerald-600' : 'text-slate-400'}>Publicar</span>
        </div>
      </header>
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-1.5 md:hidden">
        {([['creador', 'Creador'], ['config', 'Config'], ['inscribir', 'Inscribir'], ['registros', 'Registros']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`whitespace-nowrap rounded-md px-3 py-1 text-sm ${tab === k ? 'bg-emerald-50 font-semibold text-emerald-700' : 'text-slate-500'}`}>{l}</button>
        ))}
      </div>

      <div className="relative min-h-0 flex-1">
        {tab === 'creador' && <Canvas trigger={trigger} root={root} setRoot={(v: string | null) => { setRoot(v); touch(); }} nodes={nodes} onInsert={insert} onEdit={setEditNode} onDelete={del} setField={setField} selectedId={editNode} panelAbierto={!!(editNode && nodes[editNode])} onGoConfig={() => { setEditNode(null); setTab('config'); }} />}
        {/* El panel del paso vive DENTRO del lienzo: se edita viendo el flujo.
            Solo en «Creador» — en las otras pestañas taparía el contenido. */}
        {tab === 'creador' && editNode && nodes[editNode] && (
          <NodeConfig node={nodes[editNode]} onClose={() => setEditNode(null)} onPatch={(cfg) => patchNode(editNode, cfg)} />
        )}
        {tab === 'config' && (
          <div className="absolute inset-0 overflow-auto p-5"><div className="mx-auto max-w-2xl space-y-4">
            <Card title="Disparador">
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label>Cuándo entra el negocio</Label><select value={trigger.type} onChange={(e) => { setTrigger({ ...trigger, type: e.target.value }); touch(); }} className={inp}>{TRIGGERS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
                  {trigDef?.hint && <p className="mt-1 text-xs text-slate-500">{trigDef.hint}</p>}</div>
                {trigger.type === 'subscription_expiring' && (
                  <div><Label>Días antes del cobro</Label><input type="number" min={1} value={trigger.daysBefore ?? 3} onChange={(e) => { setTrigger({ ...trigger, daysBefore: +e.target.value }); touch(); }} className={inp} /></div>
                )}
                {trigger.type === 'business_inactive' && (
                  <div><Label>Días sin pedidos</Label><input type="number" min={1} value={trigger.daysInactive ?? 30} onChange={(e) => { setTrigger({ ...trigger, daysInactive: +e.target.value }); touch(); }} className={inp} /></div>
                )}
              </div>
              {trigger.type !== 'manual' && <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">⚡ Automático: el sistema revisa cada hora e inscribe los negocios que cumplen. Publica el workflow para activarlo.</p>}
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

    </div>
  );
}

function Canvas({ trigger, root, setRoot, nodes, onInsert, onEdit, onDelete, setField, selectedId, panelAbierto, onGoConfig }: any) {
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
  const structSig = JSON.stringify(Object.keys(nodes || {}).map((k) => [k, nodes[k]?.next, nodes[k]?.yes, nodes[k]?.no])) + ':' + (trigger?.type ?? '');
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
  const trigDef = TRIGGERS.find((t) => t.key === trigger.type);
  const trigLabel = trigDef?.label ?? trigger.type;
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
              negocio. Antes era una tarjeta suelta más, indistinguible de un
              paso — y el disparador no es un paso, es la puerta. */}
          <div className="wf-node w-[300px] rounded-2xl border border-emerald-200 bg-emerald-50/70 p-2">
            <p className="px-1.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700">Cuándo entra el negocio</p>
            <button
              onClick={onGoConfig}
              className="flex w-full items-center gap-2.5 rounded-xl border border-emerald-200 bg-white px-3 py-2.5 text-left shadow-sm transition hover:border-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              title="Cambiar el disparador en Configuración"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm" style={{ background: '#D1FAE5', color: '#047857' }}>▶</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-800">{trigLabel}</span>
                <span className="block truncate text-[11px] text-slate-500">{trigger.type === 'manual' ? 'Los inscribes tú desde «Inscribir»' : 'Automático, se revisa cada hora'}</span>
              </span>
              <span className="shrink-0 text-slate-300">✎</span>
            </button>
          </div>
          <Slot value={root} setSlot={setRoot} nodes={nodes} onInsert={onInsert} onEdit={onEdit} onDelete={onDelete} setField={setField} depth={0} selectedId={selectedId} />
          {/* Flujo vacío: guiar los dos pasos en vez de dejar un lienzo mudo. */}
          {vacio && (
            <div className="wf-nopan mt-3 w-[300px] rounded-2xl border border-dashed border-slate-300 bg-white/80 p-4 text-center">
              <p className="text-sm font-semibold text-slate-700">Este flujo aún no hace nada</p>
              <ol className="mt-2 space-y-1 text-left text-[12px] text-slate-500">
                <li><span className="font-semibold text-slate-600">1.</span> Elige cuándo se dispara en <button onClick={onGoConfig} className="font-medium text-emerald-700 underline underline-offset-2">Configuración</button>.</li>
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
      <div className="pointer-events-none absolute inset-x-0 rounded-sm border border-emerald-400/70 bg-emerald-400/10" style={{ top: vpTop, height: Math.max(4, vpH) }} />
    </div>
  );
}

function Slot({ value, setSlot, nodes, onInsert, onEdit, onDelete, setField, depth, selectedId }: any) {
  const node = value ? nodes[value] : null;
  const esRama = node?.type === 'if_else';
  // Tras «Terminar» no se ofrece continuación: el motor da por acabado el flujo
  // ahí y un «+» prometería un paso que nunca se ejecuta. Si un flujo viejo ya
  // trae algo colgando de un `end`, se sigue pintando — esconderlo lo dejaría
  // invisible pero guardado, que es peor.
  const cierra = node?.type === 'end' && !node?.next;
  const sub = { nodes, onInsert, onEdit, onDelete, setField, selectedId };
  return (
    <div className="flex flex-col items-center">
      <Connector terminal={!node} onPick={(t: string) => onInsert(t, value, setSlot)} />
      {node && (<>
        <NodeCard node={node} selected={selectedId === node.id} onEdit={() => onEdit(node.id)} onDelete={() => onDelete(node, setSlot)} />
        {esRama ? (
          // Conector en T: un tramo que baja del nodo y una barra horizontal que
          // va del centro de una columna al centro de la otra. Con dos columnas
          // iguales, esos centros están al 25% y al 75% — por eso el grid.
          <>
            <span aria-hidden className="h-5 w-[2px]" style={{ background: RAIL }} />
            <div className="relative grid grid-cols-2 justify-items-center" style={{ columnGap: RAMA_GAP }}>
              {/* Con dos columnas iguales y una separación g, el centro de cada
                  una NO cae en el 25%/75% exactos: cae en 25% − g/4. Sin ese
                  ajuste la barra se quedaba corta y dejaba un hueco visible
                  justo donde tiene que enganchar con cada rama. */}
              <span aria-hidden className="absolute top-0 h-[2px]" style={{ background: RAIL, left: `calc(25% - ${RAMA_GAP / 4}px)`, right: `calc(25% - ${RAMA_GAP / 4}px)` }} />
              <BranchCol label="Sí" chip="#DCFCE7" color="#15803D">
                <Slot value={node.yes ?? null} setSlot={(v: string | null) => setField(node.id, 'yes', v)} depth={depth + 1} {...sub} />
              </BranchCol>
              <BranchCol label="No" chip="#FEE2E2" color="#B91C1C">
                <Slot value={node.no ?? null} setSlot={(v: string | null) => setField(node.id, 'no', v)} depth={depth + 1} {...sub} />
              </BranchCol>
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
        className="relative z-10 grid h-7 w-7 place-items-center rounded-full border-2 text-sm font-medium leading-none transition-all hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1"
        style={open ? { background: ACCENT, color: 'white', borderColor: ACCENT } : { background: 'white', color: '#64748B', borderColor: RAIL }}
      >
        +
      </button>
      {open && (
        <div className="absolute top-10 z-30 w-60 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
          {NODE_GROUPS.map((g) => (
            <div key={g.group}>
              <p className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">{g.group}</p>
              {g.types.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { onPick(t); setOpen(false); }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-xs" style={{ background: NODE[t].chip, color: NODE[t].color }}>{NODE[t].icon}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-slate-800">{NODE[t].label}</span>
                    <span className="block truncate text-[11px] text-slate-400">{NODE[t].sub}</span>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function summary(node: WFNode) {
  const c = node.config || {};
  if (node.type === 'send_sms') return String(c.message || '').trim() || 'Sin mensaje todavía';
  if (node.type === 'send_email') return String(c.subject || '').trim() || 'Sin asunto todavía';
  if (node.type === 'wait_delay') {
    const u: Record<string, string> = { minutes: 'minutos', hours: 'horas', days: 'días', weeks: 'semanas' };
    const n = Number(c.amount) || 1;
    return `${n} ${u[String(c.unit || 'days')] ?? 'días'}`;
  }
  if (node.type === 'if_else') {
    const n = (c.conditions || []).length;
    if (!n) return 'Sin condiciones — siempre irá por «Sí»';
    return `${n} condición${n === 1 ? '' : 'es'} · cumplir ${c.match === 'any' ? 'alguna' : 'todas'}`;
  }
  if (node.type === 'end') return 'El negocio sale del flujo';
  return '';
}

function NodeCard({ node, selected, onEdit, onDelete }: { node: WFNode; selected: boolean; onEdit: () => void; onDelete: () => void }) {
  const s = nodeMeta(node.type);
  // Un paso a medio configurar se marca: es la causa nº1 de «publiqué el flujo
  // y no llegó nada».
  const incompleto =
    (node.type === 'send_sms' && !String(node.config?.message || '').trim()) ||
    (node.type === 'send_email' && !String(node.config?.body || '').trim());
  return (
    <div
      className={`wf-node group relative flex w-[264px] items-center gap-3 rounded-2xl border bg-white px-3 py-2.5 transition-shadow ${selected ? 'border-emerald-400 shadow-md ring-2 ring-emerald-100' : 'border-slate-200 shadow-sm hover:shadow-md'}`}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm" style={{ background: s.chip, color: s.color }}>{s.icon}</span>
      <button
        type="button"
        onClick={onEdit}
        className="min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 rounded-md"
      >
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-slate-800">{s.label}</span>
          {incompleto && <span className="shrink-0 rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-700" style={{ background: '#FEF3C7' }}>Vacío</span>}
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] text-slate-400">{summary(node)}</span>
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
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      <span className="mr-0.5 self-center text-[11px] text-slate-400">Insertar:</span>
      {MERGE.map((m) => (
        <button
          key={m.key}
          type="button"
          onClick={() => onPick(m.key)}
          className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

// Panel LATERAL (antes era un modal centrado que tapaba el flujo). Editar un
// paso mirando el lienzo es media faena: se ve dónde encaja lo que escribes.
function NodeConfig({ node, onClose, onPatch }: { node: WFNode; onClose: () => void; onPatch: (c: any) => void }) {
  const c = node.config || {};
  const s = nodeMeta(node.type);
  const msgRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const mensaje = String(c.message || '');
  const { unidades, segmentos, esGsm, tope } = segmentosSms(mensaje);

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
          <p className="truncate text-[11px] text-slate-400">{s.sub}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">✕</button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {node.type === 'send_sms' && (
          <div>
            <Label>Mensaje</Label>
            <textarea
              ref={msgRef}
              rows={6}
              value={mensaje}
              onChange={(e) => onPatch({ message: e.target.value })}
              className={`${inp} resize-none`}
              placeholder="Hola {{owner}}, tu plan de {{negocio}} vence pronto…"
            />
            <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px]">
              <span className="text-slate-400">
                {unidades} / {tope} · <span className={segmentos > 1 ? 'font-semibold text-amber-700' : ''}>{segmentos} segmento{segmentos === 1 ? '' : 's'}</span>
              </span>
              {!esGsm && (
                <span className="text-amber-700">
                  Lleva algo fuera del alfabeto SMS —una emoji, o á í ó ú—: el tope cae de 160 a 70 por segmento.
                </span>
              )}
            </div>
            <ChipsMerge onPick={(k) => onPatch({ message: pegarEnCursor(msgRef.current, mensaje, `{{${k}}}`) })} />
            <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
              Sale por la subcuenta de Grow Business de <strong>tu marca</strong>, canal SMS, al teléfono del dueño del negocio.
              Si la marca no tiene subcuenta propia, el paso se salta y queda anotado en Registros.
            </p>
            <p className="mt-1.5 text-[11px] text-slate-400">El contador es aproximado: las variables se sustituyen al enviar y cambian el largo.</p>
          </div>
        )}

        {node.type === 'send_email' && (
          <div className="space-y-3">
            <div>
              <Label>Asunto</Label>
              <input value={String(c.subject || '')} onChange={(e) => onPatch({ subject: e.target.value })} className={inp} placeholder="Hola {{owner}} 👋" />
            </div>
            <div>
              <Label>Cuerpo del correo · texto o HTML</Label>
              <textarea ref={bodyRef} rows={8} value={String(c.body || '')} onChange={(e) => onPatch({ body: e.target.value })} className={`${inp} resize-none`} placeholder="Escribe el correo…" />
              <ChipsMerge onPick={(k) => onPatch({ body: pegarEnCursor(bodyRef.current, String(c.body || ''), `{{${k}}}`) })} />
            </div>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
              Se envía al correo del dueño por la subcuenta de Grow Business de tu marca (canal Email).
            </p>
          </div>
        )}

        {node.type === 'wait_delay' && (
          <div>
            <Label>Cuánto espera antes del siguiente paso</Label>
            <div className="flex items-center gap-2">
              <input type="number" min={1} value={Number(c.amount) || 1} onChange={(e) => onPatch({ amount: +e.target.value })} className={`${inp} w-24`} />
              <select value={String(c.unit || 'days')} onChange={(e) => onPatch({ unit: e.target.value })} className={inp}>
                <option value="minutes">minutos</option>
                <option value="hours">horas</option>
                <option value="days">días</option>
                <option value="weeks">semanas</option>
              </select>
            </div>
            <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
              Si tienes ventana de envío activa, la espera puede alargarse hasta la siguiente hora permitida.
            </p>
          </div>
        )}

        {node.type === 'if_else' && <IfConfig conditions={c.conditions || []} match={c.match || 'all'} onPatch={onPatch} />}

        {node.type === 'end' && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-600">
            El negocio sale del flujo aquí. No se ejecuta ningún paso posterior.
          </p>
        )}
      </div>

      <footer className="shrink-0 border-t border-slate-100 px-4 py-3">
        <button type="button" onClick={onClose} className="w-full rounded-lg py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2" style={{ background: ACCENT }}>Listo</button>
        <p className="mt-1.5 text-center text-[11px] text-slate-400">Los cambios se guardan con «Guardar» arriba.</p>
      </footer>
    </aside>
  );
}
function IfConfig({ conditions, match, onPatch }: any) {
  const set = (next: any[]) => onPatch({ conditions: next });
  return (
    <div><div className="mb-2 flex items-center gap-2 text-xs text-slate-500">Cumplir <select value={match} onChange={(e) => onPatch({ match: e.target.value })} className="rounded border border-slate-300 px-1.5 py-1"><option value="all">todas</option><option value="any">alguna</option></select> las condiciones:</div>
      <div className="space-y-2">{conditions.map((cd: any, i: number) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5">
          <select value={cd.field} onChange={(e) => set(conditions.map((x: any, j: number) => j === i ? { ...x, field: e.target.value } : x))} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">{COND_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select>
          <select value={cd.op} onChange={(e) => set(conditions.map((x: any, j: number) => j === i ? { ...x, op: e.target.value } : x))} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"><option value="eq">es</option><option value="neq">no es</option><option value="contains">contiene</option><option value="filled">tiene valor</option></select>
          {cd.op !== 'filled' && <input value={cd.value ?? ''} onChange={(e) => set(conditions.map((x: any, j: number) => j === i ? { ...x, value: e.target.value } : x))} placeholder="valor" className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />}
          <button onClick={() => set(conditions.filter((_: any, j: number) => j !== i))} className="text-slate-400 hover:text-rose-600">✕</button>
        </div>))}</div>
      <button onClick={() => set([...conditions, { field: 'plan', op: 'eq', value: '' }])} className="mt-1.5 text-sm text-emerald-600">+ Condición</button>
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
      {done > 0 && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">✓ {done} negocio(s) inscrito(s).</p>}
      <div className="flex gap-2"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar negocio…" className={inp} /><button onClick={search} disabled={busy} className="rounded-lg border border-slate-300 px-3 text-sm">Buscar</button></div>
      <div className="space-y-1 rounded-xl border border-slate-200 bg-white p-2">
        {(list ?? []).map((t) => (<label key={t.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"><input type="checkbox" checked={sel.has(t.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })} /><span className="flex-1 truncate">{t.name}</span><span className="text-[11px] text-slate-400">{t.phone || t.whatsappPhone || 'sin tel'}</span></label>))}
        {list && list.length === 0 && <p className="py-4 text-center text-xs text-slate-400">Sin negocios.</p>}
      </div>
      <div className="flex justify-end"><button onClick={go} disabled={busy || !published || sel.size === 0} className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50" style={{ background: ACCENT }}>Inscribir {sel.size || ''}</button></div>
    </div></div>
  );
}
function LogsTab({ workflowId }: { workflowId: string }) {
  const [logs, setLogs] = useState<any[] | null>(null);
  useEffect(() => { api(`/admin/workflows/${workflowId}/logs`).then((r: any) => setLogs(r ?? [])).catch(() => setLogs([])); }, [workflowId]);
  return (
    <div className="absolute inset-0 overflow-auto p-5"><div className="mx-auto max-w-3xl">
      <h3 className="mb-3 text-sm font-semibold">Registros de ejecución</h3>
      {!logs ? <p className="py-8 text-center text-sm text-slate-400">Cargando…</p> : logs.length === 0 ? <p className="py-8 text-center text-sm text-slate-400">Sin registros aún.</p> : (
        <div className="space-y-1 text-sm">{logs.map((l) => (<div key={l.id} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-2 py-1.5"><span className="w-28 shrink-0 text-[11px] text-slate-400">{new Date(l.createdAt).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span><span className="w-28 shrink-0 truncate">{l.tenantName}</span><span className="min-w-0 flex-1 truncate text-slate-500">{l.message || l.result}</span><span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px]" style={l.status === 'sent' ? { background: '#dcfce7', color: '#15803d' } : l.status === 'failed' ? { background: '#fee2e2', color: '#b91c1c' } : { background: '#f1f5f9', color: '#64748b' }}>{l.status}</span></div>))}</div>
      )}
    </div></div>
  );
}
function Card({ title, children }: any) { return <div className="rounded-2xl border border-slate-200 bg-white p-4"><h3 className="mb-2 text-sm font-semibold">{title}</h3>{children}</div>; }
function Label({ children }: any) { return <p className="mb-1 text-xs font-medium text-slate-500">{children}</p>; }
