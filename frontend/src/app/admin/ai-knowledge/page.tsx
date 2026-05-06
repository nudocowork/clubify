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
        <button
          className="btn-primary"
          onClick={() =>
            setEditing({ title: '', content: '', category: 'General', isActive: true })
          }
        >
          <Icon name="plus" /> Nueva entrada
        </button>
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
