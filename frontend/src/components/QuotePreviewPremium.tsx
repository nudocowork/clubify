'use client';
// Preview premium de la cotización — usado en el Wizard de creación (Step 4)
// y reutilizable como base del PDF en Fase 5. Mantenemos el componente
// agnóstico al wizard (recibe props simples) para poder renderizarlo desde
// el listing (re-abrir cotización vieja) sin lógica de pasos.

import type { QuoteTemplate } from '@/lib/quote-templates';
import {
  getPlanBenefits,
  COMPARISON_FEATURES,
  type QuotePlan,
  type PlanBenefit,
} from '@/lib/quote-benefits';

export type QuotePreviewProps = {
  customerName: string;
  businessName: string;
  phone?: string;
  email?: string;
  plan: QuotePlan;
  template: QuoteTemplate;
  price: number;
  currency: string;
  advisorName?: string;
  /** Si está presente, se imprime en el footer y header como "fecha de propuesta". */
  date?: Date;
};

function fmtMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function fmtDateLong(d: Date) {
  return d.toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-mute">
      {children}
    </div>
  );
}

function SectionTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <header className="mb-6">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="text-2xl sm:text-3xl font-bold text-ink mt-1 leading-tight">
        {title}
      </h2>
      {description && (
        <p className="text-sm text-mute mt-2 max-w-xl leading-relaxed">
          {description}
        </p>
      )}
    </header>
  );
}

// Check stylizado a Stripe (círculo solid + check blanco)
function CheckCircle({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center w-5 h-5 rounded-full shrink-0"
      style={{ background: color }}
    >
      <svg
        viewBox="0 0 24 24"
        width="12"
        height="12"
        fill="none"
        stroke="white"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  );
}

function CrossMinimal() {
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center w-5 h-5 rounded-full shrink-0 bg-line2"
    >
      <svg
        viewBox="0 0 24 24"
        width="11"
        height="11"
        fill="none"
        stroke="#9CA3AF"
        strokeWidth={2.5}
        strokeLinecap="round"
      >
        <line x1="6" y1="6" x2="18" y2="18" />
        <line x1="18" y1="6" x2="6" y2="18" />
      </svg>
    </span>
  );
}

function BenefitCard({
  b,
  accent,
}: {
  b: PlanBenefit;
  accent: string;
}) {
  return (
    <div className="group relative rounded-2xl bg-surface border border-line p-5 transition hover:shadow-md2 hover:-translate-y-0.5">
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center text-xl mb-4"
        style={{ background: `${accent}14`, color: accent }}
      >
        <span>{b.icon}</span>
      </div>
      <div className="text-base font-semibold text-ink leading-tight">
        {b.title}
      </div>
      <p className="text-sm text-mute mt-1.5 leading-relaxed">{b.description}</p>
    </div>
  );
}

