'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import {
  STARTERS,
  coerceDoc,
  docHasContent,
  emptyDoc,
  renderEmailHtml,
} from '@/lib/email-blocks';
import EmailTemplateEditor from '@/components/marketing/EmailTemplateEditor';
import SendTemplateModal from '@/components/marketing/SendTemplateModal';

// Galería de PLANTILLAS de correo de la marca: carpetas anidadas con migas de
// pan (mismo patrón que BrandWorkflowsPanel, que ya resolvió navegación,
// modales y errores), tarjetas con miniatura, buscador y acciones por
// plantilla. Las plantillas de fábrica (isPreset) se ven y se usan, pero no se
// editan ni se borran: usarlas crea una copia propia.

const ACCENT = '#16a34a';

type Folder = { id: string; name: string; parentId?: string | null; createdAt?: string };
type Template = {
  id: string;
  folderId?: string | null;
  name: string;
  subject?: string | null;
  blocks?: any;
  html?: string | null;
  thumbnailUrl?: string | null;
  isPreset?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

function fmtDate(s?: string) {
  return s ? new Date(s).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

// ── Helpers del árbol de carpetas (mismo enfoque que BrandWorkflowsPanel) ───
type TreeOption = { id: string; name: string; depth: number };

// La carpeta y TODAS sus descendientes: excluye destinos que crearían un ciclo.
function descendantsOf(folders: Folder[], rootId: string): Set<string> {
  const out = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
    }
  }
  return out;
}

// Aplana el árbol (padre antes que hijas) con profundidad, para menús con
// sangría. Carpetas con padre roto van al final: que nunca desaparezcan.
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

function folderPath(folders: Folder[], folderId: string | null | undefined): string {
  const parts: string[] = [];
  let cur = folders.find((f) => f.id === folderId) ?? null;
  for (let i = 0; i < 20 && cur; i++) {
    parts.unshift(cur.name);
    cur = folders.find((f) => f.id === (cur!.parentId ?? '')) ?? null;
  }
  return parts.length ? parts.join(' / ') : 'Inicio';
}

type NameModalState = {
  title: string;
  initial: string;
  placeholder?: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
};
type ConfirmModalState = {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
};

const inp =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500';

