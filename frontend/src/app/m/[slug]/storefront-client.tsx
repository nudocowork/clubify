'use client';
import { Fragment, Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import {
  buildStorefrontPath,
  modeFromPathname,
  orderModeFor,
  type StorefrontMode,
} from '@/lib/menu/storefront-mode';
import {
  addToCart,
  cartTotals,
  CartItem,
  readCart,
  updateQty,
  clearCart,
} from '@/lib/cart';
import { Icon } from '@/components/Icon';
import { Barcode } from '@/components/Barcode';
import {
  ProductBadge,
  PrimaryProductBadge,
} from '@/components/storefront/ProductBadge';
import { ClubifyBadge } from '@/components/ClubifyBadge';
import { isDarkBackground } from '@/lib/contrast';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { CO_LOCATIONS, OTRO_MUNICIPIO } from '@/lib/co-locations';
import { regionsForCountry } from '@/lib/regions';
import { useLocale, useT } from '@/lib/i18n';
import { SectionCoverPreview } from '@/components/menu/SectionCoverPreview';
import { MenuBookViewer } from '@/components/menu/MenuBookViewer';
import {
  CategoryPopupController,
  CategoryPopupBadge,
} from '@/components/menu/CategoryPopupController';
import { CategoryUrlSync } from '@/components/menu/CategoryUrlSync';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type MenuLayout =
  | 'CLASSIC'
  | 'GRID'
  | 'CAROUSELS'
  | 'CLEAN'
  | 'COMPACT'
  | 'CLUVI'
  | 'SECTIONS'
  | 'FLIPBOOK';

// Estilo configurable del botón "Volver" en SECTIONS. Cualquier campo
// puede ser undefined → el render usa el default histórico.
type BackButtonConfig = {
  bgColor?: string;       // default: rgba(0,0,0,0.4)
  iconColor?: string;     // default: #fff
  opacity?: number;       // 0..1, multiplica al alpha del bg final
  borderColor?: string;   // default: ninguno
  borderWidth?: number;   // px, default 0
  shadow?: 'none' | 'sm' | 'md' | 'lg'; // default 'md'
  size?: number;          // px, default 40
};

type Storefront = {
  id: string;
  brandName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  whatsappPhone: string | null;
  instagramUrl: string | null;
  mapsUrl: string | null;
  currency: string;
  /** Símbolo override opcional. Si está, reemplaza el símbolo automático
   *  de Intl en todos los precios mostrados. */
  currencySymbol?: string | null;
  /** País ISO 3166-1 alpha-2 (CO, MX, AR, ...). Resuelve los dropdowns
   *  dinámicos de estado/provincia/etc del checkout. */
  country?: string;
  description: string;
  heroImageUrl: string | null;
  menuLayout?: MenuLayout;
  digitalMenuEnabled?: boolean;
  bookMenuEnabled?: boolean;
  ordersEnabled?: boolean;
  ordersDeliveryEnabled?: boolean;
  pageBackgroundColor?: string | null;
  pageBackgroundType?: string | null;
  pageBackgroundGradient?: string | null;
  pageBackgroundImageUrl?: string | null;
  logoBgColor?: string | null;
  titleColor?: string | null;
  descriptionColor?: string | null;
  backButtonConfig?: BackButtonConfig | null;
  popup?: { imageUrl: string; cardId: string | null; delaySeconds?: number } | null;
  planName?: string | null;
  // Label visible para tab principal y títulos — resuelto server-side
  // (override del tenant > categoría > "Menú"). Fallback "Menú" si no llega.
  mainSectionLabel?: string;
  promotions: any[];
};

type Variant = { id: string; groupName: string; name: string; priceDelta: number; isDefault: boolean };
type Extra = { id: string; name: string; price: number; maxQty: number };
type Product = {
  id: string;
  name: string;
  description: string;
  basePrice: number;
  priceMode?: 'FIXED' | 'RANGE';
  priceMax?: number | null;
  imageUrl: string | null;
  tags: string[];
  variants: Variant[];
  extras: Extra[];
};
type Category = {
  id: string;
  name: string;
  slug?: string;
  description?: string | null;
  imageUrl?: string | null;
  tagline?: string | null;
  coverConfig?: any | null;
  popupConfig?: import('@/components/menu/CategoryPopupController').PopupConfig | null;
  products: Product[];
  subsections?: Category[];
};

/** Variable global del símbolo override. Se setea desde el render principal
 *  con el valor del Storefront (s.currencySymbol) — así NO necesitamos
 *  modificar cada uno de los ~20 callsites de fmt() en este archivo. */
let CURRENT_SYMBOL_OVERRIDE: string | null = null;
function fmt(n: number, currency = 'COP') {
  try {
    const parts = new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).formatToParts(n);
    const sym = CURRENT_SYMBOL_OVERRIDE?.trim();
    if (sym) {
      return parts.map((p) => (p.type === 'currency' ? sym : p.value)).join('');
    }
    return parts.map((p) => p.value).join('');
  } catch {
    const sym = CURRENT_SYMBOL_OVERRIDE?.trim();
    return `${sym || '$'}${n.toFixed(0)}`;
  }
}

/** Formato del precio del producto según priceMode. Resuelve en un solo
 *  lugar la decisión de mostrar:
 *    - "Desde $X — $Y"  cuando RANGE con priceMax válido
 *    - "$X"             cuando FIXED o RANGE sin priceMax (fallback)
 *  Usado por los 8 layouts del storefront. */
function fmtProductPrice(
  p: Pick<Product, 'basePrice' | 'priceMode' | 'priceMax'>,
  currency = 'COP',
): string {
  if (p.priceMode === 'RANGE' && p.priceMax != null && p.priceMax > p.basePrice) {
    return `${fmt(Number(p.basePrice), currency)} — ${fmt(
      Number(p.priceMax),
      currency,
    )}`;
  }
  return fmt(Number(p.basePrice), currency);
}

/** Aplana una categoría en blocks de productos: el primer block son
 *  los productos directos de la categoría (sin sub-header, title=null),
 *  los siguientes son cada subsección con su título. Si una sección
 *  no tiene subsections, devuelve un único block.
 *
 *  Bloques con products vacíos se filtran — no inflan UI con headers
 *  huérfanos. Usado por todos los layouts vertical-acordeón. */
function getProductBlocks(
  cat: Category,
): Array<{ id: string; title: string | null; products: Product[] }> {
  const blocks: Array<{ id: string; title: string | null; products: Product[] }> =
    [];
  if (cat.products.length > 0) {
    blocks.push({ id: cat.id, title: null, products: cat.products });
  }
  for (const sub of cat.subsections ?? []) {
    if (sub.products.length > 0) {
      blocks.push({ id: sub.id, title: sub.name, products: sub.products });
    }
  }
  return blocks;
}

/** Sub-header visual para subsecciones dentro de una categoría. Estilo
 *  diferente del header de categoría (más sutil) para que la jerarquía
 *  se entienda visualmente sin competir. */
function SubsectionHeader({
  title,
  primary,
  isCluvi,
}: {
  title: string;
  primary: string;
  isCluvi?: boolean;
}) {
  return (
    <div className="mt-5 mb-2 first:mt-0 flex items-center gap-2">
      <div
        className="w-1 h-4 rounded-sm"
        style={{ background: primary }}
        aria-hidden
      />
      <h3
        className={`text-[11px] uppercase tracking-[0.16em] font-bold m-0 ${
          isCluvi ? 'text-white/80' : 'text-ink/80'
        }`}
      >
        {title}
      </h3>
    </div>
  );
}

// Componente principal del storefront público.
//
// IMPORTANTE: este archivo NO es page.tsx (es storefront-client.tsx) para
// poder exportarlo y reusarlo desde 2 routes distintas:
//   - /m/[slug]/page.tsx          (entrada normal al menú)
//   - /m/[slug]/[sectionSlug]/    (deep-link a una sección específica)
// Next.js 14.2.x rechaza named exports en page.tsx; por eso vive aquí y
// las dos page.tsx son re-exports minimal de este default.
//
// La detección de sectionSlug se hace via useParams: si la URL es
// /m/x/y, el param `sectionSlug` viene poblado; si es /m/x, viene
// undefined. El componente se comporta igual en ambos casos.

/**
 * Imagen de producto optimizada. Reemplaza el <img> plano con
 * next/image que automaticamente:
 *  - Sirve WebP (o AVIF en clientes que lo soporten) cuando la fuente
 *    es JPG/PNG pesada del R2 — reducción típica 70-85% del peso.
 *  - Genera srcset responsivo según `sizes`: el browser pide el tamaño
 *    correcto para el viewport en vez de la imagen original.
 *  - Cachea en el CDN/edge de Vercel durante 1 año (config global) —
 *    visitas repetidas son instantáneas.
 *  - Lazy load por default; `priority` para las primeras 2-3 imágenes
 *    visibles arriba del fold (precarga vía <link rel="preload">).
 *  - Fade-in suave al cargar para que el cliente no vea pop-in.
 *
 * Requiere parent con `position: relative` + dimensiones fijas
 * (aspect-square, aspect-[16/9], etc.) para usar el modo `fill`.
 */
function ProductImage({
  src,
  alt,
  sizes,
  priority = false,
  fit = 'cover',
  hoverScale = false,
}: {
  src: string;
  alt: string;
  sizes: string;
  priority?: boolean;
  fit?: 'cover' | 'contain';
  hoverScale?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {!loaded && (
        <div className="absolute inset-0 animate-pulse bg-bg2/70" />
      )}
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        onLoad={() => setLoaded(true)}
        className={`transition-opacity duration-300 ${
          loaded ? 'opacity-100' : 'opacity-0'
        } ${fit === 'cover' ? 'object-cover' : 'object-contain'} ${
          hoverScale ? 'group-hover:scale-105 transition' : ''
        }`}
      />
    </>
  );
}
// HOTFIX 2026-06-05 (bug F): `StorefrontPublic` y `CheckoutSheet` usan
// `useSearchParams()`. En Next 14 App Router los hooks de search params
// fuerzan el árbol a CSR si no están envueltos en un Suspense boundary.
// Sin Suspense, el build con `output: 'export'` o un prerender de page
// padre falla con "useSearchParams() should be wrapped in a suspense
// boundary". Mismo patrón ya aplicado en /signup y /r/[slug].
export default function StorefrontPublic() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg" />}>
      <StorefrontPublicInner />
    </Suspense>
  );
}

