'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { api } from '@/lib/api';
import { resolveMainSectionLabel } from '@/lib/business-categories';
import { Icon } from '@/components/Icon';
import { ImageUploader } from '@/components/ImageUploader';
import { SortableList, DragHandle } from '@/components/Sortable';
import { toast } from '@/components/Toast';
import { ResizableHeader } from '@/components/ResizableHeader';
import { useColumnResize } from '@/lib/useColumnResize';
import { SectionCoverEditor } from '@/components/menu/SectionCoverEditor';
import { SectionCoverPreview } from '@/components/menu/SectionCoverPreview';
import type { SectionCoverConfig } from '@/lib/menu/section-cover-config';
import { uploadCoverImage } from '@/lib/menu/upload-cover-image';
import { formatPrice, parsePriceInput } from '@/lib/money';

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
  /** Segundos a esperar tras activarse antes de mostrar (auto trigger). */
  delaySeconds?: number;
  /** Si true (auto trigger), fire en cuanto cualquier parte entra al
   *  viewport — no espera a que esté centrada. */
  triggerImmediate?: boolean;
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
  /** DELTA: variantes suman al base. ABSOLUTE: cada variante su precio propio. */
  variantPriceMode?: 'DELTA' | 'ABSOLUTE';
  imageUrl: string | null;
  tags: string[];
  isAvailable: boolean;
  availableForMesa?: boolean;
  availableForDelivery?: boolean;
  isRecommended?: boolean;
  categoryId: string | null;
  stock: number | null;
  stockAlert: number | null;
  variants: Variant[];
  extras: Extra[];
};

// Fix 2026-06-10: el formato monetario ahora usa el helper centralizado
// `formatPrice` que respeta decimales por moneda. Antes hardcoded a COP
// + maximumFractionDigits=0 → redondeaba 13.50 USD a 14 USD
// silenciosamente. El currency se lee de /tenants/me y se inyecta en
// el componente via state (`tenantCurrency`).
function fmt(n: number, currency = 'COP', symbolOverride?: string | null) {
  // Wrapper liviano para compat con los ~15 callsites locales que
  // llaman `fmt(x)` directo. Para usar moneda dinámica, pasarle
  // currency explícito o usar `fmtT` definido dentro del componente.
  // `symbolOverride` permite mostrar una palabra (ej "Ref.") en lugar
  // del signo de moneda — mismo override que usa el storefront público.
  return formatPrice(n, currency, { symbolOverride });
}

