'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { authBrandCss } from '@/lib/panel-brand-theme';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

export type AuthBrand = {
  slug: string;
  name: string;
  logoUrl: string | null;
  iconUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  secondaryColor: string | null;
  // Enlace de PRUEBA de la marca (página /prueba). null = la marca no ofrece
  // prueba. trialDays = días del período (default 7).
  trialCheckoutUrl?: string | null;
  trialDays?: number;
} | null;

// Marca de auth resuelta en el SERVIDOR (SSR) y sembrada por el layout raíz.
// Sembrar el valor inicial del hook elimina el PARPADEO de Clubify: el primer
// HTML ya trae el logo/color de la marca, sin esperar al fetch del cliente.
const AuthBrandContext = createContext<AuthBrand>(null);

export function AuthBrandProvider({
  initialBrand,
  children,
}: {
  initialBrand: AuthBrand;
  children: React.ReactNode;
}) {
  return (
    <AuthBrandContext.Provider value={initialBrand}>
      {children}
    </AuthBrandContext.Provider>
  );
}

// Hosts que son SIEMPRE Clubify (o desarrollo) → nunca consultamos branding de
// marca; mostramos el logo Clubify default. Cualquier otro host (dominio propio
// de una marca, ej. selleala.com / app.selleala.com) se resuelve contra el
// backend.
const CLUBIFY_HOSTS = new Set([
  'soyclubify.com',
  'www.soyclubify.com',
  'app.soyclubify.com',
  'admin.soyclubify.com',
  'clubify.app',
  'www.clubify.app',
  'app.clubify.app',
  'localhost',
  '127.0.0.1',
]);

function isClubifyHost(host: string): boolean {
  return (
    CLUBIFY_HOSTS.has(host) ||
    host.endsWith('.soyclubify.com') ||
    host.endsWith('.clubify.app')
  );
}

// Cache de módulo por host — sobrevive navegaciones cliente; sessionStorage
// cubre el refresh para evitar el flash de Clubify.
const memCache = new Map<string, AuthBrand>();

/**
 * Resuelve la marca blanca del HOST actual (login/recuperar/registro servidos
 * en el dominio de la marca heredan su logo + colores). Devuelve null para
 * Clubify / desarrollo (→ branding default).
 */
