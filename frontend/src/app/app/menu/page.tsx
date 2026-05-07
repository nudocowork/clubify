'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { ImageUploader } from '@/components/ImageUploader';
import { SortableList, DragHandle } from '@/components/Sortable';
import { toast } from '@/components/Toast';

type Category = { id: string; name: string; _count?: { products: number } };
type Variant = { id?: string; name: string; priceDelta: number; isDefault?: boolean; groupName?: string };
type Extra = { id?: string; name: string; price: number };
type Adicional = { id: string; name: string; price: number; isActive: boolean };
type Product = {
  id: string;
  name: string;
  description: string;
  basePrice: number;
  imageUrl: string | null;
  tags: string[];
  isAvailable: boolean;
  isRecommended?: boolean;
  categoryId: string;
  stock: number | null;
  stockAlert: number | null;
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
  const [adicionales, setAdicionales] = useState<Adicional[]>([]);
  const [showAdicionales, setShowAdicionales] = useState(false);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState('');
  const [ordersEnabled, setOrdersEnabled] = useState<boolean | null>(null);
  const [togglingOrders, setTogglingOrders] = useState(false);

  async function load(preserveActive = true) {
    const c = await api<Category[]>('/catalog/categories');
    setCats(c);
    if ((!preserveActive || !activeCat) && c.length) setActiveCat(c[0].id);
    const p = await api<Product[]>('/catalog/products');
    setProducts(p);
  }
  async function loadAdicionales() {
    try {
      const a = await api<Adicional[]>('/catalog/adicionales');
      setAdicionales(a);
    } catch {
      // tabla puede no existir todavía en deploys viejos — silencioso
    }
  }
  useEffect(() => {
    load(false);
    loadAdicionales();
    loadOrdersEnabled();
  }, []);

  async function loadOrdersEnabled() {
    try {
      const sf = await api<{ ordersEnabled: boolean }>('/storefront');
      setOrdersEnabled(sf.ordersEnabled ?? true);
    } catch {
      setOrdersEnabled(true);
    }
  }

  async function toggleOrdersEnabled() {
    if (ordersEnabled === null) return;
    const next = !ordersEnabled;
    if (
      !next &&
      !confirm(
        'Pasar a modo informativo: los clientes verán precios pero NO podrán agregar al carrito ni notificar pedidos. ¿Continuar?',
      )
    ) {
      return;
    }
    setTogglingOrders(true);
    setOrdersEnabled(next); // optimistic
    try {
      await api('/storefront', {
        method: 'PATCH',
        body: JSON.stringify({ ordersEnabled: next }),
      });
      toast(
        next
          ? 'Pedidos habilitados — los clientes pueden agregar al carrito'
          : 'Modo informativo — sin botones de pedido',
        'success',
      );
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
      setOrdersEnabled(!next); // rollback
    } finally {
      setTogglingOrders(false);
    }
  }

  async function createCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCatName.trim()) return;
    try {
      await api('/catalog/categories', {
        method: 'POST',
        body: JSON.stringify({ name: newCatName }),
      });
      setNewCatName('');
      setShowCatForm(false);
      load();
    } catch (e: any) {
      toast(e.message || 'No se pudo crear la categoría', 'error');
    }
  }

  async function deleteCategory(id: string) {
    if (!confirm('¿Eliminar esta categoría y todos sus productos?')) return;
    try {
      await api(`/catalog/categories/${id}`, { method: 'DELETE' });
      if (activeCat === id) setActiveCat(null);
      load(false);
      toast('Categoría eliminada', 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo eliminar', 'error');
    }
  }

  async function renameCategory(id: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const original = cats.find((c) => c.id === id);
    if (original?.name === trimmed) return;
    setCats((prev) => prev.map((c) => (c.id === id ? { ...c, name: trimmed } : c))); // optimistic
    try {
      await api(`/catalog/categories/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: trimmed }),
      });
      toast('Categoría renombrada', 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo renombrar', 'error');
      load(false); // rollback desde server
    }
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
    try {
      await api(`/catalog/products/${p.id}/availability`, {
        method: 'PATCH',
        body: JSON.stringify({ isAvailable: !p.isAvailable }),
      });
      load();
    } catch (e: any) {
      toast(e.message || 'No se pudo cambiar la disponibilidad', 'error');
    }
  }

  async function deleteProduct(id: string) {
    if (!confirm('¿Eliminar producto?')) return;
    try {
      await api(`/catalog/products/${id}`, { method: 'DELETE' });
      load();
      toast('Producto eliminado', 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo eliminar el producto', 'error');
    }
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
      isRecommended: false,
      variants: [],
      extras: [],
    });
  }

  async function saveProduct(p: Partial<Product>) {
    try {
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
      toast(p.id ? 'Producto actualizado' : 'Producto creado', 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar', 'error');
    }
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
        <div className="flex gap-2 flex-wrap">
          {ordersEnabled !== null && (
            <button
              type="button"
              onClick={toggleOrdersEnabled}
              disabled={togglingOrders}
              className={`btn-ghost ${ordersEnabled ? 'text-ok' : 'text-amber-600'}`}
              title={
                ordersEnabled
                  ? 'Pedidos activados — los clientes pueden agregar al carrito'
                  : 'Modo informativo — solo precios, sin carrito'
              }
            >
              {ordersEnabled ? '🛒 Pedidos: ON' : '📋 Solo informativo'}
            </button>
          )}
          <button className="btn-ghost" onClick={() => setShowCatForm(!showCatForm)}>
            <Icon name="plus" /> Categoría
          </button>
          <Link
            href="/app/storefront"
            className="btn-ghost"
            title="Personaliza el aspecto público de tu menú (logo, estilo, layout)"
          >
            🎨 Configura tu menú
          </Link>
          <Link
            href="/app/info-links"
            className="btn-ghost"
            title="Mini-páginas tipo Linktree para campañas y eventos"
          >
            🔗 InfoLinks
          </Link>
          <button className="btn-ghost" onClick={() => setShowAdicionales(true)}>
            <Icon name="plus" /> Adicionales
          </button>
          <Link
            href="/app/promos"
            className="btn-ghost"
            title="Productos en oferta del menú"
          >
            <Icon name="spark" /> Promociones
          </Link>
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
                  {editingCatId === c.id ? (
                    <input
                      autoFocus
                      className="input py-1 text-sm"
                      value={editingCatName}
                      onChange={(e) => setEditingCatName(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={() => {
                        renameCategory(c.id, editingCatName);
                        setEditingCatId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          (e.target as HTMLInputElement).blur();
                        } else if (e.key === 'Escape') {
                          setEditingCatId(null);
                        }
                      }}
                    />
                  ) : (
                    <>
                      <div className="font-medium text-sm truncate">{c.name}</div>
                      <div className="text-xs text-mute">
                        {c._count?.products ?? 0} productos
                      </div>
                    </>
                  )}
                </div>
                <button
                  className="text-mute hover:text-brand p-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingCatId(c.id);
                    setEditingCatName(c.name);
                  }}
                  title="Renombrar"
                >
                  <Icon name="edit" size={14} />
                </button>
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
         <div className="overflow-x-auto">
          <div className="min-w-[680px]">
          <div className="grid grid-cols-[40px_1fr_120px_120px_120px_120px] bg-bg2 px-3 py-2.5 text-[11px] uppercase tracking-[0.1em] text-mute font-semibold">
            <div></div>
            <div>Producto</div>
            <div>Precio</div>
            <div>Variantes</div>
            <div>Disponible</div>
            <div className="text-right">Acciones</div>
          </div>
          {visibleProducts.length === 0 ? (
            <div className="text-center p-12">
              <div className="text-3xl mb-1">🍴</div>
              <div className="font-semibold text-sm">
                Sin productos en esta categoría
              </div>
              <div className="text-mute text-xs mt-1">
                Usa el botón "Nuevo producto" para empezar.
              </div>
            </div>
          ) : (
            <SortableList items={visibleProducts} onReorder={reorderProducts}>
              {(p, { dragHandleProps }) => (
                <div className="grid grid-cols-[40px_1fr_120px_120px_120px_120px] items-center px-3 py-3 border-t border-line2 text-sm">
                  <div className="flex items-center justify-center">
                    <DragHandle {...dragHandleProps} />
                  </div>
                  <div>
                    <div className="font-medium flex items-center gap-1.5">
                      {p.isRecommended && (
                        <span title="Recomendado" className="text-amber-500">
                          ⭐
                        </span>
                      )}
                      {p.name}
                    </div>
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
                  <div className="flex flex-col gap-1 items-start">
                    <button
                      onClick={() => toggle(p)}
                      className={`badge ${
                        p.isAvailable ? 'badge-ok' : 'badge-mute'
                      } cursor-pointer`}
                    >
                      {p.isAvailable ? 'Visible' : 'Oculto'}
                    </button>
                    {p.stock !== null && p.stock !== undefined && (
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                          p.stock === 0
                            ? 'bg-red-100 text-red-800'
                            : p.stockAlert !== null && p.stock <= p.stockAlert
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-bg2 text-mute'
                        }`}
                        title="Stock disponible"
                      >
                        📦 {p.stock}
                      </span>
                    )}
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
        </div>
      </div>

      {editing && (
        <ProductDrawer
          value={editing}
          categories={cats}
          adicionales={adicionales}
          onCancel={() => setEditing(null)}
          onSave={saveProduct}
        />
      )}

      {showAdicionales && (
        <AdicionalesModal
          items={adicionales}
          onClose={() => setShowAdicionales(false)}
          onChange={loadAdicionales}
        />
      )}
    </div>
  );
}

