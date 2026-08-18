'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

// Builder visual de workflows de EMAIL MARKETING (contact-based). Backend:
// /admin/marketing/workflows/*. Árbol de nodos con ramas (sin pan/zoom, robusto).
// El proveedor de envío NUNCA se nombra en la UI.

const ACCENT = '#16a34a';

type Stats = { active: number; completed: number };
type WF = {
  id: string; name: string; folderId: string | null; status: string;
  trigger: any; rootId: string | null; nodes: Record<string, WFNode>;
  drip: any; sendWindow: any; reentry: boolean; createdAt?: string; _stats: Stats;
};
type Folder = { id: string; name: string; createdAt?: string };
type WFNode = { id: string; type: string; config: any; next?: string | null; yes?: string | null; no?: string | null };

const NODE: Record<string, { label: string; icon: string; chip: string; color: string; branch?: boolean; yesLabel?: string; noLabel?: string }> = {
  send_email: { label: 'Enviar correo', icon: '✉️', chip: '#dbeafe', color: '#2563eb' },
  send_sms: { label: 'Enviar SMS', icon: '💬', chip: '#d1fae5', color: '#059669' },
  wait_delay: { label: 'Espera (tiempo)', icon: '⏱', chip: '#ede9fe', color: '#7c3aed' },
  wait_datetime: { label: 'Esperar fecha/hora', icon: '📅', chip: '#ede9fe', color: '#7c3aed' },
  wait_reply: { label: 'Esperar respuesta', icon: '⏳', chip: '#fef9c3', color: '#ca8a04', branch: true, yesLabel: 'Respondió', noLabel: 'Sin respuesta' },
  condition: { label: 'Si / No (condición)', icon: '{ }', chip: '#e0e7ff', color: '#4f46e5', branch: true, yesLabel: 'Sí', noLabel: 'No' },
  branch: { label: 'Bifurcar A/B', icon: '⑃', chip: '#e0e7ff', color: '#4f46e5', branch: true, yesLabel: 'A', noLabel: 'B' },
  add_tag: { label: 'Agregar etiqueta', icon: '🏷', chip: '#fae8ff', color: '#a21caf' },
  webhook: { label: 'Webhook', icon: '🔗', chip: '#f1f5f9', color: '#475569' },
};
const NODE_TYPES = Object.keys(NODE);
const MERGE = [
  { key: 'nombre', label: 'Nombre' }, { key: 'email', label: 'Correo' },
  { key: 'telefono', label: 'Teléfono' }, { key: 'empresa', label: 'Empresa' }, { key: 'marca', label: 'Marca' },
];
const COND_FIELDS = [
  { key: 'nombre', label: 'Nombre' }, { key: 'email', label: 'Correo' },
  { key: 'telefono', label: 'Teléfono' }, { key: 'empresa', label: 'Empresa' }, { key: 'tags', label: 'Etiquetas' },
];
const TRIGGERS = [
  { key: 'manual', label: 'Inscripción manual / lista', hint: 'Inscribe contactos a mano desde la pestaña "Inscribir".' },
  { key: 'contact_created', label: 'Contacto nuevo', hint: 'Se inscribe solo cuando se crea un contacto nuevo.' },
  { key: 'tag_added', label: 'Etiqueta agregada', hint: 'Se inscribe cuando al contacto se le agrega una etiqueta.' },
  { key: 'email_reply', label: 'Responde / interactúa', hint: 'Cuando el contacto responde, abre o hace clic en un correo.' },
];
function uid() { try { return 'n' + crypto.randomUUID().slice(0, 8); } catch { return 'n' + Math.random().toString(36).slice(2, 10); } }
function fmtDate(s?: string) { return s ? new Date(s).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; }
const inp = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500';

