'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

// Envío de una plantilla de correo a contactos seleccionados. Tres pasos:
// elegir (búsqueda + casillas) → confirmar (con el número EXACTO de
// destinatarios: un envío masivo no se puede deshacer) → resumen del backend.
// Los omitidos (p. ej. dados de baja) se muestran como aviso, no como error:
// que el sistema respete la baja voluntaria es lo esperado, no un fallo.

const ACCENT = '#16a34a';

type Contact = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  tags: string[];
  optOut: boolean;
};

type Step = 'pick' | 'confirm' | 'result';

// El contrato dice "enviados / omitidos / fallidos" pero el backend se
// construye en paralelo: normalizamos varios nombres posibles y, si nada
// calza, mostramos la respuesta cruda antes que inventar ceros.
function normalizeSummary(r: any): { sent: number; skipped: number; failed: number } | null {
  if (!r || typeof r !== 'object') return null;
  const num = (v: any): number | null =>
    typeof v === 'number' ? v : Array.isArray(v) ? v.length : null;
  const sent = num(r.sent) ?? num(r.enviados) ?? num(r.ok);
  const skipped = num(r.skipped) ?? num(r.omitidos);
  const failed = num(r.failed) ?? num(r.fallidos) ?? num(r.errors);
  if (sent == null && skipped == null && failed == null) return null;
  return { sent: sent ?? 0, skipped: skipped ?? 0, failed: failed ?? 0 };
}