function AdicionalesModal({
  items,
  onClose,
  onChange,
}: {
  items: Adicional[];
  onClose: () => void;
  onChange: () => void;
}) {
  // editingId === null → form de creación; con id → form de edición
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', price: 0 });
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      if (editingId) {
        await api(`/catalog/adicionales/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(form),
        });
        toast('Adicional actualizado', 'success');
      } else {
        await api('/catalog/adicionales', {
          method: 'POST',
          body: JSON.stringify(form),
        });
        toast('Adicional creado', 'success');
      }
      setForm({ name: '', price: 0 });
      setEditingId(null);
      onChange();
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar', 'error');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(a: Adicional) {
    setEditingId(a.id);
    setForm({ name: a.name, price: Number(a.price) });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm({ name: '', price: 0 });
  }

  async function remove(id: string) {
    if (!confirm('¿Eliminar este adicional? Los productos que lo usan no se ven afectados.')) return;
    try {
      await api(`/catalog/adicionales/${id}`, { method: 'DELETE' });
      if (editingId === id) cancelEdit();
      onChange();
    } catch (e: any) {
      toast(e.message || 'No se pudo eliminar', 'error');
    }
  }

  return (
    <div
      className="fixed inset-0 bg-ink/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg rounded-2xl shadow-xl max-w-md w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-base m-0">Adicionales</h3>
            <p className="text-xs text-mute mt-0.5">
              Biblioteca compartida de extras. Agregalos a productos desde el
              formulario de cada producto.
            </p>
          </div>
          <button onClick={onClose} className="text-mute hover:text-ink p-1" title="Cerrar">
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="px-5 py-3 border-b border-line flex gap-2">
          <input
            className="input flex-1"
            placeholder="Nombre (ej: Queso extra)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            type="number"
            className="input w-28"
            placeholder="Precio"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
          />
          <button className="btn-primary" disabled={busy} title={editingId ? 'Guardar cambios' : 'Agregar'}>
            <Icon name={editingId ? 'check' : 'plus'} />
          </button>
          {editingId && (
            <button type="button" className="btn-ghost" onClick={cancelEdit} title="Cancelar edición">
              ✕
            </button>
          )}
        </form>

        <div className="flex-1 overflow-y-auto px-5 py-2">
          {items.length === 0 ? (
            <div className="text-center text-mute text-sm py-8">
              Aún no creaste adicionales.
            </div>
          ) : (
            items.map((a) => (
              <div
                key={a.id}
                className={`flex items-center gap-2 py-2 border-b border-line2 last:border-0 ${
                  editingId === a.id ? 'bg-brand-soft/40 -mx-5 px-5' : ''
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{a.name}</div>
                  <div className="text-xs text-mute">{fmt(Number(a.price))}</div>
                </div>
                <button
                  className="text-mute hover:text-brand p-1"
                  onClick={() => startEdit(a)}
                  title="Editar"
                >
                  <Icon name="edit" size={14} />
                </button>
                <button
                  className="text-mute hover:text-bad p-1"
                  onClick={() => remove(a.id)}
                  title="Eliminar"
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ProductDrawer({
  value,
  categories,
  adicionales,
  onCancel,
  onSave,
}: {
  value: Partial<Product>;
  categories: Category[];
  adicionales: Adicional[];
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

          <label className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-50 border border-amber-200 cursor-pointer hover:bg-amber-100 transition">
            <input
              type="checkbox"
              checked={!!form.isRecommended}
              onChange={(e) => update('isRecommended', e.target.checked)}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="text-sm font-semibold flex items-center gap-1.5">
                ⭐ Destacar como Recomendado
              </div>
              <div className="text-xs text-mute mt-0.5">
                Aparece en una sección "Recomendados" al inicio del menú
                público para empujar las ventas de este producto.
              </div>
            </div>
          </label>

          <fieldset className="border border-line rounded-lg p-3">
            <legend className="px-1 text-xs font-semibold text-mute">
              Inventario (opcional)
            </legend>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.stock !== null && form.stock !== undefined}
                onChange={(e) =>
                  update('stock', e.target.checked ? 0 : null)
                }
              />
              <span>Llevar control de stock</span>
            </label>
            {form.stock !== null && form.stock !== undefined && (
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div>
                  <label className="label">Stock disponible</label>
                  <input
                    type="number"
                    min="0"
                    className="input"
                    value={form.stock ?? 0}
                    onChange={(e) =>
                      update('stock', Math.max(0, Number(e.target.value)))
                    }
                  />
                </div>
                <div>
                  <label className="label">Avisar a los…</label>
                  <input
                    type="number"
                    min="0"
                    className="input"
                    placeholder="opcional"
                    value={form.stockAlert ?? ''}
                    onChange={(e) =>
                      update(
                        'stockAlert',
                        e.target.value === '' ? null : Number(e.target.value),
                      )
                    }
                  />
                </div>
                <div className="col-span-2 text-[11px] text-mute">
                  💡 Cada pedido descuenta automáticamente. Cuando llega a 0,
                  el producto se oculta del storefront público.
                </div>
              </div>
            )}
          </fieldset>

          <fieldset className="border border-line rounded-lg p-3">
            <legend className="px-1 text-xs font-semibold text-mute flex items-center gap-1.5">
              Variantes (
              <input
                className="bg-transparent border-b border-dashed border-line focus:border-brand outline-none text-xs font-semibold w-24 px-0.5"
                placeholder="Tamaños"
                value={form.variants?.[0]?.groupName ?? ''}
                onChange={(e) => {
                  const label = e.target.value;
                  const arr = (form.variants ?? []).map((v) => ({
                    ...v,
                    groupName: label,
                  }));
                  update('variants', arr);
                }}
                title="Editá la palabra (ej: Sabores, Colores, Opciones)"
              />
              )
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
              onClick={() => {
                const groupName = form.variants?.[0]?.groupName ?? 'Tamaño';
                update('variants', [
                  ...(form.variants ?? []),
                  { name: '', priceDelta: 0, groupName },
                ]);
              }}
            >
              + Variante
            </button>
          </fieldset>

          <fieldset className="border border-line rounded-lg p-3">
            <legend className="px-1 text-xs font-semibold text-mute">Extras</legend>

            {adicionales.length > 0 && (
              <div className="mb-3 p-2 rounded-lg bg-bg2">
                <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-1.5">
                  De la biblioteca
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {adicionales.map((a) => {
                    const checked = (form.extras ?? []).some(
                      (e) => e.name === a.name && Number(e.price) === Number(a.price),
                    );
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          const arr = [...(form.extras ?? [])];
                          if (checked) {
                            const idx = arr.findIndex(
                              (e) => e.name === a.name && Number(e.price) === Number(a.price),
                            );
                            if (idx >= 0) arr.splice(idx, 1);
                          } else {
                            arr.push({ name: a.name, price: Number(a.price) });
                          }
                          update('extras', arr);
                        }}
                        className={`px-2.5 py-1 rounded-full text-xs border transition ${
                          checked
                            ? 'bg-brand text-white border-brand'
                            : 'bg-white border-line hover:border-brand'
                        }`}
                      >
                        {checked ? '✓ ' : '+ '}
                        {a.name}{' '}
                        <span className={checked ? 'opacity-80' : 'text-mute'}>
                          {fmt(Number(a.price))}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

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
