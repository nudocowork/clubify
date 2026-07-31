'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

// PDF 1256 F3: notificaciones de pedido al CLIENTE final por SMS. Opt-in
// (OFF por defecto) porque cada SMS cuesta. A diferencia de las alertas de
// domicilio, NO se configura un teléfono: el SMS va al número del cliente del
// pedido. Solo se elige activar + qué estados disparan el mensaje. El texto se
// personaliza por marca en Master Admin → Marcas → Automatizaciones.
// Componente agnóstico del endpoint (savePath por props) para reusar contra
// /tenants/:id (admin) o /tenants/me (dueño) si se decide moverlo.

export const CUSTOMER_ORDER_EVENT_OPTIONS: {
  key: string;
  label: string;
  desc: string;
}[] = [
  { key: 'created', label: 'Pedido recibido', desc: 'Apenas el cliente hace su pedido.' },
  { key: 'confirmed', label: 'Confirmado', desc: 'El negocio aceptó el pedido.' },
  { key: 'ready', label: 'Listo', desc: 'Pedido empacado / listo para recoger.' },
  { key: 'on_the_way', label: 'En camino', desc: 'El domicilio salió hacia el cliente.' },
  { key: 'delivered', label: 'Entregado', desc: 'Pedido completado.' },
];

// Default cuando se activa sin elegir: los 2 más útiles y menos ruidosos.
const DEFAULT_EVENTS = ['confirmed', 'on_the_way'];

type CustomerOrderAlertsData = {
  customerOrderAlertsEnabled?: boolean | null;
  customerOrderAlertsEvents?: string[] | null;
};

export function CustomerOrderAlertsCard<T extends CustomerOrderAlertsData>({
  tenant,
  savePath,
  onSaved,
}: {
  tenant: T | null;
  savePath: string;
  onSaved: (t: T) => void;
}) {
  const [enabled, setEnabled] = useState<boolean>(false);
  const [events, setEvents] = useState<string[]>(DEFAULT_EVENTS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    setEnabled(tenant.customerOrderAlertsEnabled ?? false);
    setEvents(
      Array.isArray(tenant.customerOrderAlertsEvents) &&
        tenant.customerOrderAlertsEvents.length > 0
        ? tenant.customerOrderAlertsEvents
        : DEFAULT_EVENTS,
    );
  }, [tenant]);

  if (!tenant) return null;

  function toggleEvent(key: string) {
    setEvents((prev) =>
      prev.includes(key) ? prev.filter((e) => e !== key) : [...prev, key],
    );
  }

  async function save() {
    if (enabled && events.length === 0) {
      toast('Elige al menos un evento que dispare el SMS', 'error');
      return;
    }
    setSaving(true);
    try {
      const updated = await api<T>(savePath, {
        method: 'PATCH',
        body: JSON.stringify({
          customerOrderAlertsEnabled: enabled,
          customerOrderAlertsEvents: events,
        }),
      });
      toast('Notificaciones al cliente guardadas', 'success');
      if (updated) onSaved(updated);
    } catch (e: unknown) {
      toast((e as Error).message || 'No se pudo guardar', 'error');
    } finally {
      setSaving(false);
    }
  }

  const dirty =
    enabled !== (tenant.customerOrderAlertsEnabled ?? false) ||
    JSON.stringify(events) !==
      JSON.stringify(tenant.customerOrderAlertsEvents ?? DEFAULT_EVENTS);

  return (
    <div className="card card-pad mb-4">
      <h2 className="text-base font-semibold m-0 flex items-center gap-2">
        📲 Notificaciones al cliente (SMS)
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
        Manda un SMS automático al <strong>cliente</strong> cuando su pedido
        cambia de estado (al número que dejó en el pedido). Cada SMS tiene costo
        — actívalo solo para los estados que valga la pena avisar.
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
            <div className="font-semibold text-sm">Activar SMS al cliente</div>
            <div className="text-[11px] text-mute leading-snug">
              Si está prendido, los SMS salen automáticamente en los estados que
              elijas abajo.
            </div>
          </div>
        </label>

        <div>
          <label className="label">Estados que disparan el SMS</label>
          <div className="space-y-1">
            {CUSTOMER_ORDER_EVENT_OPTIONS.map((opt) => (
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
          <p className="text-[11px] text-mute italic mt-2">
            El texto de cada mensaje se edita por marca en Master Admin → Marcas
            → Automatizaciones (carpeta Operativas).
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
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
