'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import {
  QUOTE_TEMPLATES,
  type QuoteTemplate,
} from '@/lib/quote-templates';
import {
  getPlanBenefits,
  type QuotePlan,
} from '@/lib/quote-benefits';
import { QuotePreviewPremium } from '@/components/QuotePreviewPremium';
import { getUser } from '@/lib/api';

type Step = 1 | 2 | 3 | 4 | 5;
type Pricing = { eliteCost: number; proCost: number; currency: string };

const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: 'Cliente' },
  { n: 2, label: 'Plantilla' },
  { n: 3, label: 'Plan' },
  { n: 4, label: 'Preview' },
  { n: 5, label: 'Confirmar' },
];

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

export default function NuevaCotizacionPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [template, setTemplate] = useState<QuoteTemplate | null>(null);
  const [plan, setPlan] = useState<QuotePlan | null>(null);

  useEffect(() => {
    api<Pricing>('/admin/pricing')
      .then(setPricing)
      .catch((e) => toast(e.message || 'No se pudo cargar precios', 'error'));
  }, []);

  const step1Valid = customerName.trim().length > 0 && businessName.trim().length > 0;
  const step2Valid = !!template;
  const step3Valid = !!plan;

  function next() {
    if (step === 1 && !step1Valid) {
      toast('Cliente y negocio son obligatorios', 'error');
      return;
    }
    if (step === 2 && !step2Valid) {
      toast('Seleccioná una plantilla', 'error');
      return;
    }
    if (step === 3 && !step3Valid) {
      toast('Seleccioná un plan', 'error');
      return;
    }
    setStep((s) => (Math.min(5, s + 1) as Step));
  }

  function back() {
    setStep((s) => (Math.max(1, s - 1) as Step));
  }

  async function submit() {
    if (!plan || !template) return;
    setSubmitting(true);
    try {
      await api('/admin/quotes', {
        method: 'POST',
        body: JSON.stringify({
          customerName: customerName.trim(),
          businessName: businessName.trim(),
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          plan,
          templateSlug: template.slug,
        }),
      });
      toast('Cotización creada', 'success');
      router.push('/admin/cotizaciones');
    } catch (e: any) {
      toast(e.message || 'No se pudo crear la cotización', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const priceFor = (p: QuotePlan) =>
    pricing ? (p === 'ELITE' ? pricing.eliteCost : pricing.proCost) : 0;
  const currency = pricing?.currency ?? 'USD';

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Nueva cotización <span className="page-crumb">/ Paso {step} de 5</span>
        </h1>
        <Link className="btn-ghost" href="/admin/cotizaciones">
          Cancelar
        </Link>
      </div>

      {/* Stepper */}
      <div className="card card-pad mb-5">
        <div className="flex items-center justify-between gap-2 overflow-x-auto">
          {STEPS.map((s, i) => (
            <div key={s.n} className="flex items-center gap-2 flex-1 min-w-0">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${
                  step === s.n
                    ? 'bg-brand text-white'
                    : step > s.n
                    ? 'bg-brand-soft text-brand'
                    : 'bg-bg2 text-mute'
                }`}
              >
                {step > s.n ? '✓' : s.n}
              </div>
              <span
                className={`text-sm truncate ${
                  step === s.n ? 'font-semibold' : 'text-mute'
                }`}
              >
                {s.label}
              </span>
              {i < STEPS.length - 1 && (
                <div
                  className={`h-px flex-1 ${
                    step > s.n ? 'bg-brand/60' : 'bg-line'
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step 1 — Datos cliente */}
      {step === 1 && (
        <div className="card card-pad">
          <h2 className="text-base font-semibold m-0">Datos del cliente</h2>
          <p className="text-xs text-mute mt-1">
            Esta información aparece en el encabezado del PDF y en el CRM.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div>
              <label className="label">Nombre del cliente *</label>
              <input
                className="input"
                placeholder="ej: Juan Pérez"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="label">Nombre del negocio *</label>
              <input
                className="input"
                placeholder="ej: Café Aroma"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Teléfono / WhatsApp</label>
              <input
                className="input"
                placeholder="+57 300 000 0000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                placeholder="cliente@negocio.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Step 2 — Plantilla */}
      {step === 2 && (
        <div className="card card-pad">
          <h2 className="text-base font-semibold m-0">Elegí una plantilla</h2>
          <p className="text-xs text-mute mt-1">
            Cambia paleta, ejemplos y "ganchos comerciales" según el rubro del
            cliente.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
            {QUOTE_TEMPLATES.map((t) => {
              const active = template?.slug === t.slug;
              return (
                <button
                  key={t.slug}
                  onClick={() => setTemplate(t)}
                  className={`text-left rounded-xl border-2 p-4 transition ${
                    active
                      ? 'border-brand bg-brand-soft'
                      : 'border-line hover:border-brand/40 hover:bg-bg2/50'
                  }`}
                  style={
                    active
                      ? {
                          borderColor: t.accent,
                          background: `${t.accent}10`,
                        }
                      : undefined
                  }
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="text-2xl rounded-lg w-10 h-10 flex items-center justify-center"
                      style={{ background: `${t.accent}20` }}
                    >
                      {t.emoji}
                    </span>
                    <h3 className="text-sm font-semibold m-0">{t.name}</h3>
                    {active && (
                      <span className="ml-auto text-brand">
                        <Icon name="check" />
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-mute mt-2 leading-relaxed">
                    {t.tagline}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 3 — Plan */}
      {step === 3 && (
        <div className="card card-pad">
          <h2 className="text-base font-semibold m-0">Seleccioná el plan</h2>
          <p className="text-xs text-mute mt-1">
            El precio se congela en el snapshot de la cotización: cambios
            futuros en /admin/cotizaciones/precios no afectan ésta.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            {(['ELITE', 'PRO'] as const).map((p) => {
              const active = plan === p;
              const benefits = getPlanBenefits(p);
              return (
                <button
                  key={p}
                  onClick={() => setPlan(p)}
                  className={`text-left rounded-xl border-2 p-5 transition relative ${
                    active
                      ? p === 'PRO'
                        ? 'border-brand bg-brand-soft'
                        : 'border-brand bg-brand-soft'
                      : 'border-line hover:border-brand/40 hover:bg-bg2/50'
                  }`}
                >
                  {p === 'PRO' && (
                    <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-brand text-white">
                      Recomendado
                    </span>
                  )}
                  <div className="text-sm font-semibold text-mute uppercase tracking-wide">
                    Plan {p === 'ELITE' ? 'Elite' : 'Pro'}
                  </div>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-3xl font-bold">
                      {pricing ? fmtMoney(priceFor(p), currency) : '—'}
                    </span>
                    <span className="text-sm text-mute">/ mes</span>
                  </div>
                  <ul className="mt-4 space-y-2">
                    {benefits.map((b) => (
                      <li
                        key={b.title}
                        className="flex items-start gap-2 text-sm"
                      >
                        <span className="text-base shrink-0">{b.icon}</span>
                        <span className="leading-snug">{b.title}</span>
                      </li>
                    ))}
                  </ul>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 4 — Preview premium */}
      {step === 4 && plan && template && (
        <QuotePreviewPremium
          customerName={customerName}
          businessName={businessName}
          phone={phone || undefined}
          email={email || undefined}
          plan={plan}
          template={template}
          price={priceFor(plan)}
          currency={currency}
          advisorName={getUser()?.fullName || getUser()?.email}
        />
      )}

      {/* Step 5 — Confirmar */}
      {step === 5 && plan && template && (
        <div className="card card-pad">
          <h2 className="text-base font-semibold m-0">Resumen de la cotización</h2>
          <p className="text-xs text-mute mt-1">
            Revisá los datos. Al confirmar, queda registrada en el CRM con tu
            usuario como asesor y el precio actual congelado.
          </p>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 mt-4 text-sm">
            <SummaryItem label="Cliente" value={customerName} />
            <SummaryItem label="Negocio" value={businessName} />
            <SummaryItem label="Teléfono" value={phone || '—'} />
            <SummaryItem label="Email" value={email || '—'} />
            <SummaryItem
              label="Plantilla"
              value={`${template.emoji} ${template.name}`}
            />
            <SummaryItem
              label="Plan"
              value={`${plan === 'PRO' ? 'Pro' : 'Elite'} — ${fmtMoney(priceFor(plan), currency)} / mes`}
            />
          </dl>
          <div className="mt-5 p-3 rounded-lg bg-brand-soft border border-brand/20 text-xs text-mute leading-relaxed">
            La descarga del PDF profesional llega en la próxima fase. Por ahora
            la cotización queda guardada en el CRM con su snapshot de precio y
            podés re-abrir el preview cuando quieras.
          </div>
        </div>
      )}

      {/* Footer navegación */}
      <div className="flex items-center justify-between mt-5">
        <button
          className="btn-ghost"
          onClick={back}
          disabled={step === 1 || submitting}
        >
          Atrás
        </button>
        {step < 5 ? (
          <button
            className="btn-primary"
            onClick={next}
            disabled={
              (step === 1 && !step1Valid) ||
              (step === 2 && !step2Valid) ||
              (step === 3 && !step3Valid) ||
              (step === 4 && (!plan || !template))
            }
          >
            Siguiente <Icon name="arrow-right" />
          </button>
        ) : (
          <button
            className="btn-primary"
            onClick={submit}
            disabled={submitting || !plan || !template}
          >
            <Icon name="check" />{' '}
            {submitting ? 'Creando…' : 'Confirmar y crear cotización'}
          </button>
        )}
      </div>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.1em] text-mute font-semibold">
        {label}
      </dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}