export default function SendTemplateModal({
  templateId,
  templateName,
  defaultSubject,
  onClose,
}: {
  templateId: string;
  templateName: string;
  defaultSubject?: string | null;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>('pick');
  const [subject, setSubject] = useState(defaultSubject || '');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Los seleccionados viven en un Map aparte de `rows`: así la selección
  // sobrevive a los cambios de búsqueda (marcas a Ana, buscas a Juan, y Ana
  // sigue marcada aunque ya no esté en la lista visible).
  const [selected, setSelected] = useState<Map<string, Contact>>(new Map());
  const [sending, setSending] = useState(false);
  const [summary, setSummary] = useState<{ sent: number; skipped: number; failed: number } | null>(null);
  const [rawResult, setRawResult] = useState<any>(null);
  const reqSeq = useRef(0);

  async function load(query: string) {
    const seq = ++reqSeq.current;
    setLoading(true);
    setLoadError(null);
    try {
      const d = await api<{ rows: Contact[]; total: number }>(
        `/admin/marketing/contacts?q=${encodeURIComponent(query)}`,
      );
      if (seq !== reqSeq.current) return; // llegó tarde: ya hay otra búsqueda
      setRows(d?.rows ?? []);
    } catch (e: any) {
      if (seq !== reqSeq.current) return;
      // Nunca [] silencioso tras un fallo: se distingue "no hay contactos"
      // de "no se pudo consultar", con reintento a mano.
      setLoadError(e?.message || 'No se pudieron cargar los contactos.');
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }
  useEffect(() => {
    const t = setTimeout(() => load(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const eligible = (c: Contact) => !!c.email && !c.optOut;
  const visibleEligible = useMemo(() => rows.filter(eligible), [rows]);
  const allVisibleSelected =
    visibleEligible.length > 0 && visibleEligible.every((c) => selected.has(c.id));

  function toggle(c: Contact) {
    if (!eligible(c)) return;
    setSelected((m) => {
      const n = new Map(m);
      if (n.has(c.id)) n.delete(c.id);
      else n.set(c.id, c);
      return n;
    });
  }
  function toggleAllVisible() {
    setSelected((m) => {
      const n = new Map(m);
      if (allVisibleSelected) visibleEligible.forEach((c) => n.delete(c.id));
      else visibleEligible.forEach((c) => n.set(c.id, c));
      return n;
    });
  }

  function goConfirm() {
    if (!subject.trim()) {
      toast('Escribe el asunto del correo.', 'error');
      return;
    }
    if (selected.size === 0) {
      toast('Selecciona al menos un contacto.', 'error');
      return;
    }
    setStep('confirm');
  }

  async function send() {
    if (sending) return;
    setSending(true);
    try {
      const r = await api<any>(`/admin/marketing/templates/${templateId}/send`, {
        method: 'POST',
        body: JSON.stringify({ subject: subject.trim(), contactIds: [...selected.keys()] }),
      });
      setSummary(normalizeSummary(r));
      setRawResult(r);
      setStep('result');
    } catch (e: any) {
      // El envío pudo fallar completo (p. ej. sin subcuenta de envío): nos
      // quedamos en la confirmación para poder reintentar sin rearmar todo.
      toast(e?.message || 'No se pudo enviar el correo.', 'error');
    } finally {
      setSending(false);
    }
  }

  const count = selected.size;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-800">
              Enviar «{templateName}»
            </h3>
            <p className="text-xs text-slate-400">
              {step === 'pick' && 'Elige los destinatarios y el asunto.'}
              {step === 'confirm' && 'Confirma antes de enviar.'}
              {step === 'result' && 'Resultado del envío.'}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Cerrar">
            ✕
          </button>
        </div>

        {step === 'pick' && (
          <>
            <div className="space-y-2 border-b border-slate-100 px-5 py-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Asunto</span>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Asunto del correo"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400"
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar contactos…"
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-emerald-400 sm:w-64"
                />
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    disabled={visibleEligible.length === 0}
                  />
                  Seleccionar los visibles ({visibleEligible.length})
                </label>
                {count > 0 && (
                  <span className="ml-auto rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                    {count} seleccionado(s)
                  </span>
                )}
              </div>
            </div>
            <div className="min-h-[200px] flex-1 overflow-y-auto px-5 py-2">
              {loading ? (
                <p className="py-8 text-center text-sm text-slate-400">Cargando contactos…</p>
              ) : loadError ? (
                <div className="py-8 text-center">
                  <p className="text-sm font-medium text-amber-800">{loadError}</p>
                  <button
                    onClick={() => load(q)}
                    className="mt-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
                  >
                    Reintentar
                  </button>
                </div>
              ) : rows.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">
                  {q ? 'Ningún contacto coincide con la búsqueda.' : 'Aún no hay contactos. Créalos en la pestaña «Contactos».'}
                </p>
              ) : (
                <ul className="divide-y divide-slate-50">
                  {rows.map((c) => {
                    const ok = eligible(c);
                    return (
                      <li key={c.id}>
                        <label
                          className={`flex items-center gap-3 px-1 py-2 ${ok ? 'cursor-pointer hover:bg-slate-50' : 'opacity-50'}`}
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(c.id)}
                            onChange={() => toggle(c)}
                            disabled={!ok}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-slate-800">
                              {c.name || c.email || '—'}
                            </span>
                            <span className="block truncate text-xs text-slate-400">{c.email || 'Sin correo'}</span>
                          </span>
                          {c.optOut ? (
                            <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-medium text-rose-700">
                              Dado de baja
                            </span>
                          ) : !c.email ? (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                              Sin correo
                            </span>
                          ) : null}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">
                Cancelar
              </button>
              <button
                onClick={goConfirm}
                disabled={count === 0 || !subject.trim()}
                className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: ACCENT }}
              >
                Continuar {count > 0 ? `(${count})` : ''}
              </button>
            </div>
          </>
        )}

        {step === 'confirm' && (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-semibold">
                  Vas a enviar este correo a {count} contacto{count === 1 ? '' : 's'}.
                </p>
                <p className="mt-1 text-amber-800">
                  Un envío masivo no se puede deshacer. Revisa el asunto y los destinatarios antes de confirmar.
                </p>
              </div>
              <dl className="mt-4 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm text-slate-600">
                <dt className="text-slate-400">Asunto</dt>
                <dd className="font-medium text-slate-800">{subject.trim()}</dd>
                <dt className="text-slate-400">Destinatarios</dt>
                <dd>{count}</dd>
              </dl>
              <ul className="mt-3 max-h-40 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50 p-2 text-xs text-slate-600">
                {[...selected.values()].map((c) => (
                  <li key={c.id} className="truncate py-0.5">
                    {c.name ? `${c.name} — ` : ''}
                    {c.email}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button
                onClick={() => setStep('pick')}
                disabled={sending}
                className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 disabled:opacity-50"
              >
                ← Volver
              </button>
              <button
                onClick={send}
                disabled={sending}
                className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: ACCENT }}
              >
                {sending ? 'Enviando…' : `Enviar a ${count} contacto${count === 1 ? '' : 's'}`}
              </button>
            </div>
          </>
        )}

        {step === 'result' && (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {summary ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center">
                    <p className="text-2xl font-bold text-emerald-700">{summary.sent}</p>
                    <p className="text-xs font-medium text-emerald-800">Enviados</p>
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center">
                    <p className="text-2xl font-bold text-amber-700">{summary.skipped}</p>
                    <p className="text-xs font-medium text-amber-800">Omitidos</p>
                  </div>
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-center">
                    <p className="text-2xl font-bold text-rose-700">{summary.failed}</p>
                    <p className="text-xs font-medium text-rose-800">Fallidos</p>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                  El servidor confirmó el envío.
                  {rawResult != null && (
                    <pre className="mt-2 max-h-32 overflow-auto rounded bg-white/60 p-2 text-[11px] text-slate-600">
                      {JSON.stringify(rawResult, null, 2)}
                    </pre>
                  )}
                </div>
              )}
              {summary && summary.skipped > 0 && (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  Los omitidos suelen ser contactos dados de baja o sin correo válido. No es un error:
                  el sistema respeta la baja voluntaria.
                </p>
              )}
              {summary && summary.failed > 0 && (
                <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                  Hubo envíos fallidos. Revisa la conexión de envío en la pestaña «Conexión» y vuelve a intentar
                  con esos contactos.
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button
                onClick={onClose}
                className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white"
                style={{ background: ACCENT }}
              >
                Listo
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
