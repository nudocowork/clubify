import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import './globals.css';
import { PWARegister } from '@/components/PWARegister';
import { ToastProvider } from '@/components/Toast';
import { DynamicFavicon } from '@/components/DynamicFavicon';
import { ChunkReloadGuard } from '@/components/ChunkReloadGuard';
import { googleFontsUrl } from '@/lib/marketing/qr-poster-config';
import { AuthBrandProvider } from '@/components/AuthBrand';
import { resolveAuthBrandFromHeaders } from '@/lib/server-brand';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

type LayoutBrand = {
  name: string;
  logoUrl: string | null;
  shareImageUrl: string | null;
  hasIcon: boolean;
  primaryColor: string;
  slug: string;
  version: number;
};
// Última marca conocida (por host/slug) — regla dura: el shell (metadata, logo,
// tema, /login) de un dominio de marca blanca NUNCA cae a Clubify por un fallo
// del backend/DB. (Bug outage 2026-08-14: durante la caída, resolveBrandForHost
// devolvía null=Clubify y — con revalidate:60 — el data-cache de Next quedaba
// pegado, dejando el /login de Sellea como Clubify aun con el backend ya sano.
// Fix: cache:'no-store' (siempre fresco) + last-known-good.)
const lastKnownLayoutBrandByHost = new Map<string, LayoutBrand>();
const lastKnownLayoutBrandBySlug = new Map<string, LayoutBrand>();
const lastKnownTenantName = new Map<string, string>();

/** Resuelve la marca blanca del host (dominio propio, ej. selleala.com) para
 *  metadata dinámica. Devuelve null SOLO para Clubify/dev. */
async function resolveBrandForHost(host: string): Promise<LayoutBrand | null> {
  const h = (host || '').toLowerCase().split(':')[0];
  if (
    !h ||
    h === 'localhost' ||
    h.startsWith('127.') ||
    h.endsWith('soyclubify.com') ||
    h.endsWith('clubify.app')
  ) {
    return null;
  }
  try {
    const r = await fetch(
      `${API_URL}/api/superadmin-public/white-labels/branding-by-host?host=${encodeURIComponent(h)}`,
      { cache: 'no-store' },
    );
    // Fallo del backend: NUNCA Clubify en un host de marca → última conocida.
    if (!r.ok) return lastKnownLayoutBrandByHost.get(h) ?? null;
    const d = await r.json();
    if (!d || !d.slug || d.slug === 'clubify') return null;
    const brand: LayoutBrand = {
      name: d.name,
      logoUrl: d.logoUrl ?? null,
      // Imagen al compartir (Open Graph). Si no hay, el logo de la marca.
      shareImageUrl: d.shareImageUrl ?? null,
      // Tiene alguna imagen subida (favicon/icon/logo) → el backend puede
      // generar variantes; si no, caemos al SVG con inicial.
      hasIcon: !!(d.faviconUrl || d.iconUrl || d.logoUrl),
      primaryColor: d.primaryColor || '#111827',
      slug: d.slug,
      version: Number(d.brandingVersion) || 0,
    };
    lastKnownLayoutBrandByHost.set(h, brand);
    return brand;
  } catch {
    return lastKnownLayoutBrandByHost.get(h) ?? null;
  }
}

/** Igual que resolveBrandForHost pero por slug — para el acceso por
 *  /admin/<slug> en dominio Clubify (sin dominio propio). El middleware setea
 *  el header x-wl-slug en la request del documento. */
async function resolveBrandForSlug(slug: string): Promise<LayoutBrand | null> {
  const s = (slug || '').trim().toLowerCase();
  if (!s || s === 'clubify') return null;
  try {
    const r = await fetch(
      `${API_URL}/api/superadmin-public/white-labels/branding?slug=${encodeURIComponent(s)}`,
      { cache: 'no-store' },
    );
    if (!r.ok) return lastKnownLayoutBrandBySlug.get(s) ?? null;
    const d = await r.json();
    if (!d || !d.slug || d.slug === 'clubify') return null;
    const brand: LayoutBrand = {
      name: d.name,
      logoUrl: d.logoUrl ?? null,
      shareImageUrl: d.shareImageUrl ?? null,
      hasIcon: !!(d.faviconUrl || d.iconUrl || d.logoUrl),
      primaryColor: d.primaryColor || '#111827',
      slug: d.slug,
      version: Number(d.brandingVersion) || 0,
    };
    lastKnownLayoutBrandBySlug.set(s, brand);
    return brand;
  } catch {
    return lastKnownLayoutBrandBySlug.get(s) ?? null;
  }
}

