'use client';
import { useEffect, useState } from 'react';
import { api, getUser } from '@/lib/api';

type Category = {
  slug: string;
  name: string;
  emoji: string;
  description: string;
};

type State = {
  step: 'welcome' | 'address' | 'category' | 'done';
  welcomeImageUrl: string | null;
  welcomeSupportPhone: string | null;
  welcomeMessage: string;
  categories: Category[];
  currentCategorySlug: string | null;
};

/**
 * Onboarding chain post-compra. Pide /onboarding/state al montar y
 * renderiza el primer paso pendiente. Al completar (o saltar) cada
 * paso, refetcha el state y avanza al siguiente.
 */
export function OnboardingFlow() {
  const [state, setState] = useState<State | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const u = getUser();
    if (!u || u.role !== 'TENANT_OWNER') return;
    api<State>('/onboarding/state')
      .then(setState)
      .catch(() => setState(null));
  }, [refreshTick]);

  const refresh = () => setRefreshTick((n) => n + 1);

  if (!state || state.step === 'done') return null;

  if (state.step === 'welcome') {
    if (!state.welcomeImageUrl) {
      // No hay imagen configurada → saltamos silenciosamente este paso
      api('/onboarding/welcome/done', { method: 'POST' }).finally(refresh);
      return null;
    }
    return (
      <WelcomeStep
        imageUrl={state.welcomeImageUrl}
        supportPhone={state.welcomeSupportPhone}
        message={state.welcomeMessage}
        onDone={refresh}
      />
    );
  }

  if (state.step === 'address') {
    return <AddressStep onDone={refresh} />;
  }

  if (state.step === 'category') {
    return (
      <CategoryStep
        categories={state.categories}
        currentSlug={state.currentCategorySlug}
        onDone={refresh}
      />
    );
  }

  return null;
}

// ═══════════════════════════════════════════════════════════
// Step 1: Welcome — agendar sesión personalizada
// ═══════════════════════════════════════════════════════════

