'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/Logo';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

export type AuthBrand = {
  slug: string;
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string | null;
} | null;

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
  const [brand, setBrand] = useState<AuthBrand>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const host = (window.location.host || '').toLowerCase().split(':')[0];
    if (!host || isClubifyHost(host)) {
      setBrand(null);
      setLoading(false);
      return;
    }
    if (memCache.has(host)) {
      setBrand(memCache.get(host) ?? null);
      setLoading(false);
      return;
    }
    const sk = `clubify.authbrand.${host}`;
    try {
      const raw = sessionStorage.getItem(sk);
      if (raw != null) {
        const v = JSON.parse(raw) as AuthBrand;
        memCache.set(host, v);
        setBrand(v);
        setLoading(false);
        return;
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
                primaryColor: v.primaryColor || '#16a34a',
                secondaryColor: v.secondaryColor ?? null,
              }
            : null;
        memCache.set(host, b);
        try {
          sessionStorage.setItem(sk, JSON.stringify(b));
        } catch {
          /* ignore */
        }
        setBrand(b);
      })
      .catch(() => {
        if (!cancelled) setBrand(null);
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
        style={{ height: size, width: 'auto', objectFit: 'contain' }}
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
  const c = brand.primaryColor || '#16a34a';
  const css = `
.brand-auth .text-brand,.brand-auth [class*="text-brand"]{color:${c}!important}
.brand-auth [class*="bg-brand"]:not([class*="bg-brand-soft"]){background-color:${c}!important}
.brand-auth [class*="bg-brand-soft"]{background-color:${c}1f!important}
.brand-auth [class*="border-brand"]{border-color:${c}!important}
.brand-auth .text-ok,.brand-auth [class*="text-ok"]{color:${c}!important}
.brand-auth .hover\\:bg-brand-700:hover,.brand-auth .hover\\:border-brand-700:hover{background-color:${c}!important;border-color:${c}!important}
`;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
