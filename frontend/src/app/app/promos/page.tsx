'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { ImageUploader } from '@/components/ImageUploader';

type Promo = {
  id: string;
  name: string;
  description: string;
  imageUrl: string | null;
  type: string;
  value: number;
  originalPrice: number | null;
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
    try {
      setList(await api('/promotions'));
    } catch (e: any) {
      toast(e.message || 'Error cargando promociones', 'error');
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function save(p: Partial<Promo>) {
    const body = {
      name: p.name,
      description: p.description,
      imageUrl: p.imageUrl ?? undefined,
      type: p.type,
      value: Number(p.value ?? 0),
      originalPrice:
        p.originalPrice !== null && p.originalPrice !== undefined
          ? Number(p.originalPrice)
          : undefined,
      conditions: p.conditions ?? {},
      validFrom: p.validFrom || undefined,
      validUntil: p.validUntil || undefined,
      isActive: p.isActive ?? true,
    };
    try {
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
      toast(p.id ? 'Promoción actualizada' : 'Promoción creada', 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar', 'error');
    }
  }

  async function toggle(p: Promo) {
    try {
      await api(`/promotions/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !p.isActive }),
      });
      load();
    } catch (e: any) {
      toast(e.message || 'No se pudo actualizar', 'error');
    }
  }

  async function remove(id: string) {
    if (!confirm('¿Eliminar promoción?')) return;
    try {
      await api(`/promotions/${id}`, { method: 'DELETE' });
      load();
      toast('Promoción eliminada', 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo eliminar', 'error');
    }
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
              imageUrl: null,
              type: 'DISCOUNT_AMOUNT',
              value: 0,
              originalPrice: null,
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
          <div className="card card-pad text-center py-12 md:col-span-2 lg:col-span-3">
            <div className="text-4xl mb-2">🎁</div>
            <div className="font-semibold">Aún no tienes promociones</div>
            <p className="text-sm text-mute mt-1.5 max-w-md mx-auto">
              Crea una promoción para incentivar pedidos: descuentos %,
              cupones, 2x1, o subtotal mínimo. Se aplican automáticamente al
              carrito en el storefront.
            </p>
            <button
              className="btn-primary mt-4 inline-flex"
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
              <Icon name="plus" /> Crear mi primera promoción
            </button>
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
            {p.imageUrl && (
              <img
                src={p.imageUrl}
                alt=""
                className="w-full h-32 object-cover rounded-lg mt-3"
              />
            )}
            <div className="mt-3 text-sm flex items-baseline gap-2">
              {p.originalPrice && (
                <span className="text-mute line-through text-xs">
                  ${Number(p.originalPrice).toLocaleString('es-CO')}
                </span>
              )}
              <strong className="text-base text-bad">
                {p.type === 'DISCOUNT_PCT'
                  ? `${Number(p.value)}%`
                  : `$${Number(p.value).toLocaleString('es-CO')}`}
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
            <textarea
              className="input"
              rows={2}
              placeholder="Ej: 2 latte por el precio de 1, todos los miércoles."
              value={form.description ?? ''}
              onChange={(e) => update('description', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Foto de la promoción</label>
            <ImageUploader
              value={form.imageUrl ?? null}
              onChange={(url) => update('imageUrl', url)}
              folder="promotions"
            />
            <p className="text-[11px] text-mute mt-1">
              Aparece en el menú del cliente. Recomendado 1:1 (cuadrada).
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Precio regular</label>
              <input
                type="number"
                className="input"
                placeholder="$ antes"
                value={form.originalPrice ?? ''}
                onChange={(e) =>
                  update(
                    'originalPrice',
                    e.target.value ? Number(e.target.value) : null,
                  )
                }
              />
              <p className="text-[11px] text-mute mt-1">
                Aparece tachado al lado del precio promo.
              </p>
            </div>
            <div>
              <label className="label">Precio promo</label>
              <input
                type="number"
                className="input"
                placeholder="$ con descuento"
                value={form.value ?? 0}
                onChange={(e) => update('value', Number(e.target.value))}
              />
              <p className="text-[11px] text-mute mt-1">
                El precio final que paga el cliente.
              </p>
            </div>
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-mute hover:text-ink">
              Opciones avanzadas (tipo, condiciones)
            </summary>
            <div className="mt-3 space-y-3">
              <div>
                <label className="label">Tipo de promoción</label>
                <select
                  className="input"
                  value={form.type ?? 'DISCOUNT_AMOUNT'}
                  onChange={(e) => update('type', e.target.value)}
                >
                  {Object.entries(TYPE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-mute mt-1">
                  Default "$ Descuento" para producto con precio promo. Otros
                  tipos aplican al carrito completo.
                </p>
              </div>
            </div>
          </details>

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
