'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

// Panel de EMAIL MARKETING (contact-based) de la MARCA — apartado de
// automatizaciones. El proveedor de envío por debajo NUNCA se nombra en la UI.
// Sub-pestañas: Conexión (estado + envío de prueba) y Contactos (base con dedup;
// incluye los NEGOCIOS de la marca sincronizados con etiqueta `negocio` y el
// envío directo de correo/SMS a un contacto).
// Los Workflows viven en su propia pestaña principal, no acá.

const ACCENT = '#16a34a';

type Connection = {
  configured: boolean;
  subaccount?: string | null;
  domain?: string | null;
  from?: string | null;
  error?: string;
  scopeLimited?: boolean;
};
type SendResult = { ok: boolean; skipped?: boolean; error?: string; messageId?: string };
type Contact = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  tags: string[];
  optOut: boolean;
  createdAt?: string;
};

export default function EmailMarketingPanel() {
  const [sub, setSub] = useState<'conexion' | 'contactos'>('conexion');
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-800">📧 Email Marketing</h2>
        <p className="text-sm text-slate-500">
          Automatizaciones por correo (y SMS) a tus contactos.
        </p>
      </div>
      <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 text-sm w-fit">
        {([
          ['conexion', 'Conexión'],
          ['contactos', 'Contactos'],
          // Sin «Workflows»: ya existe la pestaña principal de Workflows arriba y
          // tener dos entradas al mismo concepto solo hace dudar cuál es cuál.
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setSub(k)}
            className="rounded-md px-3 py-1 font-medium"
            style={sub === k ? { background: ACCENT, color: 'white' } : { color: '#64748b' }}
          >
            {label}
          </button>
        ))}
      </div>
      {sub === 'conexion' ? <ConnectionTab /> : <ContactsTab />}
    </div>
  );
}