export default function MenuEditor() {
  const t = useTranslations('app_menu');
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
  // Fix 2026-06-10: moneda del tenant para mostrar precios correctos.
  // Default COP para fallback histórico mientras /tenants/me carga.
  const [tenantCurrency, setTenantCurrency] = useState<string>('COP');
  // Override opcional del símbolo (ej "Ref." para Venezuela). null = usar
  // el símbolo automático de la moneda.
  const [tenantCurrencySymbol, setTenantCurrencySymbol] = useState<
    string | null
  >(null);
  const [mainLabel, setMainLabel] = useState<string>('Menú');

  // Columnas redimensionables estilo Excel para que nombres largos de
  // productos no se corten irrecuperablemente. Cada scope persiste su
  // layout en localStorage.
  const productCols = useColumnResize('clubify:menu-product-cols', {
    name: 360,
    price: 120,
    variants: 120,
    available: 120,
    actions: 140,
  });
  const sidebarCols = useColumnResize('clubify:menu-sidebar', {
    width: 260,
  });

  // Solo aplicamos el resize del sidebar en desktop (≥1024px = lg). En
  // mobile el layout colapsa a una sola columna y el handle estorbaría.
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

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
      currency?: string;
      currencySymbol?: string | null;
    }>('/tenants/me')
      .then((me) => {
        setTenantSlug(me?.slug ?? null);
        if (me?.currency) setTenantCurrency(me.currency.toUpperCase());
        setTenantCurrencySymbol(me?.currencySymbol ?? null);
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
      !confirm(t('confirmDisableDelivery'))
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
          ? t('deliveryOnToast', { label: mainLabel.toLowerCase() })
          : t('deliveryOffToast'),
        'success',
      );
    } catch (e: any) {
      toast(e.message || t('error'), 'error');
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
      toast(e.message || t('couldNotCreateCategory'), 'error');
    }
  }

  async function createSubsection(parentId: string) {
    const name = prompt(t('subsectionNamePrompt'));
    if (!name?.trim()) return;
    try {
      await api('/catalog/categories', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), parentId }),
      });
      load();
      toast(t('subsectionCreated'), 'success');
    } catch (e: any) {
      toast(e.message || t('couldNotCreate'), 'error');
    }
  }

  async function deleteCategory(id: string) {
    if (!confirm(t('confirmDeleteCategory'))) return;
    try {
      await api(`/catalog/categories/${id}`, { method: 'DELETE' });
      if (activeCat === id) setActiveCat(null);
      load(false);
      toast(t('categoryDeleted'), 'success');
    } catch (e: any) {
      toast(e.message || t('couldNotDelete'), 'error');
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
      toast(t('categoryRenamed'), 'success');
    } catch (e: any) {
      toast(e.message || t('couldNotRename'), 'error');
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
      toast(e.message || t('couldNotChangeAvailability'), 'error');
    }
  }

  async function deleteProduct(id: string) {
    if (!confirm(t('confirmDeleteProduct'))) return;
    try {
      await api(`/catalog/products/${id}`, { method: 'DELETE' });
      load();
      toast(t('productDeleted'), 'success');
    } catch (e: any) {
      toast(e.message || t('couldNotDeleteProduct'), 'error');
    }
  }

  function newProduct() {
    // Bloque 2 (2026-06-12): si NO hay categorías creadas, permitimos
    // crear productos sin categoría (categoryId=null). Antes este return
    // bloqueaba la creación silenciosamente — el usuario veía el botón
    // pero no pasaba nada.
    setEditing({
      categoryId: activeCat ?? undefined,
      name: '',
      description: '',
      basePrice: 0,
      priceMode: 'FIXED',
      priceMax: null,
      imageUrl: '',
      tags: [],
      isAvailable: true,
      availableForMesa: true,
      availableForDelivery: true,
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
      toast(t('priceMaxMustBeGreater'), 'error');
      return;
    }
    // El backend usa ValidationPipe con forbidNonWhitelisted=true — manda
    // solo los campos del DTO. Sino el GET trae `id`, `tenantId`,
    // `createdAt`, `timesOrdered`, relación `category`, etc., que el
    // PATCH rechaza con 400.
    const payload = {
      // null explícito → producto sin categoría (Bloque 2 2026-06-12).
      // undefined → no tocar en update (backend respeta).
      categoryId: p.categoryId ?? null,
      name: p.name,
      description: p.description ?? '',
      basePrice: Number(p.basePrice ?? 0),
      priceMode: p.priceMode ?? 'FIXED',
      priceMax:
        p.priceMode === 'RANGE' && p.priceMax != null
          ? Number(p.priceMax)
          : null,
      variantPriceMode: p.variantPriceMode ?? 'DELTA',
      imageUrl: p.imageUrl || undefined,
      tags: p.tags ?? [],
      isAvailable: p.isAvailable ?? true,
      availableForMesa: p.availableForMesa ?? true,
      availableForDelivery: p.availableForDelivery ?? true,
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
      toast(p.id ? t('productUpdated') : t('productCreated'), 'success');
    } catch (e: any) {
      toast(e.message || t('couldNotSave'), 'error');
    }
  }

  // Bloque 2 (2026-06-12): si no hay categorías, mostramos TODOS los
  // productos juntos. Si hay categoría activa pero === null (categoría
  // virtual "Sin categoría"), mostramos los productos con categoryId null.
  const visibleProducts = cats.length === 0
    ? products
    : activeCat === null
      ? products.filter((p) => p.categoryId === null)
      : products.filter((p) => p.categoryId === activeCat);

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          {mainLabel}{' '}
          <span className="page-crumb">
            / {t('crumbCounts', { cats: cats.length, products: products.length })}
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
                  ? t('deliveryOnTitle')
                  : t('deliveryOffTitle')
              }
            >
              {ordersDeliveryEnabled
                ? t('deliveryOnBtn')
                : t('deliveryOffBtn')}
            </button>
          )}
          <button className="btn-ghost" onClick={() => setShowCatForm(!showCatForm)}>
            <Icon name="plus" /> {t('category')}
          </button>
          {/* Fix 2026-06-08: separación de rutas /m vs /d. El botón
              "Ver mesa" ahora apunta a /m/<slug> (sin ?mesa=1 legacy) y
              el botón "Ver delivery" apunta a /d/<slug>. Antes ambos
              caían en /m/ (mesa) y abría el menú equivocado. */}
          <Link
            href={tenantSlug ? `/m/${tenantSlug}` : '#'}
            target="_blank"
            className={`btn-ghost ${!tenantSlug ? 'pointer-events-none opacity-50' : ''}`}
            title={t('viewMesaTitle', { label: mainLabel.toLowerCase() })}
          >
            🍽 {t('viewMesaBtn', { label: mainLabel.toLowerCase() })}
          </Link>
          <Link
            href={tenantSlug ? `/d/${tenantSlug}` : '#'}
            target="_blank"
            className={`btn-ghost ${!tenantSlug ? 'pointer-events-none opacity-50' : ''}`}
            title={t('viewDeliveryTitle', { label: mainLabel.toLowerCase() })}
          >
            🛵 {t('viewDeliveryBtn', { label: mainLabel.toLowerCase() })}
          </Link>
          <Link
            href="/app/storefront"
            className="btn-ghost"
            title={t('configureStorefrontTitle', { label: mainLabel.toLowerCase() })}
          >
            🎨 {t('configureStorefrontBtn', { label: mainLabel.toLowerCase() })}
          </Link>
          <Link
            href="/app/info-links"
            className="btn-ghost"
            title={t('infoLinksTitle')}
          >
            🔗 {t('infoLinks')}
          </Link>
          <button className="btn-ghost" onClick={() => setShowAdicionales(true)}>
            <Icon name="plus" /> {t('addons')}
          </button>
          <Link
            href="/app/promos"
            className="btn-ghost"
            title={t('promosTitle', { label: mainLabel.toLowerCase() })}
          >
            <Icon name="spark" /> {t('promotions')}
          </Link>
          <button
            className="btn-primary"
            onClick={newProduct}
            // Bloque 2 (2026-06-12): habilitar siempre. Antes pedía
            // categoría activa, ahora permite producto sin categoría
            // cuando el tenant todavía no creó ninguna.
            title={!activeCat && cats.length > 0
              ? t('chooseCategoryFirst')
              : t('createProduct')}
          >
            <Icon name="plus" /> {t('product')}
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
            placeholder={t('categoryNamePlaceholder')}
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            autoFocus
          />
          <button className="btn-primary">{t('create')}</button>
        </form>
      )}

      <div
        className="grid grid-cols-1 gap-4"
        style={{
          // En mobile: una columna (sidebar arriba, productos abajo).
          // En desktop ≥1024px: dos columnas con la primera redimensionable.
          gridTemplateColumns: isDesktop
            ? `${sidebarCols.widths.width}px 1fr`
            : undefined,
        }}
      >
        {/* Categorías */}
        <div className="card p-2 self-start relative">
          {/* Handle para arrastrar el borde derecho del sidebar y dar
              más espacio a nombres largos de categorías. */}
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              sidebarCols.startResize(
                'width',
                e.clientX,
                sidebarCols.widths.width,
              );
            }}
            className="hidden lg:block absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-brand/40 active:bg-brand/60 transition-colors z-10"
            title={t('dragSidebarTitle')}
          />
          {cats.length === 0 && (
            <div className="text-mute text-sm text-center py-6">
              {t('noCategories')}
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
                <div className="font-medium text-sm truncate">{t('recommended')}</div>
                <div className="text-xs text-mute">
                  {t('productsCount', { count: products.filter((p) => p.isRecommended).length })}
                </div>
              </div>
              <button
                className="text-mute hover:text-brand p-1"
                onClick={() => setCoverRecommendedOpen(true)}
                title={t('designRecommendedCover')}
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
                        {t('productsCount', { count: c._count?.products ?? 0 })}
                        {subs.length > 0 && ` · ${t('subCount', { count: subs.length })}`}
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
                  title={t('addSubsection')}
                >
                  ＋
                </button>
                <button
                  className="text-mute hover:text-brand p-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCoverCat(c);
                  }}
                  title={t('designCover')}
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
                      ? t('editPopupActive')
                      : t('addOptionalPopup')
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
                  title={t('rename')}
                >
                  <Icon name="edit" size={14} />
                </button>
                <button
                  className="text-mute hover:text-bad p-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteCategory(c.id);
                  }}
                  title={t('delete')}
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
                              {t('productsCount', { count: s._count?.products ?? 0 })}
                            </div>
                          </>
                        )}
                      </div>
                      <button
                        className="text-mute hover:text-brand p-0.5"
                        onClick={(e) => { e.stopPropagation(); setCoverCat(s); }}
                        title={t('designCover')}
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
                            ? t('editPopupActive')
                            : t('addOptionalPopup')
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
                        title={t('rename')}
                      >
                        <Icon name="edit" size={12} />
                      </button>
                      <button
                        className="text-mute hover:text-bad p-0.5"
                        onClick={(e) => { e.stopPropagation(); deleteCategory(s.id); }}
                        title={t('delete')}
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

          {/* Sección virtual "Sin categoría" — productos huérfanos (categoryId
              null). Antes solo se veían en el storefront ("Otros") pero no en el
              panel de edición. Aparece si hay al menos un producto sin categoría;
              al clickear muestra esos productos para editarlos / asignarles
              categoría. (PDF Software Clubify 2026-06-29). */}
          {cats.length > 0 && products.some((p) => p.categoryId === null) && (
            <div
              onClick={() => setActiveCat(null)}
              className={`mt-1 flex items-center gap-2 px-2.5 py-2.5 rounded-lg cursor-pointer transition ${
                activeCat === null
                  ? 'bg-brand-soft text-brand-700'
                  : 'hover:bg-bg2'
              }`}
            >
              <span className="text-base">📦</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">
                  {t('uncategorized')}
                </div>
                <div className="text-xs text-mute">
                  {t('productsCount', {
                    count: products.filter((p) => p.categoryId === null).length,
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Productos */}
        <div className="card overflow-hidden">
         <div className="overflow-x-auto">
          {(() => {
            // Layout dinámico: 40px fijo (drag) + las 5 columnas
            // redimensionables. Reusamos el mismo string en header y
            // rows para mantener alineación exacta.
            const w = productCols.widths;
            const gridTemplate = `40px ${w.name}px ${w.price}px ${w.variants}px ${w.available}px ${w.actions}px`;
            const totalMin = 40 + w.name + w.price + w.variants + w.available + w.actions;
            return (
          <div style={{ minWidth: totalMin }}>
          <div className="flex items-center justify-between bg-bg2/60 px-3 py-1.5 border-b border-line2">
            <div className="text-[10px] uppercase tracking-wider text-mute">
              {t('dragColumnHint')}
            </div>
            <button
              type="button"
              onClick={productCols.reset}
              className="text-[11px] text-mute hover:text-ink underline"
              title={t('resetColumnsTitle')}
            >
              {t('resetColumns')}
            </button>
          </div>
          <div
            className="grid bg-bg2 px-3 py-2.5 text-[11px] uppercase tracking-[0.1em] text-mute font-semibold"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            <div></div>
            <ResizableHeader
              label={t('colProduct')}
              width={w.name}
              onResizeStart={(e) =>
                productCols.startResize('name', e.clientX, w.name)
              }
            />
            <ResizableHeader
              label={t('colPrice')}
              width={w.price}
              onResizeStart={(e) =>
                productCols.startResize('price', e.clientX, w.price)
              }
            />
            <ResizableHeader
              label={t('colVariants')}
              width={w.variants}
              onResizeStart={(e) =>
                productCols.startResize('variants', e.clientX, w.variants)
              }
            />
            <ResizableHeader
              label={t('colAvailable')}
              width={w.available}
              onResizeStart={(e) =>
                productCols.startResize('available', e.clientX, w.available)
              }
            />
            <ResizableHeader
              label={t('colActions')}
              width={w.actions}
              align="right"
              onResizeStart={(e) =>
                productCols.startResize('actions', e.clientX, w.actions)
              }
            />
          </div>
          {visibleProducts.length === 0 ? (
            <div className="text-center p-12">
              <div className="text-3xl mb-1">🍴</div>
              <div className="font-semibold text-sm">
                {t('noProductsInCategory')}
              </div>
              <div className="text-mute text-xs mt-1">
                {t('useNewProductButton')}
              </div>
            </div>
          ) : (
            <SortableList items={visibleProducts} onReorder={reorderProducts}>
              {(p, { dragHandleProps }) => (
                <div
                  className="grid items-center px-3 py-3 border-t border-line2 text-sm"
                  style={{ gridTemplateColumns: gridTemplate }}
                >
                  <div className="flex items-center justify-center">
                    <DragHandle {...dragHandleProps} />
                  </div>
                  <div
                    style={{ width: w.name, maxWidth: w.name }}
                    className="min-w-0"
                  >
                    <div className="font-medium flex items-center gap-1.5 truncate">
                      {p.isRecommended && (
                        <span title="Recomendado" className="text-amber-500 flex-none">
                          ⭐
                        </span>
                      )}
                      <span className="truncate" title={p.name}>{p.name}</span>
                    </div>
                    {(() => {
                      // Badges de visibilidad por canal — separación menú
                      // mesa vs delivery (2026-06-06). Productos creados
                      // antes de la migration tienen los flags en true por
                      // defecto. Si ambos están OFF, mostramos warning rojo.
                      const onMesa = p.availableForMesa ?? true;
                      const onDelivery = p.availableForDelivery ?? true;
                      const noChannels = !onMesa && !onDelivery;
                      return (
                        <div className="flex gap-1 mt-1 flex-wrap items-center">
                          {noChannels ? (
                            <span
                              className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-800"
                              title={t('noChannelWarningTitle')}
                            >
                              ⚠️ {t('noMenuBadge')}
                            </span>
                          ) : (
                            <>
                              {onMesa && (
                                <span
                                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800"
                                  title={t('visibleMesaTitle')}
                                >
                                  🍽️ {t('mesaBadge')}
                                </span>
                              )}
                              {onDelivery && (
                                <span
                                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-100 text-sky-800"
                                  title={t('visibleDeliveryTitle')}
                                >
                                  🚚 {t('deliveryBadge')}
                                </span>
                              )}
                            </>
                          )}
                          {p.tags.map((tag) => (
                            <span key={tag} className="badge badge-info text-[10px]">
                              {tag}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                  <div
                    style={{ width: w.price, maxWidth: w.price }}
                    className="font-medium truncate"
                  >
                    {fmt(Number(p.basePrice), tenantCurrency, tenantCurrencySymbol)}
                  </div>
                  <div
                    style={{ width: w.variants, maxWidth: w.variants }}
                    className="text-mute text-xs truncate"
                  >
                    {t('variantsExtrasShort', { v: p.variants.length, e: p.extras.length })}
                  </div>
                  <div
                    style={{ width: w.available, maxWidth: w.available }}
                    className="flex flex-col gap-1 items-start min-w-0"
                  >
                    <button
                      onClick={() => toggle(p)}
                      className={`badge ${
                        p.isAvailable ? 'badge-ok' : 'badge-mute'
                      } cursor-pointer`}
                    >
                      {p.isAvailable ? t('visible') : t('hidden')}
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
                        title={t('stockAvailable')}
                      >
                        📦 {p.stock}
                      </span>
                    )}
                  </div>
                  <div
                    style={{ width: w.actions, maxWidth: w.actions }}
                    className="text-right truncate"
                  >
                    <button
                      className="btn-link text-xs mr-3"
                      onClick={() => setEditing(p)}
                    >
                      {t('edit')}
                    </button>
                    <button
                      className="text-bad text-xs underline"
                      onClick={() => deleteProduct(p.id)}
                    >
                      {t('delete')}
                    </button>
                  </div>
                </div>
              )}
            </SortableList>
          )}
          </div>
            );
          })()}
         </div>
        </div>
      </div>

      {editing && (
        <ProductDrawer
          value={editing}
          categories={cats}
          adicionales={adicionales}
          mainLabel={mainLabel}
          tenantCurrency={tenantCurrency}
          tenantCurrencySymbol={tenantCurrencySymbol}
          onCancel={() => setEditing(null)}
          onSave={saveProduct}
        />
      )}

      {showAdicionales && (
        <AdicionalesModal
          items={adicionales}
          onClose={() => setShowAdicionales(false)}
          onChange={loadAdicionales}
          tenantCurrency={tenantCurrency}
          tenantCurrencySymbol={tenantCurrencySymbol}
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
            toast(t('coverSaved'), 'success');
          }}
        />
      )}

      {coverRecommendedOpen && (
        <RecommendedCoverModal
          onClose={() => setCoverRecommendedOpen(false)}
          onSaved={() => {
            setCoverRecommendedOpen(false);
            toast(t('recommendedCoverSaved'), 'success');
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
            toast(t('popupSaved'), 'success');
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
  const t = useTranslations('app_menu');
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
      toast(e.message || t('couldNotSave'), 'error');
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
            <div className="text-xs text-mute">{t('sectionCover')}</div>
            <h2 className="font-semibold text-lg m-0">{target.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-mute hover:text-ink p-1"
            aria-label={t('close')}
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="label">{t('taglineLabel')}</label>
            <input
              type="text"
              className="input"
              placeholder={t('taglinePlaceholder')}
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              maxLength={200}
            />
            <p className="text-[11px] text-mute mt-1">
              {t('taglineHint')}
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
            title={t('resetToDefaultTitle')}
          >
            {t('resetToDefault')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="btn-primary"
          >
            {saving ? t('saving') : t('saveCover')}
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
  const t = useTranslations('app_menu');
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
        setErr(e?.message || t('couldNotLoadConfig'));
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
            {t('close')}
          </button>
        </div>
      </div>
    );
  }
  if (!initial) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center">
        <div className="text-white text-sm">{t('loading')}</div>
      </div>
    );
  }
  return (
    <CoverEditorModal
      target={{
        title: t('recommended'),
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
  const t = useTranslations('app_menu');
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
      toast(e.message || t('couldNotSavePopup'), 'error');
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
              {t('optionalPopup')}
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
                <div className="font-semibold text-sm">{t('enablePopup')}</div>
                <div className="text-[11px] text-mute leading-snug">
                  {t('enablePopupHint')}
                </div>
              </div>
            </label>

            <div>
              <label className="label">{t('image')}</label>
              <ImageUploader
                value={cfg.imageUrl ?? ''}
                onChange={(url) => patch('imageUrl', url || null)}
                folder="category-popup"
              />
              <div className="text-[10px] text-mute mt-1">
                {t('imageHint')}
              </div>
            </div>

            <div>
              <label className="label">{t('title')}</label>
              <input
                type="text"
                className="input"
                placeholder={t('popupTitlePlaceholder')}
                maxLength={80}
                value={cfg.title ?? ''}
                onChange={(e) => patch('title', e.target.value)}
              />
            </div>

            <div>
              <label className="label">{t('description')}</label>
              <textarea
                className="input min-h-[80px]"
                placeholder={t('popupDescriptionPlaceholder')}
                maxLength={400}
                value={cfg.description ?? ''}
                onChange={(e) => patch('description', e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">{t('buttonText')}</label>
                <input
                  type="text"
                  className="input"
                  placeholder={t('buttonTextPlaceholder')}
                  maxLength={30}
                  value={cfg.buttonText ?? ''}
                  onChange={(e) => patch('buttonText', e.target.value)}
                />
              </div>
              <div>
                <label className="label">{t('buttonColor')}</label>
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
              <label className="label">{t('buttonUrl')}</label>
              <input
                type="url"
                className="input"
                placeholder={t('buttonUrlPlaceholder')}
                value={cfg.buttonUrl ?? ''}
                onChange={(e) => patch('buttonUrl', e.target.value)}
              />
              <div className="text-[10px] text-mute mt-1">
                {t('buttonUrlHint')}
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-line">
              <div className="text-xs font-semibold uppercase tracking-wider text-mute">
                {t('behavior')}
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
                  <div className="font-medium">{t('openAutomatically')}</div>
                  <div className="text-[11px] text-mute">
                    {t('openAutomaticallyHint')}
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
                  <div className="font-medium">{t('onlyOnTapBanner')}</div>
                  <div className="text-[11px] text-mute">
                    {t('onlyOnTapBannerHint')}
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
                <span>{t('oncePerSession')}</span>
              </label>

              {(cfg.trigger ?? 'auto') === 'auto' && (
                <>
                  <label className="flex items-start gap-2 cursor-pointer text-sm pt-2">
                    <input
                      type="checkbox"
                      checked={cfg.triggerImmediate ?? false}
                      onChange={(e) => patch('triggerImmediate', e.target.checked)}
                      className="mt-1 w-4 h-4 accent-brand"
                    />
                    <div>
                      <div className="font-medium">{t('appearImmediately')}</div>
                      <div className="text-[11px] text-mute">
                        {t('appearImmediatelyHint')}
                      </div>
                    </div>
                  </label>

                  <div className="pt-2">
                    <label className="label text-xs">
                      {t('delayLabel', { seconds: cfg.delaySeconds ?? 0 })}
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={20}
                      step={1}
                      value={cfg.delaySeconds ?? 0}
                      onChange={(e) => patch('delaySeconds', Number(e.target.value))}
                      className="w-full"
                    />
                    <div className="text-[11px] text-mute">
                      {t('delayHint')}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Preview */}
          <div className="bg-gradient-to-b from-bg2/50 to-bg2 p-5 flex flex-col items-center">
            <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-3">
              {t('preview')}
            </div>
            <PopupPreview cfg={cfg} />
            {!cfg.enabled && (
              <div className="mt-3 text-[10px] text-mute italic text-center">
                {t('popupDisabledNotice')}
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
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="btn-primary text-sm"
          >
            {saving ? t('saving') : t('savePopup')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Mock visual del popup tal como se verá en el storefront público.
 *  Frame mini-iPhone para dar contexto del tamaño. */
function PopupPreview({ cfg }: { cfg: PopupConfig }) {
  const t = useTranslations('app_menu');
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
          {t('noImagePlaceholder')}
        </div>
      )}
      <div className="p-4 space-y-2">
        {cfg.title?.trim() ? (
          <div className="font-bold text-sm leading-tight">{cfg.title}</div>
        ) : (
          <div className="font-bold text-sm text-mute italic">
            {t('popupTitlePreviewPlaceholder')}
          </div>
        )}
        {cfg.description?.trim() && (
          <div className="text-xs text-mute leading-snug whitespace-pre-line">
            {cfg.description}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button className="text-[11px] px-2 py-1.5 rounded-md text-mute" disabled>
            {t('close')}
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
          {t('completeFieldsToPreview')}
        </div>
      )}
    </div>
  );
}

function AdicionalesModal({
  items,
  onClose,
  onChange,
  tenantCurrency,
  tenantCurrencySymbol,
}: {
  items: Adicional[];
  onClose: () => void;
  onChange: () => void;
  tenantCurrency: string;
  tenantCurrencySymbol: string | null;
}) {
  const t = useTranslations('app_menu');
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
        toast(t('addonUpdated'), 'success');
      } else {
        await api('/catalog/adicionales', {
          method: 'POST',
          body: JSON.stringify(form),
        });
        toast(t('addonCreated'), 'success');
      }
      setForm({ name: '', price: 0 });
      setEditingId(null);
      onChange();
    } catch (e: any) {
      toast(e.message || t('couldNotSave'), 'error');
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
    if (!confirm(t('confirmDeleteAddon'))) return;
    try {
      await api(`/catalog/adicionales/${id}`, { method: 'DELETE' });
      if (editingId === id) cancelEdit();
      onChange();
    } catch (e: any) {
      toast(e.message || t('couldNotDelete'), 'error');
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
            <h3 className="font-semibold text-base m-0">{t('addons')}</h3>
            <p className="text-xs text-mute mt-0.5">
              {t('addonsLibraryHint')}
            </p>
          </div>
          <button onClick={onClose} className="text-mute hover:text-ink p-1" title={t('close')}>
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="px-5 py-3 border-b border-line flex gap-2">
          <input
            className="input flex-1"
            placeholder={t('addonNamePlaceholder')}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            type="number"
            className="input w-28"
            placeholder={t('price')}
            value={form.price}
            onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
          />
          <button className="btn-primary" disabled={busy} title={editingId ? t('saveChanges') : t('add')}>
            <Icon name={editingId ? 'check' : 'plus'} />
          </button>
          {editingId && (
            <button type="button" className="btn-ghost" onClick={cancelEdit} title={t('cancelEdit')}>
              ✕
            </button>
          )}
        </form>

        <div className="flex-1 overflow-y-auto px-5 py-2">
          {items.length === 0 ? (
            <div className="text-center text-mute text-sm py-8">
              {t('noAddonsYet')}
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
                  <div className="text-xs text-mute">{fmt(Number(a.price), tenantCurrency, tenantCurrencySymbol)}</div>
                </div>
                <button
                  className="text-mute hover:text-brand p-1"
                  onClick={() => startEdit(a)}
                  title={t('edit')}
                >
                  <Icon name="edit" size={14} />
                </button>
                <button
                  className="text-mute hover:text-bad p-1"
                  onClick={() => remove(a.id)}
                  title={t('delete')}
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
  tenantCurrency,
  tenantCurrencySymbol,
  onCancel,
  onSave,
}: {
  value: Partial<Product>;
  categories: Category[];
  adicionales: Adicional[];
  mainLabel: string;
  tenantCurrency: string;
  tenantCurrencySymbol: string | null;
  onCancel: () => void;
  onSave: (p: Partial<Product>) => void;
}) {
  const t = useTranslations('app_menu');
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
            {form.id ? t('editProduct') : t('newProduct')}
          </h2>
          <button onClick={onCancel} className="text-mute hover:text-ink">
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">{t('name')}</label>
            <input
              className="input"
              value={form.name ?? ''}
              onChange={(e) => update('name', e.target.value)}
            />
          </div>
          <div>
            <label className="label">{t('categoryOptional')}</label>
            <select
              className="input"
              value={form.categoryId ?? ''}
              onChange={(e) =>
                update('categoryId', e.target.value === '' ? null : e.target.value)
              }
            >
              {/* Bloque 2 (2026-06-12): "" = sin categoría. El storefront
                  renderiza productos sin categoría en una sección "Otros"
                  al final, sin layout especial. */}
              <option value="">{t('noCategoryOption')}</option>
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
                  {t('subsectionAssignedHint')}
                </div>
              )}
          </div>
          <div>
            <label className="label">{t('priceType')}</label>
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
                    {mode === 'FIXED' ? t('fixedPrice') : t('rangePrice')}
                  </button>
                );
              })}
            </div>
            {(form.priceMode ?? 'FIXED') === 'FIXED' ? (
              <div>
                <label className="label">{t('basePrice')}</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className="input"
                  value={form.basePrice ?? 0}
                  onChange={(e) =>
                    update('basePrice', parsePriceInput(e.target.value) ?? 0)
                  }
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">{t('minimum')}</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="input"
                    value={form.basePrice ?? 0}
                    onChange={(e) =>
                      update('basePrice', parsePriceInput(e.target.value) ?? 0)
                    }
                  />
                </div>
                <div>
                  <label className="label">{t('maximum')}</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="input"
                    value={form.priceMax ?? ''}
                    onChange={(e) =>
                      update(
                        'priceMax',
                        e.target.value === '' ? null : parsePriceInput(e.target.value),
                      )
                    }
                    placeholder={t('upToPlaceholder')}
                  />
                </div>
                <div className="col-span-2 text-[11px] text-mute">
                  {t('shownAs')}{' '}
                  <strong>
                    {fmt(Number(form.basePrice ?? 0), tenantCurrency, tenantCurrencySymbol)} —{' '}
                    {form.priceMax != null
                      ? fmt(Number(form.priceMax), tenantCurrency, tenantCurrencySymbol)
                      : '?'}
                  </strong>
                  {t('cartUsesMinimum')}
                </div>
              </div>
            )}
          </div>
          <div>
            <label className="label">{t('description')}</label>
            <textarea
              className="input"
              value={form.description ?? ''}
              onChange={(e) => update('description', e.target.value)}
            />
          </div>
          <div>
            <label className="label">{t('productImage')}</label>
            <ImageUploader
              value={form.imageUrl}
              onChange={(url) => update('imageUrl', url)}
              folder="products"
            />
          </div>
          <div>
            <label className="label">{t('tagsLabel')}</label>
            <input
              className="input"
              value={(form.tags ?? []).join(', ')}
              onChange={(e) =>
                update(
                  'tags',
                  e.target.value
                    .split(',')
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                )
              }
              placeholder={t('tagsPlaceholder')}
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
                ⭐ {t('highlightAsRecommended')}
              </div>
              <div className="text-xs text-mute mt-0.5">
                {t('recommendedHint', { label: mainLabel.toLowerCase() })}
              </div>
            </div>
          </label>

          {/* Visibilidad por canal (separación menú mesa vs delivery, 2026-06-06). */}
          <fieldset className="border border-line rounded-lg p-3">
            <legend className="px-1 text-xs font-semibold text-mute">
              {t('visibilityInPublicMenus')}
            </legend>
            {(() => {
              const onMesa = form.availableForMesa ?? true;
              const onDelivery = form.availableForDelivery ?? true;
              const noChannels = !onMesa && !onDelivery;
              return (
                <>
                  <label className="flex items-start gap-2.5 py-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={onMesa}
                      onChange={(e) =>
                        update('availableForMesa', e.target.checked)
                      }
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-semibold">
                        🍽️ {t('availableInMesaMenu')}
                      </div>
                      <div className="text-xs text-mute mt-0.5">
                        {t('availableInMesaHintPre')} <code>/m/&lt;slug&gt;</code> {t('availableInMesaHintPost')}
                      </div>
                    </div>
                  </label>
                  <label className="flex items-start gap-2.5 py-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={onDelivery}
                      onChange={(e) =>
                        update('availableForDelivery', e.target.checked)
                      }
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-semibold">
                        🚚 {t('availableInDeliveryMenu')}
                      </div>
                      <div className="text-xs text-mute mt-0.5">
                        {t('availableInDeliveryHintPre')} <code>/d/&lt;slug&gt;</code> {t('availableInDeliveryHintPost')}
                      </div>
                    </div>
                  </label>
                  {noChannels && (
                    <div className="mt-2 rounded-md bg-red-50 border border-red-200 px-2.5 py-1.5 text-xs text-red-800">
                      ⚠️ {t('noChannelWarning')}
                    </div>
                  )}
                </>
              );
            })()}
          </fieldset>

          <fieldset className="border border-line rounded-lg p-3">
            <legend className="px-1 text-xs font-semibold text-mute">
              {t('inventoryOptional')}
            </legend>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.stock !== null && form.stock !== undefined}
                onChange={(e) =>
                  update('stock', e.target.checked ? 0 : null)
                }
              />
              <span>{t('trackStock')}</span>
            </label>
            {form.stock !== null && form.stock !== undefined && (
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div>
                  <label className="label">{t('stockAvailable')}</label>
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
                  <label className="label">{t('alertAtLabel')}</label>
                  <input
                    type="number"
                    min="0"
                    className="input"
                    placeholder={t('optional')}
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
                  💡 {t('stockAutoDeductHint')}
                </div>
              </div>
            )}
          </fieldset>

          <fieldset className="border border-line rounded-lg p-3">
            <legend className="px-1 text-xs font-semibold text-mute flex items-center gap-1.5">
              {t('variants')} (
              <input
                className="bg-transparent border-b border-dashed border-line focus:border-brand outline-none text-xs font-semibold w-24 px-0.5"
                placeholder={t('sizesPlaceholder')}
                value={form.variants?.[0]?.groupName ?? ''}
                onChange={(e) => {
                  const label = e.target.value;
                  const arr = (form.variants ?? []).map((v) => ({
                    ...v,
                    groupName: label,
                  }));
                  update('variants', arr);
                }}
                title={t('editGroupNameTitle')}
              />
              )
            </legend>

            {/* Toggle: cómo se interpreta el precio de cada opción/tamaño.
                DELTA (default) = suma al base · ABSOLUTE = precio propio total. */}
            <div className="mb-2">
              <div className="text-[11px] font-semibold text-mute mb-1">
                {t('variantPriceModeLabel')}
              </div>
              <div className="inline-flex rounded-lg border border-line overflow-hidden text-xs">
                <button
                  type="button"
                  className={`px-3 py-1.5 transition ${
                    (form.variantPriceMode ?? 'DELTA') === 'DELTA'
                      ? 'bg-brand text-white'
                      : 'bg-white text-mute hover:bg-bg2'
                  }`}
                  onClick={() => update('variantPriceMode', 'DELTA')}
                >
                  {t('variantModeDelta')}
                </button>
                <button
                  type="button"
                  className={`px-3 py-1.5 transition border-l border-line ${
                    (form.variantPriceMode ?? 'DELTA') === 'ABSOLUTE'
                      ? 'bg-brand text-white'
                      : 'bg-white text-mute hover:bg-bg2'
                  }`}
                  onClick={() => update('variantPriceMode', 'ABSOLUTE')}
                >
                  {t('variantModeAbsolute')}
                </button>
              </div>
              <p className="text-[10px] text-mute mt-1 leading-snug">
                {(form.variantPriceMode ?? 'DELTA') === 'ABSOLUTE'
                  ? t('variantModeAbsoluteHint')
                  : t('variantModeDeltaHint')}
              </p>
            </div>

            {(form.variants ?? []).map((v, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input
                  className="input flex-1"
                  placeholder={t('variantNamePlaceholder')}
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
                  placeholder={
                    (form.variantPriceMode ?? 'DELTA') === 'ABSOLUTE'
                      ? t('absolutePricePlaceholder')
                      : t('plusPricePlaceholder')
                  }
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
              {t('addVariant')}
            </button>
          </fieldset>

          <fieldset className="border border-line rounded-lg p-3">
            <legend className="px-1 text-xs font-semibold text-mute">{t('extras')}</legend>

            {adicionales.length > 0 && (
              <div className="mb-3 p-2 rounded-lg bg-bg2">
                <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-1.5">
                  {t('fromLibrary')}
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
                          {fmt(Number(a.price), tenantCurrency, tenantCurrencySymbol)}
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
                  placeholder={t('extraNamePlaceholder')}
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
                  placeholder={t('price')}
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
              {t('addExtra')}
            </button>
          </fieldset>
        </div>

        <div className="mt-6 flex gap-2">
          <button className="btn-ghost flex-1 justify-center" onClick={onCancel}>
            {t('cancel')}
          </button>
          <button className="btn-primary flex-1 justify-center" onClick={() => onSave(form)}>
            <Icon name="check" /> {t('save')}
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
  const t = useTranslations('app_menu');
  const [origin, setOrigin] = useState<string>('');
  useEffect(() => {
    if (typeof window !== 'undefined') setOrigin(window.location.origin);
  }, []);
  const mesaUrl = `${origin}/m/${slug}`;
  const deliveryUrl = `${origin}/d/${slug}`;
  const labelLower = mainLabel.toLowerCase();

  async function copy(url: string, label: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast(t('linkCopied', { label }), 'success');
    } catch {
      toast(t('couldNotCopy'), 'error');
    }
  }

  return (
    <div className="card card-pad mb-4">
      <h2 className="text-base font-semibold m-0 flex items-center gap-2">
        🔗 {t('publicLinksTitle', { label: labelLower })}
      </h2>
      <p className="text-xs text-mute mt-1 leading-relaxed">
        {t('publicLinksIntro')}
      </p>
      <div className="mt-4 grid md:grid-cols-2 gap-3">
        {/* Mesa */}
        <div className="rounded-input border border-line2 bg-bg2/30 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="text-lg">🍽</span>
            <span>{t('mesaMenu')}</span>
            <span className="ml-auto text-[10px] uppercase tracking-wider font-bold bg-bg2 text-mute px-1.5 py-0.5 rounded">
              {t('informative')}
            </span>
          </div>
          <p className="text-[11px] text-mute mt-1 leading-snug">
            {t('mesaMenuDesc')}
          </p>
          <div className="mt-3 rounded-input bg-white border border-line px-2.5 py-2 text-[11px] font-mono break-all">
            {mesaUrl || '—'}
          </div>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              className="btn-ghost text-xs flex-1 justify-center"
              onClick={() => copy(mesaUrl, t('mesaLabel'))}
              disabled={!origin}
            >
              📋 {t('copy')}
            </button>
            <Link
              href={`/m/${slug}`}
              target="_blank"
              className="btn-ghost text-xs flex-1 justify-center"
            >
              ↗ {t('open')}
            </Link>
          </div>
        </div>
        {/* Delivery */}
        <div className="rounded-input border-2 border-brand/30 bg-brand-soft/30 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="text-lg">🛵</span>
            <span>{t('deliveryMenu')}</span>
            <span className="ml-auto text-[10px] uppercase tracking-wider font-bold bg-brand text-white px-1.5 py-0.5 rounded">
              {t('withCart')}
            </span>
          </div>
          <p className="text-[11px] text-mute mt-1 leading-snug">
            {t('deliveryMenuDesc')}
          </p>
          <div className="mt-3 rounded-input bg-white border border-line px-2.5 py-2 text-[11px] font-mono break-all">
            {deliveryUrl || '—'}
          </div>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              className="btn-ghost text-xs flex-1 justify-center"
              onClick={() => copy(deliveryUrl, t('deliveryLabel'))}
              disabled={!origin}
            >
              📋 {t('copy')}
            </button>
            <Link
              href={`/d/${slug}`}
              target="_blank"
              className="btn-ghost text-xs flex-1 justify-center"
            >
              ↗ {t('open')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
