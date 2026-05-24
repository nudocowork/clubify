'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PhoneInput } from '@/components/PhoneInput';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useT } from '@/lib/i18n';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

type Tenant = {
  id: string;
  slug: string;
  brandName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  whatsappPhone: string | null;
  googleReviewUrl: string | null;
  whatsappFeedbackEnabled?: boolean;
  whatsappFeedbackNumber?: string | null;
  whatsappFeedbackMessage?: string | null;
};

type Step = 'rate' | 'feedback' | 'thanks';

export default function ReviewPage() {
  const tt = useT();
  const { slug } = useParams<{ slug: string }>();
  const [t, setT] = useState<Tenant | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('rate');
  const [rating, setRating] = useState<number>(0);
  const [hover, setHover] = useState<number>(0);
  const [comment, setComment] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/public/r/${slug}`)
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j?.message ?? 'No disponible');
        }
        return r.json();
      })
      .then(setT)
      .catch((e: Error) => setErr(e.message || 'No disponible'));
  }, [slug]);

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
    if (n >= 4) {
      // 4-5★ → POST silencioso + redirect inmediato a Google.
      // Si no hay googleReviewUrl configurado, mostramos thanks.
      if (!t?.googleReviewUrl) {
        await postReview(n, true, '', '', '');
        setStep('thanks');
        return;
      }
      await postReview(n, true, '', '', '');
      setTimeout(() => {
        window.location.href = t.googleReviewUrl!;
      }, 150);
    } else {
      // 1-3★ → form obligatorio nombre + teléfono para capturar al cliente
      setStep('feedback');
    }
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
        }),
      });
    } catch {
      // Best-effort. No bloqueamos UX por error de red.
    }
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
  if (!t) return <div className="p-8 text-mute text-center animate-pulse">{tt('common.loading')}</div>;

  const primary = t.primaryColor || '#22C55E';

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
            <div className="mt-4 text-6xl">💚</div>
            <h2 className="text-xl font-bold mt-3">{tt('review.thanks_title')}</h2>
            <p className="text-mute mt-2 leading-relaxed">
              {tt('review.thanks_sub')}
            </p>

            {/* CTA WhatsApp para feedback. Si el dueño configuró el botón
                específico (whatsappFeedbackEnabled + number), usamos ese
                con el mensaje custom. Sino, fallback al whatsappPhone
                general del negocio (legacy). Si ninguno, no aparece. */}
            {(() => {
              const fbNum = t.whatsappFeedbackEnabled
                ? (t.whatsappFeedbackNumber ?? '').replace(/\D/g, '')
                : '';
              const generalNum = (t.whatsappPhone ?? '').replace(/\D/g, '');
              const num = fbNum || generalNum;
              if (!num || num.length < 6) return null;
              const template =
                t.whatsappFeedbackEnabled && t.whatsappFeedbackMessage?.trim()
                  ? t.whatsappFeedbackMessage
                  : `Hola ${t.brandName}, acabo de dejar una reseña y me gustaría hablar con ustedes.`;
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

        <div className="mt-10 text-[11px] text-mute opacity-70">
          {tt('common.brand_powered')}
        </div>
      </article>
      <LanguageSwitcher />
    </div>
  );
}
