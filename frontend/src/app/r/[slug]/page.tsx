'use client';
import { Suspense, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { PhoneInput } from '@/components/PhoneInput';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useT } from '@/lib/i18n';
import { safeBrandColor } from '@/lib/contrast';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

type Tenant = {
  id: string;
  slug: string;
  brandName: string;
  /** Marca blanca del negocio, resuelta en el backend desde su whiteLabelId. */
  brand?: {
    name: string;
    websiteUrl?: string | null;
    primaryColor?: string | null;
    attribution?: { poweredBy?: string; madeWith?: string } | null;
  } | null;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  whatsappPhone: string | null;
  googleReviewUrl: string | null;
  // M7.3: threshold efectivo (sobreescrito por target si vino ?target=).
  threshold?: number;
  // M7.3: info del target multi-sede activo (si vino).
  target?: {
    id: string;
    name: string;
    locationName: string | null;
  } | null;
  whatsappFeedbackEnabled?: boolean;
  whatsappFeedbackNumber?: string | null;
  whatsappFeedbackMessage?: string | null;
};

type ReviewLocation = {
  id: string;
  name: string;
  address: string | null;
  googleReviewUrl: string;
  threshold: number;
};

type Step = 'rate' | 'feedback' | 'thanks' | 'pick-location';

export default function ReviewPage() {
  return (
    <Suspense fallback={<div className="p-8 text-mute">Cargando…</div>}>
      <ReviewPageInner />
    </Suspense>
  );
}

