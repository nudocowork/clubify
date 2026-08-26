'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, getToken } from '@/lib/api';
import { toast } from '@/components/Toast';
import {
  BLOCK_META,
  ELEMENT_ORDER,
  EMAIL_TOKENS,
  FONT_STACKS,
  LAYOUTS,
  SOCIAL_NETWORKS,
  containsDataImage,
  coerceDoc,
  defaultRowProps,
  emptyDoc,
  findDataImage,
  newBlock,
  newRow,
  renderEmailHtml,
  uid,
  type EmailBlock,
  type EmailBlockType,
  type EmailDoc,
  type EmailDocSettings,
  type EmailRow,
  type EmailRowProps,
  type SocialNetworkKind,
} from '@/lib/email-blocks';
import SendTemplateModal from '@/components/marketing/SendTemplateModal';

// Editor visual de plantillas de correo por bloques (estilo GoHighLevel):
// barra lateral con Elementos y Diseños, lienzo central, panel de propiedades
// y barra superior con nombre, vista escritorio/móvil, deshacer/rehacer,
// previsualizar, enviar y guardar. El lienzo es una APROXIMACIÓN con divs
// (nuestra UI); lo que viaja al backend es el HTML de CORREO generado por
// renderEmailHtml() — tablas + estilos en línea — porque los clientes de
// correo no soportan flexbox/grid.

const ACCENT = '#16a34a';
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Template = {
  id: string;
  folderId?: string | null;
  name: string;
  subject?: string | null;
  blocks?: any;
  html?: string | null;
  thumbnailUrl?: string | null;
  isPreset?: boolean;
};

type Sel = { rowId: string; colId: string | null; blockId: string | null } | null;
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

