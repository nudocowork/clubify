'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

/**
 * Página super admin para gestionar subcuentas globales de Grow
 * Business. Una subcuenta puede asignarse a múltiples tenants para que
 * todas sus alertas SMS de reseñas salgan por la misma cuenta sin
 * pegar credenciales en cada negocio.
 *
 * Nunca decir "GHL" / "GoHighLevel" en strings visibles — la memoria
 * `project_grow_business_naming.md` es non-negotiable.
 */

type Purpose = 'BILLING' | 'OPERATIONAL' | 'GENERAL';

type Account = {
  id: string;
  name: string;
  purpose: Purpose;
  locationId: string;
  apiKeyPreview: string | null;
  switchNumber: number | null;
  isDefault: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  tenantsCount: number;
  reviewTenantsCount?: number;
  billingTenantsCount?: number;
  createdAt: string;
};

const PURPOSE_META: Record<Purpose, { label: string; emoji: string; description: string }> = {
  BILLING: {
    label: 'Billing — pagos',
    emoji: '💳',
    description:
      'Para recordatorios de pago, avisos de impago y suspensión.',
  },
  OPERATIONAL: {
    label: 'Operativa — reseñas / pedidos',
    emoji: '📣',
    description:
      'Para alertas de reseñas negativas, pedidos delivery y comunicaciones operativas.',
  },
  GENERAL: {
    label: 'General',
    emoji: '⚙️',
    description: 'Subcuenta sin propósito específico — usá para cualquier flujo.',
  },
};