export function QuotePreviewPremium(props: QuotePreviewProps) {
  const {
    customerName,
    businessName,
    plan,
    template,
    price,
    currency,
    advisorName,
    phone,
    email,
    date = new Date(),
  } = props;
  const benefits = getPlanBenefits(plan);
  const planLabel = plan === 'PRO' ? 'Pro' : 'Elite';

  return (
    <div className="rounded-card bg-surface border border-line shadow-sm2 overflow-hidden">
      {/* HERO */}
      <section
        className="relative px-6 sm:px-10 pt-10 sm:pt-14 pb-10 sm:pb-12"
        style={{
          background: `radial-gradient(circle at 0% 0%, ${template.accent}10, transparent 55%), radial-gradient(circle at 100% 0%, ${template.accent}08, transparent 50%), #FFFFFF`,
        }}
      >
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-8 items-start">
          <div>
            <Eyebrow>
              Propuesta comercial · {fmtDateLong(date)}
            </Eyebrow>
            <h1 className="text-3xl sm:text-5xl font-bold text-ink mt-2 leading-[1.05] tracking-tight">
              Hola{' '}
              <span className="text-ink">
                {customerName || 'cliente'}
              </span>
              ,
            </h1>
            <p className="text-base sm:text-lg text-mute mt-3 max-w-xl leading-relaxed">
              Esta es nuestra propuesta para{' '}
              <span className="font-semibold text-ink">
                {businessName || 'tu negocio'}
              </span>
              . {template.tagline}.
            </p>

            <div
              className="inline-flex items-center gap-2 mt-5 px-3 py-1.5 rounded-pill text-xs font-semibold"
              style={{
                background: `${template.accent}14`,
                color: template.accent,
              }}
            >
              <span>{template.emoji}</span>
              <span>Plantilla {template.name}</span>
            </div>
          </div>

          {/* Plan card destacada */}
          <div className="rounded-2xl bg-ink text-white p-6 shadow-md2 relative overflow-hidden">
            <div
              className="absolute -top-10 -right-10 w-40 h-40 rounded-full blur-2xl opacity-40"
              style={{ background: template.accent }}
            />
            <div className="relative">
              <Eyebrow>
                <span className="text-white/60">Plan recomendado</span>
              </Eyebrow>
              <div className="text-3xl font-bold mt-1">
                {planLabel}
              </div>
              <div className="flex items-baseline gap-1 mt-3">
                <span className="text-4xl font-bold tracking-tight">
                  {fmtMoney(price, currency)}
                </span>
                <span className="text-sm text-white/60">/ mes</span>
              </div>
              <div className="mt-5 pt-5 border-t border-white/10">
                <div className="text-xs text-white/60 uppercase tracking-wider font-semibold">
                  Incluye
                </div>
                <div className="text-sm mt-1 text-white/90 leading-relaxed">
                  {benefits.length} módulos activos · Setup{' '}
                  <span className="text-white font-semibold">en 24h</span> ·
                  Soporte directo por WhatsApp
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* BENEFICIOS */}
      <section className="px-6 sm:px-10 py-12 border-t border-line">
        <SectionTitle
          eyebrow="¿Qué incluye?"
          title={`Lo que tu cliente recibe con ${planLabel}`}
          description={`${benefits.length} módulos profesionales listos para usar el día 1. Sin contratos largos, sin instalaciones, sin app que tu cliente tenga que descargar.`}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4">
          {benefits.map((b) => (
            <BenefitCard key={b.title} b={b} accent={template.accent} />
          ))}
        </div>
      </section>

      {/* HIGHLIGHTS DE PLANTILLA */}
      {template.highlights.length > 0 && (
        <section
          className="px-6 sm:px-10 py-12 border-t border-line"
          style={{
            background: `linear-gradient(180deg, ${template.accent}06, transparent)`,
          }}
        >
          <SectionTitle
            eyebrow={`Diseñado para ${template.name.toLowerCase()}`}
            title={`Por qué Clubify funciona en ${template.name.toLowerCase()}`}
            description="Ganchos comerciales específicos del rubro que te ayudan a cerrar la venta."
          />
          <ul className="space-y-3 max-w-2xl">
            {template.highlights.map((h, i) => (
              <li key={i} className="flex gap-3 items-start">
                <CheckCircle color={template.accent} />
                <span className="text-base text-ink leading-relaxed">{h}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* COMPARATIVA */}
      <section className="px-6 sm:px-10 py-12 border-t border-line">
        <SectionTitle
          eyebrow="Elite vs Pro"
          title="Comparativa completa"
          description="Qué incluye cada plan, en detalle. Si el cliente arranca con Elite, puede saltar a Pro cuando quiera sin perder data."
        />
        <div className="rounded-2xl border border-line overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="bg-bg2/60 border-b border-line">
                  <th className="text-left px-5 py-4 text-[11px] uppercase tracking-[0.12em] text-mute font-semibold">
                    Característica
                  </th>
                  <th className="text-center px-5 py-4 text-[11px] uppercase tracking-[0.12em] text-mute font-semibold w-28">
                    Elite
                  </th>
                  <th className="text-center px-5 py-4 text-[11px] uppercase tracking-[0.12em] font-semibold w-28 bg-brand-soft text-brand-700 relative">
                    Pro
                    <span className="absolute top-1 right-1 px-1.5 py-0 rounded-full text-[9px] font-bold bg-brand text-white">
                      ★
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_FEATURES.map((f, i) => (
                  <tr
                    key={f.label}
                    className={`border-t border-line ${i % 2 === 1 ? 'bg-bg2/30' : 'bg-surface'}`}
                  >
                    <td className="px-5 py-3.5 text-ink">{f.label}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex justify-center">
                        {f.elite ? (
                          <CheckCircle color="#22C55E" />
                        ) : (
                          <CrossMinimal />
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 bg-brand-soft/40">
                      <div className="flex justify-center">
                        {f.pro ? (
                          <CheckCircle color="#22C55E" />
                        ) : (
                          <CrossMinimal />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FOOTER — ASESOR + PRÓXIMO PASO */}
      <section className="px-6 sm:px-10 py-10 bg-bg2/40 border-t border-line">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 items-center">
          <div>
            <Eyebrow>Tu asesor Clubify</Eyebrow>
            <div className="text-lg font-semibold text-ink mt-1">
              {advisorName || 'Asesor comercial Clubify'}
            </div>
            <p className="text-sm text-mute mt-1 leading-relaxed">
              Cualquier duda escribime y armamos el setup. La activación
              completa toma 24 horas hábiles.
            </p>
            {(phone || email) && (
              <div className="text-xs text-mute mt-3">
                Datos del prospect: {phone && <span>{phone}</span>}
                {phone && email ? ' · ' : ''}
                {email && <span>{email}</span>}
              </div>
            )}
          </div>
          <div className="text-right">
            <div
              className="inline-block px-4 py-3 rounded-xl text-white text-center shadow-md2"
              style={{ background: template.accent }}
            >
              <div className="text-xs uppercase tracking-wider opacity-90">
                Inversión mensual
              </div>
              <div className="text-3xl font-bold tracking-tight mt-1">
                {fmtMoney(price, currency)}
              </div>
              <div className="text-[11px] opacity-80 mt-1">
                Pago directo · sin contrato largo
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
