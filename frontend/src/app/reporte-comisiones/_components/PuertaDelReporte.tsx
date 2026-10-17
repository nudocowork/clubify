'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getImpersonationBackup, getUser } from '@/lib/api';

const AFILIADOS = new Set(['AFFILIATE_INFLUENCER', 'AFFILIATE_AMBASSADOR', 'AFFILIATE_VENDOR']);

/**
 * Quién puede ver el Reporte de comisiones, del lado del navegador:
 *  · sin sesión → /login
 *  · afiliado (influencer, embajador, vendedor) → /affiliate, donde ya ve SUS
 *    comisiones; no se duplica eso aquí
 *  · cualquier otro rol que no sea SUPER_ADMIN (MARKETING, dueños de negocio…)
 *    → /admin o /app
 *  · el admin de una marca blanca → /admin: es dinero de la plataforma
 *
 * El servidor responde 403 igual a todos ellos; esto solo evita el parpadeo.
 */
export function PuertaDelReporte({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    const u = getUser();
    if (!u) {
      router.replace('/login?next=/reporte-comisiones');
      return;
    }
    if (AFILIADOS.has(u.role)) {
      router.replace('/affiliate');
      return;
    }
    if (u.role !== 'SUPER_ADMIN') {
      router.replace(u.role === 'MARKETING' ? '/admin' : '/app');
      return;
    }
    // Dentro de otra marca (impersonación de marca blanca) no se entra.
    const slug = getImpersonationBackup()?.tenant?.slug;
    if (slug && slug !== 'clubify') {
      router.replace('/admin');
      return;
    }
    setOk(true);
  }, [router]);

  if (!ok) return null;
  return <>{children}</>;
}
