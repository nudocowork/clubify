'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { resolveMainSectionLabel } from '@/lib/business-categories';
import { Icon } from '@/components/Icon';
import { ImageUploader } from '@/components/ImageUploader';
import { SortableList, DragHandle } from '@/components/Sortable';
import { toast } from '@/components/Toast';
import { SectionCoverEditor } from '@/components/menu/SectionCoverEditor';
import { SectionCoverPreview } from '@/components/menu/SectionCoverPreview';
import type { SectionCoverConfig } from '@/lib/menu/section-cover-config';
import { uploadCoverImage } from '@/lib/menu/upload-cover-image';

type Category = {
  id: string;
  name: string;
  _count?: { products: number };
  imageUrl?: string | null;
  tagline?: string | null;
  coverConfig?: SectionCoverConfig | null;
  popupConfig?: PopupConfig | null;
  parentId?: string | null;
  children?: Category[];
};

export type PopupConfig = {
  enabled: boolean;
  imageUrl?: string | null;
  title?: string | null;
  description?: string | null;
  buttonText?: string | null;
  buttonUrl?: string | null;
  buttonColor?: string | null;
  /** auto = se abre solo al entrar a la sección. click = el banner es
   *  tappable y muestra una pulse animation. */
  trigger?: 'auto' | 'click';
  /** Si true, sessionStorage flag evita reabrirlo en la misma visita. */
  oncePerSession?: boolean;
};
type Variant = { id?: string; name: string; priceDelta: number; isDefault?: boolean; groupName?: string };
type Extra = { id?: string; name: string; price: number };
type Adicional = { id: string; name: string; price: number; isActive: boolean };
type Product = {
  id: string;
  name: string;
  description: string;
  basePrice: number;
  priceMode?: 'FIXED' | 'RANGE';
  priceMax?: number | null;
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
  const [coverCat, setCoverCat] = useState<Category | null>(null);
  const [popupCat, setPopupCat] = useState<Category | null>(null);
  const [coverRecommendedOpen, setCoverRecommendedOpen] = useState(false);
  const [ordersDeliveryEnabled, setOrdersDeliveryEnabled] = useState<boolean | null>(null);
  const [togglingOrders, setTogglingOrders] = useState(false);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);
  const [mainLabel, setMainLabel] = useState<string>('Menú');

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
    api<{
      slug?: string;
      mainSectionLabelOverride?: string | null;
      businessCategorySlug?: string | null;
    }>('/tenants/me')
      .then((me) => {
        setTenantSlug(me?.slug ?? null);
        setMainLabel(
          resolveMainSectionLabel(
            me?.mainSectionLabelOverride,
            me?.businessCategorySlug,
          ),
        );
      })
      .catch(() => null);
  }, []);

  async function loadOrdersEnabled() {
    try {
      const sf = await api<{
        ordersEnabled: boolean;
        ordersDeliveryEnabled?: boolean;
      }>('/storefront');
      // Backend devuelve ordersDeliveryEnabled gateado por ordersEnabled.
      // Fallback al master para storefronts viejos sin la columna nueva.
      setOrdersDeliveryEnabled(
        sf.ordersDeliveryEnabled ?? sf.ordersEnabled ?? true,
      );
    } catch {
      setOrdersDeliveryEnabled(true);
    }
  }

  async function toggleOrdersDelivery() {
    if (ordersDeliveryEnabled === null) return;
    const next = !ordersDeliveryEnabled;
    if (
      !next &&
      !confirm(
        'Apagar pedidos en delivery: los clientes verán precios pero NO podrán agregar al carrito. ¿Continuar?',
      )
    ) {
      return;
    }
    setTogglingOrders(true);
    setOrdersDeliveryEnabled(next);
    try {
      // Mantenemos ordersEnabled (master) en sync con delivery para que
      // checks legacy (`ordersEnabled !== false`) sigan funcionando.
      await api('/storefront', {
        method: 'PATCH',
        body: JSON.stringify({
          ordersDeliveryEnabled: next,
          ordersEnabled: next,
        }),
      });
      toast(
        next
          ? `Pedidos delivery activos — el carrito aparece en el ${mainLabel.toLowerCase()} público`
          : 'Delivery informativo — sin botones de pedido en el link público',
        'success',
      );
    } catch (e: any) {
      toast(e.message || 'Error', 'error');
      setOrdersDeliveryEnabled(!next);
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

  async function createSubsection(parentId: string) {
    const name = prompt('Nombre de la subsección:');
    if (!name?.trim()) return;
    try {
      await api('/catalog/categories', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), parentId }),
      });
      load();
      toast('Subsección creada', 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo crear', 'error');
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
      priceMode: 'FIXED',
      priceMax: null,
      imageUrl: '',
      tags: [],
      isAvailable: true,
      isRecommended: false,
      variants: [],
      extras: [],
    });
  }

  async function saveProduct(p: Partial<Product>) {
    // Validar rango antes de mandar: si máximo <= mínimo, fmtProductPrice
    // cae silencioso a FIXED en el storefront (condición `priceMax > basePrice`).
    // Mejor avisar al dueño en lugar de guardar config rota.
    if (
      p.priceMode === 'RANGE' &&
      (p.priceMax == null ||
        Number(p.priceMax) <= Number(p.basePrice ?? 0))
    ) {
      toast(
        'El precio máximo debe ser mayor al mínimo. Corregí el rango antes de guardar.',
        'error',
      );
      return;
    }
    // El backend usa ValidationPipe con forbidNonWhitelisted=true — manda
    // solo los campos del DTO. Sino el GET trae `id`, `tenantId`,
    // `createdAt`, `timesOrdered`, relación `category`, etc., que el
    // PATCH rechaza con 400.
    const payload = {
      categoryId: p.categoryId,
      name: p.name,
      description: p.description ?? '',
      basePrice: Number(p.basePrice ?? 0),
      priceMode: p.priceMode ?? 'FIXED',
      priceMax:
        p.priceMode === 'RANGE' && p.priceMax != null
          ? Number(p.priceMax)
          : null,
      imageUrl: p.imageUrl || undefined,
      tags: p.tags ?? [],
      isAvailable: p.isAvailable ?? true,
      isRecommended: p.isRecommended ?? false,
      stock: p.stock ?? null,
      stockAlert: p.stockAlert ?? null,
      // Variants/extras: limpiar también — el GET devuelve cada uno con
      // `id`, `productId`, `position`, `isDefault`, etc. El DTO acepta
      // any[] pero el service hace deleteMany+createMany, así que solo
      // necesita los campos editables. Evitamos mandar IDs que se
      // re-generan de todos modos.
      variants: (p.variants ?? []).map((v) => ({
        name: v.name,
        priceDelta: Number(v.priceDelta ?? 0),
        groupName: v.groupName,
        isDefault: v.isDefault ?? false,
      })),
      extras: (p.extras ?? []).map((e) => ({
        name: e.name,
        price: Number(e.price ?? 0),
      })),
    };
    try {
      if (p.id) {
        await api(`/catalog/products/${p.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await api('/catalog/products', {
          method: 'POST',
          body: JSON.stringify(payload),
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
          {mainLabel}{' '}
          <span className="page-crumb">
            / {cats.length} categorías · {products.length} productos
          </span>
        </h1>
        <div className="flex gap-2 flex-wrap">
          {ordersDeliveryEnabled !== null && (
            <button
              type="button"
              onClick={toggleOrdersDelivery}
              disabled={togglingOrders}
              className={`btn-ghost ${ordersDeliveryEnabled ? 'text-ok' : 'text-amber-600'}`}
              title={
                ordersDeliveryEnabled
                  ? 'Delivery ON — carrito + botón "Pedir por WhatsApp" activos en el link público. La vista mesa siempre es informativa.'
                  : 'Delivery OFF — solo visualización (precios, sin carrito, sin WhatsApp). La vista mesa siempre es informativa.'
              }
            >
              {ordersDeliveryEnabled
                ? '🛒 Pedidos delivery: ON'
                : '📋 Delivery informativo'}
            </button>
          )}
          <button className="btn-ghost" onClick={() => setShowCatForm(!showCatForm)}>
            <Icon name="plus" /> Categoría
          </button>
          <Link
            href={tenantSlug ? `/m/${tenantSlug}?mesa=1` : '#'}
            target="_blank"
            className={`btn-ghost ${!tenantSlug ? 'pointer-events-none opacity-50' : ''}`}
            title={`Vista de ${mainLabel.toLowerCase()} como la verá un cliente sentado en una mesa`}
          >
            🍽 Ver {mainLabel.toLowerCase()} mesa
          </Link>
          <Link
            href={tenantSlug ? `/m/${tenantSlug}` : '#'}
            target="_blank"
            className={`btn-ghost ${!tenantSlug ? 'pointer-events-none opacity-50' : ''}`}
            title={`Vista de ${mainLabel.toLowerCase()} para domicilio — el link público que envías a tus clientes`}
          >
            🛵 Ver {mainLabel.toLowerCase()} delivery
          </Link>
          <Link
            href="/app/storefront"
            className="btn-ghost"
            title={`Personaliza el aspecto público de tu ${mainLabel.toLowerCase()} (logo, estilo, layout)`}
          >
            🎨 Configura tu {mainLabel.toLowerCase()}
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
            title={`Productos en oferta del ${mainLabel.toLowerCase()}`}
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

      {/* M1.2: identificación clara entre Menú Mesa (informativo) y Menú
          Delivery (con carrito + WhatsApp). Misma data de productos pero
          rutas distintas — cada una con su propósito. */}
      {tenantSlug && <PublicMenuLinks slug={tenantSlug} mainLabel={mainLabel} />}

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
          {/* Sección virtual "Recomendados" — solo aparece si hay al
              menos un producto marcado como isRecommended. No se puede
              renombrar/eliminar/asignar productos directamente; se
              alimenta automáticamente del flag de cada producto. Solo
              expone el editor de portada (vive en Storefront, no en
              Category). */}
          {products.some((p) => p.isRecommended) && (
            <div className="mb-1 flex items-center gap-2 px-2.5 py-2.5 rounded-lg bg-amber-50 border border-amber-200">
              <span className="text-base">⭐</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">Recomendados</div>
                <div className="text-xs text-mute">
                  {products.filter((p) => p.isRecommended).length} productos
                </div>
              </div>
              <button
                className="text-mute hover:text-brand p-1"
                onClick={() => setCoverRecommendedOpen(true)}
                title="Diseñar portada de Recomendados"
              >
                🎨
              </button>
            </div>
          )}
          {/* Filtramos a roots para el sortable. Las hijas se renderean
              dentro de cada root como sub-lista no-sortable (drag/drop
              de hijas se puede agregar después si hace falta — por
              ahora orden por createdAt). */}
          <SortableList
            items={cats.filter((c) => !c.parentId)}
            onReorder={reorderCategories}
          >
            {(c, { dragHandleProps }) => {
              const subs = cats.filter((s) => s.parentId === c.id);
              return (
              <div>
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
                        {subs.length > 0 && ` · ${subs.length} sub`}
                      </div>
                    </>
                  )}
                </div>
                <button
                  className="text-mute hover:text-brand p-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    createSubsection(c.id);
                  }}
                  title="Agregar subsección"
                >
                  ＋
                </button>
                <button
                  className="text-mute hover:text-brand p-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCoverCat(c);
                  }}
                  title="Diseñar portada"
                >
                  🎨
                </button>
                <button
                  className={`p-1 ${
                    c.popupConfig?.enabled
                      ? 'text-amber-500 hover:text-amber-600'
                      : 'text-mute hover:text-brand'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPopupCat(c);
                  }}
                  title={
                    c.popupConfig?.enabled
                      ? 'Editar popup (activo)'
                      : 'Agregar popup opcional'
                  }
                >
                  🔔
                </button>
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

              {/* Subsecciones (hijas) — indentadas, no sortable.
                  Cada una es clickeable como cualquier categoría:
                  selecciona y muestra sus productos en el panel
                  derecho. Botones de editar nombre, portada y
                  eliminar funcionan idénticos. */}
              {subs.length > 0 && (
                <div className="ml-5 mt-1 border-l-2 border-line2 pl-2 space-y-1">
                  {subs.map((s) => (
                    <div
                      key={s.id}
                      onClick={() => setActiveCat(s.id)}
                      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer transition text-xs ${
                        activeCat === s.id
                          ? 'bg-brand-soft text-brand-700'
                          : 'hover:bg-bg2'
                      }`}
                    >
                      <span className="text-mute">↳</span>
                      <div className="flex-1 min-w-0">
                        {editingCatId === s.id ? (
                          <input
                            autoFocus
                            className="input py-0.5 text-xs"
                            value={editingCatName}
                            onChange={(e) => setEditingCatName(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onBlur={() => {
                              renameCategory(s.id, editingCatName);
                              setEditingCatId(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                              else if (e.key === 'Escape') setEditingCatId(null);
                            }}
                          />
                        ) : (
                          <>
                            <div className="font-medium truncate">{s.name}</div>
                            <div className="text-[10px] text-mute">
                              {s._count?.products ?? 0} productos
                            </div>
                          </>
                        )}
                      </div>
                      <button
                        className="text-mute hover:text-brand p-0.5"
                        onClick={(e) => { e.stopPropagation(); setCoverCat(s); }}
                        title="Diseñar portada"
                      >
                        🎨
                      </button>
                      <button
                        className={`p-0.5 ${
                          s.popupConfig?.enabled
                            ? 'text-amber-500 hover:text-amber-600'
                            : 'text-mute hover:text-brand'
                        }`}
                        onClick={(e) => { e.stopPropagation(); setPopupCat(s); }}
                        title={
                          s.popupConfig?.enabled
                            ? 'Editar popup (activo)'
                            : 'Agregar popup opcional'
                        }
                      >
                        🔔
                      </button>
                      <button
                        className="text-mute hover:text-brand p-0.5"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingCatId(s.id);
                          setEditingCatName(s.name);
                        }}
                        title="Renombrar"
                      >
                        <Icon name="edit" size={12} />
                      </button>
                      <button
                        className="text-mute hover:text-bad p-0.5"
                        onClick={(e) => { e.stopPropagation(); deleteCategory(s.id); }}
                        title="Eliminar"
                      >
                        <Icon name="trash" size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              </div>
              );
            }}
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
          mainLabel={mainLabel}
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

      {coverCat && (
        <CoverEditorModal
          target={{
            title: coverCat.name,
            endpoint: `/catalog/categories/${coverCat.id}`,
            initialConfig: coverCat.coverConfig ?? null,
            initialTagline: coverCat.tagline ?? '',
          }}
          onClose={() => setCoverCat(null)}
          onSaved={() => {
            setCoverCat(null);
            load();
            toast('Portada guardada', 'success');
          }}
        />
      )}

      {coverRecommendedOpen && (
        <RecommendedCoverModal
          onClose={() => setCoverRecommendedOpen(false)}
          onSaved={() => {
            setCoverRecommendedOpen(false);
            toast('Portada de Recomendados guardada', 'success');
          }}
        />
      )}

      {popupCat && (
        <PopupEditorModal
          category={popupCat}
          onClose={() => setPopupCat(null)}
          onSaved={() => {
            setPopupCat(null);
            load();
            toast('Popup guardado', 'success');
          }}
        />
      )}
    </div>
  );
}

/** CoverEditorModal genérico — sirve para categorías reales y para la
 *  sección virtual "Recomendados". El caller pasa el target con su
 *  endpoint y los valores iniciales; el modal maneja la edición y el
 *  PATCH. Antes era hard-coded a /catalog/categories/:id. */
type CoverTarget = {
  /** Display title en el header del modal. */
  title: string;
  /** Endpoint que recibe el PATCH con `{ coverConfig, tagline }` o el
   *  shape custom resuelto por `payloadShape`. */
  endpoint: string;
  /** Si está, mapea (config, tagline) → body. Default: { coverConfig, tagline }. */
  payloadShape?: (config: SectionCoverConfig | null, tagline: string | null) => any;
  initialConfig: SectionCoverConfig | null;
  initialTagline: string;
};

function CoverEditorModal({
  target,
  onClose,
  onSaved,
}: {
  target: CoverTarget;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [config, setConfig] = useState<SectionCoverConfig | null>(
    target.initialConfig,
  );
  const [tagline, setTagline] = useState(target.initialTagline);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const body = target.payloadShape
        ? target.payloadShape(config, tagline.trim() || null)
        : { coverConfig: config, tagline: tagline.trim() || null };
      await api(target.endpoint, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
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
        className="bg-bg w-full max-w-5xl rounded-2xl shadow-xl my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-line">
          <div>
            <div className="text-xs text-mute">Portada de sección</div>
            <h2 className="font-semibold text-lg m-0">{target.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-mute hover:text-ink p-1"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="label">Subtítulo (tagline) — opcional</label>
            <input
              type="text"
              className="input"
              placeholder="Ej: Cortes premium importados"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              maxLength={200}
            />
            <p className="text-[11px] text-mute mt-1">
              Aparece debajo del nombre en la portada. Vacío = sin subtítulo.
            </p>
          </div>

          <SectionCoverEditor
            title={target.title}
            tagline={tagline || null}
            value={config}
            onChange={setConfig}
            onUpload={uploadCoverImage}
          />
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-line">
          <button
            type="button"
            onClick={() => setConfig(null)}
            className="btn-ghost text-xs"
            title="Vuelve al fallback legacy (imagen + nombre centrado)"
          >
            Reset a default
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="btn-primary"
          >
            {saving ? 'Guardando…' : 'Guardar portada'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Wrapper que carga el storefront actual para obtener la config inicial
 *  de la sección Recomendados y guarda los cambios contra el endpoint
 *  /storefront (no /catalog/categories). Reutiliza CoverEditorModal vía
 *  su prop `target` genérica. */
function RecommendedCoverModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [initial, setInitial] = useState<{
    config: SectionCoverConfig | null;
    tagline: string;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const sf = await api<{
          recommendedCoverConfig?: SectionCoverConfig | null;
          recommendedTagline?: string | null;
        }>('/storefront');
        setInitial({
          config: sf.recommendedCoverConfig ?? null,
          tagline: sf.recommendedTagline ?? '',
        });
      } catch (e: any) {
        setErr(e?.message || 'No se pudo cargar la configuración');
      }
    })();
  }, []);

  if (err) {
    return (
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div
          className="bg-bg rounded-2xl p-6 max-w-sm text-center space-y-3"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-2xl">⚠️</div>
          <div className="text-sm">{err}</div>
          <button onClick={onClose} className="btn-primary">
            Cerrar
          </button>
        </div>
      </div>
    );
  }
  if (!initial) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center">
        <div className="text-white text-sm">Cargando…</div>
      </div>
    );
  }
  return (
    <CoverEditorModal
      target={{
        title: 'Recomendados',
        endpoint: '/storefront',
        // El endpoint /storefront acepta nombres específicos
        // (recommendedCoverConfig + recommendedTagline) en lugar del
        // shape default (coverConfig + tagline). Mapeamos aquí.
        payloadShape: (config, tagline) => ({
          recommendedCoverConfig: config,
          recommendedTagline: tagline,
        }),
        initialConfig: initial.config,
        initialTagline: initial.tagline,
      }}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

// =============================================================
//                 Popup editor modal por categoría
// =============================================================

/** Editor del popup opcional por sección del menú. PATCH al endpoint
 *  /catalog/categories/:id con `{ popupConfig }`. Si todos los campos
 *  están vacíos y el toggle off, manda null para "limpiar" el popup. */
function PopupEditorModal({
  category,
  onClose,
  onSaved,
}: {
  category: Category;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initial: PopupConfig = category.popupConfig ?? {
    enabled: false,
    imageUrl: null,
    title: '',
    description: '',
    buttonText: '',
    buttonUrl: '',
    buttonColor: '#22C55E',
    trigger: 'auto',
    oncePerSession: true,
  };
  const [cfg, setCfg] = useState<PopupConfig>(initial);
  const [saving, setSaving] = useState(false);

  function patch<K extends keyof PopupConfig>(k: K, v: PopupConfig[K]) {
    setCfg((c) => ({ ...c, [k]: v }));
  }

  async function save() {
    setSaving(true);
    try {
      // Limpieza: si está deshabilitado y sin imagen/texto, mandamos
      // null para borrar el JSON entero. Sino guardamos el shape.
      const isEmpty =
        !cfg.enabled &&
        !cfg.imageUrl &&
        !cfg.title?.trim() &&
        !cfg.description?.trim();
      const body = { popupConfig: isEmpty ? null : cfg };
      await api(`/catalog/categories/${category.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      onSaved();
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar el popup', 'error');
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
        className="bg-white rounded-2xl max-w-3xl w-full my-8 shadow-2xl overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-line flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
              Popup opcional
            </div>
            <div className="font-bold text-lg leading-tight">
              {category.name}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-mute hover:text-ink text-xl leading-none px-2"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
          {/* Form */}
          <div className="p-5 space-y-4 border-r-0 md:border-r border-line">
            <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg bg-bg2/40">
              <input
                type="checkbox"
                checked={cfg.enabled}
                onChange={(e) => patch('enabled', e.target.checked)}
                className="w-5 h-5 accent-brand"
              />
              <div>
                <div className="font-semibold text-sm">Activar popup</div>
                <div className="text-[11px] text-mute leading-snug">
                  Cuando esté activo, los clientes lo verán al entrar a esta
                  sección del menú.
                </div>
              </div>
            </label>

            <div>
              <label className="label">Imagen</label>
              <ImageUploader
                value={cfg.imageUrl ?? ''}
                onChange={(url) => patch('imageUrl', url || null)}
                folder="category-popup"
              />
              <div className="text-[10px] text-mute mt-1">
                Opcional. JPG / PNG hasta 15 MB. Se muestra arriba del popup.
              </div>
            </div>

            <div>
              <label className="label">Título</label>
              <input
                type="text"
                className="input"
                placeholder="Ej: Happy hour 2x1"
                maxLength={80}
                value={cfg.title ?? ''}
                onChange={(e) => patch('title', e.target.value)}
              />
            </div>

            <div>
              <label className="label">Descripción</label>
              <textarea
                className="input min-h-[80px]"
                placeholder="Cuéntale a tus clientes el detalle de la promo, experiencia o servicio."
                maxLength={400}
                value={cfg.description ?? ''}
                onChange={(e) => patch('description', e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Texto del botón</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Reservar"
                  maxLength={30}
                  value={cfg.buttonText ?? ''}
                  onChange={(e) => patch('buttonText', e.target.value)}
                />
              </div>
              <div>
                <label className="label">Color del botón</label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    value={cfg.buttonColor || '#22C55E'}
                    onChange={(e) => patch('buttonColor', e.target.value)}
                    className="w-10 h-10 rounded-md border border-line cursor-pointer flex-none"
                  />
                  <input
                    type="text"
                    className="input font-mono text-xs"
                    value={cfg.buttonColor ?? ''}
                    onChange={(e) => patch('buttonColor', e.target.value)}
                    placeholder="#22C55E"
                    maxLength={20}
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="label">URL del botón</label>
              <input
                type="url"
                className="input"
                placeholder="https://wa.me/57... o https://reservas.tu.com"
                value={cfg.buttonUrl ?? ''}
                onChange={(e) => patch('buttonUrl', e.target.value)}
              />
              <div className="text-[10px] text-mute mt-1">
                Si está vacío, el botón no se muestra. Sin botón el popup
                queda informativo (solo cerrar).
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-line">
              <div className="text-xs font-semibold uppercase tracking-wider text-mute">
                Comportamiento
              </div>
              <label className="flex items-start gap-2 cursor-pointer text-sm">
                <input
                  type="radio"
                  name="trigger"
                  checked={(cfg.trigger ?? 'auto') === 'auto'}
                  onChange={() => patch('trigger', 'auto')}
                  className="mt-1 accent-brand"
                />
                <div>
                  <div className="font-medium">Abrir automáticamente</div>
                  <div className="text-[11px] text-mute">
                    Cuando el cliente entra a esta sección, el popup aparece
                    solo.
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-2 cursor-pointer text-sm">
                <input
                  type="radio"
                  name="trigger"
                  checked={cfg.trigger === 'click'}
                  onChange={() => patch('trigger', 'click')}
                  className="mt-1 accent-brand"
                />
                <div>
                  <div className="font-medium">Solo al tocar el banner</div>
                  <div className="text-[11px] text-mute">
                    Aparece un indicador pulsante en la portada de la
                    sección y el cliente decide si lo abre.
                  </div>
                </div>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm pt-2">
                <input
                  type="checkbox"
                  checked={cfg.oncePerSession ?? true}
                  onChange={(e) => patch('oncePerSession', e.target.checked)}
                  className="w-4 h-4 accent-brand"
                />
                <span>Mostrar solo una vez por sesión</span>
              </label>
            </div>
          </div>

          {/* Preview */}
          <div className="bg-gradient-to-b from-bg2/50 to-bg2 p-5 flex flex-col items-center">
            <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-3">
              Vista previa
            </div>
            <PopupPreview cfg={cfg} />
            {!cfg.enabled && (
              <div className="mt-3 text-[10px] text-mute italic text-center">
                El popup está desactivado — no se mostrará a los clientes.
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-3 border-t border-line flex items-center justify-end gap-2 bg-bg2/30">
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost text-sm"
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="btn-primary text-sm"
          >
            {saving ? 'Guardando…' : 'Guardar popup'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Mock visual del popup tal como se verá en el storefront público.
 *  Frame mini-iPhone para dar contexto del tamaño. */
function PopupPreview({ cfg }: { cfg: PopupConfig }) {
  const hasContent =
    cfg.imageUrl ||
    cfg.title?.trim() ||
    cfg.description?.trim();
  return (
    <div className="bg-white rounded-2xl shadow-xl max-w-[260px] w-full overflow-hidden">
      {cfg.imageUrl ? (
        <img
          src={cfg.imageUrl}
          alt=""
          className="w-full max-h-[180px] object-cover"
        />
      ) : (
        <div className="w-full h-[120px] bg-bg2 flex items-center justify-center text-mute text-xs">
          (Sin imagen)
        </div>
      )}
      <div className="p-4 space-y-2">
        {cfg.title?.trim() ? (
          <div className="font-bold text-sm leading-tight">{cfg.title}</div>
        ) : (
          <div className="font-bold text-sm text-mute italic">
            (Título del popup)
          </div>
        )}
        {cfg.description?.trim() && (
          <div className="text-xs text-mute leading-snug whitespace-pre-line">
            {cfg.description}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button className="text-[11px] px-2 py-1.5 rounded-md text-mute" disabled>
            Cerrar
          </button>
          {cfg.buttonText?.trim() && cfg.buttonUrl?.trim() && (
            <button
              className="text-[11px] font-semibold px-3 py-1.5 rounded-md text-white shadow-sm"
              style={{ background: cfg.buttonColor || '#22C55E' }}
              disabled
            >
              {cfg.buttonText}
            </button>
          )}
        </div>
      </div>
      {!hasContent && (
        <div className="px-4 pb-3 text-[10px] text-mute italic text-center">
          Completa los campos a la izquierda para previsualizar.
        </div>
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
  mainLabel,
  onCancel,
  onSave,
}: {
  value: Partial<Product>;
  categories: Category[];
  adicionales: Adicional[];
  mainLabel: string;
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
              {/* Renderea roots primero, e indenta sus hijas con "↳ <padre> / <hijo>"
                  para que el dueño pueda asignar productos a subsecciones sin
                  ambigüedad. El backend acepta cualquier categoryId del tenant. */}
              {categories
                .filter((c) => !c.parentId)
                .flatMap((root) => {
                  const subs = categories.filter((s) => s.parentId === root.id);
                  return [
                    <option key={root.id} value={root.id}>
                      {root.name}
                    </option>,
                    ...subs.map((s) => (
                      <option key={s.id} value={s.id}>
                        ↳ {root.name} / {s.name}
                      </option>
                    )),
                  ];
                })}
            </select>
            {form.categoryId &&
              categories.find((c) => c.id === form.categoryId)?.parentId && (
                <div className="text-[11px] text-mute mt-1">
                  Producto asignado a una subsección — aparece dentro del chip
                  correspondiente en el layout SECTIONS del storefront.
                </div>
              )}
          </div>
          <div>
            <label className="label">Tipo de precio</label>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {(['FIXED', 'RANGE'] as const).map((mode) => {
                const active = (form.priceMode ?? 'FIXED') === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      update('priceMode', mode);
                      if (mode === 'FIXED') update('priceMax', null);
                    }}
                    className={`px-3 py-2 rounded-md text-sm font-semibold border-2 transition ${
                      active
                        ? 'border-brand bg-brand/10 text-brand'
                        : 'border-line bg-white text-mute hover:border-mute'
                    }`}
                  >
                    {mode === 'FIXED' ? '🏷 Precio fijo' : '📊 Rango'}
                  </button>
                );
              })}
            </div>
            {(form.priceMode ?? 'FIXED') === 'FIXED' ? (
              <div>
                <label className="label">Precio base</label>
                <input
                  type="number"
                  className="input"
                  value={form.basePrice ?? 0}
                  onChange={(e) => update('basePrice', Number(e.target.value))}
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">Mínimo</label>
                  <input
                    type="number"
                    className="input"
                    value={form.basePrice ?? 0}
                    onChange={(e) =>
                      update('basePrice', Number(e.target.value))
                    }
                  />
                </div>
                <div>
                  <label className="label">Máximo</label>
                  <input
                    type="number"
                    className="input"
                    value={form.priceMax ?? ''}
                    onChange={(e) =>
                      update(
                        'priceMax',
                        e.target.value === '' ? null : Number(e.target.value),
                      )
                    }
                    placeholder="Hasta…"
                  />
                </div>
                <div className="col-span-2 text-[11px] text-mute">
                  Se muestra como{' '}
                  <strong>
                    {fmt(Number(form.basePrice ?? 0))} —{' '}
                    {form.priceMax != null
                      ? fmt(Number(form.priceMax))
                      : '?'}
                  </strong>
                  . El carrito usa el mínimo como referencia.
                </div>
              </div>
            )}
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
                Aparece en una sección "Recomendados" al inicio del{' '}
                {mainLabel.toLowerCase()} público para empujar las ventas de
                este producto.
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
                title="Edita la palabra (ej: Sabores, Colores, Opciones)"
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

/**
 * M1.2 (2026-06-04): card con identificación clara de los dos links públicos
 * del menú — Mesa (informativo, ?mesa=1) y Delivery (con carrito + WhatsApp,
 * sin query). Misma data de productos, distinto propósito. Cada uno con
 * botón para copiar el link y abrir en pestaña nueva.
 */
function PublicMenuLinks({ slug, mainLabel }: { slug: string; mainLabel: string }) {
  const [origin, setOrigin] = useState<string>('');
  useEffect(() => {
    if (typeof window !== 'undefined') setOrigin(window.location.origin);
  }, []);
  const mesaUrl = `${origin}/m/${slug}?mesa=1`;
  const deliveryUrl = `${origin}/m/${slug}`;
  const labelLower = mainLabel.toLowerCase();

  async function copy(url: string, label: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast(`Link de ${label} copiado`, 'success');
    } catch {
      toast('No se pudo copiar — copialo manualmente', 'error');
    }
  }

  return (
    <div className="card card-pad mb-4">
      <h2 className="text-base font-semibold m-0 flex items-center gap-2">
        🔗 Links públicos del {labelLower}
      </h2>
      <p className="text-xs text-mute mt-1 leading-relaxed">
        Misma información de productos, distinta función. El link de mesa es
        solo para que el cliente vea, el de delivery acepta pedidos.
      </p>
      <div className="mt-4 grid md:grid-cols-2 gap-3">
        {/* Mesa */}
        <div className="rounded-input border border-line2 bg-bg2/30 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="text-lg">🍽</span>
            <span>Menú Mesa</span>
            <span className="ml-auto text-[10px] uppercase tracking-wider font-bold bg-bg2 text-mute px-1.5 py-0.5 rounded">
              Informativo
            </span>
          </div>
          <p className="text-[11px] text-mute mt-1 leading-snug">
            Solo visualización. Sin carrito, sin botón WhatsApp. Pensado
            para el QR de cada mesa — el cliente sentado pide al mozo.
          </p>
          <div className="mt-3 rounded-input bg-white border border-line px-2.5 py-2 text-[11px] font-mono break-all">
            {mesaUrl || '—'}
          </div>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              className="btn-ghost text-xs flex-1 justify-center"
              onClick={() => copy(mesaUrl, 'mesa')}
              disabled={!origin}
            >
              📋 Copiar
            </button>
            <Link
              href={`/m/${slug}?mesa=1`}
              target="_blank"
              className="btn-ghost text-xs flex-1 justify-center"
            >
              ↗ Abrir
            </Link>
          </div>
        </div>
        {/* Delivery */}
        <div className="rounded-input border-2 border-brand/30 bg-brand-soft/30 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="text-lg">🛵</span>
            <span>Menú Delivery</span>
            <span className="ml-auto text-[10px] uppercase tracking-wider font-bold bg-brand text-white px-1.5 py-0.5 rounded">
              Con carrito
            </span>
          </div>
          <p className="text-[11px] text-mute mt-1 leading-snug">
            El link público para enviar a clientes. Si Delivery está ON,
            permite armar pedido + enviar por WhatsApp.
          </p>
          <div className="mt-3 rounded-input bg-white border border-line px-2.5 py-2 text-[11px] font-mono break-all">
            {deliveryUrl || '—'}
          </div>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              className="btn-ghost text-xs flex-1 justify-center"
              onClick={() => copy(deliveryUrl, 'delivery')}
              disabled={!origin}
            >
              📋 Copiar
            </button>
            <Link
              href={`/m/${slug}`}
              target="_blank"
              className="btn-ghost text-xs flex-1 justify-center"
            >
              ↗ Abrir
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
