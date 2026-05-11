'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PhoneInput } from '@/components/PhoneInput';

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
};

type Step = 'rate' | 'feedback' | 'thanks';

export default function ReviewPage() {
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
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-3">😔</div>
          <h1 className="text-xl font-bold">No disponible</h1>
          <p className="text-mute mt-2 text-sm">
            {err === 'Negocio no disponible'
              ? 'Esta página no está activa.'
              : err}
          </p>
        </div>
      </div>
    );
  }
  if (!t) return <div className="p-8 text-mute text-center">Cargando…</div>;

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
              ¿Cómo fue tu experiencia con nosotros?
            </p>
            <div className="flex gap-2 mt-6">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onMouseEnter={() => setHover(n)}
                  onMouseLeave={() => setHover(0)}
                  onClick={() => pickRating(n)}
                  className="text-5xl transition transform hover:scale-110 focus:outline-none"
                  aria-label={`${n} estrella${n > 1 ? 's' : ''}`}
                  style={{
                    color: n <= (hover || rating) ? '#FACC15' : '#E5E7EB',
                  }}
                >
                  ★
                </button>
              ))}
            </div>
            <p className="text-xs text-mute mt-3">Toca una estrella para empezar</p>
          </>
        )}

        {step === 'feedback' && (
          <>
            <div className="mt-4 text-5xl">
              {rating <= 2 ? '😔' : '🙏'}
            </div>
            <h2 className="text-xl font-bold mt-3">
              {rating <= 2
                ? 'Lo sentimos mucho'
                : 'Cuéntanos cómo podemos mejorar'}
            </h2>
            <p className="text-mute mt-2 leading-relaxed text-sm">
              Tu mensaje llega directo al dueño del negocio (no se publica
              en ningún lado). Necesitamos tu contacto para resolver lo que
              pasó.
            </p>
            <div className="w-full mt-5 space-y-3 text-left">
              <div>
                <label className="label">
                  Tu nombre <span className="text-bad">*</span>
                </label>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Cómo te llamas"
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="label">
                  Tu WhatsApp <span className="text-bad">*</span>
                </label>
                <PhoneInput
                  value={phone}
                  onChange={setPhone}
                  placeholder="Tu número"
                />
                <div className="text-[11px] text-mute mt-1">
                  Te contactaremos por aquí para resolver tu experiencia.
                </div>
              </div>
              <div>
                <label className="label">
                  ¿Qué pasó? <span className="text-mute font-normal">(opcional)</span>
                </label>
                <textarea
                  className="input"
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Lo más específico posible nos ayuda a mejorar."
                />
              </div>
              <button
                type="button"
                disabled={
                  submitting || !name.trim() || phone.trim().length < 6
                }
                onClick={submitNegative}
                className="w-full py-3 rounded-xl text-white font-semibold text-base shadow-md disabled:opacity-50 transition"
                style={{ background: primary }}
              >
                {submitting ? 'Enviando…' : 'Enviar y recibir respuesta'}
              </button>
            </div>
          </>
        )}

        {step === 'thanks' && (
          <>
            <div className="mt-4 text-6xl">💚</div>
            <h2 className="text-xl font-bold mt-3">¡Gracias!</h2>
            <p className="text-mute mt-2 leading-relaxed">
              Recibimos tu mensaje. Lo vamos a revisar pronto.
            </p>
            {t.whatsappPhone && (
              <a
                href={`https://wa.me/${t.whatsappPhone.replace(/\D/g, '')}`}
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-flex items-center gap-2 text-sm font-semibold underline"
                style={{ color: primary }}
              >
                💬 Escribir por WhatsApp
              </a>
            )}
          </>
        )}

        <div className="mt-10 text-[11px] text-mute opacity-70">
          Powered by Clubify
        </div>
      </article>
    </div>
  );
}
