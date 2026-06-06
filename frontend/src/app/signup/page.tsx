import Link from 'next/link';
import { RefCapture } from '@/components/RefCapture';
import { Logo } from '@/components/Logo';
import { LandingPricingCheckout } from '@/components/LandingPricingCheckout';
import { fetchLandingPlans } from '@/lib/landing-plans';

// Flujo "pago → datos" (2026-06-06): /signup es el PICKER de planes —
// muestra los 4 planes igual que la página principal (lo que pedía el
// flujo del referido /ref/<slug> → /signup?ref=...). El cliente elige
// plan → paga en Hotmart → vuelve a /activar a crear su cuenta.
//
// RefCapture persiste la atribución (?ref/?via/?utm/?qt) en localStorage
// para que /activar la mande al backend tras el pago. El plan elegido lo
// persiste el CTA del picker (clubify:plan-period).
export const dynamic = 'force-dynamic';

type PlanId = 'mensual' | 'trimestral' | 'semestral' | 'anual';

export default async function SignupPage({
  searchParams,
}: {
  searchParams: { plan?: string };
}) {
  const plans = await fetchLandingPlans();
  const valid: PlanId[] = ['mensual', 'trimestral', 'semestral', 'anual'];
  const raw = (searchParams?.plan ?? '').toLowerCase();
  const initial = (valid.includes(raw as PlanId) ? raw : 'anual') as PlanId;

  return (
    <main className="min-h-screen bg-bg flex flex-col">
      <RefCapture />
      <header className="border-b border-line bg-white px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center">
            <Logo size={32} />
          </Link>
          <Link href="/login" className="text-sm text-mute hover:text-ink">
            ¿Ya tienes cuenta? Ingresar →
          </Link>
        </div>
      </header>

      <section className="flex-1 flex items-center justify-center px-6 py-10 lg:py-16">
        <div className="w-full max-w-md">
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-2 bg-brand-soft text-brand-700 text-xs font-semibold px-3 py-1 rounded-full mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-brand" />
              Activación inmediata
            </div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              Elige tu plan y empieza hoy
            </h1>
            <p className="text-mute mt-2 leading-relaxed">
              Eliges tu plan, pagas seguro con Hotmart y creas tu cuenta en
              1 minuto. Apenas se confirma el pago entras al panel.
            </p>
          </div>

          <LandingPricingCheckout plans={plans} initialPlan={initial} />

          <p className="text-center text-xs text-mute mt-6">
            ¿Ya pagaste y necesitas crear tu cuenta?{' '}
            <Link href="/activar" className="text-brand hover:underline">
              Completar mi cuenta →
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
