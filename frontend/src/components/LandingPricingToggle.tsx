'use client';
import { useState } from 'react';

/**
 * Toggle de planes en la landing pública (soyclubify.com#precios).
 * Pattern Preview 2 — selector pill arriba + 1 card grande centrada
 * que cambia al elegir periodicidad.
 *
 * Recibe los 4 planes como prop desde el server component (que los
 * fetcha del endpoint /api/landing-plans). Si el founder no configuró
 * un checkoutUrl, el botón queda deshabilitado con el texto
 * "Configurar pronto" para no enviar al usuario a un link roto.
 */

type PlanId = 'mensual' | 'trimestral' | 'semestral' | 'anual';

export type LandingPlan = {
  id: PlanId;
  name: string;
  shortName: string;
  months: number;
  price: number;
  checkoutUrl: string | null;
  description: string;
};

const MENSUAL_PRICE_FALLBACK = 68;

function fmtUSD(n: number): string {
  return `${Math.round(n)} USD`;
}
function fmtUSDDec(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return `${rounded.toFixed(rounded % 1 === 0 ? 0 : 1)} USD`;
}

export function LandingPricingToggle({ plans }: { plans: LandingPlan[] }) {
  const [active, setActive] = useState<PlanId>('anual');
  const plan = plans.find((p) => p.id === active) ?? plans[0];
  if (!plan) return null;
  const mensualPlan = plans.find((p) => p.id === 'mensual');
  const mensualPrice = mensualPlan?.price ?? MENSUAL_PRICE_FALLBACK;
  const perMonth = plan.price / plan.months;
  const save = mensualPrice * plan.months - plan.price;
  const hasUrl = !!plan.checkoutUrl;

  return (
    <div className="max-w-md mx-auto">
      {/* Selector */}
      <div className="bg-bg2 rounded-pill p-1 flex gap-1">
        {plans.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setActive(p.id)}
            className={`flex-1 text-xs sm:text-sm font-semibold py-2.5 rounded-pill transition cursor-pointer touch-manipulation select-none active:scale-[0.97] [-webkit-tap-highlight-color:transparent] ${
              active === p.id
                ? 'bg-white text-ink shadow-sm'
                : 'text-mute hover:text-ink'
            }`}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* Card principal */}
      <div className="mt-5 bg-white rounded-2xl border border-line2 p-6 sm:p-8 text-center">
        <h3 className="text-xl font-bold">{plan.name}</h3>
        <div className="mt-5">
          <div className="text-5xl font-bold">{fmtUSD(plan.price)}</div>
          <div className="text-sm text-mute mt-2">
            Equivale a {fmtUSDDec(perMonth)} / mes
          </div>
        </div>
        <p className="text-sm text-mute leading-relaxed mt-4">
          {plan.description}
        </p>
        {save > 0 && (
          <div className="mt-4 inline-flex items-center gap-1.5 bg-brand-soft text-brand text-xs font-semibold px-3 py-1.5 rounded-pill">
            💰 Ahorras {fmtUSD(save)} vs el mensual
          </div>
        )}
        {hasUrl ? (
          <a
            href={plan.checkoutUrl!}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex items-center justify-center w-full bg-brand text-white font-semibold py-3.5 rounded-pill hover:opacity-95 transition cursor-pointer touch-manipulation [-webkit-tap-highlight-color:transparent] active:scale-[0.98]"
          >
            Pagar ahora →
          </a>
        ) : (
          <button
            type="button"
            disabled
            className="mt-6 inline-flex items-center justify-center w-full bg-mute/30 text-mute font-semibold py-3.5 rounded-pill cursor-not-allowed"
            title="Próximamente — pendiente configurar el link de pago"
          >
            Próximamente
          </button>
        )}
        <div className="mt-3 text-[11px] text-mute">
          Activación inmediata. Cancela cuando quieras.
        </div>
      </div>
    </div>
  );
}
