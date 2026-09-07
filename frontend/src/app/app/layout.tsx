import AppShell from '@/components/AppShell';
import { AffiliateBroadcastBanner } from '@/components/AffiliateBroadcastBanner';
import { LoginPopupBroadcast } from '@/components/LoginPopupBroadcast';
import { OnboardingFlow } from '@/components/OnboardingFlow';
import { resolveBrandFromHeaders } from '@/lib/server-brand';

export default async function TenantLayout({ children }: { children: React.ReactNode }) {
  // Color de la marca resuelto en server por host → el primer paint del panel
  // ya sale con el color real (sin flash del verde Clubify / FODT).
  const brand = await resolveBrandFromHeaders();
  return (
    <AppShell
      variant="app"
      serverBrandColor={brand?.primaryColor ?? null}
      serverBrandBackground={brand?.backgroundColor ?? null}
      serverBrandLogo={brand?.logoUrl ?? null}
      serverBrandName={brand?.name ?? null}
    >
      {/* Difusión interna con audiencia «Negocios»: novedades del producto,
          avisos y noticias. El backend decide a quién le toca — al dueño del
          negocio, nunca a sus empleados, y nunca las piezas de afiliados. */}
      <AffiliateBroadcastBanner />
      {children}
      <OnboardingFlow />
      <LoginPopupBroadcast />
    </AppShell>
  );
}
