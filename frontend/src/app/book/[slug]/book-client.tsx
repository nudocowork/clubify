'use client';

// Ruta pública del menú libro / flipbook (F5.2). Antes vivía dentro de
// /m/[slug] cuando menuLayout=FLIPBOOK. Ahora es un modo independiente
// con su propia URL y QR, decoupleado del menú digital.
//
// Comportamiento:
//   - Fetch a /api/public/m/<slug> para obtener brandName, primary,
//     bookMenuEnabled, digitalMenuEnabled.
//   - Si bookMenuEnabled=false:
//        si digitalMenuEnabled=true → redirige a /m/<slug>
//        si ambos false           → muestra "menú no disponible"
//   - Si bookMenuEnabled=true → renderiza MenuBookViewer con urlPrefix='/book'.
//
// Para deep-links /book/[slug]/[sectionSlug] el sectionSlug se pasa al
// MenuBookViewer vía initialSectionSlug.

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { MenuBookViewer } from '@/components/menu/MenuBookViewer';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

type Storefront = {
  brandName: string;
  primaryColor: string;
  pageBackgroundColor?: string | null;
  digitalMenuEnabled?: boolean;
  bookMenuEnabled?: boolean;
  menuLayout?: string;
};

export default function BookClient() {
  const params = useParams<{ slug: string; sectionSlug?: string }>();
  const slug = params?.slug ?? '';
  const initialSectionSlug = params?.sectionSlug;

  const [s, setS] = useState<Storefront | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    fetch(`${API}/api/public/m/${slug}`)
      .then(async (r) => {
        if (!r.ok) {
          setLoadErr(`Negocio no encontrado (${r.status})`);
          return;
        }
        const d = (await r.json()) as Storefront;
        setS(d);
      })
      .catch((e) => setLoadErr(e?.message || 'Error de red'));
  }, [slug]);

  // Redirige a /m/<slug> si el dueño desactivó el libro pero tiene digital.
  // Solo lo hacemos cuando ya cargó la data — sino podría redirigir antes
  // de saber el estado real.
  useEffect(() => {
    if (!s) return;
    const bookOff = s.bookMenuEnabled === false;
    const digitalOn = s.digitalMenuEnabled !== false;
    // menuLayout=FLIPBOOK legacy → tratamos como bookOn (pre-migration).
    const legacyFlipbook = s.menuLayout === 'FLIPBOOK';
    if (bookOff && !legacyFlipbook && digitalOn) {
      if (typeof window !== 'undefined') {
        window.location.replace(`/m/${slug}${initialSectionSlug ? `/${initialSectionSlug}` : ''}`);
      }
    }
  }, [s, slug, initialSectionSlug]);

  if (loadErr) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-ink">
        <div className="max-w-md mx-auto px-5 py-12 text-center">
          <div className="text-3xl mb-2">📖</div>
          <div className="font-semibold text-lg">Menú no disponible</div>
          <div className="text-sm text-mute mt-1">{loadErr}</div>
        </div>
      </div>
    );
  }

  if (!s) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-sm text-mute">Cargando…</div>
      </div>
    );
  }

  const bookOn = s.bookMenuEnabled === true || s.menuLayout === 'FLIPBOOK';
  if (!bookOn) {
    // bookOff && !digitalOn → mostramos placeholder. (Si digital sí está,
    // el useEffect de arriba ya redirigió.)
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-ink">
        <div className="max-w-md mx-auto px-5 py-12 text-center">
          <div className="text-3xl mb-2">📖</div>
          <div className="font-semibold text-lg">Menú libro no disponible</div>
          <div className="text-sm text-mute mt-1">
            Este negocio aún no activó el modo libro.
          </div>
        </div>
      </div>
    );
  }

  const pageBg = s.pageBackgroundColor || '#FAFBFC';
  const primary = s.primaryColor || '#6366F1';

  return (
    <div className="min-h-screen relative" style={{ background: pageBg }}>
      <MenuBookViewer
        slug={slug}
        primary={primary}
        initialSectionSlug={initialSectionSlug}
        urlPrefix="/book"
      />
      <a
        href="https://soyclubify.com"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-2 right-2 z-10 text-[9px] text-mute/70 hover:text-mute font-medium tracking-tight select-none px-1.5 py-0.5 rounded bg-white/60 backdrop-blur-sm"
      >
        Clubify
      </a>
    </div>
  );
}
