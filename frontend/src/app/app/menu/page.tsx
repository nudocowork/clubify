'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { ImageUploader } from '@/components/ImageUploader';
import { SortableList, DragHandle } from '@/components/Sortable';

type Category = { id: string; name: string; _count?: { products: number } };
type Variant = { id?: string; name: string; priceDelta: number; isDefault?: boolean };
type Extra = { id?: string; name: string; price: number };
type Product = {
  id: string;
  name: string;
  description: string;
  basePrice: number;
  imageUrl: string | null;
  tags: string[];
  isAvailable: boolean;
  categoryId: string;
  variants: Variant[];
  extras: Extra[];
};

function fmt(n: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n);
}

export default function MenuEditor() {
  const [cats, setCats] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [showCatForm, setShowCatForm] = useState(false);
  const [newCatName, setNewCatName] = useState('');

  async function load(preserveActive = true) {
    const c = await api<Category[]>('/catalog/categories');
    setCats(c);
    if ((!preserveActive || !activeCat) && c.length) setActiveCat(c[0].id);
    const p = await api<Product[]>('/catalog/products');
    setProducts(p);
  }
  useEffect(() => {
    load(false);
  }, []);

  async function createCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCatName.trim()) return;
    await api('/catalog/categories', {
      method: 'POST',
      body: JSON.stringify({ name: newCatName }),
    });
    setNewCatName('');
    setShowCatForm(false);
    load();
  }

  async function deleteCategory(id: string) {
    if (!confirm('¿Eliminar esta categoría y todos sus productos?')) return;
    await api(`/catalog/categories/${id}`, { method: 'DELETE' });
    if (activeCat === id) setActiveCat(null);
    load(false);
  }

  async function reorderCategories(next: Category[]) {
    setCats(next); // optimistic
    await api('/catalog/categories/reorder', {
      method: 'PATCH',
      body: JSON.stringify({ ids: next.map((c) => c.id) }),
    }).catch(() => load());
  }

  async function reorderProducts(next: Product[]) {
    // Replace only this category's products in state
    const others = products.filter((p) => p.categoryId !== activeCat);
    setProducts([...others, ...next]); // optimistic
    await api('/catalog/products/reorder', {
      method: 'PATCH',
      body: JSON.stringify({ ids: next.map((p) => p.id) }),
    }).catch(() => load());
  }

  async function toggle(p: Product) {
    await api(`/catalog/products/${p.id}/availability`, {
      method: 'PATCH',
      body: JSON.stringify({ isAvailable: !p.isAvailable }),
    });
    load();
  }

  async function deleteProduct(id: string) {
    if (!confirm('¿Eliminar producto?')) return;
    await api(`/catalog/products/${id}`, { method: 'DELETE' });
    load();
  }

  function newProduct() {
    if (!activeCat) return;
    setEditing({
      categoryId: activeCat,
      name: '',
      description: '',
      basePrice: 0,
      imageUrl: '',
      tags: [],
      isAvailable: true,
      variants: [],
      extras: [],
    });
  }

  async function saveProduct(p: Partial<Product>) {
    if (p.id) {
      await api(`/catalog/products/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify(p),
      });
    } else {
      await api('/catalog/products', {
        method: 'POST',
        body: JSON.stringify(p),
      });
    }
    setEditing(null);
    load();
  }

  const visibleProducts = products.filter((p) => p.categoryId === activeCat);

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Menú{' '}
          <span className="page-crumb">
            / {cats.length} categorías · {products.length} productos
          </span>
        </h1>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => setShowCatForm(!showCatForm)}>
            <Icon name="plus" /> Categoría
          </button>
          <button
            className="btn-primary"
            onClick={newProduct}
            disabled={!activeCat}
          >
            <Icon name="plus" /> Producto
          </button>
        </div>
      </div>

      {showCatForm && (
        <form onSubmit={createCategory} className="card card-pad mb-4 flex gap-2">
          <input
            className="input flex-1"
            placeholder="Nombre de categoría"
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            autoFocus
          />
          <button className="btn-primary">Crear</button>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        {/* Categorías */}
        <div className="card p-2 self-start">
          {cats.length === 0 && (
            <div className="text-mute text-sm text-center py-6">
              Sin categorías
            </div>
          )}
          <SortableList items={cats} onReorder={reorderCategories}>
            {(c, { dragHandleProps }) => (
              <div
                onClick={() => setActiveCat(c.id)}
                className={`flex items-center gap-2 px-2.5 py-2.5 rounded-lg cursor-pointer transition ${
                  activeCat === c.id
                    ? 'bg-brand-soft text-brand-700'
                    : 'hover:bg-bg2'
                }`}
              >
                <DragHandle {...dragHandleProps} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{c.name}</div>
                  <div className="text-xs text-mute">
                    {c._count?.products ?? 0} productos
                  </div>
                </div>
                <button
                  className="text-mute hover:text-bad p-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteCategory(c.id);
                  }}
                  title="Eliminar"
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            )}
          </SortableList>
        </div>

        {/* Productos */}
        <div className="card overflow-hidden">
          <div className="grid grid-cols-[40px_1fr_120px_120px_120px_120px] bg-bg2 px-3 py-2.5 text-[11px] uppercase tracking-[0.1em] text-mute font-semibold">
            <div></div>
            <div>Producto</div>
            <div>Precio</div>
            <div>Variantes</div>
            <div>Disponible</div>
            <div className="text-right">Acciones</div>
          </div>
          {visibleProducts.length === 0 ? (
            <div className="text-center text-mute p-8 text-sm">
              Sin productos en esta categoría
            </div>
          ) : (
            <SortableList items={visibleProducts} onReorder={reorderProducts}>
              {(p, { dragHandleProps }) => (
                <div className="grid grid-cols-[40px_1fr_120px_120px_120px_120px] items-center px-3 py-3 border-t border-line2 text-sm">
                  <div className="flex items-center justify-center">
                    <DragHandle {...dragHandleProps} />
                  </div>
                  <div>
                    <div className="font-medium">{p.name}</div>
                    {p.tags.length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {p.tags.map((t) => (
                          <span key={t} className="badge badge-info text-[10px]">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="font-medium">{fmt(Number(p.basePrice))}</div>
                  <div className="text-mute text-xs">
                    {p.variants.length}v · {p.extras.length}e
                  </div>
                  <div>
                    <button
                      onClick={() => toggle(p)}
                      className={`badge ${
                        p.isAvailable ? 'badge-ok' : 'badge-mute'
                      } cursor-pointer`}
                    >
                      {p.isAvailable ? 'Visible' : 'Oculto'}
                    </button>
                  </div>
                  <div className="text-right">
                    <button
                      className="btn-link text-xs mr-3"
                      onClick={() => setEditing(p)}
                    >
                      Editar
                    </button>
                    <button
                      className="text-bad text-xs underline"
                      onClick={() => deleteProduct(p.id)}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              )}
            </SortableList>
          )}
        </div>
      </div>

      {editing && (
        <ProductDrawer
          value={editing}
          categories={cats}
          onCancel={() => setEditing(null)}
          onSave={saveProduct}
        />
      )}
    </div>
  );
}

function ProductDrawer({
  value,
  categories,
  onCancel,
  onSave,
}: {
  value: Partial<Product>;
  categories: Category[];
  onCancel: () => void;
  onSave: (p: Partial<Product>) => void;
}) {
  const [form, setForm] = useState<Partial<Product>>(value);

  function update<K extends keyof Product>(k: K, v: any) {
    setForm({ ...form, [k]: v });
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-ink/50" onClick={onCancel} />
      <div className="w-full max-w-md bg-white h-full overflow-auto p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            {form.id ? 'Editar producto' : 'Nuevo producto'}
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
            <label className="label">Categoría</label>
            <select
              className="input"
              value={form.categoryId ?? ''}
              onChange={(e) => update('categoryId', e.target.value)}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Precio base</label>
            <input
              type="number"
              className="input"
              value={form.basePrice ?? 0}
              onChange={(e) => update('basePrice', Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label">Descripción</label>
            <textarea
              className="input"
              value={form.description ?? ''}
              onChange={(e) => update('description', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Imagen del producto</label>
            <ImageUploader
              value={form.imageUrl}
              onChange={(url) => update('imageUrl', url)}
              folder="products"
            />
          </div>
          <div>
            <label className="label">Etiquetas (separadas por coma)</label>
            <input
              className="input"
              value={(form.tags ?? []).join(', ')}
              onChange={(e) =>
                update(
                  'tags',
                  e.target.value
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean),
                )
              }
              placeholder="popular, nuevo, veggie"
            />
          </div>

          <fieldset className="border border-line rounded-lg p-3">
            <legend className="px-1 text-xs font-semibold text-mute">
              Variantes (Tamaños)
            </legend>
            {(form.variants ?? []).map((v, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input
                  className="input flex-1"
                  placeholder="Nombre (ej: Grande)"
                  value={v.name}
                  onChange={(e) => {
                    const arr = [...(form.variants ?? [])];
                    arr[i] = { ...v, name: e.target.value };
                    update('variants', arr);
                  }}
                />
                <input
                  type="number"
                  className="input w-28"
                  placeholder="+precio"
                  value={v.priceDelta}
                  onChange={(e) => {
                    const arr = [...(form.variants ?? [])];
                    arr[i] = { ...v, priceDelta: Number(e.target.value) };
                    update('variants', arr);
                  }}
                />
                <button
                  className="btn-danger px-3"
                  onClick={() => {
                    const arr = [...(form.variants ?? [])];
                    arr.splice(i, 1);
                    update('variants', arr);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              className="btn-link text-xs"
              onClick={() =>
                update('variants', [
                  ...(form.variants ?? []),
                  { name: '', priceDelta: 0 },
                ])
              }
            >
              + Variante
            </button>
          </fieldset>

          <fieldset className="border border-line rounded-lg p-3">
            <legend className="px-1 text-xs font-semibold text-mute">Extras</legend>
            {(form.extras ?? []).map((e, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input
                  className="input flex-1"
                  placeholder="Nombre (ej: Aguacate)"
                  value={e.name}
                  onChange={(ev) => {
                    const arr = [...(form.extras ?? [])];
                    arr[i] = { ...e, name: ev.target.value };
                    update('extras', arr);
                  }}
                />
                <input
                  type="number"
                  className="input w-28"
                  placeholder="precio"
                  value={e.price}
                  onChange={(ev) => {
                    const arr = [...(form.extras ?? [])];
                    arr[i] = { ...e, price: Number(ev.target.value) };
                    update('extras', arr);
                  }}
                />
                <button
                  className="btn-danger px-3"
                  onClick={() => {
                    const arr = [...(form.extras ?? [])];
                    arr.splice(i, 1);
                    update('extras', arr);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              className="btn-link text-xs"
              onClick={() =>
                update('extras', [...(form.extras ?? []), { name: '', price: 0 }])
              }
            >
              + Extra
            </button>
          </fieldset>
        </div>

        <div className="mt-6 flex gap-2">
          <button className="btn-ghost flex-1 justify-center" onClick={onCancel}>
            Cancelar
          </button>
          <button className="btn-primary flex-1 justify-center" onClick={() => onSave(form)}>
            <Icon name="check" /> Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