export default function EmailMarketingWorkflows() {
  const [loading, setLoading] = useState(true);
  const [wfs, setWfs] = useState<WF[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try { const d: any = await api('/admin/marketing/workflows'); setWfs(d?.workflows ?? []); setFolders(d?.folders ?? []); }
    catch { /* noop */ } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

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

  const open = wfs.find((w) => w.id === openId) ?? null;
  if (open) return <Editor key={open.id} wf={open} onBack={() => { setOpenId(null); load(); }} onDeleted={() => { setWfs((p) => p.filter((w) => w.id !== open.id)); setOpenId(null); }} />;
  if (loading) return <div className="py-10 text-center text-sm text-slate-400">Cargando…</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-slate-500">Flujos por correo/SMS a tus contactos, con esperas, ramas, ventana horaria y reintentos.</p>
        <div className="ml-auto">
          <button onClick={addWf} disabled={busy} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white" style={{ background: ACCENT }}>+ Nuevo workflow</button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
            <tr className="[&>th]:px-3 [&>th]:py-2.5"><th>Nombre</th><th>Estado</th><th>Inscritos</th><th>Activos</th><th>Creado</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {wfs.map((w) => (
              <tr key={w.id} className="[&>td]:px-3 [&>td]:py-3 hover:bg-slate-50/70">
                <td><button onClick={() => setOpenId(w.id)} className="flex items-center gap-2 font-medium text-slate-800 hover:text-emerald-700">{w.name} <span className="text-slate-400">↗</span></button></td>
                <td><span className="rounded-full px-2 py-0.5 text-[11px]" style={w.status === 'published' ? { background: '#dcfce7', color: '#15803d' } : { background: '#f1f5f9', color: '#64748b' }}>{w.status === 'published' ? 'Publicado' : 'Borrador'}</span></td>
                <td className="text-slate-800">{w._stats.active + w._stats.completed}</td>
                <td className="text-slate-800">{w._stats.active}</td>
                <td className="whitespace-nowrap text-slate-400">{fmtDate(w.createdAt)}</td>
                <td className="text-right"><button onClick={() => duplicate(w.id)} disabled={busy} className="text-xs text-slate-400 hover:text-emerald-700">⧉ Duplicar</button></td>
              </tr>
            ))}
            {wfs.length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-400">Aún no hay workflows. Crea el primero.</td></tr>}
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
  const [busy, setBusy] = useState(false);
  const touch = () => setDirty(true);

  function insert(type: string, oldChild: string | null, setSlot: (v: string | null) => void) {
    const id = uid(); const branch = NODE[type]?.branch;
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
      await api(`/admin/marketing/workflows/${wf.id}`, { method: 'PATCH', body: JSON.stringify({ name, status: st, trigger, rootId: root, nodes: pruned, drip, sendWindow: win, reentry }) });
      setNodes(pruned); setStatus(st); setDirty(false); toast('Guardado', 'success');
    } catch (e: any) { toast(e.message ?? 'Error al guardar', 'error'); } finally { setBusy(false); }
  }
  async function remove() { if (!window.confirm('¿Eliminar este workflow?')) return; setBusy(true); try { await api(`/admin/marketing/workflows/${wf.id}`, { method: 'DELETE' }); onDeleted(); } catch (e: any) { toast(e.message ?? 'Error', 'error'); setBusy(false); } }

  const trigDef = TRIGGERS.find((t) => t.key === trigger.type);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-50">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
        <button onClick={onBack} className="rounded-lg px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-100">← Lista</button>
        <input value={name} onChange={(e) => { setName(e.target.value); touch(); }} className="min-w-0 max-w-[220px] flex-1 rounded-lg px-2 py-1 text-sm font-semibold text-slate-800 outline-none hover:bg-slate-50" />
        <nav className="mx-auto flex items-center gap-1">
          {([['creador', 'Creador'], ['config', 'Configuración'], ['inscribir', 'Inscribir'], ['registros', 'Registro']] as [Tab, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 text-sm ${tab === k ? 'font-semibold text-emerald-700' : 'text-slate-500'}`}>{l}</button>
          ))}
        </nav>
        <button onClick={() => save()} disabled={busy || !dirty} className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50">Guardar</button>
        <div className="flex items-center gap-2 text-sm">
          <span className={status === 'published' ? 'text-slate-400' : 'font-medium text-slate-700'}>Borrador</span>
          <button onClick={() => save(status !== 'published')} disabled={busy || !root} title={!root ? 'Agrega al menos un paso' : ''} className="relative h-5 w-9 rounded-full" style={{ background: status === 'published' ? ACCENT : '#cbd5e1' }}><span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: status === 'published' ? 18 : 2 }} /></button>
          <span className={status === 'published' ? 'font-medium text-emerald-600' : 'text-slate-400'}>Publicar</span>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-auto">
        {tab === 'creador' && (
          <div className="min-h-full bg-slate-50 [background-image:radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:22px_22px] p-6">
            <div className="flex flex-col items-center pb-40">
              <div className="w-[280px] rounded-xl border px-3 py-2.5 shadow-sm" style={{ borderColor: '#a7f3d0', background: 'white' }}>
                <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg text-sm" style={{ background: '#d1fae5', color: '#059669' }}>▶</span><div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#059669' }}>Disparador</p><p className="truncate text-sm font-medium text-slate-800">{trigDef?.label ?? trigger.type}</p></div></div>
              </div>
              <Slot value={root} setSlot={(v: string | null) => { setRoot(v); touch(); }} nodes={nodes} onInsert={insert} onEdit={setEditNode} onDelete={del} setField={setField} depth={0} />
            </div>
          </div>
        )}
        {tab === 'config' && (
          <div className="p-5"><div className="mx-auto max-w-2xl space-y-4">
            <Card title="Disparador">
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label>Cuándo entra el contacto</Label><select value={trigger.type} onChange={(e) => { setTrigger({ ...trigger, type: e.target.value }); touch(); }} className={inp}>{TRIGGERS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
                  {trigDef?.hint && <p className="mt-1 text-xs text-slate-500">{trigDef.hint}</p>}</div>
                {trigger.type === 'tag_added' && (
                  <div><Label>Etiqueta</Label><input value={trigger.tag ?? ''} onChange={(e) => { setTrigger({ ...trigger, tag: e.target.value }); touch(); }} className={inp} placeholder="ej. cliente-vip" /></div>
                )}
              </div>
              {trigger.type !== 'manual' && <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">⚡ Automático. Publica el workflow para activarlo.</p>}
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

      {editNode && nodes[editNode] && <NodeConfig node={nodes[editNode]} onClose={() => setEditNode(null)} onPatch={(cfg) => patchNode(editNode, cfg)} />}
    </div>
  );
}

function Slot({ value, setSlot, nodes, onInsert, onEdit, onDelete, setField, depth }: any) {
  const node: WFNode | null = value ? nodes[value] : null;
  const def = node ? NODE[node.type] : null;
  return (
    <div className="flex flex-col items-center">
      <Insert terminal={!node} onPick={(t: string) => onInsert(t, value, setSlot)} />
      {node && (<>
        <NodeCard node={node} onEdit={() => onEdit(node.id)} onDelete={() => onDelete(node, setSlot)} />
        {def?.branch ? (
          <div className="flex items-start gap-6 pt-1 sm:gap-10">
            <Branch label={def.yesLabel ?? 'Sí'} bg="#ecfdf5" color="#059669"><Slot value={node.yes ?? null} setSlot={(v: string | null) => setField(node.id, 'yes', v)} nodes={nodes} onInsert={onInsert} onEdit={onEdit} onDelete={onDelete} setField={setField} depth={depth + 1} /></Branch>
            <Branch label={def.noLabel ?? 'No'} bg="#fef2f2" color="#dc2626"><Slot value={node.no ?? null} setSlot={(v: string | null) => setField(node.id, 'no', v)} nodes={nodes} onInsert={onInsert} onEdit={onEdit} onDelete={onDelete} setField={setField} depth={depth + 1} /></Branch>
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
      <button onClick={() => setOp((o) => !o)} className="grid h-6 w-6 place-items-center rounded-full border text-sm" style={op ? { background: ACCENT, color: 'white', borderColor: ACCENT } : { background: 'white', color: '#94a3b8', borderColor: '#cbd5e1' }}>+</button>
      {!terminal && <div className="h-4 w-px bg-slate-300" />}
      {op && <div className="absolute top-11 z-30 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
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
  if (node.type === 'wait_datetime') return c.at ? new Date(c.at).toLocaleString('es-CO') : '(sin fecha)';
  if (node.type === 'wait_reply') return 'Espera interacción';
  if (node.type === 'condition') return `${(c.conditions || []).length} condición(es)`;
  if (node.type === 'branch') return `${c.percent ?? 50}% → A`;
  if (node.type === 'add_tag') return c.tag ? `+${c.tag}` : '(sin etiqueta)';
  if (node.type === 'webhook') return String(c.url || '(sin URL)').slice(0, 40);
  return '';
}
function NodeCard({ node, onEdit, onDelete }: { node: WFNode; onEdit: () => void; onDelete: () => void }) {
  const d = NODE[node.type] ?? { label: node.type, icon: '•', chip: '#f1f5f9', color: '#475569' };
  return (
    <div className="group relative w-[280px] rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
      <button onClick={onEdit} className="flex w-full items-center gap-2 text-left">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm" style={{ background: d.chip, color: d.color }}>{d.icon}</span>
        <div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: d.color }}>{d.label}</p><p className="truncate text-sm text-slate-600">{summary(node)}</p></div>
      </button>
      <button onClick={onDelete} className="absolute -right-2 -top-2 hidden h-5 w-5 place-items-center rounded-full bg-white text-xs text-rose-500 shadow group-hover:grid" title="Quitar paso">✕</button>
    </div>
  );
}
function Branch({ label, bg, color, children }: any) {
  return (
    <div className="flex flex-col items-center">
      <span className="mb-1 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: bg, color }}>{label}</span>
      {children}
    </div>
  );
}

function NodeConfig({ node, onClose, onPatch }: { node: WFNode; onClose: () => void; onPatch: (cfg: any) => void }) {
  const c = node.config || {};
  const d = NODE[node.type];
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-auto bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="font-semibold text-slate-800">{d?.icon} {d?.label}</h3><button onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button></div>
        <div className="mt-4 space-y-3">
          {node.type === 'send_email' && (<>
            <div><Label>Asunto</Label><input value={c.subject ?? ''} onChange={(e) => onPatch({ subject: e.target.value })} className={inp} /></div>
            <div><Label>Remitente (nombre)</Label><input value={c.from_name ?? ''} onChange={(e) => onPatch({ from_name: e.target.value })} className={inp} placeholder="opcional" /></div>
            <div><Label>Contenido (HTML o texto)</Label><textarea value={c.body ?? ''} onChange={(e) => onPatch({ body: e.target.value })} rows={8} className={inp} /></div>
            <MergeHelp />
          </>)}
          {node.type === 'send_sms' && (<>
            <div><Label>Mensaje</Label><textarea value={c.message ?? ''} onChange={(e) => onPatch({ message: e.target.value })} rows={5} className={inp} /></div>
            <MergeHelp />
          </>)}
          {node.type === 'wait_delay' && (
            <div className="flex items-center gap-2"><input type="number" min={1} value={c.amount ?? 1} onChange={(e) => onPatch({ amount: +e.target.value })} className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <select value={c.unit ?? 'days'} onChange={(e) => onPatch({ unit: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="minutes">minutos</option><option value="hours">horas</option><option value="days">días</option><option value="weeks">semanas</option></select>
            </div>
          )}
          {node.type === 'wait_datetime' && (
            <div><Label>Esperar hasta</Label><input type="datetime-local" value={c.at ?? ''} onChange={(e) => onPatch({ at: e.target.value })} className={inp} /></div>
          )}
          {node.type === 'wait_reply' && (
            <p className="text-sm text-slate-500">Espera a que el contacto <b>responda, abra o haga clic</b>. Si no interactúa en 3 días, sigue por la rama <b>“Sin respuesta”</b>. Un simple “entregado” NO cuenta como respuesta.</p>
          )}
          {node.type === 'condition' && <Conditions c={c} onPatch={onPatch} />}
          {node.type === 'branch' && (
            <div><Label>Porcentaje que va a la rama A</Label><input type="number" min={0} max={100} value={c.percent ?? 50} onChange={(e) => onPatch({ percent: +e.target.value })} className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm" /> %</div>
          )}
          {node.type === 'add_tag' && (
            <div><Label>Etiqueta a agregar</Label><input value={c.tag ?? ''} onChange={(e) => onPatch({ tag: e.target.value })} className={inp} placeholder="ej. interesado" /></div>
          )}
          {node.type === 'webhook' && (
            <div><Label>URL del webhook (POST)</Label><input value={c.url ?? ''} onChange={(e) => onPatch({ url: e.target.value })} className={inp} placeholder="https://…" /></div>
          )}
        </div>
        <button onClick={onClose} className="mt-5 w-full rounded-lg py-2 text-sm font-semibold text-white" style={{ background: ACCENT }}>Listo</button>
      </div>
    </div>
  );
}
function Conditions({ c, onPatch }: { c: any; onPatch: (cfg: any) => void }) {
  const conds = c.conditions ?? [];
  const set = (i: number, patch: any) => onPatch({ conditions: conds.map((x: any, j: number) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm"><span>Cumplir</span>
        <select value={c.match ?? 'all'} onChange={(e) => onPatch({ match: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-1"><option value="all">todas</option><option value="any">alguna</option></select>
      </div>
      {conds.map((cond: any, i: number) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5">
          <select value={cond.field} onChange={(e) => set(i, { field: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-1 text-sm">{COND_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select>
          <select value={cond.op} onChange={(e) => set(i, { op: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-1 text-sm"><option value="eq">=</option><option value="neq">≠</option><option value="contains">contiene</option><option value="filled">tiene valor</option></select>
          {cond.op !== 'filled' && <input value={cond.value ?? ''} onChange={(e) => set(i, { value: e.target.value })} className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-sm" />}
          <button onClick={() => onPatch({ conditions: conds.filter((_: any, j: number) => j !== i) })} className="text-rose-500">✕</button>
        </div>
      ))}
      <button onClick={() => onPatch({ conditions: [...conds, { field: 'tags', op: 'contains', value: '' }] })} className="text-sm font-medium text-emerald-700">+ Añadir condición</button>
    </div>
  );
}
function MergeHelp() {
  return <p className="text-xs text-slate-500">Variables: {MERGE.map((m) => <code key={m.key} className="mx-0.5 rounded bg-slate-100 px-1">{`{{${m.key}}}`}</code>)}</p>;
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
            <input type="checkbox" checked={sel.has(c.id)} onChange={(e) => setSel((s) => { const n = new Set(s); e.target.checked ? n.add(c.id) : n.delete(c.id); return n; })} />
            <span className="font-medium text-slate-800">{c.name || '—'}</span>
            <span className="text-slate-400">{c.email || c.phone || ''}</span>
          </label>
        ))}
        {rows.length === 0 && <div className="px-3 py-6 text-center text-sm text-slate-400">Sin contactos.</div>}
      </div>
      <button onClick={enroll} disabled={busy || !sel.size || !published} className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: ACCENT }}>Inscribir {sel.size ? `(${sel.size})` : ''}</button>
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
