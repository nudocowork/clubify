'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getImpersonationBackup, getUser } from '@/lib/api';

/**
 * /sales-wall — pantalla de ventas para la TV y para los equipos.
 *
 * La ven el SUPER_ADMIN (con montos, meta y servicios) y marketing y los
 * afiliados (solo ventas, ranking y celebraciones; el servidor les quita los
 * montos). Javier, 2026-10-26. El candado de verdad está en el servidor;
 * esto solo evita pintar una pantalla que respondería 403.
 */
const PERMITIDOS = new Set([
  'SUPER_ADMIN',
  'MARKETING',
  'AFFILIATE_INFLUENCER',
  'AFFILIATE_AMBASSADOR',
  'AFFILIATE_VENDOR',
  'AFFILIATE_SOCIO',
]);

export default function SalesWallLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const u = getUser();
    if (!u) {
      router.replace(`/login?next=${encodeURIComponent('/sales-wall')}`);
      return;
    }
    if (!PERMITIDOS.has(u.role)) {
      router.replace('/app');
      return;
    }
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
