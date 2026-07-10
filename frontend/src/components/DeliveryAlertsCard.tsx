'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

// #14 (2026-06-17): config de alertas SMS de domicilio. Movida de la vista
// del dueño (/app/settings) a super-admin (/admin/tenants/[id]). Componente
// compartido y agnóstico del endpoint: `savePath` (PATCH) y `testPath` (POST)
// se pasan por props para reusar contra /tenants/me o /tenants/:id.

export const DELIVERY_EVENT_OPTIONS: { key: string; label: string; desc: string }[] = [
  { key: 'created', label: 'Pedido nuevo', desc: 'Cliente acaba de hacer un pedido delivery.' },
  { key: 'confirmed', label: 'Confirmado', desc: 'El negocio aceptó el pedido en el panel.' },
  { key: 'ready', label: 'Listo para recoger', desc: 'Pedido empacado, esperando courier.' },
  { key: 'delivered', label: 'Entregado', desc: 'Pedido completado.' },
];

// Default de eventos: "Listo para recoger" (#14).
const DEFAULT_EVENTS = ['ready'];

type DeliveryAlertsData = {
  deliveryAlertsEnabled?: boolean | null;
  deliveryAlertsPhones?: string[] | null;
  deliveryAlertsEvents?: string[] | null;
};

export function DeliveryAlertsCard<T extends DeliveryAlertsData>({
  tenant,
  savePath,
  testPath,
  onSaved,
}: {
  tenant: T | null;
  savePath: string;
  testPath: string;
  onSaved: (t: T) => void;
}) {
  const [enabled, setEnabled] = useState<boolean>(false);
  const [phones, setPhones] = useState<string[]>([]);
  const [events, setEvents] = useState<string[]>(DEFAULT_EVENTS);
  const [draftPhone, setDraftPhone] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    setEnabled(tenant.deliveryAlertsEnabled ?? false);
    setPhones(
      Array.isArray(tenant.deliveryAlertsPhones) ? tenant.deliveryAlertsPhones : [],
    );
    setEvents(
      Array.isArray(tenant.deliveryAlertsEvents) && tenant.deliveryAlertsEvents.length > 0
        ? tenant.deliveryAlertsEvents
        : DEFAULT_EVENTS,
    );
  }, [tenant]);

  if (!tenant) return null;

  function addPhone() {
    const v = draftPhone.trim();
    if (!v || v.length < 6) {
      toast('Teléfono inválido', 'error');
      return;
    }
    if (phones.includes(v)) {
      toast('Ya está en la lista', 'error');
      return;
    }
    setPhones([...phones, v]);
    setDraftPhone('');
  }

  function removePhone(p: string) {
    setPhones(phones.filter((x) => x !== p));
  }

  function toggleEvent(key: string) {
    if (events.includes(key)) {
      setEvents(events.filter((e) => e !== key));
    } else {
      setEvents([...events, key]);
    }
  }

  async function save() {
    if (enabled && phones.length === 0) {
      toast('Agrega al menos un teléfono o desactiva las alertas', 'error');
      return;
    }
    if (enabled && events.length === 0) {
      toast('Elige al menos un evento que dispare el SMS', 'error');
      return;
    }
    setSaving(true);
    try {
      const updated = await api<T>(savePath, {
        method: 'PATCH',
        body: JSON.stringify({
          deliveryAlertsEnabled: enabled,
          deliveryAlertsPhones: phones,
          deliveryAlertsEvents: events,
        }),
      });
      toast('Alertas de domicilio guardadas', 'success');
      if (updated) onSaved(updated);
    } catch (e: unknown) {
      toast((e as Error).message || 'No se pudo guardar', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      // Enviamos los teléfonos que están EN PANTALLA (aunque no se haya dado
      // "Guardar cambios" aún) para probar exactamente lo que el usuario ve.
      const res = await api<{
        ok: boolean;
        total: number;
        okCount: number;
        results: { phone: string; ok: boolean; message: string | null }[];
      }>(testPath, { method: 'POST', body: JSON.stringify({ phones }) });
      if (res?.ok) {
        toast(
          `SMS aceptado por el proveedor para ${res.okCount}/${res.total} número(s). ` +
            'Si no llega en 1-2 min, verifica que la subcuenta pueda enviar SMS a ese país.',
          'success',
        );
      } else {
        const firstErr = res?.results?.find((r) => !r.ok)?.message;
        toast(
          firstErr
            ? `No se pudo enviar: ${firstErr}`
            : 'Ningún SMS pudo enviarse — revisa credenciales y números',
          'error',
        );
      }
    } catch (e: unknown) {
      toast((e as Error).message || 'No se pudo probar', 'error');
    } finally {
      setTesting(false);
    }
  }

  const dirty =
    enabled !== (tenant.deliveryAlertsEnabled ?? false) ||
    JSON.stringify(phones) !== JSON.stringify(tenant.deliveryAlertsPhones ?? []) ||
    JSON.stringify(events) !== JSON.stringify(tenant.deliveryAlertsEvents ?? DEFAULT_EVENTS);

  return (
    <div className="card card-pad mb-4">
      <h2 className="text-base font-semibold m-0 flex items-center gap-2">
        🛵 Alertas SMS de domicilio
        {enabled ? (
          <span className="text-[10px] font-bold uppercase tracking-wider bg-ok/15 text-ok px-2 py-0.5 rounded-full">
            Activas
          </span>
        ) : (
          <span className="text-[10px] font-bold uppercase tracking-wider bg-bg2 text-mute px-2 py-0.5 rounded-full">
            Inactivas
          </span>
        )}
      </h2>
      <p className="text-xs text-mute mt-1 leading-relaxed">
        Manda un SMS automático a una o varias empresas/personas de domicilio
        cuando un pedido delivery cambia de estado.
      </p>

      <div className="mt-4 space-y-4">
        <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg bg-bg2/40">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="w-5 h-5 accent-brand"
          />
          <div>
            <div className="font-semibold text-sm">Activar alertas SMS</div>
            <div className="text-[11px] text-mute leading-snug">
              Si está prendido, los SMS salen automáticamente en los eventos que
              elijas abajo.
            </div>
          </div>
        </label>

        <div>
          <label className="label">Teléfonos destino</label>
          <div className="flex gap-2">
            <input
              type="tel"
              className="input flex-1"
              placeholder="+57 300 000 0000"
              value={draftPhone}
              onChange={(e) => setDraftPhone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addPhone();
                }
              }}
              maxLength={40}
            />
            <button type="button" onClick={addPhone} className="btn-ghost text-sm">
              + Agregar
            </button>
          </div>
          {phones.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {phones.map((p) => (
                <span
                  key={p}
                  className="inline-flex items-center gap-1.5 bg-bg2 text-ink px-2 py-1 rounded-pill text-xs"
                >
                  {p}
                  <button
                    type="button"
                    onClick={() => removePhone(p)}
                    className="text-mute hover:text-bad font-bold"
                    title="Quitar"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-mute italic mt-1">
              Sin teléfonos configurados — sin esto las alertas no salen.
            </div>
          )}
        </div>

        <div>
          <label className="label">Eventos que disparan el SMS</label>
          <div className="space-y-1">
            {DELIVERY_EVENT_OPTIONS.map((opt) => (
              <label
                key={opt.key}
                className="flex items-start gap-2 cursor-pointer p-2 rounded hover:bg-bg2/40"
              >
                <input
                  type="checkbox"
                  checked={events.includes(opt.key)}
                  onChange={() => toggleEvent(opt.key)}
                  className="w-4 h-4 accent-brand mt-0.5"
                />
                <div>
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-[11px] text-mute">{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-line">
          <button
            type="button"
            onClick={test}
            disabled={testing || phones.length === 0}
            className="btn-ghost text-sm disabled:opacity-50"
            title={
              phones.length === 0
                ? 'Agrega al menos un teléfono'
                : 'Manda un SMS de prueba ya mismo'
            }
          >
            {testing ? 'Enviando…' : '📤 Probar SMS'}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="btn-primary text-sm"
          >
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  );
}