function ConnectionTab() {
  const [conn, setConn] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true);
  const [channel, setChannel] = useState<'email' | 'sms'>('email');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('Prueba de conexión');
  const [body, setBody] = useState('Hola 👋 Esto es un envío de prueba.');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  async function loadConnection() {
    setLoading(true);
    try {
      const d = await api<Connection>('/admin/marketing/connection');
      setConn(d ?? { configured: false });
    } catch {
      setConn({ configured: false, error: 'No se pudo consultar el estado de la conexión.' });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    loadConnection();
  }, []);

  async function sendTest() {
    if (!to.trim()) {
      toast('Escribe un destinatario.', 'error');
      return;
    }
    setSending(true);
    setResult(null);
    try {
      const r = await api<SendResult>('/admin/marketing/test-send', {
        method: 'POST',
        body: JSON.stringify({ channel, to: to.trim(), subject, body }),
      });
      setResult(r);
      if (r?.ok) toast('Envío de prueba realizado ✓', 'success');
      else toast(r?.error ?? 'No se pudo enviar.', 'error');
    } catch (e: any) {
      setResult({ ok: false, error: e?.message ?? 'Error enviando.' });
      toast(e?.message ?? 'Error enviando.', 'error');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">Estado de la conexión</h3>
          <button
            onClick={loadConnection}
            className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            ↻ Actualizar
          </button>
        </div>
        {loading ? (
          <p className="mt-3 text-sm text-slate-400">Consultando…</p>
        ) : !conn?.configured ? (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
            Esta marca aún no tiene una <b>subcuenta de envío</b> configurada. Configúrala en el panel de la
            marca para poder enviar correos y SMS.
          </div>
        ) : (
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: ACCENT }} />
              <span className="text-slate-700">Conexión de envío activa</span>
            </div>
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-slate-600">
              <dt className="text-slate-400">Subcuenta</dt>
              <dd className="font-mono text-xs">{conn.subaccount ?? '—'}</dd>
              <dt className="text-slate-400">Dominio</dt>
              <dd>{conn.domain ?? '—'}</dd>
              <dt className="text-slate-400">Remitente</dt>
              <dd>{conn.from ?? '—'}</dd>
            </dl>
            {conn.scopeLimited && (
              <div className="rounded-lg bg-sky-50 border border-sky-200 p-3 text-xs text-sky-800">
                El <b>envío funciona</b>, pero falta el permiso de <b>lectura</b> de la cuenta, por eso no
                mostramos el dominio ni el remitente. Habilítalo en la configuración de la subcuenta. Igual sabemos
                contra qué cuenta enviamos.
              </div>
            )}
            {conn.error && !conn.scopeLimited && (
              <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800">
                {conn.error}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="font-semibold text-slate-800">Envío de prueba</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Verifica credenciales y permisos con un envío real antes de armar automatizaciones.
        </p>
        <div className="mt-3 flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm w-fit">
          {(['email', 'sms'] as const).map((c) => (
            <button
              key={c}
              onClick={() => setChannel(c)}
              className="rounded-md px-3 py-1 font-medium"
              style={channel === c ? { background: ACCENT, color: 'white' } : { color: '#64748b' }}
            >
              {c === 'email' ? '✉️ Correo' : '💬 SMS'}
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-3 max-w-lg">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">
              {channel === 'email' ? 'Correo destino' : 'Teléfono destino'}
            </span>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={channel === 'email' ? 'tucorreo@ejemplo.com' : '+57 300 000 0000'}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400"
            />
          </label>
          {channel === 'email' && (
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Asunto</span>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400"
              />
            </label>
          )}
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Mensaje</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400"
            />
          </label>
          <div>
            <button
              onClick={sendTest}
              disabled={sending}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: ACCENT }}
            >
              {sending ? 'Enviando…' : 'Enviar prueba'}
            </button>
          </div>
          {result && (
            <div
              className={`rounded-lg border p-3 text-sm ${
                result.ok
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : result.skipped
                    ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              {result.ok ? (
                <>
                  Enviado ✓
                  {result.messageId && (
                    <span className="ml-1 font-mono text-xs opacity-70">id: {result.messageId}</span>
                  )}
                </>
              ) : (
                <>
                  {result.skipped ? 'Omitido: ' : 'Falló: '}
                  {result.error ?? 'sin detalle'}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ContactsTab() {
  const [rows, setRows] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', company: '', tags: '' });
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState('');
  const [syncing, setSyncing] = useState(false);
  // Envío directo: a qué contacto, por qué canal y qué se le manda.
  const [sendTarget, setSendTarget] = useState<Contact | null>(null);
  const [sendChannel, setSendChannel] = useState<'email' | 'sms'>('email');
  const [sendSubject, setSendSubject] = useState('');
  const [sendBody, setSendBody] = useState('');
  const [sendingDirect, setSendingDirect] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const d = await api<{ rows: Contact[]; total: number }>(
        `/admin/marketing/contacts?q=${encodeURIComponent(q)}`,
      );
      setRows(d?.rows ?? []);
      setTotal(d?.total ?? 0);
    } catch (e: any) {
      toast(e?.message ?? 'Error cargando contactos', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function addContact() {
    if (!form.email.trim() && !form.phone.trim()) {
      toast('El contacto necesita correo o teléfono.', 'error');
      return;
    }
    try {
      await api('/admin/marketing/contacts', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim() || undefined,
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          company: form.company.trim() || undefined,
          tags: form.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      setForm({ name: '', email: '', phone: '', company: '', tags: '' });
      setAdding(false);
      toast('Contacto guardado ✓', 'success');
      load();
    } catch (e: any) {
      toast(e?.message ?? 'Error guardando', 'error');
    }
  }

  // Import: cada línea "nombre, correo, teléfono". El backend deduplica por identidad.
  async function runImport() {
    const parsed = importText
      .split('\n')
      .map((line) => line.split(/[,;\t]/).map((c) => c.trim()))
      .filter((c) => c.length && (c[1] || c[2]))
      .map((c) => ({ name: c[0] || undefined, email: c[1] || undefined, phone: c[2] || undefined }));
    if (!parsed.length) {
      toast('Pega al menos una línea "nombre, correo, teléfono".', 'error');
      return;
    }
    try {
      const r = await api<{ processed: number; contacts: number }>('/admin/marketing/contacts/import', {
        method: 'POST',
        body: JSON.stringify({ rows: parsed }),
      });
      toast(`Importados ${r?.processed ?? 0} · total ${r?.contacts ?? 0}`, 'success');
      setImportText('');
      setImporting(false);
      load();
    } catch (e: any) {
      toast(e?.message ?? 'Error importando', 'error');
    }
  }

  // Negocios de la marca → contactos. Idempotente: repetirlo no duplica ni
  // pisa lo editado a mano, por eso la segunda corrida reporta 0 y 0.
  async function syncTenants() {
    setSyncing(true);
    try {
      const r = await api<{ created: number; updated: number; skipped: number; contacts: number }>(
        '/admin/marketing/contacts/sync-tenants',
        { method: 'POST' },
      );
      toast(
        `Negocios sincronizados: ${r?.created ?? 0} creados · ${r?.updated ?? 0} actualizados`,
        'success',
      );
      load();
    } catch (e: any) {
      toast(e?.message ?? 'Error sincronizando negocios', 'error');
    } finally {
      setSyncing(false);
    }
  }

  function openSend(c: Contact) {
    setSendTarget(c);
    setSendChannel(c.email ? 'email' : 'sms');
    setSendSubject('');
    setSendBody('');
    setAdding(false);
    setImporting(false);
  }

  async function sendDirect() {
    if (!sendTarget) return;
    if (!sendBody.trim()) {
      toast('Escribe el mensaje.', 'error');
      return;
    }
    setSendingDirect(true);
    try {
      const r = await api<SendResult>(`/admin/marketing/contacts/${sendTarget.id}/send`, {
        method: 'POST',
        body: JSON.stringify({
          channel: sendChannel,
          subject: sendChannel === 'email' ? sendSubject || undefined : undefined,
          body: sendBody,
        }),
      });
      if (r?.ok) {
        toast('Mensaje enviado ✓', 'success');
        setSendTarget(null);
      } else {
        toast(r?.error ?? 'No se pudo enviar.', 'error');
      }
    } catch (e: any) {
      toast(e?.message ?? 'Error enviando.', 'error');
    } finally {
      setSendingDirect(false);
    }
  }

  async function del(id: string) {
    if (!window.confirm('¿Eliminar este contacto? (si vuelve a escribir se reactiva)')) return;
    try {
      await api(`/admin/marketing/contacts/${id}`, { method: 'DELETE' });
      setRows((p) => p.filter((r) => r.id !== id));
      setTotal((t) => Math.max(0, t - 1));
    } catch (e: any) {
      toast(e?.message ?? 'Error', 'error');
    }
  }
  async function toggleOptOut(c: Contact) {
    try {
      await api(`/admin/marketing/contacts/${c.id}/optout`, {
        method: 'PATCH',
        body: JSON.stringify({ optOut: !c.optOut }),
      });
      setRows((p) => p.map((r) => (r.id === c.id ? { ...r, optOut: !r.optOut } : r)));
    } catch (e: any) {
      toast(e?.message ?? 'Error', 'error');
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nombre, correo o teléfono…"
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-emerald-400 w-64"
          />
          <span className="text-xs text-slate-400">{total} contactos</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={syncTenants}
            disabled={syncing}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            title="Trae los negocios de tu marca como contactos. Repetirlo no duplica ni pisa tus ediciones."
          >
            {syncing ? 'Sincronizando…' : '⟳ Sincronizar negocios'}
          </button>
          <button
            onClick={() => {
              setImporting((v) => !v);
              setAdding(false);
            }}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            ⇪ Importar
          </button>
          <button
            onClick={() => {
              setAdding((v) => !v);
              setImporting(false);
            }}
            className="rounded-md px-3 py-1.5 text-sm font-semibold text-white"
            style={{ background: ACCENT }}
          >
            + Nuevo contacto
          </button>
        </div>
      </div>

      {adding && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 grid gap-2 sm:grid-cols-2">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Nombre"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400"
          />
          <input
            value={form.company}
            onChange={(e) => setForm({ ...form, company: e.target.value })}
            placeholder="Empresa (opcional)"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400"
          />
          <input
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="Correo"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400"
          />
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="Teléfono (+57…)"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400"
          />
          <input
            value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
            placeholder="Etiquetas separadas por coma"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 sm:col-span-2"
          />
          <div className="sm:col-span-2">
            <button
              onClick={addContact}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white"
              style={{ background: ACCENT }}
            >
              Guardar contacto
            </button>
          </div>
        </div>
      )}

      {importing && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
          <p className="text-xs text-slate-500">
            Una línea por contacto: <code>nombre, correo, teléfono</code>. Se deduplica solo por identidad.
          </p>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={5}
            placeholder={'Ana Pérez, ana@correo.com, +573001112233\nJuan, , +573004445566'}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono outline-none focus:border-emerald-400"
          />
          <button
            onClick={runImport}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white"
            style={{ background: ACCENT }}
          >
            Importar contactos
          </button>
        </div>
      )}

      {sendTarget && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">
              Enviar mensaje a {sendTarget.name || sendTarget.email || sendTarget.phone}
            </p>
            <button
              onClick={() => setSendTarget(null)}
              className="text-slate-400 hover:text-slate-600 text-sm"
              title="Cerrar"
            >
              ✕
            </button>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 text-sm w-fit">
            {(['email', 'sms'] as const).map((c) => {
              const enabled = c === 'email' ? !!sendTarget.email : !!sendTarget.phone;
              return (
                <button
                  key={c}
                  onClick={() => enabled && setSendChannel(c)}
                  disabled={!enabled}
                  className="rounded-md px-3 py-1 font-medium disabled:opacity-40"
                  style={sendChannel === c ? { background: ACCENT, color: 'white' } : { color: '#64748b' }}
                  title={
                    enabled
                      ? undefined
                      : c === 'email'
                        ? 'El contacto no tiene correo'
                        : 'El contacto no tiene teléfono'
                  }
                >
                  {c === 'email' ? '✉️ Correo' : '💬 SMS'}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-slate-500">
            Va a:{' '}
            <span className="font-mono">
              {sendChannel === 'email' ? sendTarget.email : sendTarget.phone}
            </span>
          </p>
          {sendChannel === 'email' && (
            <input
              value={sendSubject}
              onChange={(e) => setSendSubject(e.target.value)}
              placeholder="Asunto"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400"
            />
          )}
          <textarea
            value={sendBody}
            onChange={(e) => setSendBody(e.target.value)}
            rows={4}
            placeholder="Escribe el mensaje…"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400"
          />
          <button
            onClick={sendDirect}
            disabled={sendingDirect}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: ACCENT }}
          >
            {sendingDirect ? 'Enviando…' : sendChannel === 'email' ? 'Enviar correo' : 'Enviar SMS'}
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
              <th className="py-2 pr-3 font-medium">Nombre</th>
              <th className="py-2 pr-3 font-medium">Correo</th>
              <th className="py-2 pr-3 font-medium">Teléfono</th>
              <th className="py-2 pr-3 font-medium">Etiquetas</th>
              <th className="py-2 pr-3 font-medium">Estado</th>
              <th className="py-2 pr-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-400">
                  Cargando…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-400">
                  Aún no hay contactos. Agrega uno o importa una lista.
                </td>
              </tr>
            ) : (
              rows.map((c) => (
                <tr key={c.id} className="border-b border-slate-50">
                  <td className="py-2 pr-3">{c.name || '—'}</td>
                  <td className="py-2 pr-3">{c.email || '—'}</td>
                  <td className="py-2 pr-3">{c.phone || '—'}</td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap gap-1">
                      {(c.tags ?? []).map((t) => (
                        <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <button
                      onClick={() => toggleOptOut(c)}
                      className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                        c.optOut ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                      }`}
                      title="Alternar suscripción"
                    >
                      {c.optOut ? 'Dado de baja' : 'Suscrito'}
                    </button>
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openSend(c)}
                        disabled={c.optOut || (!c.email && !c.phone)}
                        className="text-slate-400 hover:text-emerald-600 disabled:opacity-30"
                        title={
                          c.optOut
                            ? 'Dado de baja: no se le puede enviar'
                            : !c.email && !c.phone
                              ? 'Sin correo ni teléfono'
                              : 'Enviar correo o SMS'
                        }
                      >
                        ✉️
                      </button>
                      <button
                        onClick={() => del(c.id)}
                        className="text-slate-400 hover:text-rose-600"
                        title="Eliminar"
                      >
                        🗑
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