export default function EmailTemplatesPanel() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nameModal, setNameModal] = useState<NameModalState | null>(null);
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [previewTpl, setPreviewTpl] = useState<{ name: string; html: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sendFor, setSendFor] = useState<Template | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const d: any = await api('/admin/marketing/templates');
      const fs: Folder[] = d?.folders ?? [];
      setFolders(fs);
      setTemplates(d?.templates ?? []);
      // Si la carpeta actual ya no existe (la borró otra sesión), volvemos a
      // la raíz en vez de quedar mirando una vista vacía fantasma.
      setCurrentFolder((cur) => (cur && !fs.some((f) => f.id === cur) ? null : cur));
    } catch (e: any) {
      setLoadError(e?.message || 'No se pudo conectar con el servidor.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  function goFolder(id: string | null) {
    setCurrentFolder(id);
    setQ('');
  }

  // ── Carpetas ──
  function askNewFolder() {
    const here = inFolder ? ` dentro de «${inFolder.name}»` : '';
    setNameModal({
      title: `Nueva carpeta${here}`,
      initial: '',
      placeholder: 'Nombre de la carpeta',
      submitLabel: 'Crear carpeta',
      onSubmit: async (name) => {
        const f: any = await api('/admin/marketing/template-folders', {
          method: 'POST',
          body: JSON.stringify({ name, parentId: currentFolder }),
        });
        setFolders((p) => [...p, f]);
      },
    });
  }

  function askRenameFolder(f: Folder) {
    setNameModal({
      title: `Renombrar la carpeta «${f.name}»`,
      initial: f.name,
      submitLabel: 'Guardar',
      onSubmit: async (name) => {
        if (name === f.name) return;
        // Primero el servidor, luego la lista: si falla, el error se ve en el
        // modal y la carpeta conserva su nombre real.
        await api(`/admin/marketing/template-folders/${f.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name }),
        });
        setFolders((p) => p.map((x) => (x.id === f.id ? { ...x, name } : x)));
      },
    });
  }

  function moveFolderTo(id: string, parentId: string | null) {
    const prev = folders;
    setFolders((p) => p.map((f) => (f.id === id ? { ...f, parentId } : f)));
    api(`/admin/marketing/template-folders/${id}/move`, {
      method: 'PATCH',
      body: JSON.stringify({ parentId }),
    }).catch((e: any) => {
      setFolders(prev);
      toast(e?.message || 'No se pudo mover la carpeta', 'error');
    });
  }

  function askDeleteFolder(f: Folder) {
    const directTpls = templates.filter((t) => (t.folderId ?? null) === f.id).length;
    const directSubs = folders.filter((x) => (x.parentId ?? null) === f.id).length;
    const hasContent = directTpls > 0 || directSubs > 0;
    setConfirmModal({
      title: `Eliminar la carpeta «${f.name}»`,
      body: hasContent
        ? `Contiene ${directTpls} plantilla(s) y ${directSubs} subcarpeta(s). Las plantillas no se eliminan: quedarán fuera de esta carpeta.`
        : 'La carpeta está vacía. Esta acción no se puede deshacer.',
      confirmLabel: 'Eliminar carpeta',
      onConfirm: async () => {
        await api(`/admin/marketing/template-folders/${f.id}`, { method: 'DELETE' });
        // El destino del contenido lo decide el servidor: recargamos en vez
        // de adivinar y quedar mostrando un estado que no existe.
        await load();
        toast('Carpeta eliminada', 'success');
      },
    });
  }

  // ── Plantillas ──
  async function createTemplate(name: string, blocks: any) {
    setBusy(true);
    try {
      const t: any = await api('/admin/marketing/templates', {
        method: 'POST',
        body: JSON.stringify({ name, folderId: currentFolder, blocks }),
      });
      setTemplates((p) => [{ ...t, folderId: t.folderId ?? currentFolder ?? null }, ...p]);
      setNewOpen(false);
      setOpenId(t.id);
    } catch (e: any) {
      toast(e?.message || 'No se pudo crear la plantilla', 'error');
    } finally {
      setBusy(false);
    }
  }

  // Usar una plantilla de fábrica = duplicarla (las isPreset no se editan).
  async function usePreset(preset: Template) {
    setBusy(true);
    try {
      const t: any = await api(`/admin/marketing/templates/${preset.id}/duplicate`, { method: 'POST' });
      // La copia debe aterrizar donde está parado el usuario; si este PATCH
      // falla no bloqueamos: la plantilla ya existe y se puede mover luego.
      if (currentFolder && t?.id) {
        try {
          await api(`/admin/marketing/templates/${t.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ folderId: currentFolder }),
          });
          t.folderId = currentFolder;
        } catch {
          toast('La copia se creó en el inicio; muévela a la carpeta si la quieres ahí.', 'info');
        }
      }
      setTemplates((p) => [t, ...p]);
      setOpenId(t.id);
    } catch (e: any) {
      toast(e?.message || 'No se pudo usar la plantilla de fábrica', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function duplicateTpl(t: Template) {
    setBusy(true);
    try {
      const c: any = await api(`/admin/marketing/templates/${t.id}/duplicate`, { method: 'POST' });
      setTemplates((p) => [c, ...p]);
      toast('Plantilla duplicada', 'success');
    } catch (e: any) {
      toast(e?.message || 'No se pudo duplicar', 'error');
    } finally {
      setBusy(false);
    }
  }

  function askRenameTpl(t: Template) {
    setNameModal({
      title: `Renombrar «${t.name}»`,
      initial: t.name,
      submitLabel: 'Guardar',
      onSubmit: async (name) => {
        if (name === t.name) return;
        await api(`/admin/marketing/templates/${t.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name }),
        });
        setTemplates((p) => p.map((x) => (x.id === t.id ? { ...x, name } : x)));
      },
    });
  }

  // Optimista CON reversa: si el servidor rechaza, se restaura y se avisa.
  function moveTpl(id: string, folderId: string | null) {
    const prev = templates;
    setTemplates((p) => p.map((t) => (t.id === id ? { ...t, folderId } : t)));
    api(`/admin/marketing/templates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ folderId }),
    }).catch((e: any) => {
      setTemplates(prev);
      toast(e?.message || 'No se pudo mover la plantilla', 'error');
    });
  }

  function askDeleteTpl(t: Template) {
    setConfirmModal({
      title: `Eliminar la plantilla «${t.name}»`,
      body: 'Esta acción no se puede deshacer. Los correos ya enviados no se ven afectados.',
      confirmLabel: 'Eliminar plantilla',
      onConfirm: async () => {
        await api(`/admin/marketing/templates/${t.id}`, { method: 'DELETE' });
        setTemplates((p) => p.filter((x) => x.id !== t.id));
        toast('Plantilla eliminada', 'success');
      },
    });
  }

  async function openPreview(t: Template) {
    const local = tplHtml(t);
    if (local) {
      setPreviewTpl({ name: t.name, html: local });
      return;
    }
    // La lista puede venir "liviana" (sin blocks/html): pedimos el detalle.
    setPreviewLoading(true);
    try {
      const full = await api<Template>(`/admin/marketing/templates/${t.id}`);
      const html = full ? tplHtml(full) : null;
      if (!html) {
        toast('La plantilla está vacía: ábrela en el editor para armarla.', 'info');
        return;
      }
      setPreviewTpl({ name: t.name, html });
    } catch (e: any) {
      toast(e?.message || 'No se pudo cargar la previsualización', 'error');
    } finally {
      setPreviewLoading(false);
    }
  }

  // ── Vista ──
  if (openId) {
    return (
      <EmailTemplateEditor
        templateId={openId}
        onClose={() => {
          setOpenId(null);
          // Recarga al volver: el editor guarda por su cuenta y la miniatura
          // y el nombre de la tarjeta deben reflejarlo.
          load();
        }}
      />
    );
  }

  const inFolder = folders.find((f) => f.id === currentFolder) ?? null;
  const trail: Folder[] = [];
  {
    let cur = inFolder;
    for (let i = 0; i < 20 && cur; i++) {
      trail.unshift(cur);
      cur = folders.find((f) => f.id === (cur!.parentId ?? '')) ?? null;
    }
  }
  const searching = q.trim().length > 0;
  const qLower = q.trim().toLowerCase();
  const showFolders = searching ? [] : folders.filter((f) => (f.parentId ?? null) === currentFolder);
  const presets = templates.filter((t) => t.isPreset);
  const own = templates.filter((t) => !t.isPreset);
  const rows = searching
    ? [...own, ...presets].filter(
        (t) =>
          t.name.toLowerCase().includes(qLower) || (t.subject ?? '').toLowerCase().includes(qLower),
      )
    : own.filter((t) => (t.folderId ?? null) === currentFolder);
  const moveOptions = flattenTree(folders);
  const empty = showFolders.length === 0 && rows.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar plantillas…"
          className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-emerald-400 sm:w-64"
        />
        <div className="ml-auto flex gap-2">
          <button
            onClick={askNewFolder}
            disabled={busy || loading}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            📁 Nueva carpeta
          </button>
          <button
            onClick={() => setNewOpen(true)}
            disabled={busy || loading}
            className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: ACCENT }}
          >
            + Nueva plantilla
          </button>
        </div>
      </div>

      {/* Miga de pan al entrar a una carpeta */}
      {!loading && !loadError && !searching && currentFolder !== null && (
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <button
            onClick={() => goFolder(trail.length > 1 ? trail[trail.length - 2].id : null)}
            className="text-slate-500 hover:text-slate-800"
          >
            ← Atrás
          </button>
          <span className="text-slate-300">|</span>
          <button onClick={() => goFolder(null)} className="text-slate-500 hover:text-slate-800">
            Inicio
          </button>
          {trail.map((f, i) => (
            <span key={f.id} className="flex items-center gap-1.5">
              <span className="text-slate-400">/</span>
              {i === trail.length - 1 ? (
                <span className="font-semibold text-slate-800">📁 {f.name}</span>
              ) : (
                <button onClick={() => goFolder(f.id)} className="text-slate-500 hover:text-slate-800">
                  📁 {f.name}
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center text-sm text-slate-400">
          Cargando plantillas…
        </div>
      ) : loadError ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-8 text-center">
          <p className="text-sm font-semibold text-amber-900">No se pudo cargar la galería</p>
          <p className="mt-1 text-xs text-amber-800">{loadError}</p>
          <button
            onClick={load}
            className="mt-3 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
          >
            Reintentar
          </button>
        </div>
      ) : (
        <>
          {/* Plantillas de fábrica: visibles en la raíz, se usan duplicando */}
          {!searching && currentFolder === null && presets.length > 0 && (
            <div className="rounded-2xl border border-sky-100 bg-sky-50/50 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sky-700">
                De fábrica — al usarlas se crea una copia tuya
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {presets.map((t) => (
                  <div key={t.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <button onClick={() => openPreview(t)} className="block w-full" title="Previsualizar">
                      <MiniPreview tpl={t} />
                    </button>
                    <div className="space-y-1.5 p-2.5">
                      <p className="truncate text-sm font-medium text-slate-800">{t.name}</p>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => usePreset(t)}
                          disabled={busy}
                          className="flex-1 rounded-lg px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                          style={{ background: ACCENT }}
                        >
                          Usar plantilla
                        </button>
                        <button
                          onClick={() => openPreview(t)}
                          className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                        >
                          👁
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {empty ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-400">
              {searching
                ? 'Ninguna plantilla coincide con la búsqueda.'
                : currentFolder
                  ? 'Carpeta vacía. Crea una plantilla aquí o mueve una existente con «Mover a carpeta».'
                  : 'Aún no hay plantillas. Crea la primera con «+ Nueva plantilla».'}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {showFolders.map((f) => (
                <FolderCard
                  key={f.id}
                  f={f}
                  folders={folders}
                  onOpen={() => goFolder(f.id)}
                  onRename={() => askRenameFolder(f)}
                  onDelete={() => askDeleteFolder(f)}
                  onMove={(pid) => moveFolderTo(f.id, pid)}
                />
              ))}
              {rows.map((t) => (
                <TemplateCard
                  key={t.id}
                  t={t}
                  folderCaption={searching ? folderPath(folders, t.folderId) : null}
                  moveOptions={moveOptions}
                  busy={busy}
                  onOpen={() => (t.isPreset ? usePreset(t) : setOpenId(t.id))}
                  onPreview={() => openPreview(t)}
                  onSend={() => setSendFor(t)}
                  onRename={() => askRenameTpl(t)}
                  onDuplicate={() => duplicateTpl(t)}
                  onMove={(fid) => moveTpl(t.id, fid)}
                  onDelete={() => askDeleteTpl(t)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {previewLoading && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/30">
          <p className="rounded-xl bg-white px-4 py-2 text-sm text-slate-500 shadow-lg">Cargando previsualización…</p>
        </div>
      )}
      {previewTpl && (
        <GalleryPreviewModal name={previewTpl.name} html={previewTpl.html} onClose={() => setPreviewTpl(null)} />
      )}
      {sendFor && (
        <SendTemplateModal
          templateId={sendFor.id}
          templateName={sendFor.name}
          defaultSubject={sendFor.subject || sendFor.name}
          onClose={() => setSendFor(null)}
        />
      )}
      {newOpen && (
        <NewTemplateModal
          busy={busy}
          presets={presets}
          folderName={inFolder?.name ?? null}
          onCreate={createTemplate}
          onUsePreset={usePreset}
          onClose={() => setNewOpen(false)}
        />
      )}
      {nameModal && <NameModal {...nameModal} onClose={() => setNameModal(null)} />}
      {confirmModal && <ConfirmModal {...confirmModal} onClose={() => setConfirmModal(null)} />}
    </div>
  );
}

// HTML para la miniatura/preview a partir de lo que ya tengamos de la
// plantilla (sin ir al servidor): html guardado, o render de sus bloques.
function tplHtml(t: Template): string | null {
  if (t.html) return t.html;
  if (t.blocks) {
    try {
      const d = coerceDoc(t.blocks);
      if (docHasContent(d)) return renderEmailHtml(d, { title: t.name });
    } catch {
      // blocks corrupto: la tarjeta cae al placeholder, no rompe la galería
    }
  }
  return null;
}

function MiniPreview({ tpl }: { tpl: Template }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.28);
  const html = useMemo(() => tplHtml(tpl), [tpl]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || !html) return;
    const compute = () => setScale(Math.max(0.1, el.clientWidth / 640));
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [html]);

  if (!html) {
    return tpl.thumbnailUrl ? (
      <div className="h-36 overflow-hidden bg-slate-100">
        {/* Miniatura subida por el backend (si existe) */}
        <img src={tpl.thumbnailUrl} alt="" className="h-full w-full object-cover object-top" />
      </div>
    ) : (
      <div className="flex h-36 items-center justify-center bg-slate-100 text-3xl">✉️</div>
    );
  }
  return (
    <div ref={boxRef} className="relative h-36 overflow-hidden bg-slate-100">
      <iframe
        title=""
        tabIndex={-1}
        srcDoc={html}
        sandbox=""
        style={{
          width: 640,
          height: Math.ceil(144 / scale),
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          border: 0,
          pointerEvents: 'none',
        }}
      />
      {/* Capa encima: la miniatura es decorativa, el clic es de la tarjeta */}
      <div className="absolute inset-0" />
    </div>
  );
}

function FolderCard({
  f,
  folders,
  onOpen,
  onRename,
  onDelete,
  onMove,
}: {
  f: Folder;
  folders: Folder[];
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onMove: (parentId: string | null) => void;
}) {
  // Menú con position:fixed — un dropdown absoluto dentro de la grilla queda
  // recortado por overflow de los contenedores.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  function openMenu(e: React.MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  }
  const close = () => {
    setPos(null);
    setMoveOpen(false);
  };
  const item =
    'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50';
  const targets = flattenTree(folders, descendantsOf(folders, f.id));
  return (
    <div className="relative flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-3 hover:border-emerald-200">
      <button onClick={onOpen} className="flex items-center gap-2 text-left">
        <span className="text-3xl">📁</span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-slate-800">{f.name}</span>
          <span className="block text-[11px] text-slate-400">{fmtDate(f.createdAt)}</span>
        </span>
      </button>
      <div className="absolute right-2 top-2">
        <button
          onClick={(e) => (pos ? close() : openMenu(e))}
          className="rounded-lg px-1.5 py-0.5 text-lg leading-none text-slate-400 hover:bg-slate-100"
          title="Opciones de la carpeta"
        >
          ⋮
        </button>
        {pos && (
          <>
            <div className="fixed inset-0 z-40" onClick={close} />
            <div
              style={{ top: pos.top, right: pos.right }}
              className="fixed z-50 w-56 rounded-xl border border-slate-200 bg-white p-1 text-left shadow-lg"
            >
              <button onClick={() => { close(); onOpen(); }} className={item}>
                <span className="w-4 text-center">📂</span> Abrir
              </button>
              <button onClick={() => { close(); onRename(); }} className={item}>
                <span className="w-4 text-center">✎</span> Renombrar
              </button>
              <div className="relative">
                <button onClick={() => setMoveOpen((v) => !v)} className={`${item} justify-between`}>
                  <span className="flex items-center gap-2">
                    <span className="w-4 text-center">📁</span> Mover a carpeta
                  </span>
                  <span className="text-slate-400">›</span>
                </button>
                {moveOpen && (
                  <MoveTargets
                    options={targets}
                    activeId={f.parentId ?? null}
                    rootLabel="Inicio (raíz)"
                    onPick={(pid) => {
                      close();
                      onMove(pid);
                    }}
                  />
                )}
              </div>
              <div className="my-1 border-t border-slate-100" />
              <button
                onClick={() => { close(); onDelete(); }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-rose-600 hover:bg-rose-50"
              >
                <span className="w-4 text-center">🗑</span> Eliminar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TemplateCard({
  t,
  folderCaption,
  moveOptions,
  busy,
  onOpen,
  onPreview,
  onSend,
  onRename,
  onDuplicate,
  onMove,
  onDelete,
}: {
  t: Template;
  folderCaption: string | null;
  moveOptions: TreeOption[];
  busy: boolean;
  onOpen: () => void;
  onPreview: () => void;
  onSend: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onMove: (folderId: string | null) => void;
  onDelete: () => void;
}) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  function openMenu(e: React.MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  }
  const close = () => {
    setPos(null);
    setMoveOpen(false);
  };
  const item =
    'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50';
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white hover:border-emerald-200">
      <button onClick={onOpen} className="block w-full" title={t.isPreset ? 'Usar (crea una copia)' : 'Editar'}>
        <MiniPreview tpl={t} />
      </button>
      <div className="flex items-start gap-1 p-2.5">
        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm font-medium text-slate-800">{t.name}</span>
          <span className="block truncate text-[11px] text-slate-400">
            {t.isPreset ? 'De fábrica' : folderCaption ? `📁 ${folderCaption}` : fmtDate(t.updatedAt ?? t.createdAt)}
          </span>
        </button>
        <div>
          <button
            onClick={(e) => (pos ? close() : openMenu(e))}
            className="rounded-lg px-1.5 py-0.5 text-lg leading-none text-slate-400 hover:bg-slate-100"
            title="Opciones"
          >
            ⋮
          </button>
          {pos && (
            <>
              <div className="fixed inset-0 z-40" onClick={close} />
              <div
                style={{ top: pos.top, right: pos.right }}
                className="fixed z-50 w-56 rounded-xl border border-slate-200 bg-white p-1 text-left shadow-lg"
              >
                <button onClick={() => { close(); onOpen(); }} className={item}>
                  <span className="w-4 text-center">✏️</span> {t.isPreset ? 'Usar plantilla' : 'Editar'}
                </button>
                <button onClick={() => { close(); onPreview(); }} className={item}>
                  <span className="w-4 text-center">👁</span> Previsualizar
                </button>
                {!t.isPreset && (
                  <button onClick={() => { close(); onSend(); }} className={item}>
                    <span className="w-4 text-center">✉️</span> Enviar a contactos
                  </button>
                )}
                <button onClick={() => { close(); onDuplicate(); }} disabled={busy} className={item}>
                  <span className="w-4 text-center">📄</span> Duplicar
                </button>
                {!t.isPreset && (
                  <>
                    <button onClick={() => { close(); onRename(); }} className={item}>
                      <span className="w-4 text-center">✎</span> Renombrar
                    </button>
                    <div className="relative">
                      <button onClick={() => setMoveOpen((v) => !v)} className={`${item} justify-between`}>
                        <span className="flex items-center gap-2">
                          <span className="w-4 text-center">📁</span> Mover a carpeta
                        </span>
                        <span className="text-slate-400">›</span>
                      </button>
                      {moveOpen && (
                        <MoveTargets
                          options={moveOptions}
                          activeId={t.folderId ?? null}
                          rootLabel="Sin carpeta"
                          onPick={(fid) => {
                            close();
                            onMove(fid);
                          }}
                        />
                      )}
                    </div>
                    <div className="my-1 border-t border-slate-100" />
                    <button
                      onClick={() => { close(); onDelete(); }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-rose-600 hover:bg-rose-50"
                    >
                      <span className="w-4 text-center">🗑</span> Eliminar
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Lista de destinos para «Mover a…» con sangría por profundidad.
function MoveTargets({
  options,
  activeId,
  rootLabel,
  onPick,
}: {
  options: TreeOption[];
  activeId: string | null;
  rootLabel: string;
  onPick: (id: string | null) => void;
}) {
  const item = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-slate-50';
  return (
    <div className="mt-0.5 max-h-48 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/70 p-1">
      <button
        onClick={() => onPick(null)}
        className={`${item} ${activeId == null ? 'font-semibold text-emerald-700' : 'text-slate-700'}`}
      >
        <span className="w-4" /> {rootLabel}
      </button>
      {options.map((t) => (
        <button
          key={t.id}
          onClick={() => onPick(t.id)}
          className={`${item} ${activeId === t.id ? 'font-semibold text-emerald-700' : 'text-slate-700'}`}
        >
          <span className="w-4 text-center">📁</span>
          <span className="truncate" style={{ paddingLeft: t.depth * 12 }}>
            {t.name}
          </span>
        </button>
      ))}
      {options.length === 0 && <p className="px-2.5 py-1.5 text-xs text-slate-400">No hay otra carpeta.</p>}
    </div>
  );
}

// ── Modal «Nueva plantilla»: desde cero, un arranque local o una de fábrica ─
function NewTemplateModal({
  busy,
  presets,
  folderName,
  onCreate,
  onUsePreset,
  onClose,
}: {
  busy: boolean;
  presets: Template[];
  folderName: string | null;
  onCreate: (name: string, blocks: any) => Promise<void>;
  onUsePreset: (t: Template) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [choice, setChoice] = useState<string>('blank'); // 'blank' | starter.key | `preset:${id}`
  const canGo = name.trim().length > 0 || choice.startsWith('preset:');

  async function go() {
    if (busy) return;
    if (choice.startsWith('preset:')) {
      const p = presets.find((x) => `preset:${x.id}` === choice);
      if (p) await onUsePreset(p);
      onClose();
      return;
    }
    const n = name.trim();
    if (!n) {
      toast('Ponle un nombre a la plantilla.', 'error');
      return;
    }
    const starter = STARTERS.find((s) => s.key === choice);
    await onCreate(n, starter ? starter.build() : emptyDoc());
  }

  const opt = (active: boolean) =>
    `w-full rounded-xl border p-3 text-left ${
      active ? 'border-emerald-400 bg-emerald-50/60' : 'border-slate-200 hover:border-slate-300'
    }`;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-slate-800">
          Nueva plantilla{folderName ? ` en «${folderName}»` : ''}
        </h3>
        {!choice.startsWith('preset:') && (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') go();
              if (e.key === 'Escape') onClose();
            }}
            placeholder="Nombre de la plantilla"
            maxLength={80}
            className={`${inp} mt-3`}
          />
        )}
        <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Punto de partida</p>
        <div className="space-y-2">
          <button onClick={() => setChoice('blank')} className={opt(choice === 'blank')}>
            <span className="block text-sm font-medium text-slate-800">En blanco</span>
            <span className="block text-xs text-slate-500">Empieza con el lienzo vacío.</span>
          </button>
          {STARTERS.map((s) => (
            <button key={s.key} onClick={() => setChoice(s.key)} className={opt(choice === s.key)}>
              <span className="block text-sm font-medium text-slate-800">{s.name}</span>
              <span className="block text-xs text-slate-500">{s.description}</span>
            </button>
          ))}
          {presets.map((p) => (
            <button key={p.id} onClick={() => setChoice(`preset:${p.id}`)} className={opt(choice === `preset:${p.id}`)}>
              <span className="block text-sm font-medium text-slate-800">🏭 {p.name}</span>
              <span className="block text-xs text-slate-500">De fábrica: se crea una copia tuya.</span>
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">
            Cancelar
          </button>
          <button
            onClick={go}
            disabled={busy || !canGo}
            className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: ACCENT }}
          >
            {busy ? 'Creando…' : 'Crear y abrir el editor'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modales de nombre y confirmación (sin window.prompt / window.confirm) ───
// El guardado ocurre DENTRO del modal: si el servidor rechaza, el error se ve
// (toast) y el modal sigue abierto — la lista solo cambia tras el OK real.
function NameModal({
  title,
  initial,
  placeholder,
  submitLabel,
  onSubmit,
  onClose,
}: NameModalState & { onClose: () => void }) {
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  async function go() {
    const v = name.trim();
    if (!v || saving) return;
    setSaving(true);
    try {
      await onSubmit(v);
      onClose();
    } catch (e: any) {
      toast(e?.message || 'No se pudo guardar', 'error');
      setSaving(false);
    }
  }
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold text-slate-800">{title}</h3>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go();
            if (e.key === 'Escape') onClose();
          }}
          className={inp}
          placeholder={placeholder || 'Nombre'}
          maxLength={80}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">
            Cancelar
          </button>
          <button
            onClick={go}
            disabled={saving || !name.trim()}
            className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: ACCENT }}
          >
            {saving ? 'Guardando…' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: ConfirmModalState & { onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  async function go() {
    if (saving) return;
    setSaving(true);
    try {
      await onConfirm();
      onClose();
    } catch (e: any) {
      toast(e?.message || 'No se pudo completar la acción', 'error');
      setSaving(false);
    }
  }
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <p className="mt-2 text-sm text-slate-500">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">
            Cancelar
          </button>
          <button
            onClick={go}
            disabled={saving}
            className="rounded-lg bg-rose-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {saving ? 'Eliminando…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function GalleryPreviewModal({ name, html, onClose }: { name: string; html: string; onClose: () => void }) {
  const [mode, setMode] = useState<'desktop' | 'mobile'>('desktop');
  return (
    <div className="fixed inset-0 z-[75] flex flex-col bg-black/50 p-3 sm:p-6" onClick={onClose}>
      <div
        className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">👁 {name}</p>
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {(
              [
                ['desktop', '🖥️ Escritorio'],
                ['mobile', '📱 Móvil'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setMode(k)}
                className="rounded-md px-2 py-1 text-xs font-medium"
                style={mode === k ? { background: 'white', boxShadow: '0 1px 2px rgba(0,0,0,.08)' } : { color: '#64748b' }}
              >
                {label}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100" title="Cerrar">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-auto bg-slate-100 p-4">
          <iframe
            title={`Previsualización de ${name}`}
            srcDoc={html}
            sandbox=""
            className="mx-auto block h-full rounded-lg bg-white shadow"
            style={{ width: mode === 'desktop' ? '100%' : 375, maxWidth: '100%', border: 0 }}
          />
        </div>
      </div>
    </div>
  );
}
