'use client';

import { useEffect, useRef, useState } from 'react';
import { HeroTrio } from '@/components/HeroTrio';
import { HeroBanner } from '@/components/HeroBanner';
import { FidelizacionBanner } from '@/components/FidelizacionBanner';
import { InfoLinksBanner } from '@/components/InfoLinksBanner';

// Marcas placeholder para la banda de logos (clon de la portada).
const CLUBIFY_LOGOS = ['Café del Día', 'Burger Lab', 'Bowls & Co', 'Helados Tina', 'Pizza Roma', 'Sushi Kira', 'Tacos del Sur', 'Panadería 21'];

// Envuelve un bloque reutilizado de la portada (HeroBanner, Fidelización, InfoLinks)
// e intercepta el clic de CUALQUIER CTA (a/button) para abrir el formulario de
// contacto en vez de navegar — así reusamos los componentes reales sin modificarlos.
function CtaCapture({ onCta, children }: { onCta: () => void; children: React.ReactNode }) {
  return (
    <div
      onClickCapture={(e) => {
        const el = (e.target as HTMLElement).closest('a, button');
        if (el) { e.preventDefault(); e.stopPropagation(); onCta(); }
      }}
    >
      {children}
    </div>
  );
}

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
  theme?: {
    primaryColor?: string;
    customHtml?: string;
    raffleSlug?: string;
    formPopup?: boolean;
    leadWhatsapp?: string;
    leadWhatsappMsg?: string;
    template?: string;
    // Formulario visible en el primer bloque (hero) en vez de solo el popup.
    formInHero?: boolean;
    // Casilla de autorización de tratamiento de datos (obligatoria si está activa).
    dataConsent?: boolean;
    dataConsentText?: string; // el texto legal; la frase enlazable va aparte
    dataPolicyLabel?: string; // frase dentro del texto que se vuelve enlace
    dataPolicyUrl?: string; // URL de la política de tratamiento de datos
  } | null;
};

