'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

// Constructor visual de Workflows de la MARCA (audiencia: sus negocios/tenants).
// SMS al dueño por la subcuenta de Grow Business de la marca. Backend:
// /admin/workflows/* (motor durable por @Cron). Estilo GHL: tabla de carpetas +
// lienzo con nodos.

type Stats = { active: number; completed: number };
type WF = {
  id: string; name: string; folderId: string | null; status: string;
  trigger: any; rootId: string | null; nodes: any; drip: any; sendWindow: any; reentry: boolean;
  createdAt?: string; _stats: Stats;
};
type Folder = { id: string; name: string; createdAt?: string };
type WFNode = { id: string; type: string; config: any; next?: string | null; yes?: string | null; no?: string | null };

const ACCENT = '#16a34a';
const NODE = {
  send_sms: { label: 'Enviar SMS', icon: '💬', chip: '#d1fae5', color: '#059669' },
  send_email: { label: 'Enviar correo', icon: '✉️', chip: '#dbeafe', color: '#2563eb' },
  wait_delay: { label: 'Espera (tiempo)', icon: '⏱', chip: '#ede9fe', color: '#7c3aed' },
  if_else: { label: 'Si / No (condición)', icon: '{ }', chip: '#e0e7ff', color: '#4f46e5', branch: true },
  end: { label: 'Terminar', icon: '🚪', chip: '#fee2e2', color: '#dc2626' },
} as const;
const NODE_TYPES = Object.keys(NODE) as (keyof typeof NODE)[];
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

