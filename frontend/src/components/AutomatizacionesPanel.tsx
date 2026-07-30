'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

// Panel de Automatizaciones de la PROPIA marca (panel /admin). Se scopea solo
// contra `/admin/automations/*` (el backend resuelve la marca del token). Lista
// los mensajes SMS/WhatsApp que el sistema envía, organizados en carpetas
// (Administrativa / Cobros / Operativas + las que crees). Editar vacío = volver
// al default. Los workflows "pending" son editables pero su envío se activa
// en un paso posterior.

type BrandMsgTemplate = {
  id: string;
  label: string;
  description: string;
  vars: string[];
  folderId: string;
  status: 'active' | 'pending';
  enabled: boolean;
  channel: string;
  audience: string;
  default: string;
  text: string;
  isBrandCustom: boolean;
  source: 'brand' | 'global' | 'default';
};
type BrandMsgFolder = { id: string; name: string; system: boolean };

export default function AutomatizacionesPanel() {
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<BrandMsgTemplate[]>([]);
  const [folders, setFolders] = useState<BrandMsgFolder[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState('');
  const [growConnected, setGrowConnected] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  function applyData(d: any) {
    const list: BrandMsgTemplate[] = d?.templates ?? [];
    setTemplates(list);
    setFolders(d?.folders ?? []);
    setDrafts(Object.fromEntries(list.map((t) => [t.id, t.text])));
    setGrowConnected(!!d?.growConnected);
    if (d?.testPhone !== undefined) setPhoneDraft(d.testPhone ?? '');
  }

  async function savePhone() {
    setBusy(true);
    try {
      const r: any = await api('/admin/automations/test-phone', {
        method: 'PATCH',
        body: JSON.stringify({ phone: phoneDraft }),
      });
      setPhoneDraft(r?.phone ?? '');
      toast('Número de prueba guardado', 'success');
    } catch (e: any) {
      toast(e.message ?? 'Error al guardar el número', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function testSend(id: string, text: string) {
    if (!phoneDraft.trim()) {
      toast('Escribe y guarda un número de prueba primero', 'error');
      return;
    }
    setTestingId(id);
    try {
      // Guarda el número (para que quede persistido) y envía la prueba.
      await api('/admin/automations/test-phone', {
        method: 'PATCH',
        body: JSON.stringify({ phone: phoneDraft }),
      });
      const r: any = await api(
        `/admin/automations/message-templates/${id}/test`,
        { method: 'POST', body: JSON.stringify({ text }) },
      );
      toast(r?.ok ? 'SMS de prueba enviado' : r?.message ?? 'No se pudo enviar', r?.ok ? 'success' : 'error');
    } catch (e: any) {
      toast(e.message ?? 'Error al enviar la prueba', 'error');
    } finally {
      setTestingId(null);
    }
  }

  async function load() {
    setLoading(true);
    try {
      applyData(await api('/admin/automations/message-templates'));
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function save(id: string, text: string) {
    setSavingId(id);
    try {
      applyData(
        await api(`/admin/automations/message-templates/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ text }),
        }),
      );
      toast(text.trim() ? 'Mensaje actualizado' : 'Mensaje restaurado', 'success');
    } catch (e: any) {
      toast(e.message ?? 'Error al guardar el mensaje', 'error');
    } finally {
      setSavingId(null);
    }
  }

  async function toggleSend(id: string, enabled: boolean) {
    setBusy(true);
    try {
      applyData(
        await api(`/admin/automations/message-templates/${id}/enabled`, {
          method: 'PATCH',
          body: JSON.stringify({ enabled }),
        }),
      );
      toast(enabled ? 'Envío activado' : 'Envío desactivado', 'success');
    } catch (e: any) {
      toast(e.message ?? 'Error al cambiar el envío', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function moveTo(id: string, folderId: string) {
    setBusy(true);
    try {
      applyData(
        await api(`/admin/automations/message-templates/${id}/folder`, {
          method: 'PATCH',
          body: JSON.stringify({ folderId }),
        }),
      );
    } catch (e: any) {
      toast(e.message ?? 'Error al mover', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function createFolder() {
    const name = window.prompt('Nombre de la nueva carpeta:')?.trim();
    if (!name) return;
    setBusy(true);
    try {
      applyData(
        await api('/admin/automations/folders', {
          method: 'POST',
          body: JSON.stringify({ name }),
        }),
      );
      toast('Carpeta creada', 'success');
    } catch (e: any) {
      toast(e.message ?? 'Error al crear carpeta', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function renameFolder(f: BrandMsgFolder) {
    const name = window.prompt('Nuevo nombre de la carpeta:', f.name)?.trim();
    if (!name || name === f.name) return;
    setBusy(true);
    try {
      applyData(
        await api(`/admin/automations/folders/${f.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name }),
        }),
      );
      toast('Carpeta renombrada', 'success');
    } catch (e: any) {
      toast(e.message ?? 'Error al renombrar', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function deleteFolder(f: BrandMsgFolder) {
    if (
      !window.confirm(
        `¿Borrar la carpeta "${f.name}"? Sus workflows vuelven a su carpeta original.`,
      )
    )
      return;
    setBusy(true);
    try {
      applyData(
        await api(`/admin/automations/folders/${f.id}`, { method: 'DELETE' }),
      );
      toast('Carpeta borrada', 'success');
    } catch (e: any) {
      toast(e.message ?? 'Error al borrar', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <h1 className="text-xl font-bold m-0">Automatizaciones</h1>
        {!loading && (
          <button
            onClick={createFolder}
            disabled={busy}
            className="text-sm font-semibold rounded-[9px] py-1.5 px-3"
            style={{ border: '1px solid #cbd5e1', color: '#334155', background: 'white' }}
          >
            + Carpeta
          </button>
        )}
      </div>
      <div
        className="rounded-lg p-3 text-xs mb-4"
        style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af' }}
      >
        Los mensajes SMS/WhatsApp que el sistema envía a tus negocios, organizados
        en carpetas. Personaliza el texto; deja el campo vacío y guarda para volver
        al default. Los tokens <code>{'{token}'}</code> se reemplazan al enviar. Los
        marcados <b>“Envío por activar”</b> son editables; abre uno y pulsa{' '}
        <b>“Activar envío”</b> para que empiece a enviarse.
      </div>

      {!loading && (
        <div
          className="rounded-lg p-3 mb-4 flex flex-wrap items-center gap-2"
          style={{ background: '#fffbeb', border: '1px solid #fde68a' }}
        >
          <span className="text-xs font-semibold" style={{ color: '#92400e' }}>
            🧪 Número de prueba
          </span>
          <span className="text-[11px]" style={{ color: '#a16207' }}>
            Se guarda para probar tus SMS sin escribirlo cada vez.
          </span>
          <input
            value={phoneDraft}
            onChange={(e) => setPhoneDraft(e.target.value)}
            placeholder="+57 300 123 4567"
            className="text-xs rounded-[8px] px-2.5 py-1.5 flex-1 min-w-[180px]"
            style={{ border: '1px solid #e5e7eb', color: '#111827' }}
          />
          <button
            onClick={savePhone}
            disabled={busy}
            className="text-xs font-semibold rounded-[8px] py-1.5 px-3"
            style={{ background: 'white', border: '1px solid #cbd5e1', color: '#334155' }}
          >
            Guardar
          </button>
          {!growConnected && (
            <span className="text-[11px] w-full" style={{ color: '#b45309' }}>
              ⚠ Esta marca aún no tiene subcuenta de SMS conectada; la prueba no se enviará hasta conectarla.
            </span>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-sm" style={{ color: '#9aa4af' }}>
          Cargando…
        </div>
      ) : (
        <div className="space-y-5 max-w-3xl">
          {folders.map((f) => {
            const items = templates.filter((t) => t.folderId === f.id);
            return (
              <div key={f.id}>
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="text-xs font-bold uppercase tracking-wide"
                    style={{ color: '#6b7280' }}
                  >
                    📁 {f.name}
                  </span>
                  {!f.system && (
                    <span className="flex items-center gap-2">
                      <button
                        onClick={() => renameFolder(f)}
                        disabled={busy}
                        className="text-[11px]"
                        style={{ color: '#64748b' }}
                      >
                        editar
                      </button>
                      <button
                        onClick={() => deleteFolder(f)}
                        disabled={busy}
                        className="text-[11px]"
                        style={{ color: '#b91c1c' }}
                      >
                        borrar
                      </button>
                    </span>
                  )}
                </div>
                {items.length === 0 ? (
                  <div
                    className="text-[11px] rounded-lg px-3 py-2"
                    style={{ color: '#9aa4af', border: '1px dashed #e5e7eb' }}
                  >
                    Sin workflows. Mueve alguno aquí desde su menú “Carpeta”.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {items.map((t) => {
                      const open = openId === t.id;
                      const draft = drafts[t.id] ?? t.text;
                      const dirty = draft !== t.text;
                      return (
                        <div
                          key={t.id}
                          className="rounded-lg overflow-hidden bg-white"
                          style={{ border: '1px solid #eef0f2' }}
                        >
                          <button
                            onClick={() => setOpenId(open ? null : t.id)}
                            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left"
                            style={{ background: open ? '#f8fafc' : 'white' }}
                          >
                            <div className="min-w-0">
                              <div
                                className="text-sm font-semibold truncate"
                                style={{ color: '#2b3a30' }}
                              >
                                {t.label}
                              </div>
                              <div
                                className="text-[11px] truncate"
                                style={{ color: '#9aa4af' }}
                              >
                                {t.channel} · {t.audience}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {t.status === 'pending' ? (
                                <span
                                  className="text-[10px] font-bold px-2 py-0.5 rounded-[6px]"
                                  style={
                                    t.enabled
                                      ? { background: '#dcfce7', color: '#15803d' }
                                      : { background: '#fef3c7', color: '#92400e' }
                                  }
                                  title={
                                    t.enabled
                                      ? 'El envío de este mensaje está activo'
                                      : 'Editable, pero su envío está desactivado'
                                  }
                                >
                                  {t.enabled ? 'Envío activo' : 'Envío por activar'}
                                </span>
                              ) : (
                                t.isBrandCustom && (
                                  <span
                                    className="text-[10px] font-bold px-2 py-0.5 rounded-[6px]"
                                    style={{ background: '#dcfce7', color: '#15803d' }}
                                  >
                                    Personalizado
                                  </span>
                                )
                              )}
                              <span style={{ color: '#9aa4af' }}>
                                {open ? '▾' : '▸'}
                              </span>
                            </div>
                          </button>
                          {open && (
                            <div
                              className="px-3 py-3 space-y-2"
                              style={{ borderTop: '1px solid #eef0f2' }}
                            >
                              <div className="text-[11px]" style={{ color: '#6b7280' }}>
                                {t.description}
                              </div>
                              {t.vars.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {t.vars.map((v) => (
                                    <code
                                      key={v}
                                      className="text-[10px] px-1.5 py-0.5 rounded-[5px] font-mono"
                                      style={{ background: '#f3f4f6', color: '#4b5563' }}
                                    >
                                      {`{${v}}`}
                                    </code>
                                  ))}
                                </div>
                              )}
                              <textarea
                                value={draft}
                                onChange={(e) =>
                                  setDrafts((p) => ({ ...p, [t.id]: e.target.value }))
                                }
                                rows={Math.min(
                                  10,
                                  Math.max(3, draft.split('\n').length + 1),
                                )}
                                placeholder={t.default}
                                className="w-full font-mono text-xs rounded-[8px] p-2"
                                style={{
                                  border: '1px solid #e5e7eb',
                                  color: '#111827',
                                  resize: 'vertical',
                                }}
                              />
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  onClick={() => save(t.id, draft)}
                                  disabled={savingId === t.id || !dirty}
                                  className="text-xs font-semibold rounded-[8px] py-1.5 px-3"
                                  style={{
                                    background: dirty ? '#16a34a' : '#e5e7eb',
                                    color: dirty ? 'white' : '#9aa4af',
                                  }}
                                >
                                  {savingId === t.id ? 'Guardando…' : 'Guardar'}
                                </button>
                                {t.channel === 'SMS' && (
                                  <button
                                    onClick={() => testSend(t.id, draft)}
                                    disabled={testingId === t.id || !phoneDraft.trim()}
                                    title={phoneDraft.trim() ? 'Enviar este SMS a tu número de prueba' : 'Guarda un número de prueba arriba'}
                                    className="text-xs font-semibold rounded-[8px] py-1.5 px-3"
                                    style={{ background: 'white', color: '#0369a1', border: '1px solid #bae6fd' }}
                                  >
                                    {testingId === t.id ? 'Enviando…' : '🧪 Probar'}
                                  </button>
                                )}
                                {t.isBrandCustom && (
                                  <button
                                    onClick={() => save(t.id, '')}
                                    disabled={savingId === t.id}
                                    className="text-xs font-semibold rounded-[8px] py-1.5 px-3"
                                    style={{
                                      background: 'white',
                                      color: '#b91c1c',
                                      border: '1px solid #fecaca',
                                    }}
                                  >
                                    Restaurar default
                                  </button>
                                )}
                                {t.status === 'pending' && (
                                  <button
                                    onClick={() => toggleSend(t.id, !t.enabled)}
                                    disabled={busy}
                                    className="text-xs font-semibold rounded-[8px] py-1.5 px-3"
                                    style={
                                      t.enabled
                                        ? {
                                            background: 'white',
                                            color: '#b45309',
                                            border: '1px solid #fde68a',
                                          }
                                        : { background: '#0ea5e9', color: 'white' }
                                    }
                                  >
                                    {t.enabled ? 'Desactivar envío' : 'Activar envío'}
                                  </button>
                                )}
                                <label
                                  className="text-[11px] ml-auto flex items-center gap-1"
                                  style={{ color: '#64748b' }}
                                >
                                  Carpeta:
                                  <select
                                    value={t.folderId}
                                    onChange={(e) => moveTo(t.id, e.target.value)}
                                    disabled={busy}
                                    className="text-[11px] rounded-[6px] px-1.5 py-1"
                                    style={{ border: '1px solid #e5e7eb' }}
                                  >
                                    {folders.map((fo) => (
                                      <option key={fo.id} value={fo.id}>
                                        {fo.name}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
