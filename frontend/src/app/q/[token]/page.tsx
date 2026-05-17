import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  COMPARISON_FEATURES,
  getPlanBenefits,
  type QuotePlan,
} from '@/lib/quote-benefits';
import { QUOTE_TEMPLATES } from '@/lib/quote-templates';
import { ClubifyBadge } from '@/components/ClubifyBadge';
import { QuotePublicActions } from '@/components/QuotePublicActions';

const BACKEND =
  process.env.BACKEND_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4949';

type PublicQuote = {
  publicToken: string;
  customerName: string;
  businessName: string;
  plan: QuotePlan;
  templateSlug: string | null;
  advisorName: string;
  priceSnapshot: string; // Decimal serializado
  currencySnapshot: string;
  createdAt: string;
};

async function fetchQuote(token: string): Promise<PublicQuote | null> {
  try {
    const res = await fetch(`${BACKEND}/api/public/quote/${token}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as PublicQuote;
  } catch {
    return null;
  }
}

function fmtMoney(amount: number | string, currency: string) {
  const n = Number(amount);
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(0)}`;
  }
}

// Validez comercial: 30 días desde createdAt.
function validUntil(createdAt: string): string {
  const d = new Date(createdAt);
  d.setDate(d.getDate() + 30);
  return d.toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default async function PublicQuotePage({
  params,
}: {
  params: { token: string };
}) {
  const quote = await fetchQuote(params.token);
  if (!quote) notFound();

  const benefits = getPlanBenefits(quote.plan);
  const template = quote.templateSlug
    ? QUOTE_TEMPLATES.find((t) => t.slug === quote.templateSlug) ?? null
    : null;
  const accent = template?.accent ?? '#22C55E';
  const planLabel = 'Elite';
  const priceLabel = fmtMoney(quote.priceSnapshot, quote.currencySnapshot);
  // qt = publicToken completo para que el signup pueda atribuir la conversión
  // a esta cotización exacta (closed-loop). utm es solo el prefijo legible
  // para los dashboards de analítica del super admin.
  const signupHref = `/signup?plan=${planLabel.toLowerCase()}&qt=${quote.publicToken}&utm=quote-${quote.publicToken.slice(0, 8)}`;

  return (
    <main className="min-h-screen bg-gradient-to-b from-bg via-white to-bg2/30">
      {/* Hero — uso <section> en vez de <header> porque el print rule
          global de globals.css esconde header/aside/nav (asume AppShell). */}
      <section className="px-5 pt-12 pb-8 max-w-3xl mx-auto">
        <div className="flex items-center gap-2 mb-8">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-md"
            style={{ background: 'linear-gradient(135deg, #4FE83F, #00B23A)' }}
          >
            C
          </div>
          <span className="font-bold text-ink tracking-tight">Clubify</span>
        </div>

        <div className="text-[11px] uppercase tracking-[0.2em] text-mute font-semibold">
          Propuesta comercial
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mt-2 leading-tight">
          Hola {quote.customerName.split(' ')[0]}, esto es lo que armamos para{' '}
          <span style={{ color: accent }}>{quote.businessName}</span>.
        </h1>
        <p className="text-mute mt-3 leading-relaxed">
          Esta propuesta está vigente hasta el{' '}
          <b className="text-ink">{validUntil(quote.createdAt)}</b>.
        </p>
      </section>

      {/* Card precio */}
      <section className="px-5 max-w-3xl mx-auto">
        <div
          className="rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${accent}, ${accent}dd)`,
          }}
        >
          <div className="text-[11px] uppercase tracking-[0.18em] opacity-80">
            Plan {planLabel}
          </div>
          <div className="flex flex-wrap items-baseline gap-2 mt-2">
            <span className="text-5xl sm:text-6xl font-bold tracking-tight">
              {priceLabel}
            </span>
            <span className="text-base font-medium opacity-90">/ mes</span>
          </div>
          <p className="text-sm sm:text-base opacity-95 mt-3 max-w-md leading-relaxed">
            {quote.plan === 'ELITE'
              ? 'Todo lo que necesitás para fidelizar a tus clientes y digitalizar tu menú.'
              : 'Elite + automatizaciones WhatsApp, delivery y módulo administrativo.'}
          </p>
          <Link
            href={signupHref}
            className="inline-flex items-center gap-2 bg-white text-ink font-semibold px-6 py-3 rounded-pill mt-6 shadow-md hover:shadow-lg active:scale-[0.98] transition"
            style={{ color: accent }}
          >
            Aceptar y empezar →
          </Link>
        </div>
      </section>

      {/* Acciones del cliente — share / print / copy. Mobile-friendly,
          no sticky para no tapar el CTA. Se ocultan al imprimir vía
          .print-hide del component. */}
      <QuotePublicActions
        publicToken={quote.publicToken}
        businessName={quote.businessName}
        planLabel={planLabel}
        accent={accent}
      />

      {/* Template-specific (si aplica) */}
      {template && (
        <section className="px-5 max-w-3xl mx-auto mt-10">
          <div className="text-[11px] uppercase tracking-[0.18em] text-mute font-semibold">
            Pensado para {template.name.toLowerCase()}
          </div>
          <div className="mt-3 rounded-2xl bg-white border border-line shadow-sm p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <div className="text-3xl">{template.emoji}</div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-lg leading-tight">
                  {template.name}
                </div>
                <div className="text-sm text-mute mt-1">{template.tagline}</div>
              </div>
            </div>
            <ul className="mt-4 space-y-2">
              {template.highlights.map((h, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-ink">
                  <span style={{ color: accent }} className="mt-0.5">
                    ✓
                  </span>
                  <span className="leading-relaxed">{h}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Beneficios incluidos */}
      <section className="px-5 max-w-3xl mx-auto mt-10">
        <h2 className="text-xl font-bold tracking-tight">Qué incluye</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          {benefits.map((b, i) => (
            <div
              key={i}
              className="rounded-2xl bg-white border border-line p-4 hover:shadow-md transition"
            >
              <div className="text-2xl">{b.icon}</div>
              <div className="font-semibold text-sm mt-2">{b.title}</div>
              <div className="text-xs text-mute mt-1 leading-relaxed">
                {b.description}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Comparativa Elite vs Pro */}
      <section className="px-5 max-w-3xl mx-auto mt-10">
        <h2 className="text-xl font-bold tracking-tight">Elite vs Pro</h2>
        <div className="mt-4 rounded-2xl border border-line bg-white overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg2/40 text-xs uppercase tracking-wider text-mute font-semibold">
                <th className="text-left px-4 py-2.5 font-semibold">Función</th>
                <th
                  className={`text-center px-3 py-2.5 font-semibold ${
                    quote.plan === 'ELITE' ? 'bg-brand-soft text-brand-700' : ''
                  }`}
                >
                  Elite
                </th>
                <th
                  className={`text-center px-3 py-2.5 font-semibold ${
                    quote.plan === 'PRO' ? 'bg-brand-soft text-brand-700' : ''
                  }`}
                >
                  Pro
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_FEATURES.map((f, i) => (
                <tr
                  key={i}
                  className={
                    i < COMPARISON_FEATURES.length - 1 ? 'border-b border-line2' : ''
                  }
                >
                  <td className="px-4 py-2.5 text-ink">{f.label}</td>
                  <td className="text-center px-3 py-2.5">
                    {f.elite ? (
                      <span className="text-ok">✓</span>
                    ) : (
                      <span className="text-mute2">—</span>
                    )}
                  </td>
                  <td className="text-center px-3 py-2.5">
                    {f.pro ? (
                      <span className="text-ok">✓</span>
                    ) : (
                      <span className="text-mute2">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Asesor */}
      <section className="px-5 max-w-3xl mx-auto mt-10">
        <div className="rounded-2xl bg-bg2/40 border border-line p-5 sm:p-6">
          <div className="text-[11px] uppercase tracking-[0.18em] text-mute font-semibold">
            Tu asesor
          </div>
          <div className="mt-2 flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg"
              style={{ background: accent }}
            >
              {quote.advisorName.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="font-semibold text-base">{quote.advisorName}</div>
              <div className="text-xs text-mute">
                ¿Dudas? Respondé este link o pregúntale directo.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="px-5 max-w-3xl mx-auto mt-10 mb-16 text-center">
        <h2 className="text-2xl font-bold tracking-tight">¿Arrancamos?</h2>
        <p className="text-mute mt-2 leading-relaxed">
          Creá tu cuenta y configurá tu primera tarjeta en menos de 10 minutos.
        </p>
        <Link
          href={signupHref}
          className="inline-flex items-center gap-2 text-white font-semibold px-7 py-3.5 rounded-pill mt-5 shadow-lg active:scale-[0.98] transition"
          style={{ background: accent }}
        >
          Aceptar plan {planLabel} · {priceLabel}/mes →
        </Link>
        <div className="text-[11px] text-mute mt-3">
          Sin permanencia, cancelás cuando quieras.
        </div>
      </section>

      <ClubifyBadge />
    </main>
  );
}

export const metadata = {
  title: 'Tu propuesta · Clubify',
};