export default function BrandWorkflowsPanel() {
  const [loading, setLoading] = useState(true);
  const [wfs, setWfs] = useState<WF[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try { const d: any = await api('/admin/workflows'); setWfs(d?.workflows ?? []); setFolders(d?.folders ?? []); }
    catch { /* noop */ } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function addWf() {
    setBusy(true);
    try { const w: any = await api('/admin/workflows', { method: 'POST', body: JSON.stringify({ name: 'Nuevo workflow' }) }); setWfs((p) => [{ ...w, folderId: null, nodes: {}, drip: {}, sendWindow: {}, _stats: { active: 0, completed: 0 } }, ...p]); setOpenId(w.id); }
    catch (e: any) { toast(e.message ?? 'Error', 'error'); } finally { setBusy(false); }
  }
  async function newFolder() {
    const name = window.prompt('Nombre de la nueva carpeta:')?.trim(); if (!name) return;
    setBusy(true);
    try { const f: any = await api('/admin/workflows/folders', { method: 'POST', body: JSON.stringify({ name }) }); setFolders((p) => [...p, f]); }
    catch (e: any) { toast(e.message ?? 'Error', 'error'); } finally { setBusy(false); }
  }
  function move(id: string, folderId: string | null) {
    setWfs((p) => p.map((w) => (w.id === id ? { ...w, folderId } : w)));
    api(`/admin/workflows/${id}`, { method: 'PATCH', body: JSON.stringify({ folderId }) }).catch(() => {});
  }
  async function renameFolder(f: Folder) {
    const name = window.prompt('Nuevo nombre:', f.name)?.trim(); if (!name || name === f.name) return;
    setFolders((p) => p.map((x) => (x.id === f.id ? { ...x, name } : x)));
    api(`/admin/workflows/folders/${f.id}`, { method: 'PATCH', body: JSON.stringify({ name }) }).catch(() => {});
  }
  async function delFolder(f: Folder) {
    if (!window.confirm(`¿Eliminar "${f.name}"? Los workflows quedan sin carpeta.`)) return;
    setFolders((p) => p.filter((x) => x.id !== f.id)); setWfs((p) => p.map((w) => (w.folderId === f.id ? { ...w, folderId: null } : w)));
    api(`/admin/workflows/folders/${f.id}`, { method: 'DELETE' }).catch(() => {});
  }

  const open = wfs.find((w) => w.id === openId) ?? null;
  async function duplicate(id: string) {
    setBusy(true);
    try { const w: any = await api(`/admin/workflows/${id}/duplicate`, { method: 'POST' }); setWfs((p) => [{ ...w, folderId: w.folderId ?? null, nodes: w.nodes ?? {}, drip: w.drip ?? {}, sendWindow: w.sendWindow ?? {}, _stats: { active: 0, completed: 0 } }, ...p]); }
    catch { await load(); }
    finally { setBusy(false); }
  }

  if (open) return <Editor key={open.id} wf={open} onBack={() => { setOpenId(null); load(); }} onDeleted={() => { setWfs((p) => p.filter((w) => w.id !== open.id)); setOpenId(null); }} />;

  if (loading) return <div className="py-10 text-center text-sm text-slate-400">Cargando…</div>;

  const inFolder = folders.find((f) => f.id === currentFolder) ?? null;
  const showFolders = currentFolder === null ? folders : [];
  const rows = wfs.filter((w) => (w.folderId ?? null) === currentFolder);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-slate-500">Flujos con esperas, ramas y ventana horaria para tus negocios. El SMS va al dueño por tu subcuenta.</p>
        <div className="ml-auto flex gap-2">
          <button onClick={newFolder} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700">📁 Nueva carpeta</button>
          <button onClick={addWf} disabled={busy} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white" style={{ background: ACCENT }}>+ Nuevo workflow</button>
        </div>
      </div>

      {currentFolder !== null && (
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => setCurrentFolder(null)} className="text-slate-500 hover:text-slate-800">← Atrás</button>
          <span className="text-slate-400">/</span><span className="font-semibold text-slate-800">📁 {inFolder?.name}</span>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
            <tr className="[&>th]:px-3 [&>th]:py-2.5"><th>Nombre</th><th>Estado</th><th>Total de inscritos</th><th>Inscripción activa</th><th>Fecha de creación</th><th className="text-right">Carpeta</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {showFolders.map((f) => (
              <tr key={f.id} className="group [&>td]:px-3 [&>td]:py-3 hover:bg-slate-50/70">
                <td><div className="flex items-center gap-2"><span className="text-lg">📁</span>
                  <button onClick={() => setCurrentFolder(f.id)} className="font-medium text-slate-800 hover:text-emerald-700">{f.name}</button>
                  <button onClick={() => renameFolder(f)} className="px-1 text-xs text-slate-400 opacity-0 group-hover:opacity-100">✎</button>
                  <button onClick={() => delFolder(f)} className="px-1 text-xs text-rose-500 opacity-0 group-hover:opacity-100">🗑</button>
                </div></td><td /><td /><td />
                <td className="whitespace-nowrap text-slate-400">{fmtDate(f.createdAt)}</td>
                <td className="text-right"><button onClick={() => setCurrentFolder(f.id)} className="text-slate-400">›</button></td>
              </tr>
            ))}
            {rows.map((w) => (
              <tr key={w.id} className="[&>td]:px-3 [&>td]:py-3 hover:bg-slate-50/70">
                <td><button onClick={() => setOpenId(w.id)} className="flex items-center gap-2 font-medium text-slate-800 hover:text-emerald-700">{w.name} <span className="text-slate-400">↗</span></button></td>
                <td><span className="rounded-full px-2 py-0.5 text-[11px]" style={w.status === 'published' ? { background: '#dcfce7', color: '#15803d' } : { background: '#f1f5f9', color: '#64748b' }}>{w.status === 'published' ? 'Publicado' : 'Borrador'}</span></td>
                <td className="text-slate-800">{w._stats.active + w._stats.completed}</td>
                <td className="text-slate-800">{w._stats.active}</td>
                <td className="whitespace-nowrap text-slate-400">{fmtDate(w.createdAt)}</td>
                <td className="text-right"><div className="flex items-center justify-end gap-2">
                  <button onClick={() => duplicate(w.id)} disabled={busy} title="Duplicar workflow" className="whitespace-nowrap text-xs text-slate-400 hover:text-emerald-700">⧉ Duplicar</button>
                  <select value={w.folderId ?? ''} onChange={(e) => move(w.id, e.target.value || null)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500"><option value="">Sin carpeta</option>{folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
                </div></td>
              </tr>
            ))}
            {showFolders.length === 0 && rows.length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-400">{currentFolder ? 'Carpeta vacía.' : 'Aún no hay workflows ni carpetas.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
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
  function del(node: WFNode, setSlot: (v: string | null) => void) { setSlot(node.next ?? node.yes ?? null); touch(); }
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
        {tab === 'creador' && <Canvas trigger={trigger} root={root} setRoot={(v: string | null) => { setRoot(v); touch(); }} nodes={nodes} onInsert={insert} onEdit={setEditNode} onDelete={del} setField={setField} />}
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

      {editNode && nodes[editNode] && <NodeConfig node={nodes[editNode]} onClose={() => setEditNode(null)} onPatch={(cfg) => patchNode(editNode, cfg)} />}
    </div>
  );
}

function Canvas({ trigger, root, setRoot, nodes, onInsert, onEdit, onDelete, setField }: any) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structSig]);
  const trigLabel = TRIGGERS.find((t) => t.key === trigger.type)?.label ?? trigger.type;
  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden bg-slate-50 [background-image:radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:22px_22px]" onPointerDown={down} onPointerMove={moveP} onPointerUp={() => (pan.current = null)} onPointerLeave={() => (pan.current = null)} onWheel={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(-e.deltaY * 0.002); } }} style={{ cursor: pan.current ? 'grabbing' : 'grab' }}>
      <div ref={contentRef} className="absolute left-1/2 top-0 origin-top" style={{ transform: `translate(-50%,0) translate(${view.x}px,${view.y}px) scale(${view.z})` }}>
        <div className="flex flex-col items-center pb-40">
          <div className="wf-node w-[280px] rounded-xl border px-3 py-2.5 shadow-sm" style={{ borderColor: '#a7f3d0', background: 'white' }}>
            <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg text-sm" style={{ background: '#d1fae5', color: '#059669' }}>▶</span><div className="min-w-0"><p className="truncate text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#059669' }}>Disparador</p><p className="truncate text-sm font-medium text-slate-800">{trigLabel}</p></div></div>
          </div>
          <Slot value={root} setSlot={setRoot} nodes={nodes} onInsert={onInsert} onEdit={onEdit} onDelete={onDelete} setField={setField} depth={0} />
        </div>
      </div>
      <div className="wf-nopan absolute bottom-4 left-4 flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
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

function Slot({ value, setSlot, nodes, onInsert, onEdit, onDelete, setField, depth }: any) {
  const node = value ? nodes[value] : null;
  return (
    <div className="flex flex-col items-center">
      <Insert terminal={!node} onPick={(t: string) => onInsert(t, value, setSlot)} />
      {node && (<>
        <NodeCard node={node} onEdit={() => onEdit(node.id)} onDelete={() => onDelete(node, setSlot)} />
        {node.type === 'if_else' ? (
          <div className="flex items-start gap-6 pt-1 sm:gap-10">
            <Branch label="Sí" bg="#ecfdf5" color="#059669"><Slot value={node.yes ?? null} setSlot={(v: string | null) => setField(node.id, 'yes', v)} nodes={nodes} onInsert={onInsert} onEdit={onEdit} onDelete={onDelete} setField={setField} depth={depth + 1} /></Branch>
            <Branch label="No" bg="#fef2f2" color="#dc2626"><Slot value={node.no ?? null} setSlot={(v: string | null) => setField(node.id, 'no', v)} nodes={nodes} onInsert={onInsert} onEdit={onEdit} onDelete={onDelete} setField={setField} depth={depth + 1} /></Branch>
          </div>
        ) : (<Slot value={node.next ?? null} setSlot={(v: string | null) => setField(node.id, 'next', v)} nodes={nodes} onInsert={onInsert} onEdit={onEdit} onDelete={onDelete} setField={setField} depth={depth} />)}
      </>)}
      {!node && depth > 0 && <span className="mt-1 rounded-full bg-slate-200 px-2 py-0.5 text-[9px] font-medium uppercase text-slate-500">Fin</span>}
    </div>
  );
}
function Insert({ terminal, onPick }: { terminal: boolean; onPick: (t: string) => void }) {
  const [op, setOp] = useState(false);
  return (
    <div className="relative flex flex-col items-center">
      <div className="h-4 w-px bg-slate-300" />
      <button onClick={() => setOp((o) => !o)} className="wf-node grid h-6 w-6 place-items-center rounded-full border text-sm" style={op ? { background: ACCENT, color: 'white', borderColor: ACCENT } : { background: 'white', color: '#94a3b8', borderColor: '#cbd5e1' }}>+</button>
      {!terminal && <div className="h-4 w-px bg-slate-300" />}
      {op && <div className="wf-node absolute top-11 z-30 w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
        <p className="px-2 py-1 text-[10px] font-semibold uppercase text-slate-400">Añadir paso</p>
        {NODE_TYPES.map((t) => <button key={t} onClick={() => { onPick(t); setOp(false); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50"><span className="grid h-6 w-6 place-items-center rounded-md text-xs" style={{ background: NODE[t].chip, color: NODE[t].color }}>{NODE[t].icon}</span> {NODE[t].label}</button>)}
      </div>}
    </div>
  );
}
function summary(node: WFNode) {
  const c = node.config || {};
  if (node.type === 'send_sms') return String(c.message || '(sin mensaje)').slice(0, 44);
  if (node.type === 'send_email') return String(c.subject || '(sin asunto)').slice(0, 44);
  if (node.type === 'wait_delay') return `Espera ${c.amount ?? 1} ${c.unit ?? 'días'}`;
  if (node.type === 'if_else') return `${(c.conditions || []).length} condición(es)`;
  return '';
}
function NodeCard({ node, onEdit, onDelete }: { node: WFNode; onEdit: () => void; onDelete: () => void }) {
  const s = (NODE as any)[node.type] ?? { icon: '•', chip: '#f1f5f9', color: '#64748b', label: node.type };
  return (
    <div className="wf-node group flex w-[240px] items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm" style={{ background: s.chip, color: s.color }}>{s.icon}</span>
      <button onClick={onEdit} className="min-w-0 flex-1 text-left"><p className="truncate text-sm font-semibold text-slate-800">{s.label}</p><p className="truncate text-[11px] text-slate-400">{summary(node)}</p></button>
      <button onClick={onDelete} className="shrink-0 text-slate-300 opacity-0 hover:text-rose-500 group-hover:opacity-100">✕</button>
    </div>
  );
}
function Branch({ label, bg, color, children }: any) { return <div className="flex flex-col items-center"><span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ background: bg, color }}>{label}</span>{children}</div>; }

function NodeConfig({ node, onClose, onPatch }: { node: WFNode; onClose: () => void; onPatch: (c: any) => void }) {
  const c = node.config || {};
  const s = (NODE as any)[node.type] ?? { icon: '•', chip: '#f1f5f9', color: '#64748b', label: node.type };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-semibold"><span className="grid h-7 w-7 place-items-center rounded-lg text-sm" style={{ background: s.chip, color: s.color }}>{s.icon}</span> {s.label}</h3><button onClick={onClose} className="text-slate-400">✕</button></div>
        {node.type === 'send_sms' && (<div><Label>Mensaje SMS (al dueño del negocio)</Label><textarea rows={4} value={String(c.message || '')} onChange={(e) => onPatch({ message: e.target.value })} className={`${inp} resize-none`} placeholder="Hola {{owner}}, …" /><div className="mt-1 flex flex-wrap gap-1">{MERGE.map((m) => <button key={m.key} onClick={() => onPatch({ message: `${c.message || ''}{{${m.key}}}` })} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-emerald-100 hover:text-emerald-700">{m.label}</button>)}</div></div>)}
        {node.type === 'send_email' && (<div className="space-y-2">
          <div><Label>Asunto</Label><input value={String(c.subject || '')} onChange={(e) => onPatch({ subject: e.target.value })} className={inp} placeholder="Hola {{owner}} 👋" /></div>
          <div><Label>Cuerpo del correo (al dueño del negocio · texto o HTML)</Label><textarea rows={5} value={String(c.body || '')} onChange={(e) => onPatch({ body: e.target.value })} className={`${inp} resize-none`} placeholder="Escribe el correo…" /><div className="mt-1 flex flex-wrap gap-1">{MERGE.map((m) => <button key={m.key} onClick={() => onPatch({ body: `${c.body || ''}{{${m.key}}}` })} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-emerald-100 hover:text-emerald-700">{m.label}</button>)}</div></div>
          <p className="rounded-md bg-blue-50 px-3 py-2 text-[11px] text-blue-700">Se envía al correo del dueño por la subcuenta de Grow Business de tu marca (canal Email).</p>
        </div>)}
        {node.type === 'wait_delay' && (<div className="flex items-center gap-2"><input type="number" min={1} value={Number(c.amount) || 1} onChange={(e) => onPatch({ amount: +e.target.value })} className={`${inp} w-24`} /><select value={String(c.unit || 'days')} onChange={(e) => onPatch({ unit: e.target.value })} className={inp}><option value="minutes">minutos</option><option value="hours">horas</option><option value="days">días</option><option value="weeks">semanas</option></select></div>)}
        {node.type === 'if_else' && <IfConfig conditions={c.conditions || []} match={c.match || 'all'} onPatch={onPatch} />}
        {node.type === 'end' && <p className="text-sm text-slate-500">El negocio sale del workflow.</p>}
        <div className="mt-4 flex justify-end"><button onClick={onClose} className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white" style={{ background: ACCENT }}>Listo</button></div>
      </div>
    </div>
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
        {(list ?? []).map((t) => (<label key={t.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"><input type="checkbox" checked={sel.has(t.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })} /><span className="flex-1 truncate">{t.name}</span><span className="text-[11px] text-slate-400">{t.phone || t.whatsappPhone || 'sin tel'}</span></label>))}
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
