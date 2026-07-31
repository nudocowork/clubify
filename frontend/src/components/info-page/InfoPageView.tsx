'use client';

import { useState } from 'react';

export type InfoFormField = {
  key: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'number' | 'textarea' | 'select';
  required?: boolean;
  options?: string[];
};

export type InfoPageData = {
  slug: string;
  title: string;
  subtitle?: string | null;
  logoUrl?: string | null;
  heroImageUrl?: string | null;
  videoUrl?: string | null;
  description?: string | null;
  sections?: { heading?: string; body?: string; imageUrl?: string }[];
  ctaText?: string | null;
  ctaUrl?: string | null;
  formEnabled?: boolean;
  formFields?: InfoFormField[];
  theme?: { primaryColor?: string; customHtml?: string } | null;
};

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

// Convierte una URL de YouTube/Vimeo a su forma embebible; si no reconoce el
// proveedor devuelve null (se renderiza como <video> directo).
function toEmbed(url: string): string | null {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return null;
}

export function InfoPageView({ data }: { data: InfoPageData }) {
  const accent = data.theme?.primaryColor || '#16a34a';
  const fields = data.formFields ?? [];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const embed = data.videoUrl ? toEmbed(data.videoUrl) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`${API}/api/public/info-pages/${data.slug}/lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(answers),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.message || 'No se pudo enviar. Revisa los campos e intenta de nuevo.');
      }
      setDone(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Hero */}
      <header className="relative overflow-hidden">
        <div
          className="absolute inset-0 -z-10"
          style={{ background: `radial-gradient(1200px 500px at 50% -10%, ${accent}1a, transparent 70%)` }}
        />
        <div className="mx-auto max-w-3xl px-5 pb-10 pt-16 text-center sm:pt-24">
          {data.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.logoUrl} alt="Logo" className="mx-auto mb-5 h-12 w-auto object-contain sm:h-14" />
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: `${accent}14`, color: accent }}>
              ● Clubify
            </span>
          )}
          <h1 className="mt-4 text-balance text-3xl font-extrabold leading-tight sm:text-5xl">{data.title}</h1>
          {data.subtitle && <p className="mx-auto mt-4 max-w-2xl text-pretty text-base text-slate-600 sm:text-lg">{data.subtitle}</p>}
          {(data.formEnabled || data.ctaUrl) && (
            <div className="mt-7">
              {data.ctaUrl ? (
                <a href={data.ctaUrl} className="inline-flex items-center rounded-xl px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90" style={{ background: accent }}>
                  {data.ctaText || 'Más información'}
                </a>
              ) : (
                <a href="#formulario" className="inline-flex items-center rounded-xl px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90" style={{ background: accent }}>
                  {data.ctaText || 'Quiero más información'}
                </a>
              )}
            </div>
          )}
          {data.heroImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.heroImageUrl} alt="" className="mx-auto mt-10 w-full max-w-2xl rounded-2xl object-cover shadow-lg" />
          )}
        </div>
      </header>

      {/* Código HTML personalizado (avanzado): si está presente, REEMPLAZA a la
          descripción + secciones y da control total del cuerpo de la página. Lo edita
          solo un admin desde team → COMERCIAL → Páginas Info (contenido de confianza;
          los <script> insertados vía innerHTML no se ejecutan). */}
      {data.theme?.customHtml ? (
        <section className="mx-auto max-w-4xl px-5 py-8">
          <div
            className="info-html leading-relaxed text-slate-700 [&_a]:text-emerald-700 [&_a]:underline [&_h1]:mt-6 [&_h1]:text-3xl [&_h1]:font-extrabold [&_h2]:mt-6 [&_h2]:text-2xl [&_h2]:font-bold [&_h3]:mt-4 [&_h3]:text-xl [&_h3]:font-semibold [&_img]:mx-auto [&_img]:my-4 [&_img]:max-w-full [&_img]:rounded-xl [&_li]:ml-5 [&_li]:list-disc [&_p]:my-3 [&_ul]:my-3"
            dangerouslySetInnerHTML={{ __html: data.theme.customHtml }}
          />
        </section>
      ) : (
        <>
          {/* Descripción */}
          {data.description && (
            <section className="mx-auto max-w-3xl px-5 py-6">
              <p className="text-pretty text-center text-lg leading-relaxed text-slate-700">{data.description}</p>
            </section>
          )}

          {/* Secciones */}
          {!!data.sections?.length && (
            <section className="mx-auto max-w-4xl px-5 py-8">
              <div className="grid gap-5 sm:grid-cols-2">
                {data.sections.map((s, i) => (
                  <div key={i} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-6">
                    {s.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.imageUrl} alt="" className="mb-4 h-40 w-full rounded-xl object-cover" />
                    )}
                    {s.heading && <h3 className="text-lg font-bold" style={{ color: accent }}>{s.heading}</h3>}
                    {s.body && <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.body}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* Video */}
      {data.videoUrl && (
        <section className="mx-auto max-w-3xl px-5 py-8">
          <div className="overflow-hidden rounded-2xl bg-black shadow-lg" style={{ aspectRatio: '16 / 9' }}>
            {embed ? (
              <iframe src={embed} title="Video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen className="h-full w-full" />
            ) : (
              <video src={data.videoUrl} controls className="h-full w-full" />
            )}
          </div>
        </section>
      )}

      {/* Formulario de captación */}
      {data.formEnabled && (
        <section id="formulario" className="mx-auto max-w-xl px-5 py-10">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            {done ? (
              <div className="py-8 text-center">
                <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full text-3xl" style={{ background: `${accent}1a` }}>✓</div>
                <p className="text-lg font-semibold">¡Gracias! Hemos recibido tus datos.</p>
                <p className="mt-1 text-sm text-slate-500">Nuestro equipo te contactará muy pronto.</p>
              </div>
            ) : (
              <>
                <h2 className="text-center text-xl font-bold">{data.ctaText || 'Déjanos tus datos'}</h2>
                <p className="mt-1 text-center text-sm text-slate-500">Completa el formulario y te contactamos.</p>
                <form onSubmit={submit} className="mt-5 space-y-3">
                  {fields.map((f) => (
                    <div key={f.key}>
                      <label className="mb-1 block text-sm font-medium text-slate-700">
                        {f.label}
                        {f.required && <span className="ml-0.5 text-rose-500">*</span>}
                      </label>
                      {f.type === 'textarea' ? (
                        <textarea
                          required={f.required}
                          rows={3}
                          value={answers[f.key] ?? ''}
                          onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
                          className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-slate-200"
                        />
                      ) : f.type === 'select' ? (
                        <select
                          required={f.required}
                          value={answers[f.key] ?? ''}
                          onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:ring-2"
                        >
                          <option value="">Selecciona…</option>
                          {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input
                          type={f.type}
                          required={f.required}
                          value={answers[f.key] ?? ''}
                          onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
                          className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none transition focus:ring-2"
                        />
                      )}
                    </div>
                  ))}
                  {err && <p className="text-sm text-rose-600">{err}</p>}
                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
                    style={{ background: accent }}
                  >
                    {busy ? 'Enviando…' : data.ctaText || 'Enviar'}
                  </button>
                </form>
              </>
            )}
          </div>
        </section>
      )}

      <footer className="border-t border-slate-100 py-8 text-center text-xs text-slate-400">
        © {new Date().getFullYear()} Clubify · soyclubify.com
      </footer>
    </div>
  );
}