/** URL del icono de marca generado al vuelo por el backend, con cache-bust. */
function brandIconUrl(
  slug: string,
  size: number,
  purpose: 'any' | 'apple',
  version: number | string,
): string {
  return `${API_URL}/api/superadmin-public/white-labels/icon?slug=${encodeURIComponent(slug)}&size=${size}&purpose=${purpose}&v=${version}`;
}

/** Nombre del NEGOCIO cuando el host es su dominio personalizado propio
 *  (Storefront.customDomain, ej. birrialeon.com) — NO marca blanca. Devuelve
 *  el brandName para usarlo como título de pestaña (el favicon se mantiene
 *  Clubify, según el PDF). null para Clubify/dev/hosts reservados. */
async function resolveTenantNameForHost(host: string): Promise<string | null> {
  const h = (host || '').toLowerCase().split(':')[0];
  if (
    !h ||
    h === 'localhost' ||
    h.startsWith('127.') ||
    h.endsWith('soyclubify.com') ||
    h.endsWith('clubify.app')
  ) {
    return null;
  }
  try {
    const r = await fetch(
      `${API_URL}/api/public/storefront/resolve-host?host=${encodeURIComponent(h)}`,
      { cache: 'no-store' },
    );
    if (!r.ok) return lastKnownTenantName.get(h) ?? null;
    const d = await r.json();
    const name = (d?.brandName || '').trim();
    if (name) lastKnownTenantName.set(h, name);
    return name || null;
  } catch {
    return lastKnownTenantName.get(h) ?? null;
  }
}

/** Favicon SVG (cuadrado redondeado con la inicial de la marca) cuando la marca
 *  no tiene logo subido — evita mostrar el icono verde de Clubify. */