function ReviewPageInner() {
  const tt = useT();
  const { slug } = useParams<{ slug: string }>();
  const search = useSearchParams();
  // M7.3: si vino ?target=<id>, usamos ese target para resolver
  // googleReviewUrl + threshold + asociar el feedback.
  const targetId = search.get('target') || null;
  const [t, setT] = useState<Tenant | null>(null);
  const [locations, setLocations] = useState<ReviewLocation[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('rate');
  const [rating, setRating] = useState<number>(0);
  const [hover, setHover] = useState<number>(0);
  const [comment, setComment] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [networkError, setNetworkError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    // Timeout 10s — sin esto, en conexión mala el usuario ve "Cargando…"
    // perpetuo y cree que la página está rota / no puede escribir.
    const timeoutId = setTimeout(() => ctrl.abort(), 10_000);
    setNetworkError(false);
    setErr(null);
    const targetQs = targetId
      ? `?target=${encodeURIComponent(targetId)}`
      : '';
    // Multi-sede: si vino ?target= ya hay sede explícita en la URL — no
    // pedimos la lista de sedes (no hay selector intermedio en ese flujo).
    // Si NO vino target, pedimos en paralelo tenant + sedes para resolver
    // 0 sedes (legacy) / 1 (redirect directo) / 2+ (selector).
    const fetchTenant = fetch(`${API}/api/public/r/${slug}${targetQs}`, {
      signal: ctrl.signal,
      cache: 'no-store',
    }).then(async (r) => {
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.message ?? 'No disponible');
      }
      return r.json();
    });

    const fetchLocations = targetId
      ? Promise.resolve([] as ReviewLocation[])
      : fetch(`${API}/api/public/review-locations/${slug}`, {
          signal: ctrl.signal,
          cache: 'no-store',
        }).then(async (r) => {
          if (!r.ok) return [] as ReviewLocation[];
          return (await r.json()) as ReviewLocation[];
        }).catch(() => [] as ReviewLocation[]);

    Promise.all([fetchTenant, fetchLocations])
      .then(([tenant, locs]) => {
        if (cancelled) return;
        setT(tenant);
        setLocations(Array.isArray(locs) ? locs : []);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        if (e?.name === 'AbortError' || e?.message === 'Failed to fetch') {
          setNetworkError(true);
        } else {
          setErr(e.message || 'No disponible');
        }
      })
      .finally(() => {
        clearTimeout(timeoutId);
      });
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      ctrl.abort();
    };
  }, [slug, retryCount, targetId]);

  async function submitNegative() {
    if (rating === 0) return;
    // Para 1-3★: nombre + teléfono son obligatorios (regla de negocio:
    // capturar al cliente insatisfecho antes de perderlo)
    if (!name.trim() || phone.trim().length < 6) return;
    setSubmitting(true);
    await postReview(rating, false, comment, name, phone);
    setSubmitting(false);
    setStep('thanks');
  }

  async function pickRating(n: number) {
    setRating(n);
    // M7.3: usar el threshold del target si vino — sino 4 (default).
    const threshold = t?.threshold ?? 4;
    if (n >= threshold) {
      // Multi-sede (2026-06-06): si NO vino ?target= y hay 2+ sedes
      // activas, mostramos selector "¿En qué sede te atendieron?" antes
      // de redirigir. Con 1 sede, redirect directo a esa. Con 0, legacy.
      if (!targetId && locations.length >= 2) {
        setStep('pick-location');
        return;
      }
      const url =
        !targetId && locations.length === 1
          ? locations[0].googleReviewUrl
          : t?.googleReviewUrl;
      // ≥threshold★ → POST silencioso + redirect inmediato a Google.
      // Si no hay googleReviewUrl configurado, mostramos thanks.
      if (!url) {
        await postReview(n, true, '', '', '');
        setStep('thanks');
        return;
      }
      await postReview(n, true, '', '', '');
      setTimeout(() => {
        window.location.href = url;
      }, 150);
    } else {
      // <threshold★ → form obligatorio nombre + teléfono para capturar al cliente
      setStep('feedback');
    }
  }

  async function chooseLocation(loc: ReviewLocation) {
    // El cliente eligió una sede en el paso multi-sede — POST silencioso
    // marcando redirigido, después redirect al Google de la sede.
    await postReview(rating, true, '', '', '');
    setTimeout(() => {
      window.location.href = loc.googleReviewUrl;
    }, 150);
  }

  async function postReview(
    r: number,
    toGoogle: boolean,
    cmt: string,
    nm: string,
    ph: string,
  ) {
    try {
      await fetch(`${API}/api/public/r/${slug}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: r,
          comment: cmt.trim() || undefined,
          customerName: nm.trim() || undefined,
          customerPhone: ph.trim() || undefined,
          redirectedToGoogle: toGoogle,
          // M7.3: persistir target para métricas por sede.
          reviewTargetId: targetId || undefined,
        }),
      });
    } catch {
      // Best-effort. No bloqueamos UX por error de red.
    }
  }

  if (networkError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 bg-bg">
        <div className="card card-pad text-center max-w-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="text-5xl mb-3">📡</div>
          <h1 className="text-xl font-bold">Conexión lenta</h1>
          <p className="text-mute mt-2 text-sm">
            No pudimos cargar la página. Revisa tu conexión y reintenta.
          </p>
          <button
            type="button"
            className="btn-primary mt-4 w-full"
            onClick={() => setRetryCount((c) => c + 1)}
          >
            🔄 Reintentar
          </button>
        </div>
        <LanguageSwitcher />
      </div>
    );
  }
  if (err) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 bg-bg">
        <div className="text-center max-w-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="text-5xl mb-3">😔</div>
          <h1 className="text-xl font-bold">{tt('storefront.unavailable_title')}</h1>
          <p className="text-mute mt-2 text-sm">
            {err === 'Negocio no disponible'
              ? tt('storefront.unavailable_msg')
              : err}
          </p>
        </div>
        <LanguageSwitcher />
      </div>
    );
  }
  if (!t) {
    // Skeleton estructural en lugar de "Cargando…" plano.
    return (
      <div className="min-h-screen flex flex-col items-center px-6 py-8 bg-bg">
        <div className="w-full max-w-md flex flex-col items-center">
          <div className="w-20 h-20 rounded-2xl bg-bg2 animate-shimmer" />
          <div className="h-7 w-40 mt-4 bg-bg2 rounded animate-shimmer" />
          <div className="h-4 w-56 mt-3 bg-bg2 rounded animate-shimmer" />
          <div className="flex gap-2 mt-6">
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} className="w-12 h-12 bg-bg2 rounded animate-shimmer" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Color del NEGOCIO → el de su MARCA → un neutro. El respaldo era `#22C55E`,
  // que es el verde de Clubify: en la página de un negocio de Sellea eso es
  // justo lo que no debe aparecer. Y se valida, porque hubo un negocio con el
  // nombre escrito en el campo del color.
  const primary = safeBrandColor(
    t.primaryColor,
    safeBrandColor(t.brand?.primaryColor, '#334155'),
  );

  return (
    <div
      className="min-h-screen flex flex-col items-center px-6 py-8"
      style={{
        background: `linear-gradient(180deg, ${primary}10 0%, #FAFBFC 220px)`,
      }}
    >
      <article className="w-full max-w-md flex flex-col items-center text-center">
        {/* Brand header */}
        {t.logoUrl ? (
          <img
            src={t.logoUrl}
            alt={t.brandName}
            className="w-20 h-20 rounded-2xl object-cover shadow-md"
          />
        ) : (
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center text-white text-3xl font-bold shadow-md"
            style={{ background: primary }}
          >
            {t.brandName[0]}
          </div>
        )}
        <h1 className="text-2xl font-bold mt-4">{t.brandName}</h1>

        {step === 'rate' && (
          <>
            <p className="text-mute mt-2 leading-relaxed">
              {tt('review.title')}
            </p>
            <div className="flex gap-2 mt-6">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onMouseEnter={() => setHover(n)}
                  onMouseLeave={() => setHover(0)}
                  onClick={() => pickRating(n)}
                  className="text-5xl transition transform hover:scale-110 active:scale-95 focus:outline-none"
                  aria-label={`${n} estrella${n > 1 ? 's' : ''}`}
                  style={{
                    color: n <= (hover || rating) ? '#FACC15' : '#E5E7EB',
                  }}
                >
                  ★
                </button>
              ))}
            </div>
            <p className="text-xs text-mute mt-3">{tt('review.sub')}</p>
          </>
        )}

        {step === 'pick-location' && (
          <div className="w-full animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="mt-4 text-5xl text-center">📍</div>
            <h2 className="text-xl font-bold mt-3 text-center">
              ¿En qué sede te atendieron?
            </h2>
            <p className="text-mute mt-2 leading-relaxed text-sm text-center">
              Te llevamos al Google Reviews de la sede correcta para que tu
              reseña le sirva al equipo del lugar.
            </p>
            <div className="mt-5 space-y-2 text-left">
              {locations.map((loc) => (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => chooseLocation(loc)}
                  className="w-full p-4 rounded-xl border-2 border-line bg-white hover:border-brand hover:bg-brand-soft transition active:scale-[0.98] text-left"
                >
                  <div className="font-semibold text-base flex items-center gap-2">
                    🏢 {loc.name}
                  </div>
                  {loc.address && (
                    <div className="text-xs text-mute mt-1">
                      📍 {loc.address}
                    </div>
                  )}
                  <div
                    className="mt-2 text-xs font-semibold"
                    style={{ color: primary }}
                  >
                    Esa fue → Google Reviews →
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'feedback' && (
          <div className="w-full animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="mt-4 text-5xl text-center">
              {rating <= 2 ? '😔' : '🙏'}
            </div>
            <h2 className="text-xl font-bold mt-3 text-center">
              {tt('review.bad_title')}
            </h2>
            <p className="text-mute mt-2 leading-relaxed text-sm text-center">
              {tt('review.bad_sub')}
            </p>
            <div className="w-full mt-5 space-y-3 text-left">
              <div>
                <label className="label">
                  {tt('review.your_name')} <span className="text-bad">*</span>
                </label>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={tt('review.your_name')}
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="label">
                  {tt('review.your_phone')} <span className="text-bad">*</span>
                </label>
                <PhoneInput
                  value={phone}
                  onChange={setPhone}
                  placeholder={tt('review.your_phone')}
                />
              </div>
              <div>
                <label className="label">
                  {tt('review.your_message')} <span className="text-mute font-normal">({tt('common.optional')})</span>
                </label>
                <textarea
                  className="input"
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </div>
              <button
                type="button"
                disabled={
                  submitting || !name.trim() || phone.trim().length < 6
                }
                onClick={submitNegative}
                className="w-full py-3 rounded-xl text-white font-semibold text-base shadow-md disabled:opacity-50 hover:opacity-95 active:scale-[0.98] transition"
                style={{ background: primary }}
              >
                {submitting ? tt('common.sending') : tt('review.send')}
              </button>
            </div>
          </div>
        )}

        {step === 'thanks' && (
          <div className="animate-in fade-in zoom-in-95 duration-300">
            {/* Corazón con el color del NEGOCIO. Antes era el emoji 💚, verde
                fijo: en un negocio de Sellea (o de cualquier marca que no sea
                verde) chirriaba, porque el verde es el color de Clubify. Un
                emoji no se puede recolorear, así que va como SVG. */}
            <div className="mt-4 flex justify-center" aria-hidden="true">
              <svg
                width="64"
                height="64"
                viewBox="0 0 24 24"
                fill={primary}
              >
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold mt-3">{tt('review.thanks_title')}</h2>
            <p className="text-mute mt-2 leading-relaxed">
              {tt('review.thanks_sub')}
            </p>

            {/* CTA WhatsApp para feedback. Si el dueño configuró el botón
                específico (whatsappFeedbackEnabled + number), usamos ese
                con el mensaje custom. Sino, fallback al whatsappPhone
                general del negocio (legacy). Si ninguno, no aparece. */}
            {(() => {
              // El interruptor MANDA. Antes, con «WhatsApp para feedback»
              // apagado, el botón salía igual porque caía al WhatsApp general
              // del negocio: el dueño lo veía apagado en su panel y sus
              // clientes escribían a un número que él no había elegido para
              // esto. Un interruptor que no apaga nada es peor que no tenerlo.
              if (!t.whatsappFeedbackEnabled) return null;
              const num = (t.whatsappFeedbackNumber ?? '').replace(/\D/g, '');
              if (!num || num.length < 6) return null;
              const template =
                t.whatsappFeedbackMessage?.trim() ||
                `Hola ${t.brandName}, acabo de dejar una reseña y me gustaría hablar con ustedes.`;
              const rendered = template
                .replace(/\{businessName\}/g, t.brandName)
                .replace(/\{customerName\}/g, name || 'Cliente')
                .replace(/\{rating\}/g, String(rating ?? '—'));
              const href = `https://wa.me/${num}?text=${encodeURIComponent(rendered)}`;
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-6 inline-flex items-center gap-2 px-5 py-3 rounded-pill text-white text-sm font-semibold shadow-md hover:shadow-lg transition active:scale-95"
                  style={{ background: '#25D366' }}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden
                  >
                    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.711.306 1.265.489 1.697.626.713.226 1.362.194 1.875.118.572-.085 1.758-.719 2.006-1.413.247-.694.247-1.289.173-1.413z" />
                  </svg>
                  Hablar por WhatsApp
                </a>
              );
            })()}
          </div>
        )}

        {/* La marca del NEGOCIO, no la de la plataforma. Antes era un texto
            fijo «Powered by Clubify» traducido a 4 idiomas: el cliente de un
            negocio Sellea veía el nombre de Clubify en la página de reseñas de
            su restaurante. Si el backend no manda la marca, no se inventa
            ninguna — se omite el pie. */}
        {t.brand?.name && (
          <div className="mt-10 text-[11px] text-mute opacity-70">
            {t.brand.attribution?.poweredBy || `Powered by ${t.brand.name}`}
          </div>
        )}
      </article>
      <LanguageSwitcher />
    </div>
  );
}