export function useAuthBrand(): { brand: AuthBrand; loading: boolean } {
  // Valor SEMBRADO por el SSR (layout raíz) → el primer render ya trae el logo
  // correcto, sin parpadeo de Clubify.
  const ssrBrand = useContext(AuthBrandContext);
  const [brand, setBrand] = useState<AuthBrand>(ssrBrand);
  const [loading, setLoading] = useState(!ssrBrand);

  useEffect(() => {
    // El SSR ya trae la marca fresca (no-store, por request) → sin refetch, sin
    // parpadeo. Solo si el SSR NO resolvió (host Clubify, o un fallo puntual del
    // server) corremos la resolución cliente de respaldo.
    if (ssrBrand) return;
    const host = (window.location.host || '').toLowerCase().split(':')[0];
    // Dominio del master admin (soyfidelity.com): las pantallas de auth deben
    // mostrar "Fidelity", no el logo de Clubify. Sin logoUrl → BrandMark pinta
    // el nombre como texto (identidad de la plataforma, no una marca blanca).
    if (host === 'soyfidelity.com' || host === 'www.soyfidelity.com') {
      setBrand({
        slug: 'fidelity',
        name: 'Fidelity',
        logoUrl: null,
        iconUrl: null,
        faviconUrl: null,
        primaryColor: '#2563EB',
        secondaryColor: null,
      });
      setLoading(false);
      return;
    }
    if (!host || isClubifyHost(host)) {
      setBrand(null);
      setLoading(false);
      return;
    }
    // Solo caché POSITIVA. Un null cacheado (ej. el backend falló durante una
    // caída) NUNCA debe fijar Clubify → se ignora y se re-consulta.
    const cachedMem = memCache.get(host);
    if (cachedMem) {
      setBrand(cachedMem);
      setLoading(false);
      return;
    }
    // Key v2: abandona las entradas viejas potencialmente ENVENENADAS con null.
    // (Bug 2026-08-14: durante el outage se cacheó null en sessionStorage y el
    // login de Sellea quedaba como Clubify aun con el backend ya recuperado.)
    const sk = `clubify.authbrand.v2.${host}`;
    try {
      const raw = sessionStorage.getItem(sk);
      if (raw) {
        const v = JSON.parse(raw) as AuthBrand;
        if (v && v.slug) {
          memCache.set(host, v);
          setBrand(v);
          setLoading(false);
          return;
        }
      }
    } catch {
      /* sessionStorage no disponible */
    }

    let cancelled = false;
    fetch(
      `${API}/api/superadmin-public/white-labels/branding-by-host?host=${encodeURIComponent(host)}`,
      { cache: 'no-store' },
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((v: any) => {
        if (cancelled) return;
        const b: AuthBrand =
          v && v.slug
            ? {
                slug: v.slug,
                name: v.name,
                logoUrl: v.logoUrl ?? null,
                iconUrl: v.iconUrl ?? null,
                faviconUrl: v.faviconUrl ?? null,
                primaryColor: v.primaryColor || '#16a34a',
                secondaryColor: v.secondaryColor ?? null,
                trialCheckoutUrl: v.trialCheckoutUrl ?? null,
                trialDays: v.trialDays ?? 7,
              }
            : null;
        // Cachear SOLO positivos — nunca null (no envenenar el caché). Si el
        // fetch falla/no hay marca, no fijamos Clubify ni cacheamos: se reintenta.
        if (b) {
          memCache.set(host, b);
          try {
            sessionStorage.setItem(sk, JSON.stringify(b));
          } catch {
            /* ignore */
          }
          setBrand(b);
        }
      })
      .catch(() => {
        /* fallo de red: no cachear, no forzar Clubify — se reintenta */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { brand, loading };
}

/** Logo de la marca (o Clubify por default). Si la marca tiene logoUrl, lo usa;
 *  si no, muestra el nombre en su color primario. */
export function BrandMark({
  brand,
  size = 32,
}: {
  brand: AuthBrand;
  size?: number;
}) {
  if (brand?.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={brand.logoUrl}
        alt={brand.name}
        style={{
          height: size,
          width: 'auto',
          maxWidth: '100%',
          objectFit: 'contain',
        }}
      />
    );
  }
  if (brand) {
    return (
      <span
        style={{
          fontWeight: 800,
          fontSize: Math.round(size * 0.72),
          color: brand.primaryColor,
          letterSpacing: '-0.02em',
        }}
      >
        {brand.name}
      </span>
    );
  }
  return <Logo size={size} />;
}

/**
 * Wrapper cliente para páginas server (ej. /signup): aplica la clase
 * `brand-auth` + inyecta el override de color cuando el host es de una marca.
 * Permite heredar branding sin convertir toda la página a cliente.
 */
export function BrandAuthShell({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { brand } = useAuthBrand();
  return (
    <div className={`${className} ${brand ? 'brand-auth' : ''}`}>
      <BrandAuthTheme brand={brand} />
      {children}
    </div>
  );
}

/** Logo de marca envuelto en un Link (header de signup, etc). */
export function BrandLogoLink({
  href = '/',
  size = 32,
  className = '',
}: {
  href?: string;
  size?: number;
  className?: string;
}) {
  const { brand } = useAuthBrand();
  return (
    <Link href={href} className={`flex items-center ${className}`}>
      <BrandMark brand={brand} size={size} />
    </Link>
  );
}

/**
 * Inyecta un override de color scoped a `.brand-auth` que voltea los tokens
 * Tailwind `brand`/`ok` (verde Clubify, fijos en el config) al color de la
 * marca. Mismo enfoque probado con `.sellea-theme` en la landing. Sin marca →
 * no inyecta nada (queda el verde default).
 */
export function BrandAuthTheme({ brand }: { brand: AuthBrand }) {
  if (!brand) return null;
  return (
    <style
      dangerouslySetInnerHTML={{ __html: authBrandCss(brand.primaryColor || '#16a34a') }}
    />
  );
}
