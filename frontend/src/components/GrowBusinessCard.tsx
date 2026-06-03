'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from './Toast';
import { Icon } from './Icon';

type Status = {
  connected: boolean;
  locationId: string | null;
  connectedAt: string | null;
  switchNumber: number | null;
};

/**
 * Card de admin para conectar/desconectar el sub-account de "Grow Business"
 * (proveedor externo de SMS) con un tenant. Solo se renderiza dentro del
 * panel SUPER_ADMIN. Nunca expone que el provider real es GoHighLevel.
 */
export function GrowBusinessCard({
  tenantId,
  planName,
}: {
  tenantId: string;
  planName?: string | null;
}) {
  const isElite = planName === 'Elite';
  const isPro = planName === 'Pro';
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [locationId, setLocationId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [switchNumber, setSwitchNumber] = useState<string>('');
  const [working, setWorking] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const s = await api<Status>(`/admin/tenants/${tenantId}/grow-business`);
      setStatus(s);
      if (s.locationId) setLocationId(s.locationId);
      setSwitchNumber(s.switchNumber != null ? String(s.switchNumber) : '');
    } catch (e: any) {
      toast(e.message || 'Error cargando estado de Grow Business', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, [tenantId]);

  async function connect() {
    if (!locationId.trim() || !apiKey.trim()) {
      toast('Location ID y API key son obligatorios', 'error');
      return;
    }
    const sn = switchNumber.trim();
    // Si el admin dejó el campo vacío Y antes tenía un switch, quiere
    // LIMPIARLO. Mandamos null explícito al backend para que se borre,
    // en lugar de undefined que preservaría el valor anterior.
    const hadSwitchBefore = status?.switchNumber != null;
    const parsedSwitch = sn
      ? Number(sn)
      : hadSwitchBefore
      ? null
      : undefined;
    if (
      parsedSwitch !== undefined &&
      parsedSwitch !== null &&
      (!Number.isInteger(parsedSwitch) || parsedSwitch < 1)
    ) {
      toast('El switch debe ser un entero ≥ 1 (o vacío)', 'error');
      return;
    }
    setWorking(true);
    try {
      await api(`/admin/tenants/${tenantId}/grow-business`, {
        method: 'POST',
        body: JSON.stringify({
          locationId: locationId.trim(),
          apiKey: apiKey.trim(),
          ...(parsedSwitch !== undefined ? { switchNumber: parsedSwitch } : {}),
        }),
      });
      toast('Negocio conectado a Grow Business', 'success');
      setApiKey('');
      setEditing(false);
      load();
    } catch (e: any) {
      toast(e.message || 'No se pudo conectar', 'error');
    } finally {
      setWorking(false);
    }
  }

  /** Actualiza solo el switch number — sin re-pedir credenciales. */
  async function saveSwitch() {
    const sn = switchNumber.trim();
    const parsed = sn ? Number(sn) : null;
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1)) {
      toast('El switch debe ser un entero ≥ 1 (o vacío)', 'error');
      return;
    }
    setWorking(true);
    try {
      await api(`/admin/tenants/${tenantId}/grow-business/switch`, {
        method: 'PATCH',
        body: JSON.stringify({ switchNumber: parsed }),
      });
      toast(
        parsed != null
          ? `Switch ${parsed} guardado · cada SMS se prefijará con #Switch${parsed}`
          : 'Switch removido · los SMS irán sin prefijo',
        'success',
      );
      load();
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar el switch', 'error');
    } finally {
      setWorking(false);
    }
  }

  async function testConn() {
    setWorking(true);
    try {
      const r = await api<{ ok: boolean; locationName?: string; message?: string }>(
        `/admin/tenants/${tenantId}/grow-business/test`,
        { method: 'POST' },
      );
      if (r.ok) {
        toast(
          r.locationName
            ? `Conexión OK — Location: ${r.locationName}`
            : 'Conexión OK',
          'success',
        );
      } else {
        toast(r.message || 'Conexión inválida', 'error');
      }
    } catch (e: any) {
      toast(e.message || 'Error probando conexión', 'error');
    } finally {
      setWorking(false);
    }
  }

  async function disconnect() {
    if (!confirm('¿Desconectar este negocio de Grow Business? Dejará de poder enviar SMS.')) {
      return;
    }
    setWorking(true);
    try {
      await api(`/admin/tenants/${tenantId}/grow-business`, { method: 'DELETE' });
      toast('Desconectado', 'success');
      setLocationId('');
      setApiKey('');
      load();
    } catch (e: any) {
      toast(e.message || 'No se pudo desconectar', 'error');
    } finally {
      setWorking(false);
    }
  }

  if (loading) return <div className="card card-pad h-32 animate-shimmer" />;

  const connected = status?.connected;

  return (
    <div
      className={`card card-pad md:col-span-2 ${
        isElite && !connected ? 'border-2 border-amber-300 bg-amber-50/30' : ''
      }`}
    >
      {isElite && (
        <div className="text-[10px] uppercase tracking-[0.18em] text-amber-700 font-bold mb-2 flex items-center gap-1.5">
          <span>⚡</span> Recomendado para plan Elite
        </div>
      )}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold m-0">Grow Business · SMS</h2>
            {connected ? (
              <span className="badge badge-ok">Conectado</span>
            ) : (
              <span className="badge bg-bg2 text-mute">Sin conectar</span>
            )}
            {planName && (
              <span className="badge badge-info text-[10px]">
                Plan: {planName}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-mute">
            {isPro
              ? 'Plan Pro ya incluye automatizaciones de WhatsApp. SMS es opcional como canal complementario.'
              : isElite
              ? 'Plan Elite no incluye automatizaciones — conecta el sub-account de Grow Business para habilitar SMS desde este negocio.'
              : 'Habilita el envío de SMS desde este negocio usando el sub-account de Grow Business asignado por el equipo.'}
          </p>
          {connected && status?.connectedAt && (
            <div className="text-xs text-mute mt-1">
              Conectado el{' '}
              {new Date(status.connectedAt).toLocaleDateString('es-CO', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}{' '}
              · Location <code className="text-ink">{status.locationId}</code>
              {status.switchNumber != null && (
                <>
                  {' '}
                  · Prefijo{' '}
                  <code className="text-ink">#Switch{status.switchNumber}</code>
                </>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {connected && !editing && (
            <>
              <button className="btn-ghost text-sm" onClick={testConn} disabled={working}>
                <Icon name="check" /> Probar conexión
              </button>
              <button
                className="btn-ghost text-sm"
                onClick={() => setEditing(true)}
                disabled={working}
              >
                Cambiar credenciales
              </button>
              <button
                className="text-sm text-bad underline"
                onClick={disconnect}
                disabled={working}
              >
                Desconectar
              </button>
            </>
          )}
        </div>
      </div>

      {/* Switch number — visible siempre que esté conectado, sin re-editar
          credenciales. El admin lo ajusta independiente de locationId/apiKey. */}
      {connected && !editing && (
        <div className="mt-4 pt-4 border-t border-line">
          <label className="label">Número de Switch (workflow Grow Business)</label>
          <div className="flex gap-2 items-center">
            <div className="flex items-center gap-1">
              <span className="text-mute font-mono text-sm">#Switch</span>
              <input
                className="input font-mono text-sm w-[80px]"
                type="number"
                min={1}
                placeholder="—"
                value={switchNumber}
                onChange={(e) => setSwitchNumber(e.target.value)}
              />
            </div>
            <button
              className="btn-ghost text-sm"
              onClick={saveSwitch}
              disabled={
                working ||
                String(status?.switchNumber ?? '') === switchNumber.trim()
              }
            >
              Guardar switch
            </button>
          </div>
          <div className="text-[11px] text-mute mt-1.5 leading-relaxed">
            Cada SMS saliente se prefijará con{' '}
            <code className="text-ink">#Switch{switchNumber || 'N'}</code> +
            doble salto, lo que permite que el workflow de Grow Business
            enrute al sub-canal correcto. Deja vacío para enviar sin
            prefijo.
          </div>
        </div>
      )}

      {(editing || !connected) && (
        <div className="mt-4 grid gap-3">
          <div>
            <label className="label">Location ID</label>
            <input
              className="input"
              placeholder="Ej: ve9EPM428h8vShlRW1KT"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              autoComplete="off"
            />
            <div className="text-[11px] text-mute mt-1">
              Identificador del sub-account dentro de Grow Business.
            </div>
          </div>
          <div>
            <label className="label flex items-center justify-between">
              <span>API Key del sub-account</span>
              <button
                type="button"
                onClick={() => setShowApiKey((v) => !v)}
                className="text-[11px] text-brand"
              >
                {showApiKey ? 'Ocultar' : 'Mostrar'}
              </button>
            </label>
            <input
              className="input font-mono text-xs"
              type={showApiKey ? 'text' : 'password'}
              placeholder="API key privada"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
            />
            <div className="text-[11px] text-mute mt-1">
              Se guarda cifrada en la base de datos. El dueño del negocio NO
              la ve.
            </div>
          </div>
          <div>
            <label className="label">Número de Switch (opcional)</label>
            <div className="flex items-center gap-1">
              <span className="text-mute font-mono text-sm">#Switch</span>
              <input
                className="input font-mono text-sm w-[100px]"
                type="number"
                min={1}
                placeholder="1, 2, 3…"
                value={switchNumber}
                onChange={(e) => setSwitchNumber(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="text-[11px] text-mute mt-1">
              Si lo configuras, los SMS se prefijan con{' '}
              <code className="text-ink">#Switch{switchNumber || 'N'}</code>{' '}
              para que el workflow de Grow Business pueda enrutar.
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            {editing && (
              <button
                className="btn-ghost text-sm"
                onClick={() => {
                  setEditing(false);
                  setApiKey('');
                  setLocationId(status?.locationId ?? '');
                }}
                disabled={working}
              >
                Cancelar
              </button>
            )}
            <button
              className="btn-primary text-sm"
              onClick={connect}
              disabled={working || !locationId.trim() || !apiKey.trim()}
            >
              {working ? 'Guardando…' : connected ? 'Actualizar conexión' : 'Conectar'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