function WelcomeStep({
  imageUrl,
  supportPhone,
  message,
  onDone,
}: {
  imageUrl: string;
  supportPhone: string | null;
  message: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function dismiss() {
    setBusy(true);
    try {
      await api('/onboarding/welcome/done', { method: 'POST' });
    } catch {}
    onDone();
  }

  function openWhatsApp() {
    if (!supportPhone) {
      dismiss();
      return;
    }
    const phone = supportPhone.replace(/[^\d]/g, '');
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    dismiss();
  }

  return (
    <Backdrop onClose={dismiss}>
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden relative">
        <button
          onClick={dismiss}
          disabled={busy}
          className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-white/90 hover:bg-white text-ink flex items-center justify-center text-xl shadow-md backdrop-blur"
        >
          ×
        </button>
        <img src={imageUrl} alt="" className="w-full h-64 object-cover" draggable={false} />
        <div className="p-6 text-center">
          <h2 className="text-2xl font-bold mb-2">🎉 ¡Bienvenido a Clubify!</h2>
          <p className="text-mute text-sm leading-relaxed">
            Agenda una sesión personalizada con nuestro equipo para que te
            ayudemos a sacar el máximo provecho de la plataforma desde el día uno.
          </p>
          <button
            onClick={openWhatsApp}
            disabled={busy || !supportPhone}
            className="mt-5 w-full rounded-pill text-white font-semibold py-3.5 px-5 flex items-center justify-center gap-2 transition disabled:opacity-50"
            style={{ background: '#25D366' }}
          >
            <WhatsAppIcon />
            Agendar por WhatsApp
          </button>
          <button onClick={dismiss} className="mt-3 text-xs text-mute hover:text-ink">
            Lo haré después
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

// ═══════════════════════════════════════════════════════════
// Step 2: Address — dirección del negocio (push wallet location)
// ═══════════════════════════════════════════════════════════

type Suggestion = {
  display_name: string;
  lat: string;
  lon: string;
  type: string;
  name?: string;
};

function AddressStep({ onDone }: { onDone: () => void }) {
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [picked, setPicked] = useState<Suggestion | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);

  // Debounced search vía Nominatim (OSM, gratis, 1 req/seg)
  useEffect(() => {
    if (query.length < 3) {
      setSuggestions([]);
      return;
    }
    const id = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6&q=${encodeURIComponent(
            query,
          )}`,
        );
        const d: Suggestion[] = await r.json();
        setSuggestions(d);
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 600);
    return () => clearTimeout(id);
  }, [query]);

  function pickSuggestion(s: Suggestion) {
    setPicked(s);
    setSuggestions([]);
    if (!name) {
      // Auto-fill nombre con la primera línea del display
      setName(s.display_name.split(',')[0].trim());
    }
  }

  async function skip() {
    setBusy(true);
    try {
      await api('/onboarding/address/skip', { method: 'POST' });
    } catch {}
    onDone();
  }

  async function save() {
    if (!picked || !name.trim()) return;
    setBusy(true);
    try {
      await api('/onboarding/address', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          address: picked.display_name,
          latitude: Number(picked.lat),
          longitude: Number(picked.lon),
        }),
      });
      onDone();
    } catch {
      setBusy(false);
    }
  }

  const lat = picked ? Number(picked.lat) : 0;
  const lng = picked ? Number(picked.lon) : 0;
  const mapSrc = picked
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.005},${lat - 0.003},${lng + 0.005},${lat + 0.003}&layer=mapnik&marker=${lat},${lng}`
    : '';

  return (
    <Backdrop onClose={skip}>
      <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden relative max-h-[92vh] flex flex-col">
        <div className="px-6 pt-6 pb-3 border-b border-line">
          <h2 className="text-lg font-bold m-0">Háblanos de tu empresa</h2>
          <p className="text-base font-semibold mt-1.5">
            Encuentra la empresa en el mapa
          </p>
          <p className="text-xs text-mute mt-1">
            Usaremos esta dirección para los push notifications de Apple Wallet
            cuando tu cliente esté cerca del negocio.
          </p>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1">
          <div className="relative">
            <input
              className="input w-full"
              placeholder="Buscar tu negocio o dirección…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (picked) setPicked(null);
              }}
              autoFocus
            />
            {searching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-mute text-xs">
                buscando…
              </div>
            )}
            {suggestions.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-line rounded-lg shadow-lg max-h-64 overflow-y-auto">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pickSuggestion(s)}
                    className="block w-full text-left px-3 py-2.5 hover:bg-bg2 border-b border-line2 last:border-0 text-sm"
                  >
                    📍 {s.display_name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {picked && (
            <div className="mt-4 space-y-3">
              <iframe
                src={mapSrc}
                title="Mapa"
                className="w-full h-48 rounded-input border border-line"
                loading="lazy"
              />
              <div>
                <label className="text-[11px] uppercase tracking-wider font-semibold text-mute mb-1 block">
                  Nombre del negocio
                </label>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="text-xs text-mute leading-relaxed">
                <span className="font-semibold text-ink">Dirección:</span>{' '}
                {picked.display_name}
              </div>
            </div>
          )}

          {!picked && query.length >= 3 && !searching && suggestions.length === 0 && (
            <div className="text-sm text-mute text-center py-6">
              No encontramos resultados. Probá con el nombre del negocio o calle.
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-line flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={skip}
            disabled={busy}
            className="text-sm text-mute underline hover:text-ink"
          >
            Saltar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!picked || !name.trim() || busy}
            className="btn-primary"
          >
            {busy ? 'Guardando…' : 'Guardar y continuar'}
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

// ═══════════════════════════════════════════════════════════
// Step 3: Category — rubro del negocio
// ═══════════════════════════════════════════════════════════

function CategoryStep({
  categories,
  currentSlug,
  onDone,
}: {
  categories: Category[];
  currentSlug: string | null;
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(currentSlug);
  const [busy, setBusy] = useState(false);

  async function skip() {
    setBusy(true);
    try {
      await api('/onboarding/category/skip', { method: 'POST' });
    } catch {}
    onDone();
  }

  async function save() {
    if (!selected) return;
    setBusy(true);
    try {
      await api('/onboarding/category', {
        method: 'POST',
        body: JSON.stringify({ slug: selected }),
      });
      onDone();
    } catch {
      setBusy(false);
    }
  }

  return (
    <Backdrop onClose={skip}>
      <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden relative max-h-[92vh] flex flex-col">
        <div className="px-6 pt-6 pb-3 border-b border-line">
          <h2 className="text-lg font-bold m-0">Háblanos de tu negocio</h2>
          <p className="text-base font-semibold mt-1.5">
            ¿Qué categoría es la mejor opción para tu empresa?
          </p>
          <p className="text-xs text-mute mt-1">
            Configuraremos el panel para que aparezcan los módulos correctos
            según tu rubro.
          </p>
        </div>

        <div className="px-4 py-3 overflow-y-auto flex-1">
          <div className="space-y-2">
            {categories.map((c) => {
              const active = selected === c.slug;
              return (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() => setSelected(c.slug)}
                  className={`w-full text-left flex items-center gap-3 px-4 py-3.5 rounded-xl border transition ${
                    active
                      ? 'bg-ink text-white border-ink shadow-md'
                      : 'bg-white text-ink border-line hover:border-ink/40'
                  }`}
                >
                  <span className="text-2xl shrink-0">{c.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{c.name}</div>
                    <div className={`text-xs leading-snug mt-0.5 ${active ? 'text-white/70' : 'text-mute'}`}>
                      {c.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-line flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={skip}
            disabled={busy}
            className="text-sm text-mute underline hover:text-ink"
          >
            Saltar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!selected || busy}
            className="btn-primary"
          >
            {busy ? 'Guardando…' : 'Listo'}
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

function Backdrop({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] bg-ink/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()} className="w-full flex justify-center">
        {children}
      </div>
    </div>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}
