'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Integration = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: string;
  config: Record<string, any>;
};

const ICONS: Record<string, string> = {
  grow_business: '💬',
};

export default function IntegracionesPage() {
  const [items, setItems] = useState<Integration[]>([]);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function load() {
    try {
      const data = await api<Integration[]>('/superadmin/integrations');
      setItems(data);
    } catch (e) {
      console.error(e);
    }
  }
  useEffect(() => {
    load();
  }, []);

  function flashToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  }

  return (
    <div>
      <h1 className="m-0" style={{ fontSize: 26, fontWeight: 800, color: '#16241c', letterSpacing: -0.6 }}>
        Integraciones
      </h1>
      <p className="text-sm mt-1 mb-5" style={{ color: '#6b7785' }}>
        Servicios globales conectados a la plataforma
      </p>

      <div className="space-y-4">
        {items.map((i) => (
          <IntegrationCard
            key={i.key}
            integration={i}
            onConfigure={() => setEditKey(i.key)}
            onTest={async () => {
              const r = await api<{ ok: boolean; message: string }>(`/superadmin/integrations/${i.key}/test`, {
                method: 'POST',
              });
              flashToast(r.message);
              load();
            }}
          />
        ))}
        {items.length === 0 && (
          <p className="text-sm" style={{ color: '#9aa4af' }}>
            Cargando integraciones…
          </p>
        )}
      </div>

      <SmsTemplatesSection onToast={flashToast} />

      <OnboardingWebhookCard onToast={flashToast} />

      {editKey && (
        <ConfigureModal
          integration={items.find((i) => i.key === editKey)!}
          onClose={() => setEditKey(null)}
          onSaved={() => {
            setEditKey(null);
            flashToast('Configuración guardada');
            load();
          }}
        />
      )}

      {toast && (
        <div
          className="fixed left-1/2 bottom-7 -translate-x-1/2 px-4 py-2.5 rounded-[10px] text-sm font-semibold z-50"
          style={{ background: '#0f172a', color: 'white', boxShadow: '0 12px 30px rgba(0,0,0,.25)' }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

// Fase D (Onboarding Sync): config del webhook saliente `business.activated`.
function OnboardingWebhookCard({ onToast }: { onToast: (m: string) => void }) {
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [hasSecret, setHasSecret] = useState(false);
  const [secretLast4, setSecretLast4] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  async function load() {
    try {
      const c = await api<{
        url: string;
        enabled: boolean;
        hasSecret: boolean;
        secretLast4: string | null;
      }>('/onboarding-webhook');
      setUrl(c.url || '');
      setEnabled(!!c.enabled);
      setHasSecret(!!c.hasSecret);
      setSecretLast4(c.secretLast4 ?? null);
      setSecret('');
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    setSaving(true);
    try {
      const body: any = { url: url.trim(), enabled };
      if (secret.trim()) body.secret = secret.trim();
      await api('/onboarding-webhook', { method: 'PUT', body: JSON.stringify(body) });
      onToast('Webhook guardado');
      load();
    } catch (e: any) {
      onToast(e?.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      const r = await api<{ ok: boolean; message: string }>('/onboarding-webhook/test', {
        method: 'POST',
      });
      onToast(r.message);
    } catch (e: any) {
      onToast(e?.message || 'No se pudo probar');
    } finally {
      setTesting(false);
    }
  }

  return (
    <div
      className="rounded-[14px] p-5 mt-4"
      style={{
        background: 'white',
        border: '1px solid #e7e9ec',
        boxShadow: '0 1px 2px rgba(16,24,40,.04)',
      }}
    >
      <div className="flex items-start gap-4">
        <div
          className="w-12 h-12 rounded-[10px] flex items-center justify-center text-2xl shrink-0"
          style={{ background: '#e0f2fe', color: '#0369a1' }}
        >
          🔔
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="m-0 text-[15px] font-bold" style={{ color: '#16241c' }}>
              Webhook de Onboarding
            </h3>
            <span
              className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
              style={
                enabled
                  ? { background: '#dcfce7', color: '#15803d' }
                  : { background: '#f1f5f9', color: '#64748b' }
              }
            >
              {enabled ? 'Activo' : 'Inactivo'}
            </span>
          </div>
          <p className="text-[13px] mt-1 mb-3" style={{ color: '#6b7785' }}>
            Clubify hace un POST firmado a esta URL cuando un negocio se ACTIVA
            (evento <code>business.activated</code>). Firma en el header{' '}
            <code>X-Clubify-Signature: sha256=…</code> (HMAC del cuerpo con el secreto).
          </p>

          {loading ? (
            <p className="text-sm" style={{ color: '#9aa4af' }}>
              Cargando…
            </p>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-[12px] font-semibold" style={{ color: '#475569' }}>
                  URL del webhook
                </label>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://onboarding.tudominio.com/webhooks/clubify"
                  className="w-full mt-1 px-3 py-2 rounded-[10px] text-sm"
                  style={{ border: '1px solid #dfe3e8' }}
                />
              </div>
              <div>
                <label className="text-[12px] font-semibold" style={{ color: '#475569' }}>
                  Secreto de firma{' '}
                  {hasSecret && (
                    <span style={{ color: '#9aa4af', fontWeight: 400 }}>
                      (guardado ····{secretLast4})
                    </span>
                  )}
                </label>
                <input
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  type="password"
                  placeholder={
                    hasSecret ? 'Dejar vacío = no cambiar' : 'Pega un secreto (lo compartes con el onboarding)'
                  }
                  className="w-full mt-1 px-3 py-2 rounded-[10px] text-sm"
                  style={{ border: '1px solid #dfe3e8' }}
                />
              </div>
              <label
                className="flex items-center gap-2 text-sm cursor-pointer"
                style={{ color: '#334155' }}
              >
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                Enviar el webhook al activar un negocio
              </label>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={save}
                  disabled={saving}
                  className="text-sm font-semibold text-white rounded-[10px] px-4 py-2"
                  style={{ background: '#0ea5e9', opacity: saving ? 0.6 : 1 }}
                >
                  {saving ? 'Guardando…' : 'Guardar'}
                </button>
                <button
                  onClick={test}
                  disabled={testing || !url.trim()}
                  className="text-sm font-semibold rounded-[10px] px-4 py-2"
                  style={{
                    border: '1px solid #e2e8f0',
                    color: '#334155',
                    opacity: testing || !url.trim() ? 0.6 : 1,
                  }}
                >
                  {testing ? 'Probando…' : 'Probar'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function IntegrationCard({
  integration: i,
  onConfigure,
  onTest,
}: {
  integration: Integration;
  onConfigure: () => void;
  onTest: () => void;
}) {
  const connected = i.status === 'CONNECTED';
  const apiKey: string = i.config?.apiKey ?? '';
  const masked = i.config?.apiKey_masked ?? false;
  const [showFull, setShowFull] = useState(false);

  return (
    <div
      className="rounded-[14px] p-5"
      style={{
        background: 'white',
        border: '1px solid #e7e9ec',
        boxShadow: '0 1px 2px rgba(16,24,40,.04)',
      }}
    >
      <div className="flex items-start gap-4">
        <div
          className="w-12 h-12 rounded-[10px] flex items-center justify-center text-2xl shrink-0"
          style={{
            background: '#dcfce7',
            color: '#15803d',
          }}
        >
          {ICONS[i.key] ?? '🔌'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h2 className="m-0" style={{ fontSize: 18, fontWeight: 800, color: '#16241c' }}>
              {i.name}
            </h2>
            <span
              className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-[7px]"
              style={{
                background: connected ? '#dcfce7' : '#fee2e2',
                color: connected ? '#15803d' : '#b91c1c',
              }}
            >
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: connected ? '#16a34a' : '#b91c1c' }}
              />
              {connected ? 'Conectado' : 'Desconectado'}
            </span>
          </div>
          <p className="text-sm" style={{ color: '#6b7785' }}>
            {i.description}
          </p>

          <div className="grid md:grid-cols-2 gap-4 mt-4">
            <div>
              <div
                className="text-[10.5px] font-bold uppercase mb-1.5"
                style={{ letterSpacing: 0.5, color: '#6b7785' }}
              >
                API Key
              </div>
              <div
                className="flex items-center gap-2 rounded-[10px] px-3 py-2.5 text-xs font-mono"
                style={{ background: '#f4f5f7', color: '#16241c' }}
              >
                <span className="flex-1 truncate">
                  {apiKey
                    ? showFull && !masked
                      ? apiKey
                      : apiKey
                    : <span style={{ color: '#9aa4af' }}>(sin configurar)</span>}
                </span>
                {apiKey && !masked && (
                  <button
                    onClick={() => setShowFull((v) => !v)}
                    className="text-[11px] font-semibold"
                    style={{ color: '#15803d' }}
                  >
                    {showFull ? 'Ocultar' : 'Mostrar'}
                  </button>
                )}
              </div>
            </div>
            <div>
              <div
                className="text-[10.5px] font-bold uppercase mb-1.5"
                style={{ letterSpacing: 0.5, color: '#6b7785' }}
              >
                Estado de conexión
              </div>
              <div
                className="rounded-[10px] px-3 py-2.5 text-sm"
                style={{
                  background: connected ? '#f0fdf4' : '#fef2f2',
                  color: connected ? '#15803d' : '#b91c1c',
                  border: `1px solid ${connected ? '#bbf7d0' : '#fecaca'}`,
                }}
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full mr-1.5"
                  style={{ background: connected ? '#16a34a' : '#b91c1c' }}
                />
                {connected
                  ? `Activo · ${i.config?.smsThisMonth ?? '—'} SMS enviados este mes`
                  : 'Sin conexión'}
              </div>
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={onTest}
              className="text-sm font-bold px-4 py-2 rounded-[10px] text-white"
              style={{
                background: 'linear-gradient(180deg, #28c95f, #16a34a)',
                boxShadow: '0 2px 6px rgba(22,163,74,.35)',
              }}
            >
              Probar conexión
            </button>
            <button
              onClick={onConfigure}
              className="text-sm font-semibold px-4 py-2 rounded-[10px]"
              style={{ background: 'white', color: '#2b3a30', border: '1px solid #d7dbe0' }}
            >
              Configurar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfigureModal({
  integration,
  onClose,
  onSaved,
}: {
  integration: Integration;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey.trim()) {
      setErr('API Key requerida');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api(`/superadmin/integrations/${integration.key}`, {
        method: 'PATCH',
        body: JSON.stringify({ config: { apiKey: apiKey.trim() } }),
      });
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? 'Error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,.4)' }}
      onClick={onClose}
    >
      <div
        className="rounded-[14px] p-6 w-full"
        style={{ maxWidth: 480, background: 'white', boxShadow: '0 24px 70px rgba(0,0,0,.28)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="m-0" style={{ fontSize: 20, fontWeight: 800, color: '#16241c' }}>
            Configurar {integration.name}
          </h2>
          <button onClick={onClose} className="text-xl leading-none" style={{ color: '#9aa4af' }}>
            ×
          </button>
        </div>
        <p className="text-sm mt-1 mb-4" style={{ color: '#6b7785' }}>
          Pegá la API Key del proveedor. Queda enmascarada al recargar la página.
        </p>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-[11.5px] font-bold uppercase mb-1.5" style={{ letterSpacing: 0.5, color: '#6b7785' }}>
              API Key
            </label>
            <input
              required
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full text-sm font-mono"
              style={{ padding: '10px 12px', borderRadius: 9, border: '1px solid #d7dbe0' }}
              placeholder="gb_live_..."
            />
          </div>
          {err && <div className="text-sm" style={{ color: '#b91c1c' }}>{err}</div>}
          <div className="flex gap-2 justify-end pt-3">
            <button
              type="button"
              onClick={onClose}
              className="text-sm font-semibold px-4 py-2.5 rounded-[10px]"
              style={{ background: 'white', color: '#2b3a30', border: '1px solid #d7dbe0' }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="text-sm font-bold px-5 py-2.5 rounded-[10px] text-white"
              style={{
                background: 'linear-gradient(180deg, #28c95f, #16a34a)',
                boxShadow: '0 2px 6px rgba(22,163,74,.35)',
              }}
            >
              {busy ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

type SmsTpl = {
  id: string;
  label: string;
  description: string;
  vars: string[];
  group: 'cliente' | 'marca';
  default: string;
  text: string;
  isCustom: boolean;
};

/** Plantillas de SMS automáticos (cobros Hotmart) editables sin redeploy.
 *  Vacío = vuelve al texto por defecto. Variables {token} se interpolan. */
function SmsTemplatesSection({ onToast }: { onToast: (m: string) => void }) {
  const [tpls, setTpls] = useState<SmsTpl[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    try {
      const data = await api<SmsTpl[]>('/superadmin/sms-templates');
      const list = data ?? [];
      setTpls(list);
      const d: Record<string, string> = {};
      list.forEach((t) => (d[t.id] = t.text));
      setDrafts(d);
    } catch (e) {
      console.error(e);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function save(t: SmsTpl) {
    setSavingId(t.id);
    try {
      await api(`/superadmin/sms-templates/${t.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ text: drafts[t.id] ?? '' }),
      });
      onToast('Plantilla guardada');
      load();
    } catch (e: any) {
      onToast(e.message ?? 'Error');
    } finally {
      setSavingId(null);
    }
  }

  if (tpls.length === 0) return null;

  const marcaTpls = tpls.filter((t) => t.group === 'marca');

  const renderCard = (t: SmsTpl) => {
          const draft = drafts[t.id] ?? '';
          const dirty = draft !== t.text;
          return (
            <div
              key={t.id}
              className="rounded-[14px] p-5"
              style={{
                background: 'white',
                border: '1px solid #e7e9ec',
                boxShadow: '0 1px 2px rgba(16,24,40,.04)',
              }}
            >
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h3 className="m-0" style={{ fontSize: 15, fontWeight: 800, color: '#16241c' }}>
                  {t.label}
                </h3>
                {t.isCustom && (
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-[6px]"
                    style={{ background: '#dbeafe', color: '#1d4ed8' }}
                  >
                    Editado
                  </span>
                )}
              </div>
              <p className="text-xs mb-2" style={{ color: '#6b7785' }}>
                {t.description}
              </p>
              <textarea
                value={draft}
                onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                rows={3}
                className="w-full text-sm"
                style={{
                  padding: '10px 12px',
                  borderRadius: 9,
                  border: '1px solid #d7dbe0',
                  background: 'white',
                  color: '#16241c',
                  resize: 'vertical',
                }}
              />
              <div className="flex items-center justify-between gap-3 mt-2 flex-wrap">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {t.vars.map((v) => (
                    <code
                      key={v}
                      className="text-[11px] px-1.5 py-0.5 rounded"
                      style={{ background: '#f4f5f7', color: '#15803d' }}
                    >
                      {`{${v}}`}
                    </code>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px]" style={{ color: draft.length > 160 ? '#b45309' : '#9aa4af' }}>
                    {draft.length}/160
                  </span>
                  <button
                    onClick={() => setDrafts((d) => ({ ...d, [t.id]: t.default }))}
                    className="text-[12px] font-semibold"
                    style={{ color: '#6b7785' }}
                  >
                    Restaurar default
                  </button>
                  <button
                    onClick={() => save(t)}
                    disabled={!dirty || savingId === t.id}
                    className="text-sm font-bold px-4 py-2 rounded-[10px] text-white"
                    style={{
                      background: !dirty ? '#9ca3af' : 'linear-gradient(180deg, #28c95f, #16a34a)',
                      cursor: !dirty ? 'default' : 'pointer',
                    }}
                  >
                    {savingId === t.id ? 'Guardando…' : 'Guardar'}
                  </button>
                </div>
              </div>
            </div>
          );
  };

  const groupHeader = (title: string, subtitle: string) => (
    <div className="mt-6 mb-3">
      <h3 className="m-0" style={{ fontSize: 14, fontWeight: 800, color: '#16241c' }}>
        {title}
      </h3>
      <p className="text-xs mt-0.5" style={{ color: '#6b7785' }}>
        {subtitle}
      </p>
    </div>
  );

  return (
    <div className="mt-9">
      <h2 className="m-0" style={{ fontSize: 20, fontWeight: 800, color: '#16241c' }}>
        Plantillas de SMS
      </h2>
      <p className="text-sm mt-1 mb-2" style={{ color: '#6b7785' }}>
        Textos que el sistema envía automáticamente. Dejá el campo vacío para
        volver al texto por defecto. Usá las variables{' '}
        <span className="font-mono">{'{token}'}</span> donde corresponda.
      </p>

      {/* #4: la sección "Cliente final (cobro Hotmart)" se eliminó — esos SMS
          ya no se usan. Solo quedan las notificaciones a la marca blanca. */}
      {marcaTpls.length > 0 && (
        <>
          {groupHeader(
            'Marca blanca (créditos)',
            'Las envía Clubify a la marca blanca (a su teléfono de notificaciones).',
          )}
          <div className="space-y-4">{marcaTpls.map(renderCard)}</div>
        </>
      )}
    </div>
  );
}