function StorefrontPublicInner() {
  const tt = useT();
  const [locale] = useLocale();
  const params = useParams<{
    slug: string;
    sectionSlug?: string;
    subSlug?: string;
  }>();
  const slug = params.slug;
  const initialSectionSlug = params.sectionSlug;
  const initialSubSlug = params.subSlug;
  // Search params reactivos (?mesa=N, ?promo=1, ?counter=1) — leídos
  // vía Next hook para consistencia SSR/CSR. Ver comentario en `isTableMode`.
  const searchParams = useSearchParams();
  // Modo derivado del PRIMER segmento de la ruta (separación 2026-06-07):
  //   /m/<slug>           → 'mesa'      (informativo, sin cart/checkout/WA)
  //   /d/<slug>           → 'delivery'  (pedido completo)
  //   /m/<slug>/delivery  → 'delivery'  (compat con QRs viejos, se redirige)
  const pathname = usePathname() ?? '';
  const mode: StorefrontMode = modeFromPathname(pathname);
  const [s, setS] = useState<Storefront | null>(null);
  const [menu, setMenu] = useState<Category[]>([]);
  const [tab, setTab] = useState<'menu' | 'promos'>('menu');
  const [openProduct, setOpenProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showCart, setShowCart] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Promo capturado vía QR Descuento (?promo=CODE). Persiste en
  // localStorage para que el cliente lo vea aunque vuelva sin el query
  // param (links posteriores compartidos, etc).
  const [capturedPromo, setCapturedPromo] = useState<string | null>(null);

  // Indicador "traduciendo…" con debounce de 250ms. Si la respuesta
  // viene en menos (típico para cache hits) no se muestra → no flicker.
  const [translating, setTranslating] = useState(false);

  useEffect(() => {
    setCart(readCart(slug, mode));
    const handler = () => setCart(readCart(slug, mode));
    window.addEventListener(`cart:${slug}`, handler);
    return () => window.removeEventListener(`cart:${slug}`, handler);
  }, [slug, mode]);

  // Back compat con QRs viejos que apuntan a `?mesa=1`: con la nueva
  // separación `/m/<slug>` ya ES mesa, así que el param es redundante.
  // Lo limpiamos del URL para no contaminar el state (CheckoutSheet leía
  // `?mesa=N` para forzar DINE_IN — lo cubrimos directo con `mode='mesa'`).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (mode !== 'mesa') return;
    if (!searchParams.get('mesa')) return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete('mesa');
    const qs = next.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  }, [mode, searchParams]);

  // Storefront + menú: ambos fetchs dependen del locale activo. Backend
  // traduce on-the-fly con cache (Fase 2). La primera carga en un idioma
  // paga el call a Claude (~1s); las siguientes son DB hits.
  useEffect(() => {
    if (!slug) return;
    setLoadError(null);
    let cancelled = false;

    // Indicador con debounce: solo aparece si la traducción tarda >250ms.
    // Para cache hits, el fetch termina antes y el indicador no se ve.
    let debounceId: ReturnType<typeof setTimeout> | null = null;
    if (locale !== 'es') {
      debounceId = setTimeout(() => {
        if (!cancelled) setTranslating(true);
      }, 250);
    }

    const finish = () => {
      if (debounceId) clearTimeout(debounceId);
      if (!cancelled) setTranslating(false);
    };

    Promise.all([
      fetch(`${API}/api/public/m/${slug}?locale=${locale}`)
        .then(async (r) => {
          if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            throw new Error(j?.message ?? 'No disponible');
          }
          return r.json();
        })
        .then((data) => {
          if (!cancelled) setS(data);
        })
        .catch((e: Error) => {
          if (!cancelled) setLoadError(e.message || 'No disponible');
        }),
      fetch(`${API}/api/public/m/${slug}/menu?locale=${locale}&mode=${mode}`)
        .then(async (r) => (r.ok ? r.json() : []))
        .then((data) => {
          if (!cancelled) setMenu(data);
        })
        .catch(() => {
          if (!cancelled) setMenu([]);
        }),
    ]).finally(finish);

    return () => {
      cancelled = true;
      if (debounceId) clearTimeout(debounceId);
    };
  }, [slug, locale, mode]);

  // Capturar ?promo=CODE del QR Descuento. Se persiste en localStorage
  // para que el banner sobreviva navegaciones. El código se PRESENTA al
  // pagar — no se aplica automáticamente (los cupones de orders no están
  // wired en backend; ver project_marketing_qr_system memory).
  useEffect(() => {
    if (typeof window === 'undefined' || !slug) return;
    const lsKey = `clubify:promo:${slug}`;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('promo');
    if (raw) {
      const code = raw.trim().toUpperCase().slice(0, 32);
      if (code) {
        try {
          localStorage.setItem(lsKey, code);
        } catch {}
        setCapturedPromo(code);
        return;
      }
    }
    try {
      const stored = localStorage.getItem(lsKey);
      if (stored) setCapturedPromo(stored);
    } catch {}
  }, [slug]);

  // Backend manda la sección virtual "Recomendados" con nombre/tagline
  // hardcodeados en español. La sustituimos por las claves i18n al render.
  // Fase 2 hará lo propio para el resto del contenido dinámico (nombres
  // de categorías, productos, etc.) vía cache + Claude.
  const localizedMenu = useMemo(() => {
    return menu.map((c) => {
      if (c.id !== '__recommended__') return c;
      return {
        ...c,
        name: tt('menu.recommended.name'),
        tagline: tt('menu.recommended.tagline'),
        description: tt('menu.recommended.tagline'),
      };
    });
  }, [menu, tt]);

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 bg-bg">
        <div className="text-center max-w-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="text-5xl mb-3">😔</div>
          <h1 className="text-xl font-bold">{tt('storefront.unavailable_title')}</h1>
          <p className="text-mute mt-2 text-sm leading-relaxed">
            {loadError === 'No disponible' ||
            loadError === 'Negocio no disponible'
              ? tt('storefront.unavailable_msg')
              : loadError}
          </p>
        </div>
        <LanguageSwitcher />
      </div>
    );
  }
  if (!s) {
    // Skeleton de carga mientras llega /public/m/:slug. Antes era un texto
    // "Cargando…" plano que se veía pobre en mobile — ahora un skeleton
    // visual con avatar + tabs + cards placeholder.
    return (
      <div className="min-h-screen bg-[#FAFBFC] animate-in fade-in duration-200">
        <div className="px-5 pt-10 pb-6 max-w-2xl mx-auto">
          <div className="flex flex-col items-center gap-3">
            <div className="w-20 h-20 rounded-2xl bg-bg2 animate-pulse" />
            <div className="w-32 h-6 rounded-md bg-bg2 animate-pulse" />
          </div>
          <div className="mt-6 w-full max-w-md mx-auto h-12 rounded-full bg-bg2 animate-pulse" />
          <div className="mt-6 space-y-3">
            <div className="h-24 rounded-xl bg-bg2 animate-pulse" />
            <div className="h-24 rounded-xl bg-bg2 animate-pulse" />
            <div className="h-24 rounded-xl bg-bg2 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  const totals = cartTotals(cart);
  // Activamos el override de símbolo monetario del tenant antes de cualquier
  // fmt() en este render (closure global del módulo). Se setea aquí en
  // cada render — null si no hay override (uso normal del símbolo Intl).
  CURRENT_SYMBOL_OVERRIDE = s.currencySymbol ?? null;
  const primary = s.primaryColor;

  // Vista MESA = siempre informativa, sin carrito. El cliente sentado
  // en mesa NO lanza pedidos por el menú (los toma el mesero). Solo la
  // vista DELIVERY respeta el toggle del admin.
  // Separación 2026-06-06: el modo viene del path (`/m/<slug>` vs
  // `/m/<slug>/delivery`) — no del query `?mesa=N`. El back compat con
  // QRs viejos `?mesa=1` se resuelve porque la nueva ruta por defecto
  // ya es mesa (el QR sin /delivery cae al canal correcto).
  const isTableMode = mode === 'mesa';
  const ordersAllowed =
    !isTableMode &&
    s.ordersEnabled !== false &&
    (s.ordersDeliveryEnabled ?? true);
  // Mostrar el botón "pedir/contactar por WhatsApp" en el storefront
  // público. Regla de negocio (M1.3 2026-06-04):
  // - Mesa (?mesa=N): NUNCA muestra WA (incluido en ordersAllowed=false).
  // - Delivery: el botón aparece si Delivery está ON. El toggle separado
  //   `ordersWhatsappEnabled` fue eliminado — no tiene sentido "delivery
  //   con carrito pero sin canal para enviar el pedido".
  const showWhatsappButton = ordersAllowed && !!s.whatsappPhone;

  const isCluvi = (s.menuLayout ?? 'CLASSIC') === 'CLUVI';
  // Fondo de la página: tipo SOLID|GRADIENT|IMAGE. El dueño elige desde
  // /app/storefront. Default histórico (sin configurar): color sólido del
  // layout. Si pageBackgroundType está set, gana sobre pageBackgroundColor
  // para el render — pero pageBackgroundColor sigue como fallback si el
  // tipo es 'SOLID'.
  const defaultBgColor = isCluvi ? '#0a0a0a' : '#FAFBFC';
  const bgType = (s.pageBackgroundType ?? 'SOLID').toUpperCase();
  let pageBg: string;
  if (bgType === 'GRADIENT' && s.pageBackgroundGradient) {
    pageBg = s.pageBackgroundGradient;
  } else if (bgType === 'IMAGE' && s.pageBackgroundImageUrl) {
    pageBg = `url("${s.pageBackgroundImageUrl}") center/cover no-repeat fixed ${defaultBgColor}`;
  } else {
    pageBg = s.pageBackgroundColor || defaultBgColor;
  }
  // M2.2: el badge "Hecho con Clubify" cambia entre versión clara (pill
  // blanco) y oscura (texto sutil) según el brillo del fondo del menú.
  // Storefronts con tema oscuro/imagen reciben pill; storefronts con
  // tema claro (mayoría) mantienen el subtle histórico.
  const pageIsDark = isDarkBackground({
    bgType: s.pageBackgroundType ?? (isCluvi ? 'SOLID' : null),
    bgColor: s.pageBackgroundColor ?? (isCluvi ? '#0a0a0a' : null),
  });

  // Si el menú digital está apagado y el libro flipbook prendido, /m/<slug>
  // redirige a /book/<slug> (el modo libro vive en su propia ruta desde
  // F5.2). También cubre el caso legacy menuLayout=FLIPBOOK pre-migration:
  // si todavía vemos FLIPBOOK como layout (no migrado), redirigimos igual
  // para que no quede una pantalla rota.
  const shouldRedirectToBook =
    s.menuLayout === 'FLIPBOOK' ||
    (s.bookMenuEnabled === true && s.digitalMenuEnabled === false);
  if (shouldRedirectToBook) {
    if (typeof window !== 'undefined') {
      // El menú libro no distingue mesa/delivery — comparte una sola vista
      // visual. Mantenemos sectionSlug si llegó.
      window.location.replace(`/book/${slug}${initialSectionSlug ? `/${initialSectionSlug}` : ''}`);
    }
    return null;
  }

  return (
    <div
      className={`min-h-screen pb-32 ${isCluvi ? 'text-white' : ''}`}
      style={{
        background: pageBg,
      }}
    >
      {/* Indicador "traduciendo…" — pill fija arriba con spinner.
          Aparece solo si el fetch >250ms (debounce en el useEffect).
          Para cache hits no se ve. */}
      {translating && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2 px-3.5 py-2 bg-white/95 backdrop-blur-md rounded-full shadow-lg ring-1 ring-black/5 text-xs font-medium text-gray-700">
            <span
              className="inline-block w-3.5 h-3.5 rounded-full border-2 border-gray-300 border-t-gray-700 animate-spin"
              aria-hidden
            />
            <span>{tt('menu.translating')}</span>
          </div>
        </div>
      )}

      {/* Hero */}
      <header className="relative">
        {/* Backdrop: heroImage o gradient brand */}
        <div
          className="absolute inset-0 -z-10"
          style={{
            background: s.heroImageUrl
              ? isCluvi
                ? `linear-gradient(180deg, rgba(0,0,0,.2) 0%, rgba(10,10,10,.85) 70%, #0a0a0a 100%), url(${s.heroImageUrl}) center/cover`
                : `linear-gradient(180deg, rgba(0,0,0,.05) 0%, rgba(255,255,255,.95) 70%, #FAFBFC 100%), url(${s.heroImageUrl}) center/cover`
              : `linear-gradient(135deg, ${primary}15, ${s.secondaryColor}15, transparent)`,
          }}
        />
        <div className="px-5 pt-10 pb-6 max-w-2xl mx-auto">
          <div className="flex flex-col items-center text-center gap-3">
            {s.logoUrl ? (
              (() => {
                const logoBg = s.logoBgColor || '#FFFFFF';
                const isTransparent = logoBg === 'transparent';
                return (
                  <div
                    className={`rounded-2xl px-5 py-4 flex items-center justify-center max-w-[300px] w-fit overflow-visible ${
                      isTransparent ? '' : 'shadow-sm ring-1 ring-black/5'
                    }`}
                    style={{ background: logoBg }}
                  >
                    <img
                      src={s.logoUrl}
                      alt={s.brandName}
                      className="max-w-[260px] w-auto h-auto max-h-[140px] object-contain block"
                    />
                  </div>
                );
              })()
            ) : (
              <div
                className="w-20 h-20 rounded-2xl flex items-center justify-center text-white font-bold text-3xl ring-4 ring-white shadow-sm"
                style={{ background: `linear-gradient(135deg, ${primary}, ${s.secondaryColor})` }}
              >
                {s.brandName[0]}
              </div>
            )}
            <div className="w-full min-w-0">
              <div
                className="font-bold text-2xl tracking-tight"
                style={s.titleColor ? { color: s.titleColor } : undefined}
              >
                {s.brandName}
              </div>
              {s.description && (
                <div
                  className={`text-sm leading-snug whitespace-pre-line mt-1 ${
                    s.descriptionColor
                      ? ''
                      : isCluvi
                      ? 'text-white/70'
                      : 'text-mute'
                  }`}
                  style={
                    s.descriptionColor ? { color: s.descriptionColor } : undefined
                  }
                >
                  {s.description}
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap justify-center mt-4">
            {showWhatsappButton && (
              <a
                href={`https://wa.me/${s.whatsappPhone!.replace(/\D/g, '')}`}
                target="_blank"
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-white text-sm font-semibold shadow-sm hover:opacity-90 transition"
                style={{ background: '#25D366' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.711.306 1.265.489 1.697.626.713.226 1.362.194 1.875.118.572-.085 1.758-.719 2.006-1.413.247-.694.247-1.289.173-1.413z"/></svg>
                WhatsApp
              </a>
            )}
            {s.instagramUrl && (
              <a
                href={s.instagramUrl}
                target="_blank"
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/90 backdrop-blur border border-line text-sm font-medium text-ink hover:bg-white transition"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
                Instagram
              </a>
            )}
            {s.mapsUrl && (
              <a
                href={s.mapsUrl}
                target="_blank"
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/90 backdrop-blur border border-line text-sm font-medium text-ink hover:bg-white transition"
              >
                <Icon name="pin" size={14} /> {tt('storefront.directions')}
              </a>
            )}
          </div>
        </div>
      </header>

      {/* Banner de promo capturado vía QR Descuento — el código se
          presenta al pagar (capture-only, no auto-apply en checkout). */}
      {capturedPromo && (
        <div className="px-5 max-w-2xl mx-auto -mt-2 mb-3 animate-in fade-in slide-in-from-top-1 duration-300">
          <div className="rounded-2xl bg-gradient-to-r from-emerald-50 to-emerald-100 border border-emerald-200 px-4 py-3 flex items-center gap-3 shadow-sm">
            <span className="text-2xl">🎁</span>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-emerald-700">
                {tt('storefront.promo_captured')}
              </div>
              <div className="font-bold text-emerald-900 text-lg tracking-wider font-mono">
                {capturedPromo}
              </div>
              <div className="text-[11px] text-emerald-800/80 leading-tight">
                {tt('storefront.promo_captured_sub')}
              </div>
            </div>
            <button
              onClick={() => {
                try {
                  localStorage.removeItem(`clubify:promo:${slug}`);
                } catch {}
                setCapturedPromo(null);
              }}
              className="text-emerald-700/60 hover:text-emerald-900 text-sm px-1"
              title={tt('storefront.promo_discard')}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="px-5 max-w-2xl mx-auto sticky top-2 z-20">
        <div className="flex gap-1 p-1 rounded-pill bg-white border border-line shadow-sm">
          {(['menu', 'promos'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex-1 py-2 rounded-pill text-sm font-medium transition"
              style={{
                background: tab === t ? primary : 'transparent',
                color: tab === t ? '#fff' : '#6B7280',
              }}
            >
              {t === 'menu'
                ? // Si el tenant configuró un label custom (o categoría no-menu),
                  // lo usamos sin pasar por i18n. Solo cuando es "Menú" default
                  // pasamos por el sistema i18n para EN/PT.
                  s.mainSectionLabel && s.mainSectionLabel !== 'Menú'
                  ? s.mainSectionLabel
                  : tt('storefront.tab_menu')
                : tt('storefront.tab_promos')}
            </button>
          ))}
        </div>
      </div>

      {/* Menú — FLIPBOOK se renderiza arriba con early return; aquí solo
          los layouts tradicionales por productos. */}
      {tab === 'menu' && (
        <div className="max-w-2xl mx-auto mt-4 px-5">
          {localizedMenu.length === 0 && (
            <div className="text-center py-16 animate-in fade-in duration-300">
              <div className="text-5xl mb-3">📋</div>
              <div className="font-semibold text-lg">
                {s.mainSectionLabel && s.mainSectionLabel !== 'Menú'
                  ? `${s.mainSectionLabel} próximamente`
                  : tt('storefront.menu_empty_title')}
              </div>
              <div className={`text-sm mt-1 max-w-xs mx-auto ${isCluvi ? 'text-white/70' : 'text-mute'}`}>
                {tt('storefront.menu_empty_sub')}
              </div>
              {showWhatsappButton && (
                <a
                  href={`https://wa.me/${s.whatsappPhone!.replace(/\D/g, '')}`}
                  target="_blank"
                  className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-pill text-white font-semibold text-sm hover:opacity-90 active:scale-95 transition"
                  style={{ background: '#25D366' }}
                >
                  {tt('storefront.menu_chat_wa')}
                </a>
              )}
            </div>
          )}
          <MenuRenderer
            layout={s.menuLayout ?? 'CLASSIC'}
            menu={localizedMenu}
            primary={primary}
            currency={s.currency}
            onPick={setOpenProduct}
            backButtonConfig={s.backButtonConfig}
            mode={mode}
          />
          {/* Popups opcionales por categoría — auto al entrar a la
              sección via IntersectionObserver, o click si el header
              renderiza CategoryPopupBadge. Único punto de montaje para
              todos los layouts (FLIPBOOK tiene su propio sistema). */}
          <CategoryPopupController categories={localizedMenu} />
          {/* Deep-linking por categoría: URL ↔ scroll bidireccional.
              No aplica a SECTIONS (tiene su propio active state que se
              sincroniza inline en LayoutSections) ni a FLIPBOOK (que
              tiene early return arriba con MenuBookViewer + sync propia). */}
          {(s.menuLayout ?? 'CLASSIC') !== 'SECTIONS' && (
            <CategoryUrlSync
              storefrontSlug={slug}
              categories={localizedMenu}
              initialSectionSlug={initialSectionSlug}
              initialSubSlug={initialSubSlug}
              mode={mode}
            />
          )}
        </div>
      )}

      {/* Promos */}
      {tab === 'promos' && (
        <div className="max-w-2xl mx-auto mt-4 px-5 pb-24 space-y-3">
          {s.promotions.length === 0 && (
            <div className="text-center py-16 animate-in fade-in duration-300">
              <div className="text-5xl mb-3">🎁</div>
              <div className="font-semibold text-lg">{tt('storefront.promos_empty_title')}</div>
              <div className={`text-sm mt-1 ${isCluvi ? 'text-white/70' : 'text-mute'}`}>
                {tt('storefront.promos_empty_sub')}
              </div>
            </div>
          )}
          {s.promotions.map((p) => {
            // Mesa = informativo: no exponer link de WhatsApp ni en promos.
            const wa =
              ordersAllowed ? s.whatsappPhone?.replace(/\D/g, '') : null;
            const orderHref = wa
              ? `https://wa.me/${wa}?text=${encodeURIComponent(
                  `Hola! Quiero ordenar esta promoción: ${p.name}`,
                )}`
              : null;
            return (
              <div
                key={p.id}
                className="rounded-card overflow-hidden bg-white border border-line shadow-sm text-ink"
              >
                {p.imageUrl && (
                  <div className="relative aspect-[16/9] bg-bg2">
                    <ProductImage
                      src={p.imageUrl}
                      alt={p.name}
                      sizes="(max-width: 640px) 100vw, 400px"
                    />
                    <span
                      className="absolute top-3 left-3 text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded text-white shadow"
                      style={{ background: primary }}
                    >
                      {tt('storefront.promo_label')}
                    </span>
                  </div>
                )}
                <div className="p-4">
                  {!p.imageUrl && (
                    <div
                      className="text-[10px] uppercase tracking-wider font-bold mb-2 inline-block px-2 py-1 rounded text-white"
                      style={{ background: primary }}
                    >
                      {tt('storefront.promo_label')}
                    </div>
                  )}
                  <div className="font-bold text-lg leading-tight">{p.name}</div>
                  {p.description && (
                    <div className="text-sm text-mute mt-1.5 leading-relaxed whitespace-pre-line">
                      {p.description}
                    </div>
                  )}
                  {(() => {
                    // value se interpreta segun admin: para DISCOUNT_AMOUNT
                    // value = precio final que paga el cliente.
                    // Para DISCOUNT_PCT value = porcentaje off.
                    // Para BUY_X_GET_Y / COMBO / FREE_ITEM no hay
                    // before/after natural, mostramos badge.
                    const orig = p.originalPrice ? Number(p.originalPrice) : null;
                    const val = p.value ? Number(p.value) : 0;
                    let finalPrice: number | null = null;
                    let badge: string | null = null;

                    if (p.type === 'DISCOUNT_AMOUNT' && val > 0) {
                      finalPrice = val;
                      if (orig && orig > val) {
                        const off = Math.round(((orig - val) / orig) * 100);
                        if (off > 0) badge = `-${off}%`;
                      }
                    } else if (p.type === 'DISCOUNT_PCT' && val > 0) {
                      badge = `-${val}%`;
                      if (orig) finalPrice = Math.round(orig * (1 - val / 100));
                    } else if (p.type === 'BUY_X_GET_Y') {
                      badge = tt('storefront.promo_buy_x_get_y');
                    } else if (p.type === 'FREE_ITEM') {
                      badge = tt('storefront.promo_free_item');
                    } else if (p.type === 'COMBO') {
                      badge = tt('storefront.promo_combo');
                    }

                    if (!orig && finalPrice === null && !badge) return null;

                    // Valor ahorrado en pesos cuando hay precios concretos
                    // (item #4 del pack: mostrar precio original, promo,
                    // valor ahorrado y % de descuento).
                    const saved =
                      orig && finalPrice !== null && orig > finalPrice
                        ? orig - finalPrice
                        : null;
                    return (
                      <>
                        <div className="mt-2.5 flex items-baseline gap-2 flex-wrap">
                          {orig && (
                            <span className="text-mute line-through text-sm shrink-0">
                              {fmt(orig, s.currency)}
                            </span>
                          )}
                          {finalPrice !== null && (
                            <span className="text-xl font-bold text-bad shrink-0">
                              {fmt(finalPrice, s.currency)}
                            </span>
                          )}
                          {badge && (
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-bad/10 text-bad shrink-0">
                              {badge}
                            </span>
                          )}
                        </div>
                        {saved !== null && (
                          <div className="text-[11px] text-bad font-semibold mt-1">
                            Ahorrás {fmt(saved, s.currency)}
                          </div>
                        )}
                      </>
                    );
                  })()}
                  {p.validUntil && (
                    <div className="text-xs text-mute mt-2 flex items-center gap-1">
                      ⏰ {tt('storefront.promo_until', { date: new Date(p.validUntil).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }) })}
                    </div>
                  )}
                  {orderHref ? (
                    <a
                      href={orderHref}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 block w-full text-center text-white font-semibold py-2.5 rounded-pill hover:opacity-90 active:scale-[0.98] transition"
                      style={{ background: '#25D366' }}
                    >
                      {tt('storefront.promo_order_wa')}
                    </a>
                  ) : (
                    <button
                      onClick={() => setTab('menu')}
                      className="mt-4 block w-full text-center text-white font-semibold py-2.5 rounded-pill hover:opacity-90 active:scale-[0.98] transition"
                      style={{ background: primary }}
                    >
                      {tt('storefront.promo_see_menu')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bottom dock con carrito (solo si pedidos están habilitados para el modo activo) */}
      {ordersAllowed && totals.count > 0 && !showCart && !showCheckout && (
        <div
          className={`fixed bottom-0 inset-x-0 px-5 pb-5 pt-3 max-w-2xl mx-auto ${
            isCluvi
              ? 'bg-gradient-to-t from-[#0a0a0a] to-transparent'
              : 'bg-gradient-to-t from-white to-white/80'
          }`}
        >
          <button
            onClick={() => setShowCart(true)}
            className="w-full rounded-pill text-white font-semibold py-3.5 flex items-center justify-between px-5 shadow-lg hover:opacity-95 active:scale-[0.98] transition animate-in slide-in-from-bottom-4 duration-200"
            style={{ background: primary }}
          >
            <span>{tt('storefront.cart_items', { count: totals.count })}</span>
            <span>{fmt(totals.subtotal, s.currency)}</span>
            <span>{tt('storefront.cart_order')}</span>
          </button>
        </div>
      )}

      {/* Modal de producto */}
      {openProduct && (
        <ProductModal
          product={openProduct}
          slug={slug}
          primary={primary}
          currency={s.currency}
          ordersEnabled={ordersAllowed}
          onClose={() => setOpenProduct(null)}
          mode={mode}
        />
      )}

      {/* Sheet de carrito */}
      {showCart && (
        <CartSheet
          items={cart}
          slug={slug}
          primary={primary}
          currency={s.currency}
          mode={mode}
          onClose={() => setShowCart(false)}
          onCheckout={() => {
            setShowCart(false);
            setShowCheckout(true);
          }}
        />
      )}

      {/* Checkout */}
      {showCheckout && (
        <CheckoutSheet
          items={cart}
          slug={slug}
          primary={primary}
          currency={s.currency}
          country={s.country ?? 'CO'}
          planName={s.planName ?? null}
          mode={mode}
          onClose={() => setShowCheckout(false)}
        />
      )}

      {/* Popup de inscripción a tarjeta (10s después de cargar) */}
      {s.popup && <StorefrontPopup popup={s.popup} slug={slug} />}

      {/* Marca Clubify — siempre visible, no removible. Auto-adapta light/
          dark según el brillo del fondo configurado por el dueño. */}
      <ClubifyBadge variant="auto" dark={pageIsDark} />
      <LanguageSwitcher />
    </div>
  );
}

// =====================================================
// Product modal
// =====================================================
function ProductModal({
  product,
  slug,
  primary,
  currency,
  ordersEnabled,
  onClose,
  mode,
}: {
  product: Product;
  slug: string;
  primary: string;
  currency: string;
  ordersEnabled: boolean;
  onClose: () => void;
  mode: StorefrontMode;
}) {
  const tt = useT();
  const defaultVar = product.variants.find((v) => v.isDefault) ?? product.variants[0];
  const [variantId, setVariantId] = useState<string | undefined>(defaultVar?.id);
  const [extras, setExtras] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');

  const variant = product.variants.find((v) => v.id === variantId);
  const extrasObj = product.extras.filter((e) => extras.includes(e.id));
  const unit =
    Number(product.basePrice) +
    (variant ? Number(variant.priceDelta) : 0) +
    extrasObj.reduce((s, e) => s + Number(e.price), 0);
  const total = unit * qty;

  function add() {
    addToCart(
      slug,
      {
        productId: product.id,
        variantId,
        variantName: variant?.name,
        extraIds: extras,
        extras: extrasObj,
        qty,
        name: product.name + (variant ? ` (${variant.name})` : ''),
        unitPrice: unit,
        note: note || undefined,
      },
      mode,
    );
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-in fade-in duration-150">
      <div className="absolute inset-0 bg-ink/60" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-white sm:rounded-card rounded-t-3xl max-h-[90vh] overflow-auto text-ink animate-in slide-in-from-bottom-6 sm:slide-in-from-bottom-2 duration-200">
        {product.imageUrl && (
          // Contenedor cuadrado adaptable: la imagen se muestra completa
          // (object-contain) sin recorte ni zoom forzado. El fondo gris
          // suave llena los bordes cuando la foto NO es cuadrada (paisaje
          // o retrato). Reemplaza el h-48 + object-cover anterior que
          // recortaba detalles importantes de la foto.
          <div className="relative w-full aspect-square bg-bg2 flex items-center justify-center">
            <ProductImage
              src={product.imageUrl}
              alt={product.name}
              sizes="(max-width: 640px) 100vw, 400px"
              fit="contain"
              priority
            />
          </div>
        )}
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold">{product.name}</h2>
              {/* Etiquetas (Nuevo, Recomendado, Más vendido, Promoción,
                  Oferta especial, Limitado, etc.). Hasta el item #7 del
                  pack solo aparecían en algunos layouts del grid y nunca
                  en el detalle. Aquí las mostramos como badges visibles
                  al cliente. */}
              {Array.isArray(product.tags) && product.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {product.tags.map((t) => (
                    <span
                      key={t}
                      className="text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-full"
                      style={{ background: `${primary}1A`, color: primary }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <p className="text-sm text-mute mt-2">{product.description}</p>
            </div>
            <button onClick={onClose} aria-label={tt('common.close')} className="text-mute text-2xl hover:text-ink active:scale-90 transition flex-shrink-0">
              ✕
            </button>
          </div>

          {product.variants.length > 0 && (
            <div className="mt-5">
              <div className="text-xs uppercase tracking-wider text-mute font-semibold">
                {product.variants[0].groupName}
              </div>
              <div className="space-y-1.5 mt-2">
                {product.variants.map((v) => (
                  <label
                    key={v.id}
                    className="flex items-center justify-between p-3 border border-line rounded-lg cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="variant"
                        checked={variantId === v.id}
                        onChange={() => setVariantId(v.id)}
                      />
                      <span className="text-sm">{v.name}</span>
                    </div>
                    <span className="text-sm text-mute">
                      {Number(v.priceDelta) > 0
                        ? `+${fmt(Number(v.priceDelta), currency)}`
                        : Number(v.priceDelta) < 0
                        ? fmt(Number(v.priceDelta), currency)
                        : ''}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {product.extras.length > 0 && (
            <div className="mt-5">
              <div className="text-xs uppercase tracking-wider text-mute font-semibold">
                {tt('product.extras')}
              </div>
              <div className="space-y-1.5 mt-2">
                {product.extras.map((e) => (
                  <label
                    key={e.id}
                    className="flex items-center justify-between p-3 border border-line rounded-lg cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={extras.includes(e.id)}
                        onChange={(ev) =>
                          setExtras(
                            ev.target.checked
                              ? [...extras, e.id]
                              : extras.filter((x) => x !== e.id),
                          )
                        }
                      />
                      <span className="text-sm">{e.name}</span>
                    </div>
                    <span className="text-sm text-mute">
                      +{fmt(Number(e.price), currency)}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {ordersEnabled && (
            <div className="mt-5">
              <label className="text-xs uppercase tracking-wider text-mute font-semibold">
                {tt('product.notes')}
              </label>
              <input
                className="input mt-2"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          )}

          {ordersEnabled ? (
            <div className="flex items-center justify-between mt-5">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setQty(Math.max(1, qty - 1))}
                  className="w-9 h-9 rounded-full border border-line flex items-center justify-center"
                >
                  −
                </button>
                <span className="text-lg font-semibold">{qty}</span>
                <button
                  onClick={() => setQty(qty + 1)}
                  className="w-9 h-9 rounded-full border border-line flex items-center justify-center"
                >
                  +
                </button>
              </div>
              <button
                onClick={add}
                className="rounded-pill text-white font-semibold py-3 px-6 hover:opacity-95 active:scale-[0.97] transition shadow-md"
                style={{ background: primary }}
              >
                {tt('product.add_to_cart', { total: fmt(total, currency) })}
              </button>
            </div>
          ) : (
            <div className="mt-5 text-center text-2xl font-bold" style={{ color: primary }}>
              {fmt(unit, currency)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =====================================================
// Cart sheet
// =====================================================
function CartSheet({
  items,
  slug,
  primary,
  currency,
  onClose,
  onCheckout,
  mode,
}: {
  items: CartItem[];
  slug: string;
  primary: string;
  currency: string;
  onClose: () => void;
  onCheckout: () => void;
  mode: StorefrontMode;
}) {
  const tt = useT();
  const totals = cartTotals(items);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center animate-in fade-in duration-150">
      <div className="absolute inset-0 bg-ink/60" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-white rounded-t-3xl max-h-[80vh] overflow-auto text-ink animate-in slide-in-from-bottom-6 duration-200">
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">{tt('cart.title')}</h2>
            <button onClick={onClose} aria-label={tt('common.close')} className="text-mute text-2xl hover:text-ink active:scale-90 transition">
              ✕
            </button>
          </div>

          {items.length === 0 && (
            <div className="text-center text-mute py-12">{tt('cart.empty')}</div>
          )}

          <div className="space-y-3">
            {items.map((it, i) => (
              <div key={i} className="flex items-center gap-3 border-b border-line2 pb-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{it.name}</div>
                  {it.extras.length > 0 && (
                    <div className="text-xs text-mute">
                      + {it.extras.map((e) => e.name).join(', ')}
                    </div>
                  )}
                  {it.note && (
                    <div className="text-xs text-mute italic">{it.note}</div>
                  )}
                  <div className="text-sm font-semibold mt-1">
                    {fmt(it.unitPrice * it.qty, currency)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateQty(slug, i, it.qty - 1, mode)}
                    className="w-7 h-7 rounded-full border border-line flex items-center justify-center text-sm"
                  >
                    −
                  </button>
                  <span className="text-sm w-5 text-center">{it.qty}</span>
                  <button
                    onClick={() => updateQty(slug, i, it.qty + 1, mode)}
                    className="w-7 h-7 rounded-full border border-line flex items-center justify-center text-sm"
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>

          {items.length > 0 && (
            <>
              <div className="mt-4 flex items-center justify-between font-semibold">
                <span>{tt('common.total')}</span>
                <span className="text-lg">{fmt(totals.subtotal, currency)}</span>
              </div>
              <button
                onClick={onCheckout}
                className="w-full rounded-pill text-white font-semibold py-3.5 mt-5 hover:opacity-95 active:scale-[0.98] transition shadow-md"
                style={{ background: primary }}
              >
                {tt('cart.checkout_wa')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// =====================================================
// Checkout sheet
// =====================================================
function CheckoutSheet({
  items,
  slug,
  primary,
  currency,
  country,
  planName,
  mode,
  onClose,
}: {
  items: CartItem[];
  slug: string;
  primary: string;
  currency: string;
  country: string;
  planName: string | null;
  mode: StorefrontMode;
  onClose: () => void;
}) {
  const tt = useT();
  // Tras la separación 2026-06-06, el carrito solo abre en DELIVERY
  // (`ordersAllowed` corta el flujo en MESA). Igual mantenemos defaults
  // consistentes con el modo por si en el futuro habilitamos mesa con
  // carrito (autoservicio).
  // Back compat opcional: si llega `?mesa=N` en una ruta delivery legacy,
  // todavía permitimos pre-llenar el número de mesa.
  const searchParams = useSearchParams();
  const tableFromQr = mode === 'mesa' ? (searchParams.get('mesa') ?? '') : '';
  const lockedTable = mode === 'mesa' || tableFromQr.trim().length > 0;

  const defaultFulfillment: 'DINE_IN' | 'DELIVERY' =
    mode === 'mesa' ? 'DINE_IN' : 'DELIVERY';

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    fulfillment: defaultFulfillment as 'DINE_IN' | 'DELIVERY',
    tableNumber: tableFromQr,
    customerNote: '',
    // Dirección de envío (solo se completa cuando fulfillment === 'DELIVERY')
    departamento: '',
    municipio: '',
    municipioOtro: '',
    direccion: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Dataset de regiones según el país del tenant. Si el país no tiene
  // regiones curadas (cae al fallback genérico), se usa input libre.
  const regionsData = regionsForCountry(country);
  const munList =
    regionsData.regions.find((r) => r.name === form.departamento)?.cities ?? [];
  const municipioFinal =
    form.municipio === OTRO_MUNICIPIO
      ? form.municipioOtro.trim()
      : form.municipio;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    // Validación adicional para delivery: dirección obligatoria
    if (form.fulfillment === 'DELIVERY') {
      if (!form.departamento || !municipioFinal || !form.direccion.trim()) {
        setErr(tt('checkout.error_address'));
        return;
      }
    }

    setSubmitting(true);
    try {
      const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`.trim();
      const deliveryAddress =
        form.fulfillment === 'DELIVERY'
          ? {
              firstName: form.firstName.trim(),
              lastName: form.lastName.trim(),
              phone: form.phone.trim(),
              departamento: form.departamento,
              municipio: municipioFinal,
              direccion: form.direccion.trim(),
            }
          : undefined;
      const res = await fetch(`${API}/api/public/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantSlug: slug,
          customer: {
            fullName,
            phone: form.phone,
            email: form.email || undefined,
          },
          items: items.map((i) => ({
            productId: i.productId,
            variantId: i.variantId,
            extraIds: i.extraIds,
            qty: i.qty,
            note: i.note,
          })),
          fulfillment: form.fulfillment,
          tableNumber: form.tableNumber || undefined,
          deliveryAddress,
          customerNote: form.customerNote || undefined,
          mode: orderModeFor(mode),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'No se pudo enviar el pedido');
      }
      const order = await res.json();
      clearCart(slug, mode);

      if (order.whatsappLink) {
        window.location.href = order.whatsappLink;
        setTimeout(() => {
          window.location.href = `/o/${order.code}`;
        }, 800);
      } else {
        window.location.href = `/o/${order.code}`;
      }
    } catch (e: any) {
      setErr(e.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center animate-in fade-in duration-150">
      <div className="absolute inset-0 bg-ink/60" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-white rounded-t-3xl max-h-[90vh] overflow-auto text-ink animate-in slide-in-from-bottom-6 duration-200">
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">{tt('checkout.title')}</h2>
            <button onClick={onClose} aria-label={tt('common.close')} className="text-mute text-2xl hover:text-ink active:scale-90 transition">
              ✕
            </button>
          </div>

          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">{tt('checkout.first_name')}</label>
                <input
                  className="input"
                  placeholder={tt('checkout.first_name')}
                  value={form.firstName}
                  onChange={(e) =>
                    setForm({ ...form, firstName: e.target.value })
                  }
                  required
                />
              </div>
              <div>
                <label className="label">{tt('checkout.last_name')}</label>
                <input
                  className="input"
                  placeholder={tt('checkout.last_name')}
                  value={form.lastName}
                  onChange={(e) =>
                    setForm({ ...form, lastName: e.target.value })
                  }
                  required
                />
              </div>
            </div>
            <div>
              <label className="label">{tt('checkout.whatsapp')}</label>
              <input
                className="input"
                placeholder="+57 ..."
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                required
              />
            </div>
            {!lockedTable && (
              <div>
                <label className="label">{tt('checkout.fulfillment_q')}</label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      {
                        v: 'DINE_IN' as const,
                        l: tt('checkout.fulfillment_dinein'),
                        disabled: !lockedTable,
                        hint: tt('checkout.fulfillment_dinein_hint'),
                      },
                      {
                        v: 'DELIVERY' as const,
                        l: tt('checkout.fulfillment_delivery'),
                        disabled: false,
                        hint: '',
                      },
                    ]
                  ).map((o) => {
                    const active = form.fulfillment === o.v;
                    return (
                      <button
                        type="button"
                        key={o.v}
                        disabled={o.disabled}
                        onClick={() =>
                          !o.disabled && setForm({ ...form, fulfillment: o.v })
                        }
                        title={o.disabled ? o.hint : undefined}
                        className={`py-2.5 rounded-lg text-sm border relative ${
                          active && !o.disabled
                            ? 'text-white border-transparent'
                            : o.disabled
                            ? 'border-line text-mute opacity-50 cursor-not-allowed bg-bg2/40'
                            : 'border-line text-ink'
                        }`}
                        style={
                          active && !o.disabled
                            ? { background: primary }
                            : undefined
                        }
                      >
                        {o.l}
                        {o.disabled && (
                          <span className="block text-[10px] text-mute font-normal mt-0.5">
                            {o.hint}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {lockedTable && (
              <div className="rounded-lg bg-brand-soft text-brand-700 px-3 py-2.5 text-sm flex items-center gap-2">
                <span>📍</span>
                <span>
                  {tt('checkout.table_locked', { n: form.tableNumber })}
                </span>
              </div>
            )}

            {form.fulfillment === 'DELIVERY' && (
              <div className="rounded-lg border border-line bg-bg2/30 p-3 space-y-2.5 animate-in fade-in slide-in-from-top-1 duration-200">
                <div className="text-xs uppercase tracking-wider text-mute font-semibold">
                  {tt('checkout.shipping_title')}
                </div>
                {/* Aviso de "el monto del delivery se acuerda con el
                    proveedor" — el storefront público NO cobra delivery
                    fijo; el cliente y el negocio coordinan por WhatsApp
                    después de recibir el pedido. */}
                <div className="rounded-md bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-[11px] text-amber-900 leading-snug">
                  💡 El costo del domicilio se{' '}
                  <strong>acuerda con el proveedor</strong> al confirmar
                  el pedido — no se cobra aquí.
                </div>
                <div>
                  <label className="label">{regionsData.regionLabel} *</label>
                  {regionsData.regions.length > 0 ? (
                    <select
                      className="input"
                      value={form.departamento}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          departamento: e.target.value,
                          municipio: '',
                          municipioOtro: '',
                        })
                      }
                      required
                    >
                      <option value="">{regionsData.regionLabel}</option>
                      {regionsData.regions.map((r) => (
                        <option key={r.name} value={r.name}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="input"
                      value={form.departamento}
                      onChange={(e) =>
                        setForm({ ...form, departamento: e.target.value })
                      }
                      placeholder={regionsData.regionLabel}
                      required
                    />
                  )}
                </div>
                <div>
                  <label className="label">{regionsData.cityLabel} *</label>
                  {regionsData.regions.length > 0 && munList.length > 0 ? (
                    <select
                      className="input"
                      value={form.municipio}
                      onChange={(e) =>
                        setForm({ ...form, municipio: e.target.value })
                      }
                      disabled={!form.departamento}
                      required
                    >
                      <option value="">
                        {form.departamento ? regionsData.cityLabel : regionsData.regionLabel}
                      </option>
                      {munList.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                      {form.departamento && (
                        <option value={OTRO_MUNICIPIO}>Otra…</option>
                      )}
                    </select>
                  ) : (
                    <input
                      className="input"
                      value={form.municipio}
                      onChange={(e) =>
                        setForm({ ...form, municipio: e.target.value })
                      }
                      placeholder={regionsData.cityLabel}
                      required
                    />
                  )}
                </div>
                {form.municipio === OTRO_MUNICIPIO && (
                  <div>
                    <label className="label">{tt('checkout.muni_other')} *</label>
                    <input
                      className="input"
                      placeholder={tt('checkout.muni_other')}
                      value={form.municipioOtro}
                      onChange={(e) =>
                        setForm({ ...form, municipioOtro: e.target.value })
                      }
                      required
                    />
                  </div>
                )}
                <div>
                  <label className="label">{tt('checkout.address')} *</label>
                  <input
                    className="input"
                    placeholder={tt('checkout.address_ph')}
                    value={form.direccion}
                    onChange={(e) =>
                      setForm({ ...form, direccion: e.target.value })
                    }
                    required
                  />
                </div>
              </div>
            )}

            <div>
              <label className="label">{tt('checkout.notes')}</label>
              <textarea
                className="input"
                value={form.customerNote}
                onChange={(e) =>
                  setForm({ ...form, customerNote: e.target.value })
                }
              />
            </div>

            {err && (
              <div className="rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink animate-in fade-in slide-in-from-top-1 duration-200">
                {err}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-pill text-white font-semibold py-3.5 disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-95 active:scale-[0.98] transition shadow-md"
              style={{ background: primary }}
            >
              {submitting ? tt('common.sending') : tt('checkout.submit')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// =====================================================
// "Mi tarjeta" lookup
// =====================================================
type LookedUpPass = {
  id: string;
  serialNumber: string;
  stampsCount: number;
  pointsBalance: number;
  card: {
    id: string;
    name: string;
    type: 'STAMPS' | 'POINTS' | 'TIER' | 'COUPON';
    stampsRequired: number | null;
    primaryColor: string | null;
  };
  customer: { id: string; fullName: string };
};

function CardLookup({ slug, primary }: { slug: string; primary: string }) {
  const tt = useT();
  const STORAGE_KEY = `clubify:lastPhone:${slug}`;
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [passes, setPasses] = useState<LookedUpPass[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    const saved =
      typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (saved) {
      setPhone(saved);
      runLookup(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function runLookup(p: string) {
    setLoading(true);
    setErr('');
    try {
      const r = await fetch(
        `${API}/api/passes/lookup/by-phone?slug=${encodeURIComponent(slug)}&phone=${encodeURIComponent(p)}`,
      );
      if (!r.ok) throw new Error('No pudimos consultar ahora');
      const data = await r.json();
      setPasses(data.passes ?? []);
      setSearched(true);
      if ((data.passes ?? []).length > 0) {
        try {
          localStorage.setItem(STORAGE_KEY, p);
        } catch {}
      }
    } catch (e: any) {
      setErr(e.message || 'Error');
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    runLookup(phone);
  }

  function changePhone() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setPasses([]);
    setSearched(false);
    setPhone('');
  }

  return (
    <div className="max-w-md mx-auto mt-6 px-5">
      {!searched || passes.length === 0 ? (
        <form onSubmit={onSubmit} className="text-center">
          <div
            className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-3"
            style={{ background: primary + '15', color: primary }}
          >
            <Icon name="card" size={28} />
          </div>
          <h2 className="text-lg font-bold mb-1">{tt('storefront.lookup_title')}</h2>
          <p className="text-sm text-mute mb-4">
            {tt('storefront.lookup_sub')}
          </p>
          <input
            className="input mb-3 text-center"
            placeholder="+57 300 1234567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            required
          />
          <button
            type="submit"
            disabled={loading || phone.replace(/\D/g, '').length < 7}
            className="btn-primary w-full justify-center disabled:opacity-50"
            style={{ background: primary, borderColor: primary }}
          >
            <Icon name="search" />{' '}
            {loading ? tt('storefront.lookup_searching') : tt('storefront.lookup_submit')}
          </button>
          {err && (
            <div className="text-sm text-bad mt-3">{err}</div>
          )}
          {searched && passes.length === 0 && !loading && !err && (
            <div className="rounded-xl bg-bg2 mt-4 p-4 text-sm text-mute">
              {tt('storefront.lookup_empty')}
            </div>
          )}
          <p className="text-xs text-mute mt-3">
            {tt('storefront.lookup_privacy')}
          </p>
        </form>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs text-mute">
              {tt('storefront.lookup_hello')}{' '}
              <span className="font-semibold text-ink">
                {passes[0].customer.fullName}
              </span>
            </div>
            <button
              onClick={changePhone}
              className="text-xs text-brand hover:underline"
            >
              {tt('storefront.lookup_change_phone')}
            </button>
          </div>
          <div className="space-y-3">
            {passes.map((p) => (
              <PassCard key={p.id} pass={p} fallbackPrimary={primary} />
            ))}
          </div>
          <p className="text-xs text-mute mt-4 text-center">
            {tt('storefront.lookup_show_code')}
          </p>
        </div>
      )}
    </div>
  );
}

function PassCard({
  pass,
  fallbackPrimary,
}: {
  pass: LookedUpPass;
  fallbackPrimary: string;
}) {
  const tt = useT();
  const color = pass.card.primaryColor || fallbackPrimary;
  const required = pass.card.stampsRequired ?? 10;
  const dots = Array.from({ length: required });
  return (
    <div className="rounded-2xl shadow-card overflow-hidden bg-white">
      <div
        className="px-4 py-3 text-white flex items-center justify-between"
        style={{ background: color }}
      >
        <div>
          <div className="text-[11px] uppercase tracking-wider opacity-80">
            {tt('storefront.pass_card')}
          </div>
          <div className="font-semibold text-sm">{pass.card.name}</div>
        </div>
        {pass.card.type === 'STAMPS' && (
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider opacity-80">
              {tt('storefront.pass_stamps')}
            </div>
            <div className="font-bold text-lg">
              {pass.stampsCount}/{required}
            </div>
          </div>
        )}
        {pass.card.type === 'POINTS' && (
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider opacity-80">
              {tt('storefront.pass_points')}
            </div>
            <div className="font-bold text-lg">{pass.pointsBalance}</div>
          </div>
        )}
      </div>
      {pass.card.type === 'STAMPS' && (
        <div className="px-4 py-3 flex flex-wrap gap-1.5 bg-bg2">
          {dots.map((_, i) => (
            <span
              key={i}
              className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold"
              style={{
                background: i < pass.stampsCount ? color : '#fff',
                color: i < pass.stampsCount ? '#fff' : '#9CA3AF',
                border: '1.5px solid ' + (i < pass.stampsCount ? color : '#E5E7EB'),
              }}
            >
              {i + 1}
            </span>
          ))}
        </div>
      )}
      <div className="px-4 py-3 bg-white flex flex-col items-center">
        <Barcode value={pass.serialNumber} height={60} />
        <div className="text-[10px] tracking-widest text-mute mt-1">
          {pass.serialNumber}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MenuRenderer — switch entre los 5 layouts de menú
// ============================================================
type RenderProps = {
  layout: MenuLayout;
  menu: Category[];
  primary: string;
  currency: string;
  onPick: (p: Product) => void;
  /** Solo SECTIONS lo usa por ahora — estilo del botón Volver. */
  backButtonConfig?: BackButtonConfig | null;
  /** Canal activo (mesa|delivery) — solo SECTIONS lo necesita para
   *  preservar el prefijo `/delivery` en los replaceState internos. */
  mode: StorefrontMode;
};

function MenuRenderer({ layout, menu, primary, currency, onPick, backButtonConfig, mode }: RenderProps) {
  if (layout === 'GRID')
    return <LayoutGrid menu={menu} primary={primary} currency={currency} onPick={onPick} mode={mode} />;
  if (layout === 'CAROUSELS')
    return <LayoutCarousels menu={menu} primary={primary} currency={currency} onPick={onPick} mode={mode} />;
  if (layout === 'CLEAN')
    return <LayoutClean menu={menu} primary={primary} currency={currency} onPick={onPick} mode={mode} />;
  if (layout === 'COMPACT')
    return <LayoutCompact menu={menu} primary={primary} currency={currency} onPick={onPick} mode={mode} />;
  if (layout === 'CLUVI')
    return <LayoutCluvi menu={menu} primary={primary} currency={currency} onPick={onPick} mode={mode} />;
  if (layout === 'SECTIONS')
    return (
      <LayoutSections
        menu={menu}
        primary={primary}
        currency={currency}
        onPick={onPick}
        backButtonConfig={backButtonConfig}
        mode={mode}
      />
    );
  return <LayoutClassic menu={menu} primary={primary} currency={currency} onPick={onPick} mode={mode} />;
}

type LP = Omit<RenderProps, 'layout'>;

/** Sección de categoría con acordeón. Default expandida — el cliente
 *  puede colapsarla con un click en el header. State local: si el
 *  cliente recarga la página vuelve a quedar todo expandido (no se
 *  persiste). Usado en todos los layouts verticales del menú. */
function AccordionSection({
  catId,
  className = 'mb-6',
  header,
  children,
  popupTrigger,
}: {
  catId: string;
  className?: string;
  header: React.ReactNode;
  children: React.ReactNode;
  /** Si la categoría tiene popup con trigger=click, el header muestra
   *  un badge "🔔 Tocar" pulsante. CategoryPopupController captura el
   *  click globalmente vía data attribute. */
  popupTrigger?: 'auto' | 'click' | null;
}) {
  const [open, setOpen] = useState(true);

  // Si el cliente clickea un tab del LayoutCompact (anchor #cat-X) y la
  // categoría está colapsada, el browser scrollea pero ve solo el
  // header. Auto-expandimos cuando el hash matchea nuestro id.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const target = `#cat-${catId}`;
    function maybeOpen() {
      if (window.location.hash === target && !open) setOpen(true);
    }
    maybeOpen();
    window.addEventListener('hashchange', maybeOpen);
    return () => window.removeEventListener('hashchange', maybeOpen);
  }, [catId, open]);

  return (
    <section id={`cat-${catId}`} className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-left mb-3 group"
        aria-expanded={open}
      >
        <div className="flex-1 min-w-0">{header}</div>
        {popupTrigger === 'click' && (
          <CategoryPopupBadge categoryId={catId} className="shrink-0" />
        )}
        <span
          className={`text-mute text-sm shrink-0 transition-transform ${
            open ? '' : '-rotate-90'
          } group-hover:text-ink`}
          aria-hidden
        >
          ▾
        </span>
      </button>
      {/* Grid-rows 1fr/0fr es el trick standard para animar altura
       *  auto sin clamp arbitrario. Funciona en menús con cualquier
       *  cantidad de productos (antes max-h-[10000px] truncaba a 12k+px).
       *  El inner wrapper con overflow:hidden + min-h:0 es necesario
       *  para que el grid colapse correctamente. */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden min-h-0">{children}</div>
      </div>
    </section>
  );
}

// 1️⃣ CLASSIC — foto izq + info der (estilo Rappi/UberEats)
function LayoutClassic({ menu, primary, currency, onPick }: LP) {
  return (
    <>
      {menu.map((cat) => (
        <AccordionSection
          key={cat.id}
          catId={cat.id}
          popupTrigger={cat.popupConfig?.trigger ?? null}
          header={
            <h2 className="text-xs uppercase tracking-[0.18em] text-mute font-semibold">
              {cat.name}{' '}
              <span className="text-mute/70 font-normal normal-case tracking-normal">
                · {cat.products.length +
                  (cat.subsections ?? []).reduce(
                    (n, s) => n + s.products.length,
                    0,
                  )}
              </span>
            </h2>
          }
        >
          <div className="space-y-2.5">
            {getProductBlocks(cat).map((block) => (
              <Fragment key={block.id}>
                {block.title && (
                  <SubsectionHeader title={block.title} primary={primary} />
                )}
                {block.products.map((p) => (
              <button
                key={p.id}
                onClick={() => onPick(p)}
                className="w-full bg-white border border-line rounded-card overflow-hidden text-left transition hover:shadow-md2 flex"
              >
                {p.imageUrl ? (
                  <div className="relative w-24 h-24 bg-bg2 flex-none">
                    <ProductImage
                      src={p.imageUrl}
                      alt={p.name}
                      sizes="96px"
                    />
                  </div>
                ) : (
                  <div className="w-24 h-24 bg-bg2 flex-none flex items-center justify-center text-2xl text-mute">
                    🍽
                  </div>
                )}
                <div className="flex-1 p-3 min-w-0">
                  <div className="font-semibold text-sm">{p.name}</div>
                  <div className="text-xs text-mute mt-0.5 line-clamp-2">{p.description}</div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="font-bold text-sm">{fmtProductPrice(p, currency)}</div>
                    <div className="flex gap-1 flex-wrap">
                      {p.tags.map((t) => (
                        <ProductBadge key={t} tag={t} variant="inline" />
                      ))}
                    </div>
                  </div>
                </div>
                <div
                  className="w-12 flex items-center justify-center text-white text-xl flex-none"
                  style={{ background: primary }}
                >
                  +
                </div>
              </button>
                ))}
              </Fragment>
            ))}
          </div>
        </AccordionSection>
      ))}
    </>
  );
}

// 2️⃣ GRID — 2 columnas con foto cuadrada grande (Instagram)
function LayoutGrid({ menu, primary, currency, onPick }: LP) {
  return (
    <>
      {menu.map((cat) => (
        <AccordionSection
          key={cat.id}
          catId={cat.id}
          popupTrigger={cat.popupConfig?.trigger ?? null}
          header={
            <h2 className="text-xs uppercase tracking-[0.18em] text-mute font-semibold">
              {cat.name}{' '}
              <span className="text-mute/70 font-normal normal-case tracking-normal">
                · {cat.products.length +
                  (cat.subsections ?? []).reduce(
                    (n, s) => n + s.products.length,
                    0,
                  )}
              </span>
            </h2>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            {getProductBlocks(cat).map((block) => (
              <Fragment key={block.id}>
                {block.title && (
                  <div className="col-span-2">
                    <SubsectionHeader title={block.title} primary={primary} />
                  </div>
                )}
                {block.products.map((p) => (
              <button
                key={p.id}
                onClick={() => onPick(p)}
                className="text-left group"
              >
                <div className="aspect-square rounded-2xl overflow-hidden relative bg-bg2">
                  {p.imageUrl ? (
                    <ProductImage
                      src={p.imageUrl}
                      alt={p.name}
                      sizes="(max-width: 640px) 50vw, 200px"
                      hoverScale
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-4xl text-mute">
                      🍽
                    </div>
                  )}
                  <PrimaryProductBadge tags={p.tags} variant="overlay" />
                  <div
                    className="absolute bottom-2 right-2 w-9 h-9 rounded-full text-white shadow-lg text-xl flex items-center justify-center"
                    style={{ background: primary }}
                  >
                    +
                  </div>
                </div>
                <div className="mt-1.5 px-1">
                  <div className="text-sm font-semibold leading-tight line-clamp-1">{p.name}</div>
                  <div className="text-sm font-bold mt-0.5" style={{ color: primary }}>
                    {fmtProductPrice(p, currency)}
                  </div>
                </div>
              </button>
                ))}
              </Fragment>
            ))}
          </div>
        </AccordionSection>
      ))}
    </>
  );
}

// 3️⃣ CAROUSELS — scroll horizontal por categoría (Netflix)
function LayoutCarousels({ menu, primary, currency, onPick }: LP) {
  // Cada categoría se vuelve N carruseles: 1 por productos directos +
  // 1 por subsección con productos. Cada carrusel mantiene su scroll
  // independiente — más legible que mezclar todo en uno solo.
  const blocksByCat = menu.map((cat) => ({
    cat,
    blocks: getProductBlocks(cat),
  }));
  return (
    <>
      {blocksByCat.map(({ cat, blocks }) => (
        <section key={cat.id} className="mb-7">
          <div className="flex items-baseline justify-between mb-2.5 px-1">
            <h2 className="font-bold text-base">{cat.name}</h2>
            <span className="text-xs text-mute">
              {cat.products.length +
                (cat.subsections ?? []).reduce(
                  (n, s) => n + s.products.length,
                  0,
                )}{' '}
              productos
            </span>
          </div>
          {blocks.map((block) => (
            <Fragment key={block.id}>
              {block.title && (
                <div className="px-1">
                  <SubsectionHeader title={block.title} primary={primary} />
                </div>
              )}
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-5 px-5 snap-x snap-mandatory mb-3">
                {block.products.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => onPick(p)}
                    className="w-[140px] flex-none text-left snap-start"
                  >
                    <div className="aspect-square rounded-xl overflow-hidden relative bg-bg2">
                      {p.imageUrl ? (
                        <ProductImage
                          src={p.imageUrl}
                          alt={p.name}
                          sizes="140px"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-3xl text-mute">
                          🍽
                        </div>
                      )}
                      <PrimaryProductBadge tags={p.tags} variant="overlay" />
                    </div>
                    <div className="mt-1 px-0.5">
                      <div className="text-xs font-semibold leading-tight line-clamp-2 min-h-[2.4em]">
                        {p.name}
                      </div>
                      <div className="text-sm font-bold mt-0.5" style={{ color: primary }}>
                        {fmtProductPrice(p, currency)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </Fragment>
          ))}
        </section>
      ))}
    </>
  );
}

// 4️⃣ CLEAN — sin fotos, serif elegante (boutique)
function LayoutClean({ menu, primary, currency, onPick }: LP) {
  return (
    <div className="font-serif">
      {menu.map((cat) => (
        <AccordionSection
          key={cat.id}
          catId={cat.id}
          popupTrigger={cat.popupConfig?.trigger ?? null}
          className="mb-7"
          header={
            <div className="text-center">
              <div className="text-[10px] tracking-[0.3em] uppercase font-semibold text-mute mb-1.5">
                {cat.name}
              </div>
              <div className="w-12 h-px bg-ink mx-auto" />
            </div>
          }
        >
          <div className="space-y-4">
            {getProductBlocks(cat).map((block) => (
              <Fragment key={block.id}>
                {block.title && (
                  /* Sub-header serif italic centrado, consistente con la
                     vibe boutique del layout. */
                  <div className="text-center pt-2">
                    <div className="text-[11px] tracking-[0.2em] uppercase italic text-mute">
                      ~ {block.title} ~
                    </div>
                  </div>
                )}
                {block.products.map((p) => (
              <button
                key={p.id}
                onClick={() => onPick(p)}
                className="block w-full text-left px-1 hover:bg-bg2/50 rounded-md py-2 transition"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="text-[15px] font-semibold">{p.name}</div>
                  <div className="text-sm tracking-tight">
                    {fmtProductPrice(p, currency)}
                  </div>
                </div>
                {p.description && (
                  <div className="text-[12px] text-mute mt-1 italic">{p.description}</div>
                )}
                {p.tags[0] && (
                  <div className="mt-1.5">
                    <PrimaryProductBadge tags={p.tags} variant="inline" />
                  </div>
                )}
              </button>
                ))}
              </Fragment>
            ))}
          </div>
        </AccordionSection>
      ))}
    </div>
  );
}

// 5️⃣ COMPACT — lista compacta + tabs sticky por categoría (DoorDash)
function LayoutCompact({ menu, primary, currency, onPick }: LP) {
  return (
    <>
      {menu.length > 1 && (
        <div className="sticky top-0 bg-white z-10 -mx-5 px-5 py-2 border-b border-line flex gap-4 overflow-x-auto text-xs font-semibold mb-3">
          {menu.map((c, i) => (
            <a
              key={c.id}
              href={`#cat-${c.id}`}
              className={`whitespace-nowrap pb-1 ${i === 0 ? 'border-b-2 text-ink' : 'text-mute'}`}
              style={i === 0 ? { borderColor: primary } : {}}
            >
              {c.name}
            </a>
          ))}
        </div>
      )}
      {menu.map((cat) => (
        <AccordionSection
          key={cat.id}
          catId={cat.id}
          popupTrigger={cat.popupConfig?.trigger ?? null}
          className="mb-5"
          header={
            <h2 className="font-bold text-sm mt-1">
              {cat.name}{' '}
              <span className="text-mute font-normal text-xs">
                · {cat.products.length +
                  (cat.subsections ?? []).reduce(
                    (n, s) => n + s.products.length,
                    0,
                  )}
              </span>
            </h2>
          }
        >
          <div className="bg-white rounded-card border border-line overflow-hidden">
            {getProductBlocks(cat).map((block) => (
              <Fragment key={block.id}>
                {block.title && (
                  /* Sub-header del card. Sin border-b — el bg-bg2/40 lo
                     separa visualmente y evita doble línea con el border
                     del último button del block previo. */
                  <div
                    className="px-3.5 py-1.5 text-[10px] uppercase tracking-[0.16em] font-bold bg-bg2/40"
                    style={{ color: primary }}
                  >
                    {block.title}
                  </div>
                )}
                {block.products.map((p) => (
              <button
                key={p.id}
                onClick={() => onPick(p)}
                className="w-full text-left px-3.5 py-3 hover:bg-bg2/50 transition border-b border-line last:border-b-0"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="font-semibold text-sm flex items-center gap-1.5">
                    {p.name}
                    <PrimaryProductBadge tags={p.tags} variant="inline" />
                  </div>
                  <div className="font-bold text-sm whitespace-nowrap">
                    {fmtProductPrice(p, currency)}
                  </div>
                </div>
                {p.description && (
                  <div className="text-[11px] text-mute mt-0.5 line-clamp-1">{p.description}</div>
                )}
              </button>
                ))}
              </Fragment>
            ))}
          </div>
        </AccordionSection>
      ))}
    </>
  );
}

// 6️⃣ CLUVI — fondo oscuro + cards blancas + secciones título amarillo + VER pill
//      (estilo bananas-grill-bar.cluvi.co)
function LayoutCluvi({ menu, primary, currency, onPick }: LP) {
  return (
    <>
      {menu.map((cat) => (
        <AccordionSection
          key={cat.id}
          catId={cat.id}
          popupTrigger={cat.popupConfig?.trigger ?? null}
          className="mb-8"
          header={
            <h2
              className="font-bold uppercase text-lg tracking-tight"
              style={{ color: primary }}
            >
              {cat.name}
            </h2>
          }
        >
          <div className="space-y-3">
            {getProductBlocks(cat).map((block) => (
              <Fragment key={block.id}>
                {block.title && (
                  <SubsectionHeader
                    title={block.title}
                    primary={primary}
                    isCluvi
                  />
                )}
                {block.products.map((p) => (
              <button
                key={p.id}
                onClick={() => onPick(p)}
                className="w-full bg-white text-ink rounded-2xl shadow-md text-left flex items-stretch overflow-hidden"
              >
                <div className="relative w-28 h-28 sm:w-32 sm:h-32 flex-none">
                  {p.imageUrl ? (
                    <img
                      src={p.imageUrl}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-bg2 flex items-center justify-center text-3xl text-mute">
                      🍽
                    </div>
                  )}
                  <PrimaryProductBadge tags={p.tags} variant="overlay" />
                </div>
                <div className="flex-1 p-3 sm:p-4 min-w-0 flex flex-col">
                  <div className="font-bold text-base leading-tight">
                    {p.name}
                  </div>
                  {p.description && (
                    <div className="text-xs text-mute mt-1 line-clamp-2 leading-snug flex-1">
                      {p.description}
                    </div>
                  )}
                  <div className="flex items-end justify-between mt-2 gap-2">
                    <div className="font-bold text-sm">
                      {fmtProductPrice(p, currency)}
                    </div>
                    <span
                      className="px-3 py-1 rounded-full text-xs font-semibold text-ink shrink-0"
                      style={{ background: primary }}
                    >
                      VER
                    </span>
                  </div>
                </div>
              </button>
                ))}
              </Fragment>
            ))}
          </div>
        </AccordionSection>
      ))}
    </>
  );
}

// =====================================================
// SECTIONS — banners grandes por sección con portada editable
// =====================================================
//
// Mobile-first. Cada sección renderea su portada (coverConfig) en
// hero. Si tiene subsecciones, se muestran como chips horizontales
// scrolleables que filtran los productos. Los productos vienen en
// grid 2 columnas con foto + precio + tap para abrir bottom sheet.
//
// El coverConfig viene del backend (Fase 1). Si está null, fallback
// = imagen + nombre. Para no inflar el JS, importamos el preview
// dinámicamente — solo se baja cuando el layout SECTIONS está activo.

function LayoutSections({
  menu,
  primary,
  currency,
  onPick,
  backButtonConfig,
  mode,
}: LP & { backButtonConfig?: BackButtonConfig | null; mode: StorefrontMode }) {
  const tt = useT();
  const params = useParams<{
    slug: string;
    sectionSlug?: string;
    subSlug?: string;
  }>();
  const storefrontSlug = params.slug;
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [activeSub, setActiveSub] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  // ── Deep-link: al cargar, resolver IDs desde slugs de la URL.
  useEffect(() => {
    if (menu.length === 0) return;
    if (!params.sectionSlug) return;
    const cat = menu.find((c) => c.slug === params.sectionSlug);
    if (!cat) return;
    setActiveSection(cat.id);
    if (params.subSlug) {
      const sub = (cat.subsections ?? []).find(
        (s) => s.slug === params.subSlug,
      );
      if (sub) setActiveSub(sub.id);
    }
  }, [menu, params.sectionSlug, params.subSlug]);

  // ── Sync URL ← state. Cuando el usuario entra/sale de una sección
  // o sub, actualizamos el path sin inflar el back-button (replaceState).
  // Preserva el prefijo `/delivery` cuando el canal activo es delivery.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!storefrontSlug) return;
    let sectionSlug: string | null = null;
    let subSlug: string | null = null;
    if (activeSection) {
      const cat = menu.find((c) => c.id === activeSection);
      if (cat?.slug) {
        sectionSlug = cat.slug;
        if (activeSub) {
          const sub = (cat.subsections ?? []).find((s) => s.id === activeSub);
          if (sub?.slug) subSlug = sub.slug;
        }
      }
    }
    const target = buildStorefrontPath(storefrontSlug, mode, sectionSlug, subSlug);
    if (window.location.pathname === target) return;
    window.history.replaceState({}, '', target);
  }, [activeSection, activeSub, menu, storefrontSlug, mode]);

  // Estilo aplicado al botón "Volver". Defaults reproducen el estilo
  // histórico (negro a 40% + flecha blanca + sombra md + 40px) si el
  // tenant no configuró nada.
  const backStyle = (() => {
    const c = backButtonConfig ?? {};
    const size = c.size ?? 40;
    const shadowMap: Record<string, string> = {
      none: 'none',
      sm: '0 1px 2px rgba(0,0,0,0.1)',
      md: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)',
      lg: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)',
    };
    const shadow = shadowMap[c.shadow ?? 'md'] ?? shadowMap.md;
    return {
      width: size,
      height: size,
      background: c.bgColor ?? 'rgba(0,0,0,0.4)',
      color: c.iconColor ?? '#fff',
      opacity: c.opacity ?? 1,
      border: c.borderWidth
        ? `${c.borderWidth}px solid ${c.borderColor ?? 'transparent'}`
        : undefined,
      boxShadow: shadow,
      // backdrop-blur queda como tailwind class — se aplica siempre
      // porque ayuda a la legibilidad sobre fotos. El tenant que quiera
      // sin blur usa bg sólido.
      fontSize: Math.round(size * 0.5),
    };
  })();

  // Si el cliente eligió una sección, mostramos detalle. Sino, grilla.
  const section = activeSection
    ? menu.find((m) => m.id === activeSection)
    : null;

  // Skeleton state — mientras carga el menú o no hay secciones aún.
  if (menu.length === 0) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-44 rounded-2xl bg-bg2 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (!section) {
    // Vista 1: lista de banners de secciones (con stagger entrance)
    return (
      <div className="space-y-3 animate-in fade-in duration-300">
        {menu.map((m, idx) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              setTransitioning(true);
              setActiveSection(m.id);
              setActiveSub(null);
              window.scrollTo({ top: 0, behavior: 'smooth' });
              window.setTimeout(() => setTransitioning(false), 50);
            }}
            className="block w-full text-left active:scale-[0.98] hover:scale-[1.005] transition-transform duration-150"
            style={{
              animation: `slideUp 0.35s ease-out ${idx * 60}ms both`,
            }}
          >
            <SectionBanner cat={m} primary={primary} />
          </button>
        ))}
        <style jsx>{`
          @keyframes slideUp {
            from {
              opacity: 0;
              transform: translateY(12px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}</style>
      </div>
    );
  }

  // Vista 2: detalle de sección. Subsecciones como chips si hay.
  const subs = section.subsections ?? [];
  const hasSubs = subs.length > 0;

  // Productos visibles: si hay subsection activa, los de esa sub.
  // Sino ("Todo" pill activo), agregamos productos de la sección padre
  // + todas las subsecciones. Antes solo mostrábamos section.products
  // directos, lo que dejaba "Todo" vacío en negocios donde TODOS los
  // productos viven en subsecciones (caso Motilart: WOMEN → Cortes/
  // Peinados/Maquillaje, sin productos directos en WOMEN).
  const visibleProducts = activeSub
    ? subs.find((s) => s.id === activeSub)?.products ?? []
    : [...section.products, ...subs.flatMap((s) => s.products)];

  return (
    <div
      key={section.id}
      className="space-y-4"
      style={{ animation: 'slideInRight 0.3s ease-out' }}
    >
      {/* Header con back + banner reducido */}
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setActiveSection(null);
            setActiveSub(null);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          // Class fija: posición + backdrop-blur (mejora legibilidad
          // sobre cualquier portada) + interacciones. Tamaño/colores/
          // sombra/opacidad/borde se aplican vía style según
          // backButtonConfig.
          className="absolute top-3 left-3 z-10 rounded-full backdrop-blur-md flex items-center justify-center active:scale-95 hover:opacity-90 transition-all"
          style={backStyle}
          aria-label="Volver"
        >
          ←
        </button>
        <SectionBanner cat={section} primary={primary} />
      </div>

      {/* Subsection chips */}
      {hasSubs && (
        <div className="flex items-center gap-2 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-none sticky top-0 z-20 bg-bg/95 backdrop-blur-md py-2 -mt-2">
          <SubChip
            label="Todo"
            count={section.products.length + subs.reduce((n, s) => n + s.products.length, 0)}
            active={!activeSub}
            onClick={() => setActiveSub(null)}
            primary={primary}
          />
          {subs.map((s) => (
            <SubChip
              key={s.id}
              label={s.name}
              count={s.products.length}
              active={activeSub === s.id}
              onClick={() => setActiveSub(s.id)}
              primary={primary}
            />
          ))}
        </div>
      )}

      {/* Productos */}
      {visibleProducts.length === 0 ? (
        <div className="text-center text-mute py-12 text-sm animate-in fade-in">
          <div className="text-4xl mb-2 opacity-50">🍽</div>
          {activeSub
            ? tt('storefront.sections_empty_sub')
            : tt('storefront.sections_empty_main')}
        </div>
      ) : (
        <div
          key={activeSub ?? 'all'}
          className="grid grid-cols-2 gap-3 animate-in fade-in duration-200"
        >
          {visibleProducts.map((p, idx) => (
            <div
              key={p.id}
              style={{
                animation: `cardIn 0.3s ease-out ${idx * 30}ms both`,
              }}
            >
              <SectionProductCard
                product={p}
                currency={currency}
                onPick={() => onPick(p)}
                priority={idx < 4}
              />
            </div>
          ))}
        </div>
      )}

      <style jsx>{`
        @keyframes slideInRight {
          from {
            opacity: 0;
            transform: translateX(20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        @keyframes cardIn {
          from {
            opacity: 0;
            transform: translateY(8px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
}

function SectionBanner({
  cat,
  primary,
}: {
  cat: Category;
  primary: string;
}) {
  // Si tiene coverConfig, usamos el preview. Sino fallback simple:
  // imageUrl como bg + nombre centrado.
  if (cat.coverConfig) {
    return (
      <SectionCoverPreview
        config={cat.coverConfig}
        title={cat.name}
        tagline={cat.tagline}
      />
    );
  }
  // Fallback legacy
  return (
    <div
      className="relative h-44 rounded-2xl overflow-hidden flex items-end p-5"
      style={{
        backgroundImage: cat.imageUrl
          ? `linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.7) 100%), url(${cat.imageUrl})`
          : `linear-gradient(135deg, ${primary}, ${primary}aa)`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <div className="text-white">
        <h2 className="text-2xl font-bold leading-tight m-0">{cat.name}</h2>
        {cat.tagline && (
          <p className="text-sm opacity-90 mt-1 m-0">{cat.tagline}</p>
        )}
      </div>
    </div>
  );
}

function SubChip({
  label,
  count,
  active,
  onClick,
  primary,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  primary: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`whitespace-nowrap text-sm font-semibold px-4 py-2 rounded-full border transition active:scale-95 ${
        active ? 'text-white border-transparent' : 'text-ink border-line bg-bg'
      }`}
      style={
        active
          ? { backgroundColor: primary, boxShadow: `0 4px 12px ${primary}40` }
          : undefined
      }
    >
      {label}
      {count !== undefined && (
        <span className={`ml-1.5 text-[11px] opacity-70`}>· {count}</span>
      )}
    </button>
  );
}

function SectionProductCard({
  product,
  currency,
  onPick,
  priority = false,
}: {
  product: Product;
  currency: string;
  onPick: () => void;
  /** Marcar las primeras 2-3 imágenes visibles como priority — Next.js
   *  inyecta <link rel="preload"> para que carguen ASAP, no esperando
   *  al IntersectionObserver del lazy load. */
  priority?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="block text-left rounded-xl overflow-hidden bg-white shadow-sm hover:shadow-md border border-line2 active:scale-[0.97] transition-all duration-200 w-full"
    >
      <div className="aspect-square bg-gradient-to-br from-bg2 to-bg2/60 relative overflow-hidden">
        {product.imageUrl ? (
          <ProductImage
            src={product.imageUrl}
            alt={product.name}
            sizes="(max-width: 640px) 50vw, 200px"
            priority={priority}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl opacity-40">
            🍽
          </div>
        )}
      </div>
      <div className="p-2.5">
        <div className="font-semibold text-sm leading-tight line-clamp-2 min-h-[2.5rem]">
          {product.name}
        </div>
        <div className="font-bold text-sm mt-1.5 text-ink">
          {fmtProductPrice(product, currency)}
        </div>
      </div>
    </button>
  );
}

// =====================================================
// Popup de inscripción a tarjeta de fidelización
// =====================================================
//
// Aparece a los 10s de cargar el menú. Se muestra una sola vez por
// sesión (localStorage por slug) — no molesta al cliente que lo cierra.
// Click en la imagen → /c/{cardId} (página de inscripción).
// X para cerrar y seguir viendo el menú.
function StorefrontPopup({
  popup,
  slug,
}: {
  popup: { imageUrl: string; cardId: string | null; delaySeconds?: number };
  slug: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = `clubify:popup-shown:${slug}`;
    if (sessionStorage.getItem(key)) return;
    // Default 10s para configs viejas o tenants que aún no tienen el
    // campo seteado. El backend ya devuelve `popup.delaySeconds` cuando
    // está disponible.
    const delayMs = Math.max(1, popup.delaySeconds ?? 10) * 1000;
    const t = window.setTimeout(() => {
      setOpen(true);
      sessionStorage.setItem(key, '1');
    }, delayMs);
    return () => window.clearTimeout(t);
  }, [slug, popup.delaySeconds]);

  if (!open) return null;

  const Body = popup.cardId ? 'a' : 'div';
  const props: any = popup.cardId ? { href: `/c/${popup.cardId}` } : {};

  return (
    <div
      className="fixed inset-0 z-[55] bg-ink/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={() => setOpen(false)}
    >
      <div
        className="relative max-w-sm w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => setOpen(false)}
          aria-label="Cerrar"
          className="absolute -top-3 -right-3 z-10 w-9 h-9 rounded-full bg-white text-ink flex items-center justify-center text-xl shadow-md hover:bg-bg2"
        >
          ×
        </button>
        <Body
          {...props}
          className="block rounded-2xl overflow-hidden shadow-2xl bg-white"
        >
          <img
            src={popup.imageUrl}
            alt=""
            className="w-full h-auto block"
            draggable={false}
          />
        </Body>
      </div>
    </div>
  );
}
