'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';

type Promo = {
  id: string;
  name: string;
  description: string;
  type: string;
  value: number;
  conditions: any;
  validFrom: string | null;
  validUntil: string | null;
  isActive: boolean;
};

const TYPE_LABEL: Record<string, string> = {
  DISCOUNT_PCT: '% Descuento',
  DISCOUNT_AMOUNT: '$ Descuento',
  BUY_X_GET_Y: '2x1',
  COMBO: 'Combo',
  FREE_ITEM: 'Producto gratis',
};

export default function PromosPage() {
  const [list, setList] = useState<Promo[]>([]);
  const [editing, setEditing] = useState<Partial<Promo> | null>(null);

  async function load() {
    setList(await api('/promotions'));
  }
  useEffect(() => {
    load();
  }, []);

  async function save(p: Partial<Promo>) {
    const body = {
      name: p.name,
      description: p.description,
      type: p.type,
      value: Number(p.value ?? 0),
      conditions: p.conditions ?? {},
      validFrom: p.validFrom || undefined,
      validUntil: p.validUntil || undefined,
      isActive: p.isActive ?? true,
    };
    if (p.id) {
      await api(`/promotions/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    } else {
      await api('/promotions', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    }
    setEditing(null);
    load();
  }

  async function toggle(p: Promo) {
    await api(`/promotions/${p.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !p.isActive }),
    });
    load();
  }

  async function remove(id: string) {
    if (!confirm('¿Eliminar promoción?')) return;
    await api(`/promotions/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Promociones <span className="page-crumb">/ {list.length} configuradas</span>
        </h1>
        <button
          className="btn-primary"
          onClick={() =>
            setEditing({
              name: '',
              description: '',
              type: 'DISCOUNT_PCT',
              value: 10,
              conditions: {},
              isActive: true,
            })
          }
        >
          <Icon name="plus" /> Nueva promoción
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {list.length === 0 && (
          <div className="card card-pad text-mute md:col-span-2 lg:col-span-3">
            Sin promociones. Crea una para incentivar pedidos.
          </div>
        )}
        {list.map((p) => (
          <div key={p.id} className="card card-pad">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold">{p.name}</div>
                <div className="text-xs text-mute mt-0.5">{p.description}</div>
              </div>
              <span
                className={`badge ${p.isActive ? 'badge-ok' : 'badge-mute'}`}
              >
                {p.isActive ? 'Activa' : 'Pausa'}
              </span>
            </div>
            <div className="mt-4 text-sm">
              <span className="text-mute">{TYPE_LABEL[p.type]}: </span>
              <strong>
                {p.type === 'DISCOUNT_PCT'
                  ? `${Number(p.value)}%`
                  : p.type === 'DISCOUNT_AMOUNT'
                  ? `$${Number(p.value).toLocaleString('es-CO')}`
                  : Number(p.value)}
              </strong>
            </div>
            {p.validUntil && (
              <div className="text-xs text-mute mt-1">
                Hasta {new Date(p.validUntil).toLocaleDateString('es-CO')}
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <button className="btn-link text-xs" onClick={() => setEditing(p)}>
                Editar
              </button>
              <button className="btn-link text-xs" onClick={() => toggle(p)}>
                {p.isActive ? 'Pausar' : 'Activar'}
              </button>
              <button
                className="text-bad text-xs underline ml-auto"
                onClick={() => remove(p.id)}
              >
                Eliminar
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <PromoDrawer
          value={editing}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

function PromoDrawer({
  value,
  onCancel,
  onSave,
}: {
  value: Partial<Promo>;
  onCancel: () => void;
  onSave: (p: Partial<Promo>) => void;
}) {
  const [form, setForm] = useState<Partial<Promo>>(value);

  function update<K extends keyof Promo>(k: K, v: any) {
    setForm({ ...form, [k]: v });
  }

  function updateCond(k: string, v: any) {
    setForm({ ...form, conditions: { ...(form.conditions ?? {}), [k]: v } });
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-ink/50" onClick={onCancel} />
      <div className="w-full max-w-md bg-white h-full overflow-auto p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            {form.id ? 'Editar promoción' : 'Nueva promoción'}
          </h2>
          <button onClick={onCancel} className="text-mute hover:text-ink">
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">Nombre</label>
            <input
              className="input"
              value={form.name ?? ''}
              onChange={(e) => update('name', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Descripción</label>
            <input
              className="input"
              value={form.description ?? ''}
              onChange={(e) => update('description', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Tipo</label>
              <select
                className="input"
                value={form.type ?? 'DISCOUNT_PCT'}
                onChange={(e) => update('type', e.target.value)}
              >
                {Object.entries(TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Valor</label>
              <input
                type="number"
                className="input"
                value={form.value ?? 0}
                onChange={(e) => update('value', Number(e.target.value))}
              />
            </div>
          </div>

          <fieldset className="border border-line rounded-lg p-3">
            <legend className="px-1 text-xs font-semibold text-mute">
              Condiciones (opcional)
            </legend>
            <div>
              <label className="label">Subtotal mínimo</label>
              <input
                type="number"
                className="input"
                value={form.conditions?.minSubtotal ?? ''}
                onChange={(e) =>
                  updateCond(
                    'minSubtotal',
                    e.target.value ? Number(e.target.value) : undefined,
                  )
                }
              />
            </div>
            <div className="mt-3">
              <label className="label">Días de la semana (0=Dom, 6=Sáb)</label>
              <input
                className="input"
                placeholder="ej: 1,2,3 (lun, mar, mié)"
                value={(form.conditions?.daysOfWeek ?? []).join(',')}
                onChange={(e) =>
                  updateCond(
                    'daysOfWeek',
                    e.target.value
                      .split(',')
                      .map((s) => parseInt(s.trim()))
                      .filter((n) => !isNaN(n)),
                  )
                }
              />
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Vigencia desde</label>
              <input
                type="date"
                className="input"
                value={form.validFrom?.split('T')[0] ?? ''}
                onChange={(e) => update('validFrom', e.target.value)}
              />
            </div>
            <div>
              <label className="label">Vigencia hasta</label>
              <input
                type="date"
                className="input"
                value={form.validUntil?.split('T')[0] ?? ''}
                onChange={(e) => update('validUntil', e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-2">
          <button className="btn-ghost flex-1 justify-center" onClick={onCancel}>
            Cancelar
          </button>
          <button
            className="btn-primary flex-1 justify-center"
            onClick={() => onSave(form)}
          >
            <Icon name="check" /> Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