function brandFaviconDataUri(name: string, color: string): string {
  const initial = (name.trim()[0] ?? 'S').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${color}"/><text x="32" y="45" font-size="36" font-family="Arial,Helvetica,sans-serif" font-weight="700" fill="#ffffff" text-anchor="middle">${initial}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * generateMetadata corre en el server side y revalida cada 60s. En el dominio
 * de una marca blanca (resuelto por host) devuelve title/favicon/OG de ESA
 * marca — nada de Clubify. En Clubify pulla el branding global y arma los
 * favicons locales como siempre.
 */
export async function generateMetadata(): Promise<Metadata> {
  const h = headers();
  const host = h.get('host') ?? '';
  // Marca por dominio propio (host) o, si entra por /admin/<slug> en dominio
  // Clubify, por el slug (header x-wl-slug del middleware).
  const brand =
    (await resolveBrandForHost(host)) ||
    (await resolveBrandForSlug(h.get('x-wl-slug') ?? ''));

  // Negocio con dominio propio (customDomain) que NO es marca blanca: el título
  // de pestaña muestra el nombre del negocio (favicon se mantiene Clubify, PDF).
  const bizName = brand ? null : await resolveTenantNameForHost(host);

  // ───────── Marca blanca (dominio propio o /admin/<slug>) → metadata de la marca ─────────
  if (brand) {
    // Iconos generados al vuelo por el backend desde la imagen de la marca
    // (favicon 32/48, apple-touch 180 OPACO). Si la marca no subió ninguna
    // imagen, caemos a un SVG con su inicial (nunca el icono de Clubify).
    const fav32 = brand.hasIcon
      ? brandIconUrl(brand.slug, 32, 'any', brand.version)
      : brandFaviconDataUri(brand.name, brand.primaryColor);
    const fav48 = brand.hasIcon
      ? brandIconUrl(brand.slug, 48, 'any', brand.version)
      : brandFaviconDataUri(brand.name, brand.primaryColor);
    const appleIcon = brand.hasIcon
      ? brandIconUrl(brand.slug, 180, 'apple', brand.version)
      : brandFaviconDataUri(brand.name, brand.primaryColor);
    // Imagen al compartir el enlace (WhatsApp/redes): la configurada por la
    // marca; si no, su logo. Nunca la de Clubify.
    const shareImage = brand.shareImageUrl || brand.logoUrl;
    const title = brand.name;
    const description = `${brand.name}: fideliza, vende y automatiza tu negocio en un solo lugar.`;
    return {
      metadataBase: new URL(`https://${host.split(':')[0] || 'soyclubify.com'}`),
      title: { default: title, template: `%s · ${brand.name}` },
      description,
      // El slug en la URL del manifest hace que la request (separada) del
      // browser resuelva la marca aunque no arrastre el host/header — clave
      // para /admin/<slug> en dominio Clubify (sin dominio propio). En dominio
      // propio el slug es redundante pero inofensivo (el host ya resuelve).
      manifest: `/manifest.webmanifest?slug=${encodeURIComponent(brand.slug)}`,
      applicationName: brand.name,
      appleWebApp: {
        capable: true,
        title: brand.name,
        statusBarStyle: 'black-translucent',
      },
      openGraph: {
        title,
        description,
        url: '/',
        siteName: brand.name,
        locale: 'es_LA',
        type: 'website',
        ...(shareImage
          ? { images: [{ url: shareImage, alt: brand.name }] }
          : {}),
      },
      twitter: {
        card: brand.shareImageUrl ? 'summary_large_image' : 'summary',
        title,
        description,
        ...(shareImage ? { images: [shareImage] } : {}),
      },
      robots: {
        index: true,
        follow: true,
        googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
      },
      icons: {
        icon: [
          { url: fav32, sizes: '32x32', type: 'image/png' },
          { url: fav48, sizes: '48x48', type: 'image/png' },
        ],
        shortcut: [{ url: fav48 }],
        apple: [{ url: appleIcon, sizes: '180x180', type: 'image/png' }],
      },
      other: {
        'msapplication-TileColor': brand.primaryColor,
        // Equivalente moderno de apple-mobile-web-app-capable (que Next emite
        // por appleWebApp.capable). Silencia el warning de deprecación.
        'mobile-web-app-capable': 'yes',
      },
    };
  }

  // ───────── Clubify (default) ─────────
  let faviconUrl: string | null = null;
  try {
    const r = await fetch(`${API_URL}/api/branding`, {
      next: { revalidate: 60 },
    });
    if (r.ok) {
      const data = await r.json();
      faviconUrl = data?.faviconUrl ?? null;
    }
  } catch {
    // Si el backend está offline, caemos al favicon default
  }

  // Orden importante para Google Search: SVG primero (vectorial, mejor calidad),
  // luego PNGs por tamaño ascendente, luego favicon.ico como fallback legacy.
  // Si hay un favicon custom de branding (super admin Setting) lo priorizamos.
  //
  // FAVICON_VERSION: bump cuando regeneramos los PNGs/SVG locales — Google
  // y browsers cachean favicons por semanas-meses. La query string fuerza
  // re-fetch en clientes (browsers ignoran cuando el contenido cambia, pero
  // ven URL distinta y refrescan). Para Google Search hay que pedir
  // re-indexación en Search Console; este cache-bust acelera el proceso.
  const FAVICON_VERSION = '2026-05-16';
  const v = (url: string) =>
    url.includes('?') ? `${url}&v=${FAVICON_VERSION}` : `${url}?v=${FAVICON_VERSION}`;
  // Si hay branding.faviconUrl (custom del super admin), va primero. Pero
  // SIEMPRE incluimos los locales como fallback — si la URL de R2 falla
  // (cdn caído, imagen corrupta), el browser cae al siguiente disponible
  // en lugar de quedarse sin favicon visible.
  const localIcons = [
    { url: v('/icons/icon.svg'), type: 'image/svg+xml' },
    { url: v('/favicon-16.png'), sizes: '16x16', type: 'image/png' },
    { url: v('/favicon-32.png'), sizes: '32x32', type: 'image/png' },
    { url: v('/favicon-48.png'), sizes: '48x48', type: 'image/png' },
    { url: v('/favicon-96.png'), sizes: '96x96', type: 'image/png' },
    { url: v('/icons/icon-192.png'), sizes: '192x192', type: 'image/png' },
    { url: v('/icons/icon-512.png'), sizes: '512x512', type: 'image/png' },
    { url: v('/favicon.ico'), sizes: 'any' },
  ];
  // Favicon custom de Clubify (Setting branding) → lo servimos por el GENERADOR
  // (slug=clubify, opaco) en vez de la imagen cruda: un símbolo transparente
  // (ej. la flecha verde) se ve invisible a 16/32px; el generador lo cuadra
  // sobre fondo sólido para que tenga presencia. Si no hay custom, la C verde
  // estática de siempre.
  const customFaviconV = faviconUrl
    ? faviconUrl.slice(-16).replace(/[^a-zA-Z0-9]/g, '') || '1'
    : '1';
  const clubifyGen = (size: number) =>
    brandIconUrl('clubify', size, 'apple', customFaviconV);
  const icon = faviconUrl
    ? [
        { url: clubifyGen(32), sizes: '32x32', type: 'image/png' },
        { url: clubifyGen(48), sizes: '48x48', type: 'image/png' },
        ...localIcons,
      ]
    : localIcons;

  return {
    metadataBase: new URL(
      process.env.NEXT_PUBLIC_APP_URL ?? 'https://soyclubify.com',
    ),
    title: {
      default: bizName || 'Clubify · El sistema operativo de tu negocio local',
      template: bizName ? `%s · ${bizName}` : '%s · Clubify',
    },
    description:
      'Vende por WhatsApp, fideliza con tarjetas wallet y automatiza con un solo lugar. Activa tu cuenta y empieza a vender hoy.',
    manifest: '/manifest.webmanifest',
    applicationName: bizName || 'Clubify',
    appleWebApp: {
      capable: true,
      title: bizName || 'Clubify',
      statusBarStyle: 'black-translucent',
      startupImage: ['/apple-touch-icon.png'],
    },
    openGraph: {
      title: 'Clubify · El sistema operativo de tu negocio local',
      description:
        'Vende por WhatsApp, fideliza con tarjetas wallet y automatiza. Activa tu cuenta y empieza a vender hoy.',
      url: '/',
      siteName: 'Clubify',
      locale: 'es_LA',
      type: 'website',
      images: [
        { url: v('/og-image.png'), width: 1200, height: 630, alt: 'Clubify · El sistema operativo de tu negocio local' },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Clubify · El sistema operativo de tu negocio local',
      description:
        'Vende por WhatsApp, fideliza con wallet y automatiza. Activa tu cuenta y empieza a vender hoy.',
      images: [v('/og-image.png')],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
    },
    icons: {
      icon,
      shortcut: [{ url: v('/favicon.ico') }],
      apple: [
        faviconUrl
          ? { url: clubifyGen(180), sizes: '180x180', type: 'image/png' }
          : { url: v('/apple-touch-icon.png'), sizes: '180x180', type: 'image/png' },
      ],
      other: [
        {
          rel: 'mask-icon',
          url: v('/icons/safari-pinned-tab.svg'),
          color: '#22C55E',
        },
      ],
    },
    other: {
      'msapplication-TileColor': '#22C55E',
      'msapplication-TileImage': v('/icons/icon-192.png'),
      // Equivalente moderno de apple-mobile-web-app-capable → silencia el
      // warning de deprecación. iOS sigue usando appleWebApp.capable.
      'mobile-web-app-capable': 'yes',
    },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const host = headers().get('host') ?? '';
  const brand = await resolveBrandForHost(host);
  return {
    // En el dominio de la marca, el color de la barra del navegador (mobile)
    // usa el color de la marca, no el verde Clubify.
    themeColor: brand?.primaryColor || '#22C55E',
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // i18n foundation 2026-06-12: el locale se resuelve server-side
  // (cookie NEXT_LOCALE → Accept-Language → x-vercel-ip-country → 'es').
  // Las messages se importan dinámicamente desde frontend/messages/.
  const locale = await getLocale();
  const messages = await getMessages();
  // Marca de auth resuelta en el SERVIDOR → se siembra en el árbol para que las
  // pantallas de login/registro rendericen el logo de la marca desde el primer
  // HTML (sin parpadeo de Clubify). null en Clubify/dev.
  const authBrand = await resolveAuthBrandFromHeaders();
  return (
    <html lang={locale}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* TODAS las fuentes de FONT_OPTIONS cargadas globalmente —
            disponibles en cualquier página (panel admin, billing,
            cotizaciones, editor QR, wallet pass preview). Una sola
            request al CDN de Google, browsers cachean agresivamente.
            Antes solo Inter estaba global y el resto cargaba on-demand
            cuando montaba QrPosterEditor — quedaban inutilizables en
            otras vistas. */}
        <link
          href={googleFontsUrl()}
          rel="stylesheet"
        />
      </head>
      <body>
        <ChunkReloadGuard />
        <DynamicFavicon />
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ToastProvider>
            <AuthBrandProvider initialBrand={authBrand}>
              {children}
            </AuthBrandProvider>
          </ToastProvider>
        </NextIntlClientProvider>
        <PWARegister />
      </body>
    </html>
  );
}