// El wrapper api() fija Content-Type: application/json, así que la subida
// multipart va con fetch directo (mismo patrón que FileUploader). La imagen
// vive en S3 y al bloque solo entra la URL — NUNCA un data:image.
async function uploadEmailImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file, file.name);
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}/api/media/upload?folder=email-templates`, {
    method: 'POST',
    headers,
    body: fd,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = text;
    try {
      msg = JSON.parse(text)?.message ?? text;
    } catch {
      /* texto plano */
    }
    throw new Error(msg || `Error ${res.status} subiendo la imagen`);
  }
  const data = await res.json();
  if (!data?.url) throw new Error('El servidor no devolvió la URL de la imagen.');
  return data.url as string;
}

function locate(d: EmailDoc, blockId: string) {
  for (let ri = 0; ri < d.rows.length; ri++) {
    const row = d.rows[ri];
    for (let ci = 0; ci < row.columns.length; ci++) {
      const bi = row.columns[ci].blocks.findIndex((b) => b.id === blockId);
      if (bi >= 0) return { ri, ci, bi, row, col: row.columns[ci], block: row.columns[ci].blocks[bi] };
    }
  }
  return null;
}

function withColumnBlocks(
  d: EmailDoc,
  ri: number,
  ci: number,
  fn: (blocks: EmailBlock[]) => EmailBlock[],
): EmailDoc {
  return {
    ...d,
    rows: d.rows.map((r, i) =>
      i !== ri
        ? r
        : { ...r, columns: r.columns.map((c, j) => (j !== ci ? c : { ...c, blocks: fn(c.blocks) })) },
    ),
  };
}

const inp =
  'w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-500';
const lbl = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400';

export default function EmailTemplateEditor({
  templateId,
  onClose,
}: {
  templateId: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [doc, setDoc] = useState<EmailDoc | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [viewMode, setViewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [sidebarTab, setSidebarTab] = useState<'elementos' | 'disenos'>('elementos');
  const [sidebarOpen, setSidebarOpen] = useState(false); // drawer móvil
  // En móvil el panel de propiedades es una hoja inferior que solo aparece al
  // seleccionar algo; este flag permite abrir los AJUSTES del correo (asunto,
  // colores) sin tener nada seleccionado.
  const [settingsOpenMobile, setSettingsOpenMobile] = useState(false);
  const [preview, setPreview] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [exitAsk, setExitAsk] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Historial deshacer/rehacer. `histVersion` remonta los inputs NO
  // controlados (contentEditable) tras un undo/redo para que reflejen el
  // estado restaurado — un contentEditable solo pinta su HTML al montar.
  const pastRef = useRef<EmailDoc[]>([]);
  const futureRef = useRef<EmailDoc[]>([]);
  const lastEditRef = useRef<{ key: string; at: number } | null>(null);
  const [histVersion, setHistVersion] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  // Secuencia de mutaciones: si el doc cambia MIENTRAS un guardado está en
  // vuelo, al terminar no se marca limpio (el autoguardado vuelve a disparar).
  const mutSeq = useRef(0);
  const savingRef = useRef(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const t = await api<Template>(`/admin/marketing/templates/${templateId}`);
      if (!t) throw new Error('La plantilla no existe (¿la borró otra sesión?).');
      setName(t.name ?? 'Plantilla');
      setSubject(t.subject ?? '');
      setReadOnly(!!t.isPreset);
      let d = coerceDoc(t.blocks);
      // Plantilla guardada solo como HTML (importada o de otra herramienta):
      // no se puede reconstruir en bloques, así que se conserva íntegra en un
      // bloque de código para no perder contenido.
      if (d.rows.length === 0 && t.html) {
        d = emptyDoc();
        d.rows = [newRow([100], [[newBlock('html', { html: t.html })]])];
      }
      setDoc(d);
      pastRef.current = [];
      futureRef.current = [];
      setCanUndo(false);
      setCanRedo(false);
      setDirty(false);
      setSaveState('idle');
    } catch (e: any) {
      setLoadError(e?.message || 'No se pudo cargar la plantilla.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, [templateId]);

  function touchMeta() {
    mutSeq.current++;
    setDirty(true);
    setSaveState((s) => (s === 'saved' ? 'idle' : s));
  }

  function change(next: EmailDoc, coalesceKey?: string) {
    if (readOnly) return;
    if (doc) {
      const now = Date.now();
      const le = lastEditRef.current;
      // Coalescencia: teclear en un mismo campo no genera 40 pasos de undo;
      // el tope del historial ya guarda el estado previo a la ráfaga.
      const skipPush = !!coalesceKey && !!le && le.key === coalesceKey && now - le.at < 900;
      if (!skipPush) {
        pastRef.current.push(doc);
        if (pastRef.current.length > 60) pastRef.current.shift();
      }
      lastEditRef.current = coalesceKey ? { key: coalesceKey, at: now } : null;
      futureRef.current = [];
    }
    mutSeq.current++;
    setDoc(next);
    setDirty(true);
    setSaveState((s) => (s === 'saved' ? 'idle' : s));
    setCanUndo(pastRef.current.length > 0);
    setCanRedo(false);
  }

  function undo() {
    if (!doc || pastRef.current.length === 0) return;
    futureRef.current.push(doc);
    const prev = pastRef.current.pop()!;
    lastEditRef.current = null;
    mutSeq.current++;
    setDoc(prev);
    setDirty(true);
    setHistVersion((v) => v + 1);
    setCanUndo(pastRef.current.length > 0);
    setCanRedo(true);
  }
  function redo() {
    if (!doc || futureRef.current.length === 0) return;
    pastRef.current.push(doc);
    const next = futureRef.current.pop()!;
    lastEditRef.current = null;
    mutSeq.current++;
    setDoc(next);
    setDirty(true);
    setHistVersion((v) => v + 1);
    setCanUndo(true);
    setCanRedo(futureRef.current.length > 0);
  }

  // ── Mutaciones del documento ──────────────────────────────────────────────
  function updateBlock(blockId: string, patch: Record<string, any>, coalesceKey?: string) {
    if (!doc) return;
    const loc = locate(doc, blockId);
    if (!loc) return;
    change(
      withColumnBlocks(doc, loc.ri, loc.ci, (blocks) =>
        blocks.map((b) => (b.id === blockId ? { ...b, props: { ...b.props, ...patch } } : b)),
      ),
      coalesceKey,
    );
  }

  function updateSettings(patch: Partial<EmailDocSettings>, coalesceKey?: string) {
    if (!doc) return;
    change({ ...doc, settings: { ...doc.settings, ...patch } }, coalesceKey);
  }

  /** Fondo y relleno de la BANDA: es lo que hace las cabeceras de color. */
  function updateRow(rowId: string, patch: Partial<EmailRowProps>, coalesceKey?: string) {
    if (!doc) return;
    change(
      {
        ...doc,
        rows: doc.rows.map((r) =>
          r.id === rowId ? { ...r, props: { ...defaultRowProps(), ...r.props, ...patch } } : r,
        ),
      },
      coalesceKey,
    );
  }

  function addElement(type: EmailBlockType) {
    if (!doc || readOnly) return;
    const b = newBlock(type);
    let next: EmailDoc;
    if (sel?.blockId) {
      const loc = locate(doc, sel.blockId);
      if (loc) {
        next = withColumnBlocks(doc, loc.ri, loc.ci, (blocks) => {
          const arr = [...blocks];
          arr.splice(loc.bi + 1, 0, b);
          return arr;
        });
        change(next);
        setSel({ rowId: loc.row.id, colId: loc.col.id, blockId: b.id });
        setSidebarOpen(false);
        return;
      }
    }
    if (sel?.colId) {
      const ri = doc.rows.findIndex((r) => r.id === sel.rowId);
      const ci = ri >= 0 ? doc.rows[ri].columns.findIndex((c) => c.id === sel.colId) : -1;
      if (ri >= 0 && ci >= 0) {
        next = withColumnBlocks(doc, ri, ci, (blocks) => [...blocks, b]);
        change(next);
        setSel({ rowId: sel.rowId, colId: sel.colId, blockId: b.id });
        setSidebarOpen(false);
        return;
      }
    }
    if (doc.rows.length > 0) {
      const ri = doc.rows.length - 1;
      next = withColumnBlocks(doc, ri, 0, (blocks) => [...blocks, b]);
      change(next);
      const row = doc.rows[ri];
      setSel({ rowId: row.id, colId: row.columns[0].id, blockId: b.id });
    } else {
      const row = newRow([100], [[b]]);
      change({ ...doc, rows: [row] });
      setSel({ rowId: row.id, colId: row.columns[0].id, blockId: b.id });
    }
    setSidebarOpen(false);
  }

  function addLayout(widths: number[]) {
    if (!doc || readOnly) return;
    const row = newRow(widths);
    let idx = doc.rows.length;
    if (sel) {
      const i = doc.rows.findIndex((r) => r.id === sel.rowId);
      if (i >= 0) idx = i + 1;
    }
    const rows = [...doc.rows];
    rows.splice(idx, 0, row);
    change({ ...doc, rows });
    setSel({ rowId: row.id, colId: row.columns[0].id, blockId: null });
    setSidebarOpen(false);
  }

  function moveBlock(blockId: string, dir: -1 | 1) {
    if (!doc) return;
    const loc = locate(doc, blockId);
    if (!loc) return;
    const to = loc.bi + dir;
    if (to < 0 || to >= loc.col.blocks.length) return;
    change(
      withColumnBlocks(doc, loc.ri, loc.ci, (blocks) => {
        const arr = [...blocks];
        const [b] = arr.splice(loc.bi, 1);
        arr.splice(to, 0, b);
        return arr;
      }),
    );
  }

  function duplicateBlock(blockId: string) {
    if (!doc) return;
    const loc = locate(doc, blockId);
    if (!loc) return;
    const copy: EmailBlock = { ...loc.block, id: uid(), props: JSON.parse(JSON.stringify(loc.block.props)) };
    change(
      withColumnBlocks(doc, loc.ri, loc.ci, (blocks) => {
        const arr = [...blocks];
        arr.splice(loc.bi + 1, 0, copy);
        return arr;
      }),
    );
    setSel({ rowId: loc.row.id, colId: loc.col.id, blockId: copy.id });
  }

  function deleteBlock(blockId: string) {
    if (!doc) return;
    const loc = locate(doc, blockId);
    if (!loc) return;
    change(withColumnBlocks(doc, loc.ri, loc.ci, (blocks) => blocks.filter((b) => b.id !== blockId)));
    setSel({ rowId: loc.row.id, colId: loc.col.id, blockId: null });
  }

  function moveRow(rowId: string, dir: -1 | 1) {
    if (!doc) return;
    const i = doc.rows.findIndex((r) => r.id === rowId);
    const to = i + dir;
    if (i < 0 || to < 0 || to >= doc.rows.length) return;
    const rows = [...doc.rows];
    const [r] = rows.splice(i, 1);
    rows.splice(to, 0, r);
    change({ ...doc, rows });
  }

  function duplicateRow(rowId: string) {
    if (!doc) return;
    const i = doc.rows.findIndex((r) => r.id === rowId);
    if (i < 0) return;
    const src = doc.rows[i];
    const copy: EmailRow = {
      id: uid(),
      columns: src.columns.map((c) => ({
        id: uid(),
        widthPct: c.widthPct,
        blocks: c.blocks.map((b) => ({ ...b, id: uid(), props: JSON.parse(JSON.stringify(b.props)) })),
      })),
      // La copia se lleva el fondo y el relleno: duplicar una banda de color y
      // que salga blanca sería lo contrario de lo que espera quien la duplica.
      props: { ...defaultRowProps(), ...(src.props ?? {}) },
    };
    const rows = [...doc.rows];
    rows.splice(i + 1, 0, copy);
    change({ ...doc, rows });
  }

  function deleteRow(rowId: string) {
    if (!doc) return;
    change({ ...doc, rows: doc.rows.filter((r) => r.id !== rowId) });
    setSel(null);
  }

  // ── Guardado (manual + autoguardado) ──────────────────────────────────────
  async function save(auto = false): Promise<boolean> {
    if (!doc || readOnly) return false;
    if (savingRef.current) return false;
    const offending = findDataImage(doc);
    const html = offending ? '' : renderEmailHtml(doc, { title: subject || name });
    if (offending || containsDataImage(html)) {
      const msg = `El bloque «${offending ?? 'Código HTML'}» contiene una imagen incrustada (data:image). Súbela con «Subir imagen» para obtener una URL — el servidor rechaza ese formato.`;
      setSaveState('error');
      setSaveError(msg);
      if (!auto) toast(msg, 'error');
      return false;
    }
    const seq = mutSeq.current;
    savingRef.current = true;
    setSaveState('saving');
    setSaveError(null);
    try {
      await api(`/admin/marketing/templates/${templateId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim() || 'Plantilla sin nombre',
          subject: subject.trim() ? subject.trim() : null,
          blocks: doc,
          html,
        }),
      });
      if (mutSeq.current === seq) {
        setDirty(false);
        setSaveState('saved');
      } else {
        // Cambió algo durante el guardado: sigue sucio, el autosave reintenta.
        setSaveState('idle');
      }
      return true;
    } catch (e: any) {
      setSaveState('error');
      setSaveError(e?.message || 'No se pudo guardar la plantilla.');
      if (!auto) toast(e?.message || 'No se pudo guardar la plantilla.', 'error');
      return false;
    } finally {
      savingRef.current = false;
    }
  }

  // Autoguardado: 2,5 s después del último cambio. Si falla queda la franja
  // de error con «Reintentar» — nunca un fallo silencioso.
  useEffect(() => {
    if (!dirty || !doc || readOnly || loading) return;
    const t = setTimeout(() => {
      save(true);
    }, 2500);
    return () => clearTimeout(t);
  }, [doc, name, subject, dirty]);

  // Cerrar la pestaña con cambios sin guardar: el navegador pide confirmación.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  // Atajos: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y / Ctrl+S. Dentro de un campo de
  // texto se respeta el undo nativo del navegador.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        save(false);
        return;
      }
      const t = e.target as HTMLElement | null;
      const typing =
        !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (typing) return;
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [doc, name, subject]);

  function requestClose() {
    if (!dirty) {
      onClose();
      return;
    }
    setExitAsk(true);
  }

  async function openSend() {
    if (readOnly) return;
    if (dirty) {
      // El envío usa lo GUARDADO en el servidor: guardar primero evita mandar
      // una versión vieja sin que el usuario lo note.
      const ok = await save(false);
      if (!ok) {
        toast('Guarda la plantilla antes de enviar.', 'error');
        return;
      }
    }
    setSendOpen(true);
  }

  const previewHtml = useMemo(
    () => (doc ? renderEmailHtml(doc, { title: subject || name }) : ''),
    [doc, subject, name],
  );

  if (loading) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-100">
        <p className="text-sm text-slate-400">Cargando plantilla…</p>
      </div>
    );
  }
  if (loadError || !doc) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-100 p-4">
        <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
          <p className="text-sm font-semibold text-amber-900">No se pudo abrir la plantilla</p>
          <p className="mt-1 text-xs text-amber-800">{loadError ?? 'Documento vacío.'}</p>
          <div className="mt-4 flex justify-center gap-2">
            <button onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
              ← Volver
            </button>
            <button onClick={load} className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700">
              Reintentar
            </button>
          </div>
        </div>
      </div>
    );
  }

  const selBlock = sel?.blockId ? locate(doc, sel.blockId)?.block ?? null : null;
  const selRow = sel ? doc.rows.find((r) => r.id === sel.rowId) ?? null : null;

  const saveLabel =
    saveState === 'saving'
      ? 'Guardando…'
      : saveState === 'saved'
        ? '✓ Guardado'
        : saveState === 'error'
          ? '⚠ Sin guardar'
          : dirty
            ? 'Cambios sin guardar'
            : '';

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-100">
      {/* ── Barra superior ── */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <button onClick={requestClose} className="rounded-lg px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-100">
          ← Plantillas
        </button>
        <button
          onClick={() => setSidebarOpen(true)}
          className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-600 md:hidden"
          title="Elementos y diseños"
        >
          ＋ Bloques
        </button>
        <button
          onClick={() => {
            setSel(null);
            setSettingsOpenMobile(true);
          }}
          className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-600 md:hidden"
          title="Ajustes del correo (asunto, colores, tipografía)"
        >
          ⚙
        </button>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            touchMeta();
          }}
          disabled={readOnly}
          className="min-w-0 max-w-[240px] flex-1 rounded-lg px-2 py-1 text-sm font-semibold text-slate-800 outline-none hover:bg-slate-50 focus:bg-slate-50"
          placeholder="Nombre de la plantilla"
        />
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          {(
            [
              ['desktop', '🖥️', 'Vista escritorio'],
              ['mobile', '📱', 'Vista móvil'],
            ] as const
          ).map(([k, icon, title]) => (
            <button
              key={k}
              onClick={() => setViewMode(k)}
              title={title}
              className="rounded-md px-2 py-1 text-sm"
              style={viewMode === k ? { background: 'white', boxShadow: '0 1px 2px rgba(0,0,0,.08)' } : {}}
            >
              {icon}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={undo}
            disabled={!canUndo || readOnly}
            title="Deshacer (Ctrl+Z)"
            className="rounded-lg px-2 py-1 text-base text-slate-500 hover:bg-slate-100 disabled:opacity-30"
          >
            ↶
          </button>
          <button
            onClick={redo}
            disabled={!canRedo || readOnly}
            title="Rehacer (Ctrl+Shift+Z)"
            className="rounded-lg px-2 py-1 text-base text-slate-500 hover:bg-slate-100 disabled:opacity-30"
          >
            ↷
          </button>
        </div>
        <span
          className={`hidden text-xs sm:inline ${saveState === 'error' ? 'font-medium text-rose-600' : 'text-slate-400'}`}
          title={saveError ?? undefined}
        >
          {saveLabel}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setPreview(true)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            👁 Previsualizar
          </button>
          {!readOnly && (
            <>
              <button
                onClick={openSend}
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
              >
                ✉️ Enviar
              </button>
              <button
                onClick={() => save(false)}
                disabled={saveState === 'saving'}
                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: ACCENT }}
              >
                {saveState === 'saving' ? 'Guardando…' : 'Guardar plantilla'}
              </button>
            </>
          )}
        </div>
      </header>

      {readOnly && (
        <div className="border-b border-sky-200 bg-sky-50 px-4 py-2 text-xs text-sky-800">
          Plantilla de fábrica: solo lectura. Desde la galería usa «Usar plantilla» para crear una copia editable.
        </div>
      )}
      {saveState === 'error' && saveError && (
        <div className="flex flex-wrap items-center gap-2 border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-800">
          <span className="flex-1">{saveError}</span>
          <button
            onClick={() => save(false)}
            className="rounded-lg bg-rose-600 px-2.5 py-1 font-semibold text-white hover:bg-rose-700"
          >
            Reintentar
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ── Barra lateral: Elementos y Diseños ── */}
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          tab={sidebarTab}
          setTab={setSidebarTab}
          onAddElement={addElement}
          onAddLayout={addLayout}
          disabled={readOnly}
        />

        {/* ── Lienzo ── */}
        <div className="min-w-0 flex-1 overflow-auto" onClick={() => setSel(null)}>
          <div
            className="mx-auto my-6 min-h-[320px] shadow-sm transition-all"
            style={{
              width: viewMode === 'desktop' ? doc.settings.contentWidth : 375,
              maxWidth: 'calc(100% - 16px)',
              background: doc.settings.contentBackground,
              fontFamily: doc.settings.fontFamily,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {doc.rows.length === 0 ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center gap-2 p-8 text-center text-sm text-slate-400">
                <span className="text-3xl">✉️</span>
                <p>El correo está vacío.</p>
                <p className="text-xs">
                  Añade un <b>diseño</b> o un <b>elemento</b> desde el panel de la izquierda
                  <span className="md:hidden"> (botón «＋ Bloques»)</span>.
                </p>
              </div>
            ) : (
              doc.rows.map((row) => (
                <CanvasRow
                  key={row.id}
                  row={row}
                  settings={doc.settings}
                  sel={sel}
                  viewMode={viewMode}
                  readOnly={readOnly}
                  onSelectCol={(colId) => setSel({ rowId: row.id, colId, blockId: null })}
                  onSelectBlock={(colId, blockId) => setSel({ rowId: row.id, colId, blockId })}
                  onMoveRow={(dir) => moveRow(row.id, dir)}
                  onDupRow={() => duplicateRow(row.id)}
                  onDelRow={() => deleteRow(row.id)}
                  onMoveBlock={moveBlock}
                  onDupBlock={duplicateBlock}
                  onDelBlock={deleteBlock}
                />
              ))
            )}
          </div>
        </div>

        {/* ── Panel de propiedades: lateral en escritorio, hoja inferior en móvil ── */}
        <div
          className={`${
            sel || settingsOpenMobile
              ? 'fixed inset-x-0 bottom-0 z-50 max-h-[60vh] overflow-y-auto rounded-t-2xl border-t border-slate-200 bg-white shadow-2xl'
              : 'hidden'
          } md:static md:z-auto md:block md:max-h-none md:w-[300px] md:shrink-0 md:overflow-y-auto md:rounded-none md:border-l md:border-t-0 md:shadow-none md:bg-white`}
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2 md:hidden">
            <span className="text-xs font-semibold text-slate-500">Propiedades</span>
            <button
              onClick={() => {
                setSel(null);
                setSettingsOpenMobile(false);
              }}
              className="rounded px-2 py-0.5 text-slate-400 hover:bg-slate-100"
            >
              ✕
            </button>
          </div>
          <div className="space-y-4 p-4">
            {selBlock ? (
              <BlockProps
                key={`${selBlock.id}:${histVersion}`}
                block={selBlock}
                readOnly={readOnly}
                onPatch={(patch, coalesce) =>
                  updateBlock(selBlock.id, patch, coalesce ? `${coalesce}:${selBlock.id}` : undefined)
                }
              />
            ) : sel && selRow ? (
              <RowProps
                key={`row:${selRow.id}:${histVersion}`}
                row={selRow}
                readOnly={readOnly}
                onPatch={(patch, coalesce) =>
                  updateRow(selRow.id, patch, coalesce ? `${coalesce}:${selRow.id}` : undefined)
                }
              />
            ) : (
              <TemplateProps
                key={`settings:${histVersion}`}
                subject={subject}
                onSubject={(v) => {
                  setSubject(v);
                  touchMeta();
                }}
                settings={doc.settings}
                readOnly={readOnly}
                onPatch={(p, coalesce) => updateSettings(p, coalesce)}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Previsualización ── */}
      {preview && (
        <PreviewModal html={previewHtml} subject={subject || name} onClose={() => setPreview(false)} />
      )}

      {/* ── Enviar a contactos ── */}
      {sendOpen && (
        <SendTemplateModal
          templateId={templateId}
          templateName={name}
          defaultSubject={subject || name}
          onClose={() => setSendOpen(false)}
        />
      )}

      {/* ── Salir con cambios sin guardar ── */}
      {exitAsk && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={() => setExitAsk(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-slate-800">Hay cambios sin guardar</h3>
            <p className="mt-2 text-sm text-slate-500">
              Si sales sin guardar, los últimos cambios de la plantilla se pierden.
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button onClick={() => setExitAsk(false)} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">
                Cancelar
              </button>
              <button
                onClick={() => {
                  setExitAsk(false);
                  onClose();
                }}
                className="rounded-lg border border-rose-300 px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50"
              >
                Salir sin guardar
              </button>
              <button
                onClick={async () => {
                  const ok = await save(false);
                  if (ok) {
                    setExitAsk(false);
                    onClose();
                  }
                }}
                className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white"
                style={{ background: ACCENT }}
              >
                Guardar y salir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Barra lateral ───────────────────────────────────────────────────────────
function Sidebar({
  open,
  onClose,
  tab,
  setTab,
  onAddElement,
  onAddLayout,
  disabled,
}: {
  open: boolean;
  onClose: () => void;
  tab: 'elementos' | 'disenos';
  setTab: (t: 'elementos' | 'disenos') => void;
  onAddElement: (t: EmailBlockType) => void;
  onAddLayout: (widths: number[]) => void;
  disabled: boolean;
}) {
  const content = (
    <>
      <div className="flex gap-1 border-b border-slate-100 p-2">
        {(
          [
            ['elementos', 'Elementos'],
            ['disenos', 'Diseños'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold ${
              tab === k ? 'bg-emerald-50 text-emerald-700' : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {tab === 'elementos' ? (
          <div className="grid grid-cols-2 gap-2">
            {ELEMENT_ORDER.map((t) => (
              <button
                key={t}
                onClick={() => onAddElement(t)}
                disabled={disabled}
                className="flex flex-col items-center gap-1 rounded-xl border border-slate-200 bg-white px-2 py-3 text-center hover:border-emerald-300 hover:bg-emerald-50/40 disabled:opacity-40"
                title={`Añadir ${BLOCK_META[t].label.toLowerCase()}`}
              >
                <span className="text-xl leading-none">{BLOCK_META[t].icon}</span>
                <span className="text-[11px] font-medium text-slate-600">{BLOCK_META[t].label}</span>
              </button>
            ))}
            <p className="col-span-2 px-1 pt-1 text-[11px] leading-snug text-slate-400">
              Clic para insertar. Se añade a la columna seleccionada, o debajo del bloque activo.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {LAYOUTS.map((l) => (
              <button
                key={l.key}
                onClick={() => onAddLayout(l.widths)}
                disabled={disabled}
                className="w-full rounded-xl border border-slate-200 bg-white p-2 hover:border-emerald-300 hover:bg-emerald-50/40 disabled:opacity-40"
                title={`Añadir fila: ${l.label}`}
              >
                <span className="flex h-8 gap-1">
                  {l.widths.map((w, i) => (
                    <span key={i} className="rounded-sm bg-slate-200" style={{ flexBasis: `${w}%` }} />
                  ))}
                </span>
                <span className="mt-1 block text-[11px] font-medium text-slate-600">{l.label}</span>
              </button>
            ))}
            <p className="px-1 text-[11px] leading-snug text-slate-400">
              Cada diseño añade una fila nueva; en móvil las columnas se apilan.
            </p>
          </div>
        )}
      </div>
    </>
  );
  return (
    <>
      {/* Escritorio: columna fija */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">{content}</aside>
      {/* Móvil: cajón sobre el lienzo */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={onClose} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <span className="text-xs font-semibold text-slate-500">Añadir bloques</span>
              <button onClick={onClose} className="rounded px-2 py-0.5 text-slate-400 hover:bg-slate-100">
                ✕
              </button>
            </div>
            {content}
          </aside>
        </div>
      )}
    </>
  );
}

// ── Lienzo: fila, columnas y bloques ────────────────────────────────────────
function CanvasRow({
  row,
  settings,
  sel,
  viewMode,
  readOnly,
  onSelectCol,
  onSelectBlock,
  onMoveRow,
  onDupRow,
  onDelRow,
  onMoveBlock,
  onDupBlock,
  onDelBlock,
}: {
  row: EmailRow;
  settings: EmailDocSettings;
  sel: Sel;
  viewMode: 'desktop' | 'mobile';
  readOnly: boolean;
  onSelectCol: (colId: string) => void;
  onSelectBlock: (colId: string, blockId: string) => void;
  onMoveRow: (dir: -1 | 1) => void;
  onDupRow: () => void;
  onDelRow: () => void;
  onMoveBlock: (blockId: string, dir: -1 | 1) => void;
  onDupBlock: (blockId: string) => void;
  onDelBlock: (blockId: string) => void;
}) {
  const active = sel?.rowId === row.id;
  const rp = { ...defaultRowProps(), ...(row.props ?? {}) };
  const btn =
    'rounded bg-white/95 px-1.5 py-0.5 text-xs text-slate-600 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50';
  return (
    <div className={`group/row relative ${active ? 'outline outline-1 outline-emerald-200' : ''}`}>
      {!readOnly && (
        <div
          className={`absolute -top-3 right-2 z-10 flex gap-1 transition-opacity ${
            active ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100'
          }`}
        >
          <button onClick={() => onMoveRow(-1)} className={btn} title="Subir fila">
            ↑
          </button>
          <button onClick={() => onMoveRow(1)} className={btn} title="Bajar fila">
            ↓
          </button>
          <button onClick={onDupRow} className={btn} title="Duplicar fila">
            ⧉
          </button>
          <button onClick={onDelRow} className={`${btn} text-rose-500`} title="Eliminar fila">
            🗑
          </button>
        </div>
      )}
      <div
        className={viewMode === 'mobile' ? 'flex flex-col' : 'flex'}
        style={{
          background: rp.background || undefined,
          // El lienzo imita lo que hace el correo: en móvil el relleno lateral
          // baja a 20 px por media query, y aquí se ve igual.
          padding: `${rp.paddingV}px ${viewMode === 'mobile' ? 20 : rp.paddingH}px`,
        }}
      >
        {row.columns.map((col) => {
          const colActive = active && sel?.colId === col.id && !sel?.blockId;
          return (
            <div
              key={col.id}
              style={{ width: viewMode === 'mobile' ? '100%' : `${col.widthPct}%` }}
              className={`min-h-[44px] ${colActive ? 'bg-emerald-50/40 outline-dashed outline-1 outline-emerald-400' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelectCol(col.id);
              }}
            >
              {col.blocks.length === 0 && (
                <div className="m-2 rounded-lg border border-dashed border-slate-200 p-3 text-center text-[11px] text-slate-300">
                  Columna vacía
                </div>
              )}
              {col.blocks.map((b) => (
                <CanvasBlock
                  key={b.id}
                  block={b}
                  settings={settings}
                  selected={sel?.blockId === b.id}
                  readOnly={readOnly}
                  onSelect={() => onSelectBlock(col.id, b.id)}
                  onMove={(dir) => onMoveBlock(b.id, dir)}
                  onDup={() => onDupBlock(b.id)}
                  onDel={() => onDelBlock(b.id)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CanvasBlock({
  block,
  settings,
  selected,
  readOnly,
  onSelect,
  onMove,
  onDup,
  onDel,
}: {
  block: EmailBlock;
  settings: EmailDocSettings;
  selected: boolean;
  readOnly: boolean;
  onSelect: () => void;
  onMove: (dir: -1 | 1) => void;
  onDup: () => void;
  onDel: () => void;
}) {
  const btn =
    'rounded bg-white px-1.5 py-0.5 text-xs text-slate-600 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50';
  return (
    <div
      className={`group/block relative cursor-pointer ${
        selected ? 'ring-2 ring-inset ring-emerald-400' : 'hover:ring-1 hover:ring-inset hover:ring-slate-200'
      }`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      {selected && !readOnly && (
        <div className="absolute -top-3 right-1 z-10 flex items-center gap-1">
          <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm">
            {BLOCK_META[block.type].label}
          </span>
          <button onClick={(e) => { e.stopPropagation(); onMove(-1); }} className={btn} title="Subir">
            ↑
          </button>
          <button onClick={(e) => { e.stopPropagation(); onMove(1); }} className={btn} title="Bajar">
            ↓
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDup(); }} className={btn} title="Duplicar">
            ⧉
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDel(); }} className={`${btn} text-rose-500`} title="Eliminar">
            🗑
          </button>
        </div>
      )}
      <BlockVisual block={block} settings={settings} />
    </div>
  );
}

// Aproximación visual de cada bloque en el lienzo. Puede usar divs porque es
// nuestra UI — el HTML del correo real sale de renderEmailHtml().
function BlockVisual({ block, settings }: { block: EmailBlock; settings: EmailDocSettings }) {
  const p = block.props ?? {};
  const T = EMAIL_TOKENS;
  const acento = settings.linkColor || T.color.acento;
  // El relleno LATERAL lo pone la fila (igual que en el correo); aquí solo va
  // el ritmo vertical, para que el lienzo y el HTML final coincidan.
  const box = (bottom: number = T.espacio.s, extra: React.CSSProperties = {}): React.CSSProperties => ({
    padding: `0 0 ${bottom}px 0`,
    fontFamily: settings.fontFamily,
    ...extra,
  });
  const vacio = (icono: string, texto: string) => (
    <div className="my-2 rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">
      {icono} {texto}
    </div>
  );
  const btnChip = (label: string, outline = false) => (
    <span
      style={{
        display: 'inline-block',
        padding: `${Number(p.paddingV) || 14}px ${Number(p.paddingH) || 32}px`,
        background: outline ? '#fff' : p.background || acento,
        border: outline ? `2px solid ${p.background || acento}` : undefined,
        color: outline ? p.background || acento : p.color || '#ffffff',
        fontSize: Number(p.fontSize) || T.texto.body.size,
        fontWeight: 700,
        lineHeight: 1.2,
        borderRadius: Number(p.radius) || 0,
      }}
    >
      {label || 'Botón'}
    </span>
  );
  const estrellas = (n: number, color: string, size: number) => {
    const llenas = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
    return (
      <span style={{ fontSize: size, letterSpacing: 2, lineHeight: 1.2 }}>
        <span style={{ color }}>{'★'.repeat(llenas)}</span>
        <span style={{ color: T.color.borde }}>{'★'.repeat(5 - llenas)}</span>
      </span>
    );
  };

  switch (block.type) {
    case 'heading': {
      const isH1 = p.level === 'h1';
      return (
        <div style={box(T.espacio.s, { textAlign: (p.align || 'left') as any })}>
          {p.kicker ? (
            <div
              style={{
                fontSize: T.texto.small.size,
                fontWeight: 700,
                letterSpacing: 1.5,
                textTransform: 'uppercase',
                color: p.kickerColor || acento,
                paddingBottom: 8,
              }}
            >
              {p.kicker}
            </div>
          ) : null}
          <div
            style={{
              fontSize: isH1 ? T.texto.h1.size : T.texto.h2.size,
              lineHeight: `${isH1 ? T.texto.h1.line : T.texto.h2.line}px`,
              fontWeight: 700,
              color: p.color || settings.textColor,
              overflowWrap: 'anywhere',
            }}
          >
            {p.title || <span style={{ opacity: 0.4 }}>Título vacío</span>}
          </div>
          {p.subtitle ? (
            <div
              style={{
                fontSize: T.texto.body.size,
                lineHeight: `${T.texto.body.line}px`,
                color: T.color.tintaSuave,
                paddingTop: 10,
              }}
            >
              {p.subtitle}
            </div>
          ) : null}
        </div>
      );
    }
    case 'text':
      return (
        <div
          style={box(T.espacio.s, {
            fontSize: Number(p.fontSize) || T.texto.body.size,
            lineHeight: 1.6,
            color: p.color || settings.textColor,
            textAlign: (p.align || 'left') as any,
            overflowWrap: 'anywhere',
          })}
          dangerouslySetInnerHTML={{ __html: p.html || '<span style="opacity:.4">Texto vacío</span>' }}
        />
      );
    case 'image':
    case 'logo': {
      const url = String(p.url || '').trim();
      if (!url) {
        return (
          <div className="my-2 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-400">
            🖼️ {block.type === 'logo' ? 'Logotipo' : 'Imagen'}: súbela desde el panel de propiedades
          </div>
        );
      }
      const w = p.width ? Number(p.width) : null;
      return (
        <div style={box(T.espacio.s, { textAlign: (p.align || 'center') as any })}>
          <img
            src={url}
            alt={p.alt || ''}
            style={{
              display: 'inline-block',
              width: w ? `${w}px` : '100%',
              maxWidth: '100%',
              height: 'auto',
              borderRadius: Number(p.radius) || 0,
            }}
          />
        </div>
      );
    }
    case 'button':
      return (
        <div style={box(T.espacio.m, { paddingTop: 8, textAlign: (p.align || 'center') as any })}>
          {btnChip(p.label)}
        </div>
      );
    case 'buttons':
      return (
        <div
          style={box(T.espacio.m, {
            paddingTop: 8,
            textAlign: (p.align || 'center') as any,
            display: 'flex',
            gap: 12,
            justifyContent: p.align === 'left' ? 'flex-start' : p.align === 'right' ? 'flex-end' : 'center',
            flexWrap: 'wrap',
          })}
        >
          {btnChip(p.label)}
          {btnChip(p.label2, true)}
        </div>
      );
    case 'feature': {
      const stacked = p.layout === 'stacked';
      const chip = (
        <span
          style={{
            display: 'inline-block',
            width: 44,
            height: 44,
            lineHeight: '44px',
            textAlign: 'center',
            borderRadius: 22,
            background: p.iconBg || acento,
            color: p.iconColor || '#fff',
            fontSize: 20,
            flex: '0 0 auto',
          }}
        >
          {p.icon || '•'}
        </span>
      );
      const cuerpo = (
        <div>
          <div style={{ fontSize: 17, lineHeight: '24px', fontWeight: 700, color: settings.textColor }}>
            {p.title || <span style={{ opacity: 0.4 }}>Sin título</span>}
          </div>
          {p.text ? (
            <div style={{ fontSize: T.texto.body.size - 1, lineHeight: '24px', color: T.color.tintaSuave, paddingTop: 4 }}>
              {p.text}
            </div>
          ) : null}
        </div>
      );
      if (stacked) {
        return (
          <div style={box(T.espacio.s, { textAlign: (p.align || 'center') as any })}>
            {chip}
            <div style={{ height: 12 }} />
            {cuerpo}
          </div>
        );
      }
      return (
        <div style={box(T.espacio.s, { display: 'flex', gap: 14, alignItems: 'flex-start' })}>
          {chip}
          {cuerpo}
        </div>
      );
    }
    case 'product': {
      const url = String(p.url || '').trim();
      const radius = Number(p.radius) || 0;
      return (
        <div style={box(T.espacio.s)}>
          <div
            style={{
              background: p.background || '#fff',
              border: `1px solid ${p.borderColor || T.color.borde}`,
              borderRadius: radius,
              overflow: 'hidden',
            }}
          >
            {url ? (
              <img src={url} alt={p.alt || ''} style={{ display: 'block', width: '100%', height: 'auto' }} />
            ) : (
              <div className="border-b border-dashed border-slate-200 bg-slate-50 p-5 text-center text-xs text-slate-400">
                🖼️ Foto del producto (opcional)
              </div>
            )}
            <div style={{ padding: '18px 20px 20px' }}>
              <div style={{ fontSize: 17, lineHeight: '24px', fontWeight: 700, color: settings.textColor }}>
                {p.title || 'Sin nombre'}
              </div>
              {p.description ? (
                <div style={{ fontSize: 15, lineHeight: '23px', color: T.color.tintaSuave, paddingTop: 6 }}>
                  {p.description}
                </div>
              ) : null}
              {p.price ? (
                <div style={{ fontSize: 20, lineHeight: '28px', fontWeight: 700, color: settings.textColor, paddingTop: 8 }}>
                  {p.price}
                  {p.oldPrice ? (
                    <span style={{ fontSize: 15, fontWeight: 400, color: T.color.tintaSuave, textDecoration: 'line-through', marginLeft: 8 }}>
                      {p.oldPrice}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {p.label ? (
                <div style={{ paddingTop: 14 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '11px 24px',
                      background: acento,
                      color: '#fff',
                      fontSize: 15,
                      fontWeight: 700,
                      borderRadius: T.radio,
                    }}
                  >
                    {p.label}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      );
    }
    case 'order': {
      const items: any[] = Array.isArray(p.items) ? p.items : [];
      const totals: any[] = Array.isArray(p.totals) ? p.totals : [];
      if (!items.length && !totals.length) return vacio('🧾', 'Añade líneas al pedido desde propiedades');
      return (
        <div style={box(T.espacio.m)}>
          {p.title ? (
            <div style={{ fontSize: T.texto.h2.size, lineHeight: `${T.texto.h2.line}px`, fontWeight: 700, color: settings.textColor, paddingBottom: 6 }}>
              {p.title}
            </div>
          ) : null}
          {items.map((it, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                padding: '12px 0',
                borderBottom: `1px solid ${T.color.borde}`,
                fontSize: 15,
                color: settings.textColor,
              }}
            >
              <span>
                {it?.name || '—'}
                {it?.qty ? <span style={{ color: T.color.tintaSuave }}> × {it.qty}</span> : null}
              </span>
              <span style={{ whiteSpace: 'nowrap' }}>{it?.price || ''}</span>
            </div>
          ))}
          {totals.map((t, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                paddingTop: 8,
                fontSize: t?.strong ? 17 : 15,
                fontWeight: t?.strong ? 700 : 400,
                color: t?.strong ? settings.textColor : T.color.tintaSuave,
              }}
            >
              <span>{t?.label || ''}</span>
              <span style={{ whiteSpace: 'nowrap' }}>{t?.value || ''}</span>
            </div>
          ))}
          {p.note ? (
            <div style={{ fontSize: T.texto.small.size, color: T.color.tintaSuave, paddingTop: 12 }}>{p.note}</div>
          ) : null}
        </div>
      );
    }
    case 'quote':
      return (
        <div style={box(T.espacio.s)}>
          <div
            style={{
              background: p.background || T.color.acentoSuave,
              borderLeft: `4px solid ${p.accent || acento}`,
              borderRadius: T.radio,
              padding: '18px 22px',
            }}
          >
            {Number(p.stars) > 0 ? <div style={{ paddingBottom: 8 }}>{estrellas(p.stars, '#f59e0b', 16)}</div> : null}
            <div style={{ fontSize: T.texto.body.size, lineHeight: `${T.texto.body.line}px`, color: settings.textColor, fontStyle: 'italic' }}>
              «{p.text || ''}»
            </div>
            <div style={{ fontSize: T.texto.small.size, color: T.color.tintaSuave, paddingTop: 10 }}>
              {p.author || ''}
              {p.role ? ` · ${p.role}` : ''}
            </div>
          </div>
        </div>
      );
    case 'rating':
      return (
        <div style={box(T.espacio.s, { textAlign: (p.align || 'center') as any })}>
          {estrellas(p.stars, p.color || '#f59e0b', Number(p.size) || 22)}
          {p.label ? (
            <div style={{ fontSize: T.texto.small.size, color: T.color.tintaSuave, paddingTop: 6 }}>{p.label}</div>
          ) : null}
        </div>
      );
    case 'coupon':
      return (
        <div style={box(T.espacio.m, { paddingTop: 4, textAlign: 'center' })}>
          <span
            style={{
              display: 'inline-block',
              background: p.background || T.color.acentoSuave,
              border: `2px dashed ${p.borderColor || acento}`,
              borderRadius: T.radio,
              padding: '16px 30px',
            }}
          >
            {p.label ? (
              <div style={{ fontSize: T.texto.small.size, color: T.color.tintaSuave, paddingBottom: 6 }}>{p.label}</div>
            ) : null}
            <div style={{ fontSize: 24, lineHeight: '30px', fontWeight: 700, letterSpacing: 3, color: p.color || acento }}>
              {p.code || 'CODIGO'}
            </div>
            {p.note ? (
              <div style={{ fontSize: T.texto.small.size, color: T.color.tintaSuave, paddingTop: 8 }}>{p.note}</div>
            ) : null}
          </span>
        </div>
      );
    case 'divider':
      return (
        <div style={{ padding: `${Number(p.paddingV) || 12}px 0` }}>
          <div style={{ borderTop: `${Number(p.thickness) || 1}px solid ${p.color || T.color.borde}` }} />
        </div>
      );
    case 'spacer':
      return (
        <div
          style={{ height: Number(p.height) || T.espacio.m }}
          className="flex items-center justify-center text-[10px] text-slate-300"
          title={`Espaciador · ${Number(p.height) || T.espacio.m}px`}
        />
      );
    case 'social': {
      const size = Number(p.size) || 34;
      const nets = (Array.isArray(p.networks) ? p.networks : []).filter((n: any) => n);
      if (nets.length === 0) return vacio('🌐', 'Añade redes desde el panel de propiedades');
      return (
        <div style={box(T.espacio.s, { textAlign: (p.align || 'center') as any })}>
          {nets.map((n: any, i: number) => {
            const meta = SOCIAL_NETWORKS[n.kind as SocialNetworkKind] ?? SOCIAL_NETWORKS.web;
            return (
              <span
                key={i}
                title={meta.label + (n.url ? '' : ' (sin URL: no saldrá en el correo)')}
                style={{
                  display: 'inline-block',
                  width: size,
                  height: size,
                  lineHeight: `${size}px`,
                  margin: '0 5px',
                  background: meta.color,
                  borderRadius: '50%',
                  color: '#fff',
                  fontSize: Math.round(size * 0.38),
                  fontWeight: 700,
                  textAlign: 'center',
                  opacity: n.url ? 1 : 0.35,
                }}
              >
                {meta.abbr}
              </span>
            );
          })}
        </div>
      );
    }
    case 'footer':
      return (
        <div
          style={{
            padding: `${T.espacio.m}px 0 8px 0`,
            fontFamily: settings.fontFamily,
            fontSize: Number(p.fontSize) || T.texto.small.size,
            lineHeight: 1.6,
            color: p.color || T.color.tintaSuave,
            textAlign: 'center',
            overflowWrap: 'anywhere',
          }}
        >
          <span dangerouslySetInnerHTML={{ __html: p.html || '<span style="opacity:.5">Pie de página vacío</span>' }} />
          {p.address ? <div style={{ paddingTop: 8 }}>{p.address}</div> : null}
          {p.unsubscribeUrl ? (
            <div style={{ paddingTop: 8, textDecoration: 'underline' }}>{p.unsubscribeLabel || 'Darme de baja'}</div>
          ) : null}
        </div>
      );
    case 'html':
      return p.html ? (
        <div style={{ overflow: 'hidden' }} dangerouslySetInnerHTML={{ __html: p.html }} />
      ) : (
        vacio('＜＞', 'Bloque de código vacío')
      );
    default:
      return null;
  }
}
// ── Panel de propiedades ────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className={lbl}>{label}</span>
      {children}
    </div>
  );
}

function ColorInput({
  value,
  onChange,
  allowEmpty,
  emptyHint,
}: {
  value: string;
  onChange: (v: string) => void;
  allowEmpty?: boolean;
  emptyHint?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-10 cursor-pointer rounded border border-slate-300"
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={allowEmpty ? emptyHint || 'Automático' : '#000000'}
        className={`${inp} font-mono text-xs`}
      />
      {allowEmpty && value && (
        <button
          onClick={() => onChange('')}
          className="rounded px-1.5 py-1 text-xs text-slate-400 hover:bg-slate-100"
          title={emptyHint || 'Usar el color automático'}
        >
          ↺
        </button>
      )}
    </div>
  );
}

function AlignPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1">
      {(
        [
          ['left', '⬅', 'Izquierda'],
          ['center', '⏺', 'Centro'],
          ['right', '➡', 'Derecha'],
        ] as const
      ).map(([k, icon, title]) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          title={title}
          className={`flex-1 rounded-lg border px-2 py-1 text-sm ${
            value === k ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
          }`}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}

function NumInput({
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isFinite(v)) return;
          onChange(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v)));
        }}
        className={inp}
      />
      {suffix && <span className="text-xs text-slate-400">{suffix}</span>}
    </div>
  );
}

// Editor de texto enriquecido mínimo (negrita/cursiva/subrayado/enlace) sobre
// contentEditable + execCommand. execCommand está "deprecado" pero sigue
// funcionando en todos los navegadores y es la única vía sin meter una
// dependencia de editor completa para un caso tan chico. NO controlado: el
// HTML solo se pinta al montar (por eso el padre lo re-monta tras undo/redo).
function RichTextArea({
  initialHtml,
  onChange,
  minHeight = 90,
  disabled,
}: {
  initialHtml: string;
  onChange: (html: string) => void;
  minHeight?: number;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = initialHtml || '';
    // Solo al montar: si se re-pintara en cada cambio, el cursor saltaría al
    // inicio con cada tecla.
  }, []);

  function emit() {
    if (ref.current) onChange(ref.current.innerHTML);
  }
  function exec(cmd: string, val?: string) {
    document.execCommand(cmd, false, val);
    emit();
  }
  // preventDefault en mousedown: si el botón roba el foco, se pierde la
  // selección del contentEditable y el comando no aplica a nada.
  const keep = (e: React.MouseEvent) => e.preventDefault();

  function openLink(e: React.MouseEvent) {
    e.preventDefault();
    const s = window.getSelection();
    if (s && s.rangeCount > 0) savedRange.current = s.getRangeAt(0).cloneRange();
    setLinkOpen(true);
  }
  function applyLink() {
    const url = linkUrl.trim();
    if (!url) return;
    const s = window.getSelection();
    if (savedRange.current && s) {
      s.removeAllRanges();
      s.addRange(savedRange.current);
    }
    exec('createLink', /^https?:\/\//i.test(url) ? url : `https://${url}`);
    setLinkOpen(false);
    setLinkUrl('');
  }

  const tb = 'rounded px-2 py-0.5 text-xs font-semibold text-slate-600 hover:bg-slate-100';
  return (
    <div className="rounded-lg border border-slate-300">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-100 px-1 py-1">
        <button onMouseDown={keep} onClick={() => exec('bold')} className={tb} title="Negrita">
          B
        </button>
        <button onMouseDown={keep} onClick={() => exec('italic')} className={`${tb} italic`} title="Cursiva">
          I
        </button>
        <button onMouseDown={keep} onClick={() => exec('underline')} className={`${tb} underline`} title="Subrayado">
          U
        </button>
        <button onMouseDown={keep} onClick={openLink} className={tb} title="Convertir la selección en enlace">
          🔗
        </button>
        <button onMouseDown={keep} onClick={() => exec('unlink')} className={tb} title="Quitar enlace">
          ⛓️‍💥
        </button>
        <button
          onMouseDown={keep}
          onClick={() => {
            exec('removeFormat');
            exec('unlink');
          }}
          className={tb}
          title="Limpiar formato"
        >
          ⌫
        </button>
      </div>
      {linkOpen && (
        <div className="flex items-center gap-1 border-b border-slate-100 px-2 py-1.5">
          <input
            autoFocus
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyLink();
              if (e.key === 'Escape') setLinkOpen(false);
            }}
            placeholder="https://…"
            className="w-full rounded border border-slate-200 px-2 py-1 text-xs outline-none focus:border-emerald-400"
          />
          <button onClick={applyLink} className="rounded bg-emerald-600 px-2 py-1 text-xs font-semibold text-white">
            Aplicar
          </button>
        </div>
      )}
      <div
        ref={ref}
        contentEditable={!disabled}
        onInput={emit}
        onBlur={emit}
        className="prose-sm max-w-none px-3 py-2 text-sm text-slate-700 outline-none"
        style={{ minHeight }}
      />
    </div>
  );
}

// Origen de una imagen: subir a S3 (queda la URL) o pegar una URL externa.
// Un data:image se rechaza acá mismo, con explicación — el backend devolvería
// 400 igual, pero este mensaje dice QUÉ hacer en su lugar.
function ImageSource({
  url,
  onUrl,
  disabled,
}: {
  url: string;
  onUrl: (u: string) => void;
  disabled?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      toast('Solo imágenes (JPG, PNG, WebP, GIF).', 'error');
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast('La imagen no puede pesar más de 10 MB.', 'error');
      return;
    }
    setUploading(true);
    try {
      const u = await uploadEmailImage(f);
      onUrl(u);
      toast('Imagen subida ✓', 'success');
    } catch (err: any) {
      toast(err?.message || 'No se pudo subir la imagen.', 'error');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading || disabled}
        className="w-full rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
      >
        {uploading ? 'Subiendo…' : '⇪ Subir imagen'}
      </button>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
      <Field label="O pega una URL">
        <input
          value={url}
          onChange={(e) => {
            const v = e.target.value;
            if (/^\s*data:/i.test(v)) {
              toast(
                'Las imágenes incrustadas (data:image) no se aceptan: usa «Subir imagen» para obtener una URL.',
                'error',
              );
              return;
            }
            onUrl(v);
          }}
          disabled={disabled}
          placeholder="https://…"
          className={`${inp} font-mono text-xs`}
        />
      </Field>
    </div>
  );
}

/**
 * Propiedades de la FILA (banda). Aquí viven el fondo de color y el relleno,
 * que es lo que convierte una fila normal en una cabecera de marca o en una
 * sección destacada sin tocar HTML.
 */
function RowProps({
  row,
  readOnly,
  onPatch,
}: {
  row: EmailRow;
  readOnly: boolean;
  onPatch: (patch: Partial<EmailRowProps>, coalesce?: string) => void;
}) {
  const rp = { ...defaultRowProps(), ...(row.props ?? {}) };
  const bandas: { label: string; value: string }[] = [
    { label: 'Sin fondo', value: '' },
    { label: 'Acento', value: EMAIL_TOKENS.color.acento },
    { label: 'Acento suave', value: EMAIL_TOKENS.color.acentoSuave },
    { label: 'Gris claro', value: EMAIL_TOKENS.color.fondo },
    { label: 'Tinta', value: EMAIL_TOKENS.color.tinta },
  ];
  return (
    <div className="space-y-4">
      <h4 className="text-sm font-semibold text-slate-800">▭ Fila (banda)</h4>
      <Field label="Fondo de la banda">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {bandas.map((b) => (
            <button
              key={b.label}
              onClick={() => onPatch({ background: b.value })}
              disabled={readOnly}
              title={b.label}
              className={`h-7 w-7 rounded-md border ${
                rp.background === b.value ? 'border-emerald-500 ring-2 ring-emerald-200' : 'border-slate-200'
              }`}
              style={
                b.value
                  ? { background: b.value }
                  : {
                      backgroundImage:
                        'linear-gradient(45deg,#e2e8f0 25%,transparent 25%,transparent 75%,#e2e8f0 75%)',
                      backgroundSize: '8px 8px',
                    }
              }
            />
          ))}
        </div>
        <ColorInput
          value={rp.background}
          allowEmpty
          emptyHint="Sin fondo"
          onChange={(v) => onPatch({ background: v }, 'rowbg')}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Espacio arriba/abajo">
          <NumInput value={rp.paddingV} min={0} max={120} suffix="px" onChange={(v) => onPatch({ paddingV: v }, 'rowpv')} />
        </Field>
        <Field label="Espacio a los lados">
          <NumInput value={rp.paddingH} min={0} max={60} suffix="px" onChange={(v) => onPatch({ paddingH: v }, 'rowph')} />
        </Field>
      </div>
      <p className="text-[11px] leading-snug text-slate-400">
        Con fondo de color, acuérdate de poner los textos de esta fila en blanco. En el móvil el
        espacio lateral baja a 20 px automáticamente.
      </p>
      <p className="text-[11px] leading-snug text-slate-400">
        Los elementos nuevos del panel izquierdo entran en la columna seleccionada.
      </p>
    </div>
  );
}

function TemplateProps({
  subject,
  onSubject,
  settings,
  readOnly,
  onPatch,
}: {
  subject: string;
  onSubject: (v: string) => void;
  settings: EmailDocSettings;
  readOnly: boolean;
  onPatch: (p: Partial<EmailDocSettings>, coalesce?: string) => void;
}) {
  return (
    <div className="space-y-4">
      <h4 className="text-sm font-semibold text-slate-800">Ajustes del correo</h4>
      <Field label="Asunto por defecto">
        <input
          value={subject}
          onChange={(e) => onSubject(e.target.value)}
          disabled={readOnly}
          placeholder="Asunto del correo"
          className={inp}
        />
      </Field>
      <Field label="Texto de vista previa (preheader)">
        <input
          value={settings.preheader ?? ''}
          onChange={(e) => onPatch({ preheader: e.target.value }, 'set:pre')}
          disabled={readOnly}
          maxLength={140}
          placeholder="Lo que se lee junto al asunto en la bandeja"
          className={inp}
        />
        <p className="mt-1 text-[11px] leading-snug text-slate-400">
          Va oculto dentro del correo. Entre 40 y 90 caracteres: si lo dejas vacío, el cliente de
          correo enseña las primeras palabras del cuerpo, que casi nunca es lo que quieres.
        </p>
      </Field>
      <Field label="Tipografía">
        <select
          value={settings.fontFamily}
          onChange={(e) => onPatch({ fontFamily: e.target.value })}
          disabled={readOnly}
          className={inp}
        >
          {FONT_STACKS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
          {!FONT_STACKS.some((f) => f.value === settings.fontFamily) && (
            <option value={settings.fontFamily}>Personalizada</option>
          )}
        </select>
      </Field>
      <Field label="Ancho del contenido (px)">
        <NumInput
          value={settings.contentWidth}
          min={480}
          max={700}
          onChange={(v) => onPatch({ contentWidth: v }, 'set:width')}
          suffix="px"
        />
      </Field>
      <Field label="Fondo exterior">
        <ColorInput value={settings.backgroundColor} onChange={(v) => onPatch({ backgroundColor: v }, 'set:bg')} />
      </Field>
      <Field label="Fondo del contenido">
        <ColorInput
          value={settings.contentBackground}
          onChange={(v) => onPatch({ contentBackground: v }, 'set:cbg')}
        />
      </Field>
      <Field label="Color del texto">
        <ColorInput value={settings.textColor} onChange={(v) => onPatch({ textColor: v }, 'set:tc')} />
      </Field>
      <Field label="Color de acento">
        <ColorInput value={settings.linkColor} onChange={(v) => onPatch({ linkColor: v }, 'set:lc')} />
        <p className="mt-1 text-[11px] leading-snug text-slate-400">
          Botones, antetítulos, iconos y cupones lo heredan. Cámbialo aquí y la plantilla entera se
          repinta con el color de tu marca.
        </p>
      </Field>
      <p className="text-[11px] leading-snug text-slate-400">
        Haz clic en un bloque del lienzo para editar sus propiedades, o en una columna para elegir dónde
        entran los elementos nuevos.
      </p>
    </div>
  );
}

function BlockProps({
  block,
  readOnly,
  onPatch,
}: {
  block: EmailBlock;
  readOnly: boolean;
  onPatch: (patch: Record<string, any>, coalesce?: string) => void;
}) {
  const p = block.props ?? {};
  const title = (
    <h4 className="text-sm font-semibold text-slate-800">
      {BLOCK_META[block.type].icon} {BLOCK_META[block.type].label}
    </h4>
  );
  switch (block.type) {
    case 'heading':
      return (
        <div className="space-y-3">
          {title}
          <Field label="Antetítulo (opcional)">
            <input
              value={p.kicker || ''}
              onChange={(e) => onPatch({ kicker: e.target.value }, 'kicker')}
              disabled={readOnly}
              className={inp}
              placeholder="POR TIEMPO LIMITADO"
            />
          </Field>
          <Field label="Título">
            <textarea
              value={p.title || ''}
              onChange={(e) => onPatch({ title: e.target.value }, 'title')}
              disabled={readOnly}
              rows={2}
              className={inp}
            />
          </Field>
          <Field label="Bajada (opcional)">
            <textarea
              value={p.subtitle || ''}
              onChange={(e) => onPatch({ subtitle: e.target.value }, 'sub')}
              disabled={readOnly}
              rows={2}
              className={inp}
            />
          </Field>
          <Field label="Jerarquía">
            <select
              value={p.level || 'h2'}
              onChange={(e) => onPatch({ level: e.target.value })}
              disabled={readOnly}
              className={inp}
            >
              <option value="h1">Principal (30 px)</option>
              <option value="h2">De sección (22 px)</option>
            </select>
          </Field>
          <Field label="Alineación">
            <AlignPicker value={p.align || 'left'} onChange={(v) => onPatch({ align: v })} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Color del título">
              <ColorInput value={p.color || ''} allowEmpty emptyHint="Heredar" onChange={(v) => onPatch({ color: v }, 'color')} />
            </Field>
            <Field label="Color del antetítulo">
              <ColorInput value={p.kickerColor || ''} allowEmpty emptyHint="Acento" onChange={(v) => onPatch({ kickerColor: v }, 'kc')} />
            </Field>
          </div>
          <p className="text-[11px] leading-snug text-slate-400">
            Sobre una banda de color, pon los dos colores en blanco.
          </p>
        </div>
      );
    case 'buttons':
      return (
        <div className="space-y-3">
          {title}
          <Field label="Botón principal">
            <input value={p.label || ''} onChange={(e) => onPatch({ label: e.target.value }, 'label')} disabled={readOnly} className={inp} />
          </Field>
          <Field label="Enlace del principal">
            <input value={p.href || ''} onChange={(e) => onPatch({ href: e.target.value }, 'href')} disabled={readOnly} className={`${inp} font-mono text-xs`} placeholder="https://…" />
          </Field>
          <Field label="Botón secundario (contorno)">
            <input value={p.label2 || ''} onChange={(e) => onPatch({ label2: e.target.value }, 'label2')} disabled={readOnly} className={inp} />
          </Field>
          <Field label="Enlace del secundario">
            <input value={p.href2 || ''} onChange={(e) => onPatch({ href2: e.target.value }, 'href2')} disabled={readOnly} className={`${inp} font-mono text-xs`} placeholder="https://…" />
          </Field>
          <Field label="Color (vacío = acento)">
            <ColorInput value={p.background || ''} allowEmpty emptyHint="Acento" onChange={(v) => onPatch({ background: v }, 'bg')} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Esquinas">
              <NumInput value={Number(p.radius) || 0} min={0} max={40} onChange={(v) => onPatch({ radius: v }, 'r')} />
            </Field>
            <Field label="Alineación">
              <AlignPicker value={p.align || 'center'} onChange={(v) => onPatch({ align: v })} />
            </Field>
          </div>
          <p className="text-[11px] leading-snug text-slate-400">En el móvil se apilan uno debajo del otro.</p>
        </div>
      );
    case 'feature':
      return (
        <div className="space-y-3">
          {title}
          <div className="grid grid-cols-[70px_1fr] gap-2">
            <Field label="Icono">
              <input
                value={p.icon || ''}
                onChange={(e) => onPatch({ icon: e.target.value }, 'icon')}
                disabled={readOnly}
                maxLength={2}
                className={`${inp} text-center text-lg`}
              />
            </Field>
            <Field label="Título">
              <input value={p.title || ''} onChange={(e) => onPatch({ title: e.target.value }, 'title')} disabled={readOnly} className={inp} />
            </Field>
          </div>
          <Field label="Texto">
            <textarea value={p.text || ''} onChange={(e) => onPatch({ text: e.target.value }, 'text')} disabled={readOnly} rows={3} className={inp} />
          </Field>
          <Field label="Disposición">
            <select value={p.layout || 'row'} onChange={(e) => onPatch({ layout: e.target.value })} disabled={readOnly} className={inp}>
              <option value="row">Icono al lado (1 columna ancha)</option>
              <option value="stacked">Icono arriba (tarjetas de 2 o 3)</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Fondo del icono">
              <ColorInput value={p.iconBg || ''} allowEmpty emptyHint="Acento" onChange={(v) => onPatch({ iconBg: v }, 'ibg')} />
            </Field>
            <Field label="Alineación (apilado)">
              <AlignPicker value={p.align || 'center'} onChange={(v) => onPatch({ align: v })} />
            </Field>
          </div>
          <p className="text-[11px] leading-snug text-slate-400">
            El icono es un emoji o una letra: no se bloquea como una imagen.
          </p>
        </div>
      );
    case 'product':
      return (
        <div className="space-y-3">
          {title}
          <ImageSource url={p.url || ''} disabled={readOnly} onUrl={(url) => onPatch({ url })} />
          <Field label="Texto alternativo de la foto">
            <input value={p.alt || ''} onChange={(e) => onPatch({ alt: e.target.value }, 'alt')} disabled={readOnly} className={inp} />
          </Field>
          <Field label="Nombre">
            <input value={p.title || ''} onChange={(e) => onPatch({ title: e.target.value }, 'title')} disabled={readOnly} className={inp} />
          </Field>
          <Field label="Descripción">
            <textarea value={p.description || ''} onChange={(e) => onPatch({ description: e.target.value }, 'desc')} disabled={readOnly} rows={2} className={inp} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Precio">
              <input value={p.price || ''} onChange={(e) => onPatch({ price: e.target.value }, 'price')} disabled={readOnly} className={inp} placeholder="$120.000" />
            </Field>
            <Field label="Precio anterior">
              <input value={p.oldPrice || ''} onChange={(e) => onPatch({ oldPrice: e.target.value }, 'old')} disabled={readOnly} className={inp} placeholder="$150.000" />
            </Field>
          </div>
          <Field label="Texto del botón (vacío = sin botón)">
            <input value={p.label || ''} onChange={(e) => onPatch({ label: e.target.value }, 'label')} disabled={readOnly} className={inp} />
          </Field>
          <Field label="Enlace">
            <input value={p.href || ''} onChange={(e) => onPatch({ href: e.target.value }, 'href')} disabled={readOnly} className={`${inp} font-mono text-xs`} placeholder="https://…" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Borde">
              <ColorInput value={p.borderColor || '#e5e7eb'} onChange={(v) => onPatch({ borderColor: v }, 'bc')} />
            </Field>
            <Field label="Esquinas">
              <NumInput value={Number(p.radius) || 0} min={0} max={24} suffix="px" onChange={(v) => onPatch({ radius: v }, 'r')} />
            </Field>
          </div>
        </div>
      );
    case 'order': {
      const items: any[] = Array.isArray(p.items) ? p.items : [];
      const totals: any[] = Array.isArray(p.totals) ? p.totals : [];
      const setItem = (i: number, patch: any) =>
        onPatch({ items: items.map((x, j) => (j === i ? { ...x, ...patch } : x)) }, `it${i}`);
      const setTotal = (i: number, patch: any) =>
        onPatch({ totals: totals.map((x, j) => (j === i ? { ...x, ...patch } : x)) }, `tt${i}`);
      const fila = 'rounded-lg border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-emerald-500';
      return (
        <div className="space-y-3">
          {title}
          <Field label="Encabezado">
            <input value={p.title || ''} onChange={(e) => onPatch({ title: e.target.value }, 'title')} disabled={readOnly} className={inp} />
          </Field>
          <div>
            <span className={lbl}>Líneas</span>
            <div className="space-y-1.5">
              {items.map((it, i) => (
                <div key={i} className="flex items-center gap-1">
                  <input value={it?.name || ''} onChange={(e) => setItem(i, { name: e.target.value })} disabled={readOnly} placeholder="Concepto" className={`${fila} min-w-0 flex-1`} />
                  <input value={it?.qty || ''} onChange={(e) => setItem(i, { qty: e.target.value })} disabled={readOnly} placeholder="1" className={`${fila} w-10 text-center`} />
                  <input value={it?.price || ''} onChange={(e) => setItem(i, { price: e.target.value })} disabled={readOnly} placeholder="$0" className={`${fila} w-20`} />
                  <button
                    onClick={() => onPatch({ items: items.filter((_, j) => j !== i) })}
                    disabled={readOnly}
                    className="rounded px-1.5 py-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    title="Quitar línea"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                onClick={() => onPatch({ items: [...items, { name: '', qty: '1', price: '' }] })}
                disabled={readOnly}
                className="w-full rounded-lg border border-dashed border-slate-300 px-2 py-1.5 text-xs text-slate-500 hover:border-emerald-300 hover:text-emerald-700"
              >
                + Añadir línea
              </button>
            </div>
          </div>
          <div>
            <span className={lbl}>Totales</span>
            <div className="space-y-1.5">
              {totals.map((t, i) => (
                <div key={i} className="flex items-center gap-1">
                  <input value={t?.label || ''} onChange={(e) => setTotal(i, { label: e.target.value })} disabled={readOnly} placeholder="Total" className={`${fila} min-w-0 flex-1`} />
                  <input value={t?.value || ''} onChange={(e) => setTotal(i, { value: e.target.value })} disabled={readOnly} placeholder="$0" className={`${fila} w-20`} />
                  <label className="flex items-center gap-1 text-[11px] text-slate-500" title="Resaltado">
                    <input type="checkbox" checked={!!t?.strong} onChange={(e) => setTotal(i, { strong: e.target.checked })} disabled={readOnly} />B
                  </label>
                  <button
                    onClick={() => onPatch({ totals: totals.filter((_, j) => j !== i) })}
                    disabled={readOnly}
                    className="rounded px-1.5 py-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    title="Quitar total"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                onClick={() => onPatch({ totals: [...totals, { label: '', value: '', strong: false }] })}
                disabled={readOnly}
                className="w-full rounded-lg border border-dashed border-slate-300 px-2 py-1.5 text-xs text-slate-500 hover:border-emerald-300 hover:text-emerald-700"
              >
                + Añadir total
              </button>
            </div>
          </div>
          <Field label="Nota al pie del pedido">
            <textarea value={p.note || ''} onChange={(e) => onPatch({ note: e.target.value }, 'note')} disabled={readOnly} rows={2} className={inp} />
          </Field>
        </div>
      );
    }
    case 'quote':
      return (
        <div className="space-y-3">
          {title}
          <Field label="Testimonio">
            <textarea value={p.text || ''} onChange={(e) => onPatch({ text: e.target.value }, 'text')} disabled={readOnly} rows={4} className={inp} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Quién lo dice">
              <input value={p.author || ''} onChange={(e) => onPatch({ author: e.target.value }, 'author')} disabled={readOnly} className={inp} />
            </Field>
            <Field label="Detalle">
              <input value={p.role || ''} onChange={(e) => onPatch({ role: e.target.value }, 'role')} disabled={readOnly} className={inp} placeholder="Cliente desde 2024" />
            </Field>
          </div>
          <Field label="Estrellas (0 = ninguna)">
            <NumInput value={Number(p.stars) || 0} min={0} max={5} onChange={(v) => onPatch({ stars: v }, 'stars')} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Fondo">
              <ColorInput value={p.background || '#eef2ff'} onChange={(v) => onPatch({ background: v }, 'bg')} />
            </Field>
            <Field label="Barra lateral">
              <ColorInput value={p.accent || ''} allowEmpty emptyHint="Acento" onChange={(v) => onPatch({ accent: v }, 'ac')} />
            </Field>
          </div>
        </div>
      );
    case 'rating':
      return (
        <div className="space-y-3">
          {title}
          <Field label="Estrellas llenas">
            <NumInput value={Number(p.stars) || 5} min={0} max={5} onChange={(v) => onPatch({ stars: v }, 'stars')} />
          </Field>
          <Field label="Texto debajo (opcional)">
            <input value={p.label || ''} onChange={(e) => onPatch({ label: e.target.value }, 'label')} disabled={readOnly} className={inp} placeholder="4,9 sobre 5 · 320 opiniones" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Color">
              <ColorInput value={p.color || '#f59e0b'} onChange={(v) => onPatch({ color: v }, 'color')} />
            </Field>
            <Field label="Tamaño">
              <NumInput value={Number(p.size) || 22} min={12} max={48} suffix="px" onChange={(v) => onPatch({ size: v }, 'size')} />
            </Field>
          </div>
          <Field label="Alineación">
            <AlignPicker value={p.align || 'center'} onChange={(v) => onPatch({ align: v })} />
          </Field>
        </div>
      );
    case 'coupon':
      return (
        <div className="space-y-3">
          {title}
          <Field label="Código">
            <input
              value={p.code || ''}
              onChange={(e) => onPatch({ code: e.target.value.toUpperCase() }, 'code')}
              disabled={readOnly}
              className={`${inp} font-mono tracking-widest`}
            />
          </Field>
          <Field label="Texto de arriba">
            <input value={p.label || ''} onChange={(e) => onPatch({ label: e.target.value }, 'label')} disabled={readOnly} className={inp} />
          </Field>
          <Field label="Letra pequeña">
            <input value={p.note || ''} onChange={(e) => onPatch({ note: e.target.value }, 'note')} disabled={readOnly} className={inp} placeholder="Válido hasta el 30 de septiembre" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Fondo">
              <ColorInput value={p.background || '#eef2ff'} onChange={(v) => onPatch({ background: v }, 'bg')} />
            </Field>
            <Field label="Borde y código">
              <ColorInput value={p.borderColor || ''} allowEmpty emptyHint="Acento" onChange={(v) => onPatch({ borderColor: v, color: v }, 'bc')} />
            </Field>
          </div>
        </div>
      );
    case 'text':
      return (
        <div className="space-y-3">
          {title}
          <RichTextArea
            initialHtml={p.html || ''}
            disabled={readOnly}
            onChange={(html) => onPatch({ html }, 'text')}
          />
          <Field label="Alineación">
            <AlignPicker value={p.align || 'left'} onChange={(v) => onPatch({ align: v })} />
          </Field>
          <Field label="Tamaño de letra">
            <NumInput value={Number(p.fontSize) || 15} min={10} max={48} suffix="px" onChange={(v) => onPatch({ fontSize: v }, 'fs')} />
          </Field>
          <Field label="Color (vacío = color del texto general)">
            <ColorInput value={p.color || ''} allowEmpty emptyHint="Heredar" onChange={(v) => onPatch({ color: v }, 'color')} />
          </Field>
        </div>
      );
    case 'image':
    case 'logo':
      return (
        <div className="space-y-3">
          {title}
          <ImageSource url={p.url || ''} disabled={readOnly} onUrl={(url) => onPatch({ url })} />
          <Field label="Texto alternativo">
            <input value={p.alt || ''} onChange={(e) => onPatch({ alt: e.target.value }, 'alt')} disabled={readOnly} className={inp} placeholder="Describe la imagen" />
          </Field>
          <Field label="Ancho">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={!p.width}
                  onChange={(e) => onPatch({ width: e.target.checked ? null : block.type === 'logo' ? 140 : 300 })}
                  disabled={readOnly}
                />
                Completo
              </label>
              {p.width ? (
                <NumInput value={Number(p.width)} min={24} max={700} suffix="px" onChange={(v) => onPatch({ width: v }, 'w')} />
              ) : null}
            </div>
          </Field>
          <Field label="Alineación">
            <AlignPicker value={p.align || 'center'} onChange={(v) => onPatch({ align: v })} />
          </Field>
          <Field label="Enlace al hacer clic (opcional)">
            <input value={p.href || ''} onChange={(e) => onPatch({ href: e.target.value }, 'href')} disabled={readOnly} className={`${inp} font-mono text-xs`} placeholder="https://…" />
          </Field>
          {block.type === 'image' && (
            <Field label="Esquinas redondeadas">
              <NumInput value={Number(p.radius) || 0} min={0} max={48} suffix="px" onChange={(v) => onPatch({ radius: v }, 'r')} />
            </Field>
          )}
        </div>
      );
    case 'button':
      return (
        <div className="space-y-3">
          {title}
          <Field label="Texto del botón">
            <input value={p.label || ''} onChange={(e) => onPatch({ label: e.target.value }, 'label')} disabled={readOnly} className={inp} />
          </Field>
          <Field label="Enlace">
            <input value={p.href || ''} onChange={(e) => onPatch({ href: e.target.value }, 'href')} disabled={readOnly} className={`${inp} font-mono text-xs`} placeholder="https://…" />
          </Field>
          <Field label="Color de fondo (vacío = acento)">
            <ColorInput value={p.background || ''} allowEmpty emptyHint="Acento" onChange={(v) => onPatch({ background: v }, 'bg')} />
          </Field>
          <Field label="Color del texto">
            <ColorInput value={p.color || '#ffffff'} onChange={(v) => onPatch({ color: v }, 'color')} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Tamaño de letra">
              <NumInput value={Number(p.fontSize) || 15} min={10} max={32} onChange={(v) => onPatch({ fontSize: v }, 'fs')} />
            </Field>
            <Field label="Esquinas">
              <NumInput value={Number(p.radius) || 0} min={0} max={40} onChange={(v) => onPatch({ radius: v }, 'r')} />
            </Field>
            <Field label="Alto interno">
              <NumInput value={Number(p.paddingV) || 12} min={4} max={32} onChange={(v) => onPatch({ paddingV: v }, 'pv')} />
            </Field>
            <Field label="Ancho interno">
              <NumInput value={Number(p.paddingH) || 28} min={8} max={80} onChange={(v) => onPatch({ paddingH: v }, 'ph')} />
            </Field>
          </div>
          <Field label="Alineación">
            <AlignPicker value={p.align || 'center'} onChange={(v) => onPatch({ align: v })} />
          </Field>
        </div>
      );
    case 'divider':
      return (
        <div className="space-y-3">
          {title}
          <Field label="Color">
            <ColorInput value={p.color || '#e2e8f0'} onChange={(v) => onPatch({ color: v }, 'color')} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Grosor">
              <NumInput value={Number(p.thickness) || 1} min={1} max={12} suffix="px" onChange={(v) => onPatch({ thickness: v }, 't')} />
            </Field>
            <Field label="Espacio vertical">
              <NumInput value={Number(p.paddingV) || 12} min={0} max={60} suffix="px" onChange={(v) => onPatch({ paddingV: v }, 'pv')} />
            </Field>
          </div>
        </div>
      );
    case 'spacer':
      return (
        <div className="space-y-3">
          {title}
          <Field label="Altura">
            <NumInput value={Number(p.height) || 24} min={4} max={200} suffix="px" onChange={(v) => onPatch({ height: v }, 'h')} />
          </Field>
        </div>
      );
    case 'social': {
      const nets: { kind: SocialNetworkKind; url: string }[] = Array.isArray(p.networks) ? p.networks : [];
      const setNets = (arr: { kind: SocialNetworkKind; url: string }[]) => onPatch({ networks: arr });
      return (
        <div className="space-y-3">
          {title}
          <div className="space-y-2">
            {nets.map((n, i) => (
              <div key={i} className="flex items-center gap-1">
                <select
                  value={n.kind}
                  onChange={(e) => setNets(nets.map((x, j) => (j === i ? { ...x, kind: e.target.value as SocialNetworkKind } : x)))}
                  disabled={readOnly}
                  className="w-28 rounded-lg border border-slate-300 px-1.5 py-1.5 text-xs outline-none focus:border-emerald-500"
                >
                  {Object.entries(SOCIAL_NETWORKS).map(([k, meta]) => (
                    <option key={k} value={k}>
                      {meta.label}
                    </option>
                  ))}
                </select>
                <input
                  value={n.url}
                  onChange={(e) => onPatch({ networks: nets.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) }, `net${i}`)}
                  disabled={readOnly}
                  placeholder="https://…"
                  className={`${inp} font-mono text-xs`}
                />
                <button
                  onClick={() => setNets(nets.filter((_, j) => j !== i))}
                  disabled={readOnly}
                  className="rounded px-1.5 py-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  title="Quitar"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={() => setNets([...nets, { kind: 'web', url: '' }])}
              disabled={readOnly}
              className="w-full rounded-lg border border-dashed border-slate-300 px-2 py-1.5 text-xs text-slate-500 hover:border-emerald-300 hover:text-emerald-700"
            >
              + Añadir red
            </button>
            <p className="text-[11px] text-slate-400">Las redes sin URL no salen en el correo.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Tamaño">
              <NumInput value={Number(p.size) || 34} min={20} max={60} suffix="px" onChange={(v) => onPatch({ size: v }, 'size')} />
            </Field>
            <Field label="Alineación">
              <AlignPicker value={p.align || 'center'} onChange={(v) => onPatch({ align: v })} />
            </Field>
          </div>
        </div>
      );
    }
    case 'footer':
      return (
        <div className="space-y-3">
          {title}
          <RichTextArea initialHtml={p.html || ''} disabled={readOnly} minHeight={70} onChange={(html) => onPatch({ html }, 'text')} />
          <Field label="Dirección o datos del negocio (opcional)">
            <input
              value={p.address || ''}
              onChange={(e) => onPatch({ address: e.target.value }, 'addr')}
              disabled={readOnly}
              className={inp}
              placeholder="Calle 10 #4-56, Bogotá · NIT 900.123.456"
            />
          </Field>
          <Field label="Enlace de baja (opcional)">
            <input
              value={p.unsubscribeUrl || ''}
              onChange={(e) => onPatch({ unsubscribeUrl: e.target.value }, 'unsub')}
              disabled={readOnly}
              className={`${inp} font-mono text-xs`}
              placeholder="https://…"
            />
            <p className="mt-1 text-[11px] leading-snug text-slate-400">
              Si lo dejas vacío queda la instrucción de responder BAJA, que es la que sí funciona hoy:
              esas respuestas se marcan como baja en Contactos.
            </p>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Tamaño de letra">
              <NumInput value={Number(p.fontSize) || 13} min={9} max={18} onChange={(v) => onPatch({ fontSize: v }, 'fs')} />
            </Field>
            <Field label="Color">
              <ColorInput value={p.color || '#6b7280'} onChange={(v) => onPatch({ color: v }, 'color')} />
            </Field>
          </div>
        </div>
      );
    case 'html':
      return (
        <div className="space-y-3">
          {title}
          <Field label="HTML del bloque">
            <textarea
              value={p.html || ''}
              onChange={(e) => onPatch({ html: e.target.value }, 'html')}
              disabled={readOnly}
              rows={10}
              spellCheck={false}
              className={`${inp} font-mono text-xs`}
              placeholder="<table>…</table>"
            />
          </Field>
          <p className="text-[11px] leading-snug text-slate-400">
            Recuerda: los clientes de correo solo entienden tablas y estilos en línea. Las imágenes
            incrustadas (data:image) se rechazan al guardar — usa URLs.
          </p>
        </div>
      );
    default:
      return null;
  }
}

// ── Previsualización ────────────────────────────────────────────────────────
function PreviewModal({ html, subject, onClose }: { html: string; subject: string; onClose: () => void }) {
  const [mode, setMode] = useState<'desktop' | 'mobile'>('desktop');
  return (
    <div className="fixed inset-0 z-[75] flex flex-col bg-black/50 p-3 sm:p-6" onClick={onClose}>
      <div
        className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-800">Previsualización</p>
            <p className="truncate text-xs text-slate-400">Asunto: {subject || '(sin asunto)'}</p>
          </div>
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
            title="Previsualización del correo"
            srcDoc={html}
            className="mx-auto block h-full rounded-lg bg-white shadow"
            style={{ width: mode === 'desktop' ? '100%' : 375, maxWidth: '100%', border: 0 }}
            sandbox=""
          />
        </div>
      </div>
    </div>
  );
}