// Dominio del panel team_clubify donde vive el proceso del sorteo (endpoint público).
const TEAM_BASE = 'https://team.soyclubify.com';

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

  const customHtml = data.theme?.customHtml || null;
  const raffleSlug = data.theme?.raffleSlug || null;
  // Plantilla "clon de la home de Clubify" (soyclubify.com): mismo hero + mockups
  // reales (HeroTrio) que la portada, pero el CTA "Contactar" abre el formulario
  // emergente y al enviar redirige a WhatsApp (captación Gastrofusión).
  const template = data.theme?.template || null;
  // Gastrofusión: form en popup + redirect a WhatsApp al enviar (config por theme).
  const formPopup = !!data.theme?.formPopup;
  const leadWhatsapp = (data.theme?.leadWhatsapp || '').replace(/\D/g, '');
  const leadWaMsg = data.theme?.leadWhatsappMsg || 'Hola, me interesa saber más';
  const [showForm, setShowForm] = useState(false);
  // Formulario en el primer bloque (hero) + casilla de tratamiento de datos.
  const formInHero = !!data.theme?.formInHero;
  const consentEnabled = !!data.theme?.dataConsent;
  const consentText = data.theme?.dataConsentText || '';
  const policyLabel = data.theme?.dataPolicyLabel || 'Política de Tratamiento de Datos';
  const policyUrl = data.theme?.dataPolicyUrl || '';
  const [consent, setConsent] = useState(false);
  const htmlRef = useRef<HTMLDivElement>(null);
  const [raffle, setRaffle] = useState<{ state: 'idle' | 'done' | 'already'; wa?: string; msg?: string }>({ state: 'idle' });

  // Banda de logos: nombres de negocios ACTIVOS reales (mismo endpoint que la
  // portada soyclubify.com); si falla o viene vacío, cae al placeholder.
  const [marqueeNames, setMarqueeNames] = useState<string[]>(CLUBIFY_LOGOS);
  useEffect(() => {
    if (template !== 'clubify-home') return;
    const API = process.env.NEXT_PUBLIC_API_URL ?? '';
    if (!API) return;
    let alive = true;
    fetch(`${API}/api/landing-active-businesses`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: unknown) => {
        const names = Array.isArray((d as { names?: unknown })?.names) ? (d as { names: unknown[] }).names : [];
        const clean = names.filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
        if (alive && clean.length) setMarqueeNames(clean);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [template]);

  // HTML personalizado + sorteo vinculado → el <form> del HTML registra en el sorteo
  // (mismo proceso que el formulario del sorteo: dedup + RaffleEntry + confirmación por
  // WhatsApp), vía el endpoint público cross-origin de team_clubify.
  useEffect(() => {
    if (!customHtml || !raffleSlug) return;
    const form = htmlRef.current?.querySelector('form');
    if (!form) return;
    async function onSubmit(e: Event) {
      e.preventDefault();
      const el = e.currentTarget as HTMLFormElement;
      const payload: Record<string, string> = {};
      new FormData(el).forEach((v, k) => { payload[k] = typeof v === 'string' ? v : ''; });
      const btn = el.querySelector('button[type=submit],input[type=submit]') as HTMLButtonElement | null;
      const prev = btn?.textContent;
      if (btn) { btn.disabled = true; if (btn.textContent) btn.textContent = 'Enviando…'; }
      try {
        const res = await fetch(`${TEAM_BASE}/api/raffle/${raffleSlug}/entry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const j = await res.json();
        if (j.ok) {
          setRaffle({ state: j.already ? 'already' : 'done', wa: j.confirmWhatsapp, msg: j.confirmMessage });
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          if (btn) { btn.disabled = false; if (prev) btn.textContent = prev; }
          alert(j.error || 'No se pudo registrar. Revisa los datos e intenta de nuevo.');
        }
      } catch {
        if (btn) { btn.disabled = false; if (prev) btn.textContent = prev; }
        alert('No se pudo registrar. Intenta de nuevo.');
      }
    }
    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
  }, [customHtml, raffleSlug]);

  // HTML personalizado + formulario en popup: cablea los CTA del HTML de marca para
  // que abran el formulario de contacto (Gastrofusión). Convención de botón, en orden:
  //   [data-contactar]  ·  <a href="#contactar|#contacto|#formulario|#form">  ·  texto "Contactar".
  useEffect(() => {
    if (!customHtml || !formPopup) return;
    const root = htmlRef.current;
    if (!root) return;
    const bySelector = Array.from(
      root.querySelectorAll('[data-contactar], a[href="#contactar"], a[href="#contacto"], a[href="#formulario"], a[href="#form"]'),
    );
    const byText = Array.from(root.querySelectorAll('a, button')).filter(
      (el) => (el.textContent || '').trim().toLowerCase() === 'contactar',
    );
    const targets = Array.from(new Set([...bySelector, ...byText]));
    const open = (e: Event) => { e.preventDefault(); setShowForm(true); };
    targets.forEach((el) => el.addEventListener('click', open));
    return () => targets.forEach((el) => el.removeEventListener('click', open));
  }, [customHtml, formPopup]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (consentEnabled && !consent) {
      setErr('Debes autorizar el tratamiento de datos para continuar.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`${API}/api/public/info-pages/${data.slug}/lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(consentEnabled ? { ...answers, _consent: 'Sí', _consentAt: new Date().toISOString() } : answers),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.message || 'No se pudo enviar. Revisa los campos e intenta de nuevo.');
      }
      // Además: empujar el lead al CRM/Contactos del team (best-effort, no bloquea la UX).
      fetch(`${TEAM_BASE}/api/public/lead-intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...answers, _source: `Página: ${data.title || data.slug}` }),
      }).catch(() => {});
      setDone(true);
      // Al completar → redirigir a WhatsApp (Gastrofusión) tras mostrar el "gracias".
      if (leadWhatsapp) {
        const url = `https://wa.me/${leadWhatsapp}?text=${encodeURIComponent(leadWaMsg)}`;
        setTimeout(() => { window.location.href = url; }, 900);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Texto de la casilla de tratamiento de datos con la frase de la política enlazada.
  const consentTextNode = consentText
    ? consentText.split(policyLabel).map((p, i, arr) => (
        <span key={i}>
          {p}
          {i < arr.length - 1 &&
            (policyUrl ? (
              <a href={policyUrl} target="_blank" rel="noreferrer" className="font-semibold underline" style={{ color: accent }}>{policyLabel}</a>
            ) : (
              <span className="font-semibold underline">{policyLabel}</span>
            ))}
        </span>
      ))
    : null;

  // Tarjeta del formulario (reutilizable: sección inline o popup).
  const formCard = (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      {done ? (
        <div className="py-8 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full text-3xl" style={{ background: `${accent}1a` }}>✓</div>
          <p className="text-lg font-semibold">¡Gracias! Hemos recibido tus datos.</p>
          <p className="mt-1 text-sm text-slate-500">{leadWhatsapp ? 'Te estamos redirigiendo a WhatsApp…' : 'Nuestro equipo te contactará muy pronto.'}</p>
          {leadWhatsapp && (
            <a href={`https://wa.me/${leadWhatsapp}?text=${encodeURIComponent(leadWaMsg)}`} className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#25D366] px-5 py-2.5 text-sm font-semibold text-white">Abrir WhatsApp</a>
          )}
        </div>
      ) : (
        <>
          <h2 className="text-center text-xl font-bold">{data.ctaText === 'Contactar' ? 'Contáctanos' : data.ctaText || 'Déjanos tus datos'}</h2>
          <p className="mt-1 text-center text-sm text-slate-500">Completa el formulario y te contactamos.</p>
          <form onSubmit={submit} className="mt-5 space-y-3">
            {fields.map((f) => (
              <div key={f.key}>
                <label className="mb-1 block text-sm font-medium text-slate-700">{f.label}{f.required && <span className="ml-0.5 text-rose-500">*</span>}</label>
                {f.type === 'textarea' ? (
                  <textarea required={f.required} rows={3} value={answers[f.key] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))} className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-slate-200" />
                ) : f.type === 'select' ? (
                  <select required={f.required} value={answers[f.key] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))} className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none transition focus:ring-2">
                    <option value="">Selecciona…</option>
                    {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type={f.type} required={f.required} value={answers[f.key] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))} className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none transition focus:ring-2" />
                )}
              </div>
            ))}
            {consentEnabled && (
              <label className="flex items-start gap-2 text-left text-xs leading-relaxed text-slate-600">
                <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-current" style={{ accentColor: accent }} />
                <span>{consentTextNode}</span>
              </label>
            )}
            {err && <p className="text-sm text-rose-600">{err}</p>}
            <button type="submit" disabled={busy} className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50" style={{ background: accent }}>{busy ? 'Enviando…' : data.ctaText || 'Enviar'}</button>
          </form>
        </>
      )}
    </div>
  );

  // Popup del formulario de contacto (reutilizable por las plantillas que usan CTA
  // "Contactar" en vez de sección inline).
  const formPopupModal = showForm && (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center" onClick={() => setShowForm(false)}>
      <div className="relative w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => setShowForm(false)} className="absolute -right-2 -top-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-white text-slate-500 shadow">✕</button>
        {formCard}
      </div>
    </div>
  );

  // ── Plantilla: clon de la portada soyclubify.com ──────────────────────────
  // Duplica el diseño de la home real (header + hero con titular en gradiente +
  // pilares + trío de iPhones + banda de métricas), cambiando los CTA por
  // "Contactar" → formulario emergente → WhatsApp.
  if (template === 'clubify-home') {
    const open = () => setShowForm(true);
    return (
      <main className="min-h-screen bg-white text-ink">
        {/* Header */}
        <header className="sticky top-0 z-30 border-b border-line/80 bg-white/85 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
            {/* Logo oficial de Clubify (asset del sistema). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={data.logoUrl || '/clubify-logo.png'} alt="Clubify" className="block h-9 w-auto max-w-[190px] object-contain" />
            <button onClick={open} className="inline-flex items-center gap-1.5 rounded-pill bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink/90">
              {data.ctaText || 'Contactar'} →
            </button>
          </div>
        </header>

        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            className="absolute inset-0 -z-10 opacity-40"
            style={{ background: 'radial-gradient(ellipse 70% 60% at 30% 20%, rgba(91,94,238,0.16), transparent 60%), radial-gradient(ellipse 60% 50% at 80% 30%, rgba(192,38,211,0.10), transparent 60%)' }}
          />
          <div className="mx-auto max-w-7xl px-6 pb-16 pt-8 lg:pb-24 lg:pt-12">
            <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-16">
              <div>
                <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-semibold shadow-sm">
                  <span className="text-amber-500">★★★★★</span>
                  <span>4.9/5</span>
                  <span className="font-normal text-mute">·</span>
                  <span className="font-normal text-mute">+150 negocios en LATAM</span>
                </div>
                <h1 className="text-[40px] font-bold leading-[1.04] tracking-tight md:text-[52px] lg:text-[60px]">
                  Una plataforma{' '}
                  <span className="bg-gradient-to-r from-brand-400 via-brand-500 to-brand-700 bg-clip-text text-transparent">todo en uno</span>{' '}
                  para tu negocio local.
                </h1>
                <p className="mt-6 max-w-xl text-lg leading-relaxed text-mute lg:text-xl">
                  {data.subtitle || 'Tarjetas de fidelización, menú digital, CRM de pedidos y automatizaciones de delivery.'}
                </p>
                <div className="mt-6 flex flex-wrap gap-2">
                  {['Pedidos', 'Fidelización', 'Automatización', 'CRM', 'Analítica'].map((p) => (
                    <span key={p} className="rounded-full bg-bg2 px-2.5 py-1 text-xs font-medium text-ink/80">{p}</span>
                  ))}
                </div>
                {!formInHero && (
                  <div className="mt-8 flex flex-wrap gap-3">
                    <button onClick={open} className="inline-flex items-center rounded-pill bg-ink px-6 py-3.5 text-base font-semibold text-white shadow-md transition hover:bg-ink/90">
                      {data.ctaText || 'Contactar'}
                    </button>
                  </div>
                )}
                <div className="mt-8 flex flex-wrap items-center gap-5 text-xs text-mute">
                  <div className="flex items-center gap-1.5"><span className="font-bold text-ok">✓</span> Activación inmediata</div>
                  <div className="flex items-center gap-1.5"><span className="font-bold text-ok">✓</span> Cancela cuando quieras</div>
                  <div className="flex items-center gap-1.5"><span className="font-bold text-ok">✓</span> En español, soporte LATAM</div>
                </div>
              </div>
              {/* Primer bloque: formulario visible de inmediato (formInHero) o los mockups. */}
              {formInHero ? (
                <div id="formulario" className="w-full">{formCard}</div>
              ) : (
                <div className="relative flex justify-center lg:justify-end">
                  <HeroTrio />
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Banda de logos (marquee) */}
        <section className="overflow-hidden border-y border-line/80 bg-bg2/40 py-8">
          <div className="mx-auto mb-5 max-w-7xl px-6 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-mute">
            Negocios LATAM creciendo con Clubify
          </div>
          <div className="relative">
            <div className="flex animate-marquee gap-12 whitespace-nowrap">
              {[...marqueeNames, ...marqueeNames, ...marqueeNames].map((l, i) => (
                <span key={`${l}-${i}`} className="flex-none text-sm font-semibold capitalize text-mute opacity-70">{l}</span>
              ))}
            </div>
          </div>
        </section>

        {/* Banda de métricas */}
        <section className="py-14">
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-6 px-6 text-center md:grid-cols-4">
            {[['+150', 'Negocios activos en LATAM'], ['+30K', 'Clientes con tarjeta wallet'], ['50K', 'Pedidos procesados / mes'], ['4.9 / 5', 'Calificación de dueños']].map(([v, l]) => (
              <div key={l}>
                <div className="text-3xl font-bold tracking-tight md:text-4xl">{v}</div>
                <div className="mt-1.5 text-xs leading-snug text-mute">{l}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Bloque Fidelización (componente real de la portada) — sin CTAs "Ver plan"/"Demo" en el clon. */}
        <CtaCapture onCta={open}><FidelizacionBanner waLink="#contactar" demoLink="#contactar" hideCtas /></CtaCapture>

        {/* Menús con IA (componente real de la portada) — sin CTAs "Ver plan"/"Demo" en el clon. */}
        <CtaCapture onCta={open}><HeroBanner waLink="#contactar" demoLink="#contactar" hideCtas /></CtaCapture>

        {/* InfoLinks (componente real de la portada) — sin CTA "Ver planes y comenzar" en el clon. */}
        <CtaCapture onCta={open}><InfoLinksBanner hideCtas /></CtaCapture>

        {/* Testimonios */}
        <section className="border-y border-line/80 bg-bg2/40 py-20">
          <div className="mx-auto max-w-7xl px-6">
            <div className="mx-auto mb-10 max-w-2xl text-center">
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-brand">Lo que dicen</div>
              <h2 className="text-3xl font-bold leading-[1.1] tracking-tight md:text-5xl">Nuestros clientes</h2>
            </div>
            <div className="mx-auto grid max-w-4xl grid-cols-1 gap-6 md:grid-cols-2">
              {[{ id: 'ZK5Q0QRXUeI', name: 'Nudo Cowork & Coffee' }, { id: 'BffWf9f8sHY', name: 'Konnys Pizza' }].map((v) => (
                <div key={v.id} className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
                  <div className="aspect-video w-full bg-black">
                    <iframe src={`https://www.youtube-nocookie.com/embed/${v.id}`} title={`Testimonio ${v.name}`} className="h-full w-full" style={{ border: 0 }} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen loading="lazy" />
                  </div>
                  <div className="flex items-center gap-2.5 px-5 py-4">
                    <div className="text-sm text-amber-500">★★★★★</div>
                    <div className="text-sm font-semibold">{v.name}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Precios → Contactar */}
        <section className="py-20">
          <div className="mx-auto max-w-3xl px-6 text-center">
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-brand">Precios</div>
            <h2 className="text-3xl font-bold leading-[1.1] tracking-tight md:text-5xl">Precios a la medida de tu negocio</h2>
            <p className="mt-4 text-lg text-mute">Cada negocio es distinto. Déjanos tus datos y armamos juntos el plan que mejor se ajusta a lo que necesitas.</p>
            <div className="mt-9 flex justify-center">
              <button onClick={open} className="inline-flex items-center justify-center gap-2 rounded-full bg-brand px-8 py-4 text-base font-semibold text-white shadow-lg transition hover:opacity-90 sm:text-lg">
                {data.ctaText || 'Contactar'} →
              </button>
            </div>
          </div>
        </section>

        {/* CTA final */}
        <section className="border-t border-line bg-bg2/40 py-16">
          <div className="mx-auto max-w-2xl px-6 text-center">
            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">¿Listo para dar el siguiente paso?</h2>
            <p className="mt-3 text-mute">Déjanos tus datos y un asesor te contacta por WhatsApp.</p>
            <button onClick={open} className="mt-7 inline-flex items-center rounded-pill bg-ink px-7 py-3.5 text-base font-semibold text-white shadow-md transition hover:bg-ink/90">
              {data.ctaText || 'Contactar'}
            </button>
          </div>
        </section>

        <footer className="border-t border-line bg-white py-10 text-center text-xs text-mute">
          © {new Date().getFullYear()} Clubify · soyclubify.com
        </footer>

        {formPopupModal}
      </main>
    );
  }

  // HTML personalizado = LIENZO COMPLETO: la página ES tu HTML (con su propio <style>),
  // sin el hero/footer de Clubify ni utilidades que pisen tu CSS. Tras enviar el form
  // (si hay sorteo vinculado) se muestra la confirmación por WhatsApp.
  if (customHtml) {
    return (
      <div className="min-h-screen bg-white text-slate-900">
        {raffle.state !== 'idle' ? (
          <section className="mx-auto max-w-lg px-5 py-16 text-center">
            <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full text-4xl" style={{ background: `${accent}1a` }}>
              {raffle.state === 'already' ? '🎟️' : '🎉'}
            </div>
            <h2 className="text-2xl font-bold">{raffle.state === 'already' ? '¡Ya estás participando!' : '¡Ya casi eres parte del sorteo!'}</h2>
            <p className="mx-auto mt-2 max-w-md text-slate-600">
              {raffle.state === 'already'
                ? 'Ya te habías registrado en este sorteo con estos datos. Si aún no lo hiciste, confirma tu participación por WhatsApp.'
                : 'Solo falta un paso muy importante: confirma tu participación por WhatsApp.'}
            </p>
            {raffle.wa && (
              <a
                href={`https://wa.me/${raffle.wa}?text=${encodeURIComponent(raffle.msg || '')}`}
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-[#25D366] px-6 py-3 text-sm font-semibold text-white hover:bg-[#1eb457]"
              >
                ✅ Confirmar mi participación
              </a>
            )}
            <p className="mx-auto mt-5 max-w-md rounded-lg bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800">
              ⚠️ Si no confirmas por WhatsApp, tu participación no será válida.
            </p>
          </section>
        ) : (
          <div ref={htmlRef} dangerouslySetInnerHTML={{ __html: customHtml }} />
        )}

        {/* Formulario de contacto en popup (Gastrofusión): lo abren los CTA del HTML
            de marca cableados arriba. Solo si theme.formPopup está activo. */}
        {formPopup && showForm && (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center" onClick={() => setShowForm(false)}>
            <div className="relative w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => setShowForm(false)} className="absolute -right-2 -top-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-white text-slate-500 shadow">✕</button>
              {formCard}
            </div>
          </div>
        )}
      </div>
    );
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
              ) : formPopup ? (
                <button onClick={() => setShowForm(true)} className="inline-flex items-center rounded-xl px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90" style={{ background: accent }}>
                  {data.ctaText || 'Contactar'}
                </button>
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
      {customHtml ? (
        raffle.state !== 'idle' ? (
          <section className="mx-auto max-w-lg px-5 py-16 text-center">
            <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full text-4xl" style={{ background: `${accent}1a` }}>
              {raffle.state === 'already' ? '🎟️' : '🎉'}
            </div>
            <h2 className="text-2xl font-bold">{raffle.state === 'already' ? '¡Ya estás participando!' : '¡Ya casi eres parte del sorteo!'}</h2>
            <p className="mx-auto mt-2 max-w-md text-slate-600">
              {raffle.state === 'already'
                ? 'Ya te habías registrado en este sorteo con estos datos. Si aún no lo hiciste, confirma tu participación por WhatsApp.'
                : 'Solo falta un paso muy importante: confirma tu participación por WhatsApp.'}
            </p>
            {raffle.wa && (
              <a
                href={`https://wa.me/${raffle.wa}?text=${encodeURIComponent(raffle.msg || '')}`}
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-[#25D366] px-6 py-3 text-sm font-semibold text-white hover:bg-[#1eb457]"
              >
                ✅ Confirmar mi participación
              </a>
            )}
            <p className="mx-auto mt-5 max-w-md rounded-lg bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800">
              ⚠️ Si no confirmas por WhatsApp, tu participación no será válida.
            </p>
            <p className="mt-2 text-sm text-slate-500">📸 Recuerda seguirnos en Instagram y TikTok para poder ganar.</p>
          </section>
        ) : (
          <section className="mx-auto max-w-4xl px-5 py-8">
            <div
              ref={htmlRef}
              className="info-html leading-relaxed text-slate-700 [&_a]:text-emerald-700 [&_a]:underline [&_h1]:mt-6 [&_h1]:text-3xl [&_h1]:font-extrabold [&_h2]:mt-6 [&_h2]:text-2xl [&_h2]:font-bold [&_h3]:mt-4 [&_h3]:text-xl [&_h3]:font-semibold [&_img]:mx-auto [&_img]:my-4 [&_img]:max-w-full [&_img]:rounded-xl [&_li]:ml-5 [&_li]:list-disc [&_p]:my-3 [&_ul]:my-3"
              dangerouslySetInnerHTML={{ __html: customHtml }}
            />
          </section>
        )
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

      {/* Formulario de captación propio (se OCULTA si hay HTML personalizado: el HTML
          trae su propio formulario, que registra en el sorteo vinculado si lo hay). */}
      {data.formEnabled && !customHtml && !formPopup && (
        <section id="formulario" className="mx-auto max-w-xl px-5 py-10">{formCard}</section>
      )}
      {data.formEnabled && !customHtml && formPopup && showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center" onClick={() => setShowForm(false)}>
          <div className="relative w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setShowForm(false)} className="absolute -right-2 -top-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-white text-slate-500 shadow">✕</button>
            {formCard}
          </div>
        </div>
      )}

      <footer className="border-t border-slate-100 py-8 text-center text-xs text-slate-400">
        © {new Date().getFullYear()} Clubify · soyclubify.com
      </footer>
    </div>
  );
}
