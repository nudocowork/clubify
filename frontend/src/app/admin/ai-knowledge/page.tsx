'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

type Entry = {
  id: string;
  title: string;
  content: string;
  category: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

const SUGGESTED_CATEGORIES = [
  'General',
  'Tarjetas wallet',
  'Menú y pedidos',
  'WhatsApp y push',
  'Facturación',
  'Categorías de negocio',
  'Configuración',
];

export default function AIKnowledgePage() {
  const [list, setList] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Entry> | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    try {
      setList(await api<Entry[]>('/admin/knowledge'));
    } catch (e: any) {
      toast(e.message || 'Error cargando knowledge', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!editing) return;
    if (!editing.title?.trim() || !editing.content?.trim()) {
      toast('Título y contenido obligatorios', 'error');
      return;
    }
    setSaving(true);
    try {
      const body = {
        title: editing.title,
        content: editing.content,
        category: editing.category || 'General',
        isActive: editing.isActive ?? true,
      };
      if (editing.id) {
        await api(`/admin/knowledge/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      } else {
        await api('/admin/knowledge', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }
      toast('Guardado', 'success');
      setEditing(null);
      load();
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('¿Eliminar esta entrada?')) return;
    try {
      await api(`/admin/knowledge/${id}`, { method: 'DELETE' });
      toast('Eliminada', 'success');
      load();
    } catch (e: any) {
      toast(e.message || 'No se pudo eliminar', 'error');
    }
  }

  async function toggleActive(e: Entry) {
    try {
      await api(`/admin/knowledge/${e.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !e.isActive }),
      });
      load();
    } catch (err: any) {
      toast(err.message || 'No se pudo actualizar', 'error');
    }
  }

  const grouped = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = !term
      ? list
      : list.filter(
          (e) =>
            e.title.toLowerCase().includes(term) ||
            e.content.toLowerCase().includes(term) ||
            e.category.toLowerCase().includes(term),
        );
    const map = new Map<string, Entry[]>();
    for (const e of filtered) {
      const k = e.category || 'General';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [list, search]);

  const activeCount = list.filter((e) => e.isActive).length;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          IA · Knowledge base{' '}
          <span className="page-crumb">
            / {activeCount} activas · {list.length} totales
          </span>
        </h1>
        <div className="flex gap-2 flex-wrap">
          <BulkImportButton onDone={load} />
          <MasterPromptButton />
          <button
            className="btn-primary"
            onClick={() =>
              setEditing({ title: '', content: '', category: 'General', isActive: true })
            }
          >
            <Icon name="plus" /> Nueva entrada
          </button>
        </div>
      </div>

      <div className="card card-pad mb-5">
        <h3 className="text-base font-semibold m-0 flex items-center gap-2">
          🤖 ¿Cómo funciona?
        </h3>
        <p className="text-sm text-mute mt-2 leading-relaxed">
          Cada entrada de esta lista alimenta el asistente IA del widget de
          soporte que ven los clientes en el panel. El backend toma todas las
          entradas <b>activas</b>, las concatena en el system prompt de
          Anthropic Claude (haiku) y responde basándose en eso.
        </p>
        <p className="text-sm text-mute mt-2 leading-relaxed">
          Mantén las entradas <b>cortas y directas</b> (200-500 palabras).
          Una pregunta común + una respuesta clara funciona mejor que un
          tutorial largo. Agrupá por categoría para que sea más fácil
          mantenerlas.
        </p>
      </div>

      <div className="mb-4">
        <input
          type="text"
          placeholder="🔍 Buscar entradas…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input max-w-md"
        />
      </div>

      {loading ? (
        <div className="card card-pad">
          <div className="h-4 bg-bg2 rounded animate-shimmer mb-3" />
          <div className="h-20 bg-bg2 rounded animate-shimmer" />
        </div>
      ) : list.length === 0 ? (
        <div className="card card-pad text-center py-12">
          <div className="text-4xl mb-2">🧠</div>
          <div className="font-semibold">Sin entradas todavía</div>
          <p className="text-sm text-mute mt-1.5 max-w-md mx-auto">
            Agrega la primera entrada con preguntas frecuentes y respuestas.
            El asistente IA empezará a usar la información en cuanto
            actives la entrada.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([cat, entries]) => (
            <div key={cat}>
              <div className="text-[11px] uppercase tracking-[0.16em] text-mute font-semibold mb-2">
                {cat} · {entries.length}
              </div>
              <div className="space-y-2">
                {entries.map((e) => (
                  <div
                    key={e.id}
                    className={`card card-pad ${
                      !e.isActive ? 'opacity-60 bg-bg2/40' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold flex items-center gap-2 flex-wrap">
                          {e.title}
                          {!e.isActive && (
                            <span className="badge badge-mute text-[10px]">
                              Pausada
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-mute mt-1.5 leading-relaxed whitespace-pre-wrap line-clamp-3">
                          {e.content}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          className="btn-ghost text-xs"
                          onClick={() => toggleActive(e)}
                          title={e.isActive ? 'Pausar' : 'Activar'}
                        >
                          {e.isActive ? '⏸' : '▶'}
                        </button>
                        <button
                          className="btn-ghost text-xs"
                          onClick={() => setEditing(e)}
                        >
                          <Icon name="edit" /> Editar
                        </button>
                        <button
                          className="btn-danger text-xs"
                          onClick={() => remove(e.id)}
                          title="Eliminar"
                        >
                          <Icon name="trash" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal editor */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-ink/60"
            onClick={() => !saving && setEditing(null)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-line flex items-center justify-between">
              <h2 className="font-bold text-lg">
                {editing.id ? 'Editar entrada' : 'Nueva entrada'}
              </h2>
              <button
                onClick={() => !saving && setEditing(null)}
                className="text-mute hover:text-ink text-xl leading-none"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <div>
                <label className="label">Título / Pregunta</label>
                <input
                  className="input"
                  placeholder="Ej: Cómo cambiar el plan de un negocio"
                  value={editing.title ?? ''}
                  onChange={(e) =>
                    setEditing((c) => ({ ...c, title: e.target.value }))
                  }
                  autoFocus
                />
              </div>
              <div>
                <label className="label">Categoría</label>
                <input
                  className="input"
                  list="categories-list"
                  value={editing.category ?? ''}
                  onChange={(e) =>
                    setEditing((c) => ({ ...c, category: e.target.value }))
                  }
                />
                <datalist id="categories-list">
                  {SUGGESTED_CATEGORIES.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="label">Respuesta / Contenido</label>
                <textarea
                  className="input"
                  rows={10}
                  placeholder={
                    'Ej: Para cambiar el plan de un negocio, entra a /admin/tenants/[id], busca la card "Facturación" y elige el modo (Pagada / Trial / Sin pago). Aplicar cambio actualiza el estado del lockscreen.'
                  }
                  value={editing.content ?? ''}
                  onChange={(e) =>
                    setEditing((c) => ({ ...c, content: e.target.value }))
                  }
                />
                <div className="text-[11px] text-mute mt-1">
                  Markdown básico permitido. La IA usa este texto como
                  contexto al responder.
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={editing.isActive ?? true}
                  onChange={(e) =>
                    setEditing((c) => ({ ...c, isActive: e.target.checked }))
                  }
                />
                <span>Activa (se incluye en el contexto del asistente)</span>
              </label>
            </div>
            <div className="px-5 py-3 border-t border-line bg-bg2/30 flex justify-end gap-2">
              <button
                onClick={() => setEditing(null)}
                disabled={saving}
                className="btn-ghost"
              >
                Cancelar
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="btn-primary disabled:opacity-50"
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Modal de import masivo: el admin pega un documento + elige cómo
 *  partirlo (## sections, párrafos, o uno solo). Cada chunk se vuelve
 *  un KnowledgeEntry — upsert por title dentro de la misma categoría. */
function BulkImportButton({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'sections' | 'paragraphs' | 'whole'>('sections');
  const [category, setCategory] = useState('General');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!text.trim()) {
      toast('Pegá algún contenido primero', 'error');
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ count: number }>('/admin/knowledge/bulk-import', {
        method: 'POST',
        body: JSON.stringify({ text, mode, category }),
      });
      toast(`✓ Se importaron ${r.count} entradas`, 'success');
      setOpen(false);
      setText('');
      onDone();
    } catch (e: any) {
      toast(e.message || 'No se pudo importar', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn-ghost text-sm" onClick={() => setOpen(true)}>
        📥 Importar documento
      </button>
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-line flex items-center justify-between">
              <h3 className="text-lg font-semibold m-0">Importar documento → IA</h3>
              <button
                onClick={() => setOpen(false)}
                className="text-mute hover:text-ink"
                disabled={busy}
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-sm text-mute leading-relaxed">
                Pegá un documento largo (FAQ, brief, copy de la landing) y la
                IA lo partirá automáticamente en entradas individuales del
                knowledge base. No tenés que crear cada pregunta-respuesta
                a mano.
              </div>

              <div>
                <label className="label">Modo de split</label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { v: 'sections', label: '## Headers', hint: 'Splittea por "## Título"' },
                      { v: 'paragraphs', label: 'Párrafos', hint: 'Splittea por doble salto' },
                      { v: 'whole', label: 'Documento entero', hint: '1 sola entrada' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.v}
                      type="button"
                      onClick={() => setMode(m.v)}
                      className={`text-left p-2.5 rounded-lg border-2 transition ${
                        mode === m.v
                          ? 'border-brand bg-brand-soft'
                          : 'border-line hover:border-mute'
                      }`}
                    >
                      <div className="text-xs font-semibold">{m.label}</div>
                      <div className="text-[10px] text-mute mt-0.5">{m.hint}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="label">Categoría destino</label>
                <input
                  className="input"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="General"
                />
                <div className="text-[11px] text-mute mt-1">
                  Si ya existe una entrada con el mismo título en esta
                  categoría, se sobrescribe (no se duplica).
                </div>
              </div>

              <div>
                <label className="label">Documento</label>
                <textarea
                  className="input font-mono text-xs"
                  rows={14}
                  placeholder={
                    mode === 'sections'
                      ? '## ¿Cómo funcionan las tarjetas wallet?\nClubify genera pkpass para Apple y JWT save links para Google...\n\n## ¿Qué pasa si el cliente cambia de celular?\nEl pass se restaura automáticamente desde iCloud...'
                      : 'Pegá acá el documento. Será partido automáticamente según el modo elegido.'
                  }
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <div className="text-[11px] text-mute mt-1">
                  {text.length.toLocaleString()} caracteres · máx 200.000
                </div>
              </div>
            </div>
            <div className="p-5 border-t border-line flex gap-2 justify-end">
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="btn-ghost"
              >
                Cancelar
              </button>
              <button
                onClick={submit}
                disabled={busy || !text.trim()}
                className="btn-primary disabled:opacity-50"
              >
                {busy ? 'Importando…' : `Importar ${text.length > 0 ? `(${Math.max(1, text.split(/\n\s*\n/).length)} ~chunks)` : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Modal del master prompt — texto libre que se prepone al system prompt
 *  del widget. Permite ajustar tono, instrucciones, restricciones sin
 *  redeploy. */
function MasterPromptButton() {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api<{ prompt: string | null }>('/admin/support/master-prompt')
      .then((r) => {
        setPrompt(r.prompt ?? '');
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [open]);

  async function save() {
    setBusy(true);
    try {
      await api('/admin/support/master-prompt', {
        method: 'PATCH',
        body: JSON.stringify({ prompt: prompt.trim() || null }),
      });
      toast('Master prompt guardado', 'success');
      setOpen(false);
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn-ghost text-sm" onClick={() => setOpen(true)}>
        🧠 Master prompt
      </button>
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-line flex items-center justify-between">
              <h3 className="text-lg font-semibold m-0">Master prompt de la IA</h3>
              <button
                onClick={() => setOpen(false)}
                className="text-mute hover:text-ink"
                disabled={busy}
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-sm text-mute leading-relaxed">
                Texto que se preponne al system prompt del widget IA. Sirve
                para fijar tono, agregar instrucciones específicas o
                restricciones sin redeploy. Si está vacío, se usa solo el
                prompt default + el knowledge base.
              </div>
              {loaded ? (
                <textarea
                  className="input font-mono text-xs"
                  rows={16}
                  placeholder="Ejemplo:&#10;Sos un asistente de Clubify. Hablás en español neutro LATAM. Nunca uses jerga argentina. Si el cliente menciona precios sin tener login, redirígelo a /signup. Si pregunta por el plan Pro, mencioná que incluye automatizaciones WhatsApp y prioridad de soporte."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              ) : (
                <div className="text-sm text-mute py-8 text-center">Cargando…</div>
              )}
              <div className="text-[11px] text-mute">
                {prompt.length.toLocaleString()} caracteres · máx 20.000
              </div>
            </div>
            <div className="p-5 border-t border-line flex gap-2 justify-end">
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="btn-ghost"
              >
                Cancelar
              </button>
              <button
                onClick={save}
                disabled={busy || !loaded}
                className="btn-primary disabled:opacity-50"
              >
                {busy ? 'Guardando…' : 'Guardar prompt'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
