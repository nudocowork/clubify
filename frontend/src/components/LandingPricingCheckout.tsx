'use client';
import { useState, type ReactNode } from 'react';
import { useHidesPurchases } from '@/lib/native';

/**
 * Selector de planes tipo checkout en la landing pública (Preview 5).
 * Pattern: 4 opciones tipo radio apiladas, cada una con precio +
 * equivalente mensual + ahorro. Total dinámico abajo + CTA "Continuar
 * al pago".
 *
 * Flow (2026-06-06 — "pago → datos"): el CTA abre el checkout de Hotmart
 * del plan elegido DIRECTO. El cliente paga primero y, al volver (página
 * de gracias de Hotmart → /activar), crea su cuenta. Antes de redirigir
 * persistimos el plan elegido en localStorage (`clubify:plan-period`)
 * para que /activar lo recupere; la atribución del referido ya está en
 * localStorage vía RefCapture.
 *
 * Recibe los 4 planes como prop (fetchados de /api/landing-plans). Si el
 * founder no configuró el checkoutUrl del plan, el botón sale como
 * "Próximamente" deshabilitado.
 *
 * Se reutiliza tal cual en la landing (/) y en /signup (entrada del
 * referido) — mismos 4 planes, mismo comportamiento.
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

export function LandingPricingCheckout({
  plans,
  initialPlan = 'anual',
  footnote,
  installationFeeUsd = null,
  installationPromoUsd = null,
}: {
  plans: LandingPlan[];
  /** Plan preseleccionado (ej. ?plan= del CTA de la landing). Default: anual. */
  initialPlan?: PlanId;
  /** Texto al pie del checkout (gris, chico). Default: nota de Hotmart de
   *  Clubify. Las marcas blancas pasan el suyo. */
  footnote?: ReactNode;
  /** Costo de instalación/implementación de la marca (USD). Si está, se cobra
   *  en planes NO anuales y se muestra el desglose; el anual lo incluye gratis
   *  (cuenta como ahorro). Null = sin línea de instalación. */
  installationFeeUsd?: number | null;
  /** Precio promocional de instalación (USD). Si está, se muestra el fee
   *  original tachado + "PRECIO PROMOCIONAL" y este es el cobrado. */
  installationPromoUsd?: number | null;
}) {
  // iOS: la app es solo para cuentas que ya existen. Mostrar planes y precios
  // con checkout externo es exactamente lo que Apple rechaza por 3.1.1, y esto
  // se alcanza desde /signup, a dos toques del login. El hook va antes del
  // return para no romper el orden de hooks entre renders.
  const sinCompras = useHidesPurchases();
  const [selected, setSelected] = useState<PlanId>(initialPlan);
  if (sinCompras) {
    return (
      <div className="rounded-2xl bg-bg2 px-5 py-6 text-center text-sm text-mute leading-relaxed">
        Los planes se contratan desde el panel web. Si ya tienes cuenta, inicia
        sesión para entrar.
      </div>
    );
  }
  const plan = plans.find((p) => p.id === selected) ?? plans[0];
  if (!plan) return null;
  const mensualPlan = plans.find((p) => p.id === 'mensual');
  const mensualPrice = mensualPlan?.price ?? MENSUAL_PRICE_FALLBACK;
  const hasUrl = !!plan.checkoutUrl;

  // Instalación: el monto que realmente se cobra es el promo (si hay) o el fee.
  // El plan ANUAL la incluye gratis (no se suma al total y cuenta como ahorro);
  // los demás planes la pagan una vez junto al primer ciclo.
  const installCharge = installationPromoUsd ?? installationFeeUsd ?? 0;
  const hasInstall = installCharge > 0;
  const planPaysInstall = hasInstall && plan.id !== 'anual';
  const totalToday = plan.price + (planPaysInstall ? installCharge : 0);
  // Mostrar fee tachado + promo solo si hay un descuento real (fee > promo).
  const showPromo =
    installationFeeUsd != null &&
    installationPromoUsd != null &&
    installationFeeUsd > installationPromoUsd;

  // Pago → datos: persistimos el plan elegido para que /activar lo
  // recupere post-pago y abrimos el checkout de Hotmart directo. La
  // atribución del referido (ref/via/utm) ya está en localStorage (RefCapture).
  //
  // ATRIBUCIÓN ROBUSTA (2026-08-15): además del localStorage (que se pierde si
  // paga otra persona / otro dispositivo / incógnito), inyectamos el código del
  // afiliado como `?src=<code>` en la URL de Hotmart. Hotmart lo devuelve en el
  // webhook como `purchase.tracking.source` y el backend
  // (ensureAffiliateAttributionFromSrc) atribuye server-side aunque el
  // localStorage no sobreviva el ida-y-vuelta del pago. Sin esto, una compra por
  // el link del afiliado llegaba a Hotmart con tracking vacío → negocio sin
  // afiliado (caso Monet, comprador ≠ dueño de la cuenta).
  function goToCheckout() {
    if (!plan.checkoutUrl) return;
    try {
      localStorage.setItem('clubify:plan-period', plan.id);
    } catch {}
    let url = plan.checkoutUrl;
    try {
      const ref = localStorage.getItem('clubify:ref');
      if (ref) {
        const u = new URL(url, window.location.origin);
        const existing = u.searchParams.get('src');
        // FIX 2026-08-18: si el checkout ya trae el token de MARCA (src=wl_<uuid>,
        // que inyecta el Master Admin para rutear créditos), COMBINAMOS en vez de
        // descartar el afiliado: `<CODE>-wl_<uuid>` lleva afiliado Y marca. El
        // backend parsea ambos por separado. Antes se perdía el afiliado en toda
        // compra de marca blanca por link de referido (caso Taquería).
        if (!existing) {
          u.searchParams.set('src', ref);
        } else if (
          /wl[_-]/i.test(existing) &&
          !existing.toUpperCase().includes(ref.toUpperCase())
        ) {
          u.searchParams.set('src', `${ref}-${existing}`);
        }
        url = u.toString();
      }
    } catch {
      // URL inválida o sin acceso a storage → seguimos con la URL cruda.
    }
    window.location.href = url;
  }

  return (
    <div className="max-w-md mx-auto bg-white rounded-2xl border border-line2 p-5 sm:p-6 shadow-sm">
      <h3 className="text-base font-bold">Elige tu plan</h3>
      <p className="text-xs text-mute mt-1">
        Pago seguro · activación inmediata.
      </p>

      <div className="mt-5 space-y-2.5">
        {plans.map((p) => {
          const active = selected === p.id;
          // Ahorro = (equivalente mensual del periodo − precio del periodo). El
          // ANUAL suma además la instalación que se ahorra (la incluye gratis).
          const save =
            mensualPrice * p.months -
            p.price +
            (hasInstall && p.id === 'anual' ? installCharge : 0);
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
        {/* Instalación: fee original tachado + PRECIO PROMOCIONAL en mayúscula. */}
        {hasInstall && (
          <div className="flex justify-between items-baseline mb-2 text-sm">
            <span className="text-mute">Costo de instalación</span>
            <span>
              {planPaysInstall ? (
                <>
                  {showPromo && (
                    <span className="text-mute line-through mr-2">
                      {fmtUSD(installationFeeUsd as number)}
                    </span>
                  )}
                  {showPromo && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-brand mr-1.5">
                      Precio promocional
                    </span>
                  )}
                  <span className="font-semibold">{fmtUSD(installCharge)}</span>
                </>
              ) : (
                <span className="font-semibold text-brand">Incluida</span>
              )}
            </span>
          </div>
        )}
        <div className="flex justify-between items-baseline mb-1">
          <span className="text-sm text-mute">Total hoy</span>
          <span className="text-2xl font-bold">{fmtUSD(totalToday)}</span>
        </div>
        {/* Desglose cuando se cobra instalación (ej. $80 plan + $100 instalación). */}
        {planPaysInstall && (
          <div className="text-[11px] text-mute mb-3">
            {fmtUSD(plan.price)} {plan.name.toLowerCase()} + {fmtUSD(installCharge)} instalación
          </div>
        )}
        {!planPaysInstall && <div className="mb-3" />}
        {hasUrl ? (
          <button
            type="button"
            onClick={goToCheckout}
            className="inline-flex items-center justify-center w-full bg-brand text-white font-semibold py-3.5 rounded-pill hover:opacity-95 transition cursor-pointer touch-manipulation [-webkit-tap-highlight-color:transparent] active:scale-[0.98]"
          >
            Continuar al pago →
          </button>
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
          {footnote ??
            'Pago seguro con Hotmart. Apenas pagas, creas tu cuenta en 1 minuto.'}
        </div>
      </div>
    </div>
  );
}
