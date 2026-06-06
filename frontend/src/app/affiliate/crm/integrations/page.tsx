'use client';

/**
 * /affiliate/crm/integrations — conexión personal a Grow Business (C7).
 *
 * Cada afiliado conecta SU propia subcuenta GB. El sync trae los
 * contactos del location y los importa al CRM del afiliado, deduplicando
 * por externalContactId / phone. Sync manual por ahora; el cron 30min
 * llega en una iteración posterior.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type GbStatus =
  | { connected: false }
  | {
      connected: true;
      locationId: string;
      locationName: string | null;
      connectedAt: string;
      lastSyncAt: string | null;
      lastSyncCount: number | null;
    };

export default function CrmIntegrationsPage() {
  const [status, setStatus] = useState<GbStatus | null>(null);
  const [locationId, setLocationId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    created: number;
    updated: number;
  } | null>(null);

  async function load() {
    try {
      const s = await api<GbStatus>('/crm/integrations/grow-business');
      setStatus(s);
    } catch (e: any) {
      toast(e?.message || 'Error cargando estado', 'error');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (!locationId.trim() || !apiKey.trim()) return;
    setBusy(true);
    try {
      await api('/crm/integrations/grow-business', {
        method: 'POST',
        body: JSON.stringify({
          locationId: locationId.trim(),
          apiKey: apiKey.trim(),
        }),
      });
      toast('Grow Business conectado', 'success');
      setLocationId('');
      setApiKey('');
      await load();
    } catch (err: any) {
      toast(err?.message || 'No se pudo conectar', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (
      !confirm(
        '¿Desconectar Grow Business? Los contactos importados quedan en tu CRM, pero el sync se detiene.',
      )
    )
      return;
    setBusy(true);
    try {
      await api('/crm/integrations/grow-business', { method: 'DELETE' });
      toast('Desconectado', 'success');
      await load();
    } catch (err: any) {
      toast(err?.message || 'No se pudo desconectar', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    setBusy(true);
    setSyncResult(null);
    try {
      const r = await api<{ created: number; updated: number }>(
        '/crm/integrations/grow-business/sync',
        { method: 'POST' },
      );
      setSyncResult(r);
      toast(
        `Sync OK · ${r.created} nuevos · ${r.updated} actualizados`,
        'success',
      );
      await load();
    } catch (err: any) {
      toast(err?.message || 'Error en sync', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return (
      <div className="space-y-3">
        <div className="h-10 bg-bg2 rounded animate-shimmer" />
        <div className="h-32 bg-bg2 rounded animate-shimmer" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="page-head">
        <h1 className="page-title">
          Integraciones <span className="page-crumb">/ CRM</span>
        </h1>
        <Link href="/affiliate/crm" className="btn-ghost text-sm">
          ← Kanban
        </Link>
      </div>

      <div className="card card-pad mb-4">
        <div className="flex items-start gap-3 mb-3">
          <div className="text-2xl">📲</div>
          <div>
            <h2 className="font-semibold">Grow Business · WhatsApp</h2>
            <p className="text-xs text-mute mt-1 leading-relaxed">
              Conecta tu subcuenta de Grow Business para importar contactos
              automáticamente desde el WhatsApp conectado. Los contactos que
              ya existen en tu CRM se actualizan sin duplicar.
            </p>
          </div>
        </div>

        {status.connected ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-ok-soft text-ok-ink px-3 py-2 text-sm">
              <div className="font-semibold">
                ✓ Conectado a{' '}
                {status.locationName ? (
                  <strong>{status.locationName}</strong>
                ) : (
                  <span className="font-mono text-xs">
                    {status.locationId}
                  </span>
                )}
              </div>
              <div className="text-xs mt-1 opacity-80">
                {status.lastSyncAt
                  ? `Último sync: ${new Date(status.lastSyncAt).toLocaleString('es-CO')} · ${status.lastSyncCount ?? 0} contactos`
                  : 'Nunca sincronizado aún'}
              </div>
            </div>

            {syncResult && (
              <div className="rounded-lg bg-bg2 px-3 py-2 text-xs">
                ➕ {syncResult.created} nuevos · ✏️ {syncResult.updated} actualizados
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary"
                onClick={sync}
                disabled={busy}
              >
                {busy ? 'Sincronizando…' : '🔄 Sincronizar ahora'}
              </button>
              <button
                type="button"
                className="btn-ghost text-bad"
                onClick={disconnect}
                disabled={busy}
              >
                Desconectar
              </button>
            </div>
            <p className="text-[11px] text-mute leading-snug">
              El sync trae hasta 1.000 contactos por vez. Si tu cuenta tiene
              más, corré el sync varias veces. Próximamente: sync automático
              cada 30 minutos.
            </p>
          </div>
        ) : (
          <form onSubmit={connect} className="space-y-3">
            <div>
              <label className="label">Location ID</label>
              <input
                className="input"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                placeholder="ej: LDpPaqGv0EaNJ1XX..."
                maxLength={80}
                required
              />
              <p className="text-[11px] text-mute mt-1">
                Lo encuentras en Grow Business → Settings → Business Profile.
              </p>
            </div>
            <div>
              <label className="label">API Key</label>
              <input
                className="input font-mono text-xs"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="eyJhbGc..."
                type="password"
                maxLength={500}
                required
              />
              <p className="text-[11px] text-mute mt-1">
                Settings → API → Generate API Key. Pega el token completo.
              </p>
            </div>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Verificando…' : 'Conectar'}
            </button>
            <p className="text-[11px] text-mute leading-snug">
              Verificamos la conexión contra Grow Business antes de guardar.
              Si las credenciales son inválidas, no se persisten.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
