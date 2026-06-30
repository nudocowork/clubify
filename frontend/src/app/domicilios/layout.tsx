'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, clearSession, getUser } from '@/lib/api';

type Ctx = {
  id: string;
  name: string;
  logoUrl: string | null;
  city: string | null;
  whatsapp: string | null;
  isActive: boolean;
};

export default function DeliveryPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [ctx, setCtx] = useState<Ctx | null>(null);

  useEffect(() => {
    const u = getUser();
    if (!u || u.role !== 'DELIVERY_COMPANY') {
      router.replace('/login');
      return;
    }
    setUser(u);
    api<Ctx>('/delivery-portal/me')
      .then(setCtx)
      .catch(() => null);
  }, [router]);

  if (!user) return null;

  return (
    <div style={{ minHeight: '100vh', background: '#f4f5f7', fontFamily: '"Figtree", system-ui, sans-serif' }}>
      <header
        className="flex items-center justify-between px-5 py-3 sticky top-0 z-20"
        style={{ background: '#0ea5e9', color: 'white', boxShadow: '0 2px 8px rgba(0,0,0,.12)' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-9 h-9 rounded-[10px] flex items-center justify-center text-lg overflow-hidden shrink-0"
            style={{ background: 'rgba(255,255,255,.2)' }}
          >
            {ctx?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ctx.logoUrl} alt={ctx.name} className="w-full h-full object-contain" />
            ) : (
              '🛵'
            )}
          </div>
          <div className="min-w-0">
            <div className="font-extrabold text-[15px] leading-tight truncate">
              {ctx?.name ?? 'Domicilios'}
            </div>
            <div className="text-[11px] opacity-80 leading-snug">
              Portal de domicilios{ctx?.city ? ` · ${ctx.city}` : ''}
            </div>
          </div>
        </div>
        <button
          onClick={() => {
            clearSession();
            router.replace('/login');
          }}
          className="text-[13px] font-semibold rounded-[9px] px-3 py-1.5"
          style={{ background: 'rgba(255,255,255,.18)' }}
        >
          Salir
        </button>
      </header>
      <main style={{ maxWidth: 760, margin: '0 auto', padding: '18px 14px 60px' }}>
        {children}
      </main>
    </div>
  );
}