export default function IntegrationsPage() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api<Account[]>(
        '/admin/integrations/grow-business-accounts',
      );
      setAccounts(data);
    } catch (e: any) {
      toast(e.message || 'No se pudo cargar', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function test(id: string) {
    try {
      const res = await api<{ ok: boolean; status?: number; detail?: any; error?: string }>(
        `/admin/integrations/grow-business-accounts/${id}/test`,
        { method: 'POST' },
      );
      if (res.ok) {
        toast('Conexión OK', 'success');
      } else {
        toast(
          `Falló: ${res.error || res.detail?.message || res.status || 'sin detalle'}`,
          'error',
        );
      }
      load();
    } catch (e: any) {
      toast(e.message || 'No se pudo probar', 'error');
    }
  }

  async function remove(id: string, name: string) {
    if (
      !confirm(
        `¿Eliminar la subcuenta "${name}"? Los negocios que la usen volverán a credenciales propias.`,
      )
    )
      return;
    try {
      await api(`/admin/integrations/grow-business-accounts/${id}`, {
        method: 'DELETE',
      });
      toast('Subcuenta eliminada', 'success');
      load();
    } catch (e: any) {
      toast(e.message || 'No se pudo eliminar', 'error');
    }
  }

  return (
    <div className="max-w-4xl">
      <div className="page-head">
        <h1 className="page-title">
          Integraciones SMS{' '}
          <span className="page-crumb">/ Subcuentas Grow Business</span>
        </h1>
        <button
          className="btn-primary"
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
        >
          <Icon name="plus" /> Nueva subcuenta
        </button>
      </div>

      <div className="card card-pad mb-5">
        <h3 className="text-base font-semibold m-0">
          ¿Para qué sirven las subcuentas globales?
        </h3>
        <p className="text-sm text-mute mt-2 leading-relaxed">
          Cada subcuenta es una cuenta de Grow Business (provider SMS).
          Conectala una sola vez acá, y después asignala a cualquier
          negocio desde su detalle (
          <code className="bg-bg2 px-1.5 py-0.5 rounded text-xs">
            /admin/tenants/[id]
          </code>
          ) para que todas sus alertas SMS de reseñas salgan por esa
          cuenta. Sin tener que pegar credenciales en cada tenant.
        </p>
        <p className="text-xs text-mute mt-2 leading-relaxed">
          Si un negocio no tiene subcuenta asignada, el sistema usa las
          credenciales propias del tenant (legacy). Si tampoco las tiene,
          el SMS no se manda.
        </p>
      </div>

      {loading && <div className="text-mute">Cargando…</div>}

      {!loading && accounts?.length === 0 && (
        <div className="card card-pad text-center text-mute">
          Aún no hay subcuentas registradas. Creá la primera con el botón
          arriba a la derecha.
        </div>
      )}

      {!loading && accounts && accounts.length > 0 && (
        <div className="space-y-6">
          {(['BILLING', 'OPERATIONAL', 'GENERAL'] as const).map((purpose) => {
            const inGroup = accounts.filter(
              (a) => (a.purpose ?? 'GENERAL') === purpose,
            );
            if (inGroup.length === 0) return null;
            const meta = PURPOSE_META[purpose];
            return (
              <div key={purpose}>
                <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-mute mb-2 flex items-center gap-2">
                  <span>{meta.emoji}</span>
                  <span>{meta.label}</span>
                </h2>
                <p className="text-[11px] text-mute mb-2">{meta.description}</p>
                <div className="space-y-3">
                  {inGroup.map((acc) => (
            <div key={acc.id} className="card card-pad">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-semibold m-0">{acc.name}</h3>
                    {acc.isDefault && (
                      <span className="text-[10px] uppercase tracking-wider font-bold bg-brand/15 text-brand px-2 py-0.5 rounded-full">
                        Default
                      </span>
                    )}
                    {acc.lastTestOk === true && (
                      <span className="text-[10px] uppercase tracking-wider font-bold bg-ok/15 text-ok px-2 py-0.5 rounded-full">
                        Test OK
                      </span>
                    )}
                    {acc.lastTestOk === false && (
                      <span className="text-[10px] uppercase tracking-wider font-bold bg-bad/15 text-bad px-2 py-0.5 rounded-full">
                        Test falló
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 text-xs text-mute space-y-0.5">
                    <div>
                      <span className="font-semibold">Location ID:</span>{' '}
                      <code className="bg-bg2 px-1.5 py-0.5 rounded text-[11px]">
                        {acc.locationId}
                      </code>
                    </div>
                    <div>
                      <span className="font-semibold">API key:</span>{' '}
                      <code className="bg-bg2 px-1.5 py-0.5 rounded text-[11px]">
                        {acc.apiKeyPreview ?? '—'}
                      </code>
                    </div>
                    {acc.switchNumber != null && (
                      <div>
                        <span className="font-semibold">Switch:</span> #
                        {acc.switchNumber}
                      </div>
                    )}
                    <div>
                      <span className="font-semibold">Negocios usándola:</span>{' '}
                      {acc.tenantsCount}
                      {(acc.reviewTenantsCount != null ||
                        acc.billingTenantsCount != null) && (
                        <span className="text-[10px] ml-1">
                          (reseñas: {acc.reviewTenantsCount ?? 0} · pagos:{' '}
                          {acc.billingTenantsCount ?? 0})
                        </span>
                      )}
                      {acc.lastTestAt && (
                        <>
                          {' '}
                          · Último test:{' '}
                          {new Date(acc.lastTestAt).toLocaleString('es-CO')}
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap shrink-0">
                  <button
                    className="btn-ghost text-xs"
                    onClick={() => test(acc.id)}
                  >
                    Probar
                  </button>
                  <button
                    className="btn-ghost text-xs"
                    onClick={() => {
                      setEditing(acc);
                      setShowForm(true);
                    }}
                  >
                    <Icon name="edit" /> Editar
                  </button>
                  <button
                    className="btn-ghost text-xs text-bad"
                    onClick={() => remove(acc.id, acc.name)}
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <AccountForm
          editing={editing}
          onClose={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSaved={() => {
            setShowForm(false);
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function AccountForm({
  editing,
  onClose,
  onSaved,
}: {
  editing: Account | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? '');
  const [locationId, setLocationId] = useState(editing?.locationId ?? '');
  const [apiKey, setApiKey] = useState('');
  const [switchNumber, setSwitchNumber] = useState<string>(
    editing?.switchNumber != null ? String(editing.switchNumber) : '',
  );
  const [isDefault, setIsDefault] = useState(editing?.isDefault ?? false);
  const [purpose, setPurpose] = useState<Purpose>(editing?.purpose ?? 'GENERAL');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim() || !locationId.trim()) {
      toast('Name y Location ID son obligatorios', 'error');
      return;
    }
    if (!editing && !apiKey.trim()) {
      toast('API key obligatoria para crear', 'error');
      return;
    }
    const sn = switchNumber.trim();
    const parsedSwitch =
      sn === '' ? (editing ? null : undefined) : Number(sn);
    if (
      parsedSwitch !== undefined &&
      parsedSwitch !== null &&
      (!Number.isInteger(parsedSwitch) || parsedSwitch < 1)
    ) {
      toast('Switch debe ser entero ≥ 1 o vacío', 'error');
      return;
    }
    setSaving(true);
    try {
      const body: any = {
        name: name.trim(),
        locationId: locationId.trim(),
        isDefault,
        purpose,
      };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      if (parsedSwitch !== undefined) body.switchNumber = parsedSwitch;
      if (editing) {
        await api(`/admin/integrations/grow-business-accounts/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        toast('Subcuenta actualizada', 'success');
      } else {
        await api('/admin/integrations/grow-business-accounts', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        toast('Subcuenta creada', 'success');
      }
      onSaved();
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl max-w-lg w-full my-8 shadow-2xl"
      >
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <h2 className="text-lg font-bold m-0">
            {editing ? 'Editar subcuenta' : 'Nueva subcuenta Grow Business'}
          </h2>
          <button
            onClick={onClose}
            className="text-mute hover:text-ink text-xl leading-none"
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="label">Nombre interno</label>
            <input
              type="text"
              className="input"
              placeholder="Ej: Subcuenta principal · Bucaramanga"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
            />
            <div className="text-[10px] text-mute mt-1">
              Solo para que vos lo identifiques en este panel.
            </div>
          </div>

          <div>
            <label className="label">Propósito</label>
            <div className="grid grid-cols-3 gap-2">
              {(['BILLING', 'OPERATIONAL', 'GENERAL'] as const).map((p) => {
                const meta = PURPOSE_META[p];
                const active = purpose === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPurpose(p)}
                    className={`text-left px-3 py-2 rounded-lg border-2 transition ${
                      active
                        ? 'border-brand bg-brand/5'
                        : 'border-line bg-white hover:border-mute'
                    }`}
                  >
                    <div className="text-base">{meta.emoji}</div>
                    <div className={`text-xs font-semibold mt-0.5 ${active ? 'text-brand' : 'text-ink'}`}>
                      {meta.label}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="text-[10px] text-mute mt-1">
              {PURPOSE_META[purpose].description}
            </div>
          </div>

          <div>
            <label className="label">Location ID</label>
            <input
              type="text"
              className="input font-mono text-xs"
              placeholder="abcd1234..."
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            />
          </div>

          <div>
            <label className="label">
              API key {editing && <span className="text-[10px] text-mute">(dejá vacío para mantener la actual)</span>}
            </label>
            <input
              type="password"
              className="input font-mono text-xs"
              placeholder={
                editing && editing.apiKeyPreview
                  ? editing.apiKeyPreview
                  : 'eyJhbGc...'
              }
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          <div>
            <label className="label">
              Switch number{' '}
              <span className="text-[10px] text-mute">(opcional)</span>
            </label>
            <input
              type="number"
              className="input"
              min={1}
              placeholder="1, 2, 3..."
              value={switchNumber}
              onChange={(e) => setSwitchNumber(e.target.value)}
            />
            <div className="text-[10px] text-mute mt-1">
              Si esta subcuenta enruta mensajes con prefijo
              <code className="mx-1 bg-bg2 px-1 rounded">#Switch&#123;N&#125;</code>,
              poné el número acá.
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer p-2 rounded bg-bg2/40">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="w-4 h-4 accent-brand"
            />
            <div>
              <div className="text-sm font-semibold">Marcar como default</div>
              <div className="text-[11px] text-mute">
                Esta subcuenta aparece preseleccionada al asignar a un nuevo
                negocio. Solo puede haber una default activa a la vez.
              </div>
            </div>
          </label>
        </div>

        <div className="px-5 py-3 border-t border-line flex justify-end gap-2 bg-bg2/30">
          <button onClick={onClose} className="btn-ghost text-sm" disabled={saving}>
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="btn-primary text-sm"
          >
            {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear subcuenta'}
          </button>
        </div>
      </div>
    </div>
  );
}
