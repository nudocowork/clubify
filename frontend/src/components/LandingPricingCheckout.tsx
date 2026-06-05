'use client';
import { useState } from 'react';

/**
 * Selector de planes tipo checkout en la landing pública (Preview 5).
 * Pattern: 4 opciones tipo radio apiladas, cada una con precio +
 * equivalente mensual + ahorro. Total dinámico abajo + CTA "Continuar
 * al pago" que abre el checkout del plan seleccionado.
 *
 * Recibe los 4 planes como prop desde el server component (que los
 * fetcha del endpoint /api/landing-plans). Si el founder no configuró
 * el checkoutUrl del plan elegido, el botón sale como "Próximamente"
 * deshabilitado para no enviar al usuario a un link roto.
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

export function LandingPricingCheckout({ plans }: { plans: LandingPlan[] }) {
  const [selected, setSelected] = useState<PlanId>('anual');
  const plan = plans.find((p) => p.id === selected) ?? plans[0];
  if (!plan) return null;
  const mensualPlan = plans.find((p) => p.id === 'mensual');
  const mensualPrice = mensualPlan?.price ?? MENSUAL_PRICE_FALLBACK;
  const hasUrl = !!plan.checkoutUrl;

  return (
    <div className="max-w-md mx-auto bg-white rounded-2xl border border-line2 p-5 sm:p-6 shadow-sm">
      <h3 className="text-base font-bold">Elige tu plan</h3>
      <p className="text-xs text-mute mt-1">
        Pago seguro · activación inmediata.
      </p>

      <div className="mt-5 space-y-2.5">
        {plans.map((p) => {
          const active = selected === p.id;
          const save = mensualPrice * p.months - p.price;
          const perMonth = p.price / p.months;
          return (
            <label
              key={p.id}
              className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer touch-manipulation select-none transition active:scale-[0.99] [-webkit-tap-highlight-color:transparent] ${
                active
                  ? 'border-brand bg-brand-soft/40'
                  : 'border-line2 bg-white hover:bg-bg2/40'
              }`}
            >
              <input
                type="radio"
                name="plan"
                className="sr-only"
                checked={active}
                onChange={() => setSelected(p.id)}
              />
              <div
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-none ${
                  active ? 'border-brand' : 'border-line2'
                }`}
              >
                {active && (
                  <div className="w-2.5 h-2.5 rounded-full bg-brand" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm flex items-center gap-2 flex-wrap">
                  {p.name}
                  {p.id === 'anual' && (
                    <span className="text-[9px] uppercase tracking-wider font-bold bg-brand text-white px-1.5 py-0.5 rounded">
                      Mejor precio
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-mute mt-0.5">
                  {fmtUSDDec(perMonth)} / mes
                  {save > 0 && (
                    <>
                      {' '}
                      ·{' '}
                      <span className="text-brand font-semibold">
                        ahorras {fmtUSD(save)}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="font-bold text-base flex-none">
                {fmtUSD(p.price)}
              </div>
            </label>
          );
        })}
      </div>

      <div className="mt-5 pt-5 border-t border-line2">
        <div className="flex justify-between items-baseline mb-3">
          <span className="text-sm text-mute">Total hoy</span>
          <span className="text-2xl font-bold">{fmtUSD(plan.price)}</span>
        </div>
        {hasUrl ? (
          <a
            href={plan.checkoutUrl!}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center w-full bg-brand text-white font-semibold py-3.5 rounded-pill hover:opacity-95 transition cursor-pointer touch-manipulation [-webkit-tap-highlight-color:transparent] active:scale-[0.98]"
          >
            Continuar al pago →
          </a>
        ) : (
          <button
            type="button"
            disabled
            className="inline-flex items-center justify-center w-full bg-mute/30 text-mute font-semibold py-3.5 rounded-pill cursor-not-allowed"
            title="Próximamente — pendiente configurar el link de pago"
          >
            Próximamente
          </button>
        )}
        <div className="text-center text-[11px] text-mute mt-3">
          🔒 Pago seguro vía Hotmart · Garantía 7 días
        </div>
      </div>
    </div>
  );
}
